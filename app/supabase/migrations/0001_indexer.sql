-- Kestrel trace/event indexer schema.
--
-- Three tables:
--   markets  — one row per Market PDA (denormalized timeline header).
--   events   — append-only timeline of decoded Kestrel program instructions.
--   cursors  — per-cluster (base | er) resume marker for the indexer worker.

create extension if not exists pgcrypto;

create table if not exists public.markets (
  market_pubkey   text primary key,
  market_id       integer not null,
  open_ts         bigint,
  close_ts        bigint,
  status          text,
  strike_price    bigint,
  close_price     bigint,
  winner          text,
  created_sig          text,
  delegated_sig        text,
  opened_sig           text,
  closed_sig           text,
  settled_sig          text,
  undelegated_sig      text,
  updated_at      timestamptz not null default now()
);

create unique index if not exists markets_market_id_key on public.markets (market_id);

create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  signature       text not null,
  ix_index        integer not null,
  cluster         text not null check (cluster in ('base', 'er')),
  slot            bigint,
  block_time      timestamptz,
  market_pubkey   text references public.markets(market_pubkey) on delete set null,
  market_id       integer,
  kind            text not null,
  actor           text,
  args            jsonb not null default '{}'::jsonb,
  accounts        jsonb not null default '{}'::jsonb,
  success         boolean not null default true,
  err             text,
  decision        jsonb,
  inserted_at     timestamptz not null default now(),
  unique (signature, ix_index)
);

create index if not exists events_market_id_block_time_idx
  on public.events (market_id, block_time desc nulls last);

create index if not exists events_market_pubkey_inserted_at_idx
  on public.events (market_pubkey, inserted_at desc);

create index if not exists events_kind_inserted_at_idx
  on public.events (kind, inserted_at desc);

create table if not exists public.cursors (
  cluster         text primary key check (cluster in ('base', 'er')),
  last_signature  text,
  last_slot       bigint,
  updated_at      timestamptz not null default now()
);

-- Ensure the rolling cursor rows always exist so the worker can upsert blindly.
insert into public.cursors (cluster) values ('base'), ('er')
  on conflict do nothing;

-- Realtime: publish events + markets so the UI can subscribe.
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.markets;

-- RLS: the dashboard is a read-only public trace, the indexer writes via the
-- service role key (which bypasses RLS).
alter table public.markets enable row level security;
alter table public.events  enable row level security;
alter table public.cursors enable row level security;

drop policy if exists "markets are public" on public.markets;
drop policy if exists "events are public"  on public.events;
drop policy if exists "cursors are public" on public.cursors;

create policy "markets are public" on public.markets for select using (true);
create policy "events are public"  on public.events  for select using (true);
create policy "cursors are public" on public.cursors for select using (true);
