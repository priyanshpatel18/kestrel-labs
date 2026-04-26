-- Kestrel agent-trace schema upgrades.
--
--  - events gains an `event_seq` column so multiple Anchor `#[event]`s can
--    cluster under a single `(signature, ix_index)` without colliding on the
--    primary unique index.
--  - public.agents is the per-owner roll-up the indexer maintains from
--    register_agent / update_policy / deposit / withdraw / place_bet / settle
--    so the /agents pages can render without scanning the events stream.
--  - Realtime + RLS are wired so the dashboard can subscribe with the anon
--    key.

alter table public.events
  add column if not exists event_seq integer not null default 0;

-- Replace the old (signature, ix_index) unique key with one that also keys
-- on event_seq so derived synthetic rows (PlaceBetAttempted / PlaceBetBlocked
-- / decoded BetPlaced) can coexist on the same instruction.
alter table public.events
  drop constraint if exists events_signature_ix_index_key;

create unique index if not exists events_sig_ix_seq_key
  on public.events (signature, ix_index, event_seq);

create index if not exists events_actor_block_time_idx
  on public.events (actor, block_time desc nulls last);

create table if not exists public.agents (
  owner_pubkey    text primary key,
  agent_pda       text,
  role            text,                -- 'market_ops' | 'trader' | 'risk_lp' (set by runtime)
  label           text,
  current_policy  jsonb,
  current_balance bigint,
  registered_at   timestamptz,
  last_event_at   timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists agents_role_last_event_idx
  on public.agents (role, last_event_at desc nulls last);

alter publication supabase_realtime add table public.agents;

alter table public.agents enable row level security;

drop policy if exists "agents are public" on public.agents;
create policy "agents are public" on public.agents for select using (true);
