export type Cluster = "base" | "er";

/** Last-close strip: minimal fields from indexer (client-safe). */
export interface MarketCloseOutcome {
  market_id: number;
  winner: string;
}

export interface MarketRow {
  market_pubkey: string;
  market_id: number;
  open_ts: number | null;
  close_ts: number | null;
  status: string | null;
  // Supabase can return `bigint` as string; callers should coerce as needed.
  strike_price: number | string | null;
  close_price: number | string | null;
  winner: string | null;
  created_sig: string | null;
  delegated_sig: string | null;
  opened_sig: string | null;
  closed_sig: string | null;
  settled_sig: string | null;
  undelegated_sig: string | null;
  updated_at: string;
}

export interface EventRow {
  id: string;
  signature: string;
  ix_index: number;
  cluster: Cluster;
  slot: number | null;
  block_time: string | null;
  market_pubkey: string | null;
  market_id: number | null;
  kind: string;
  actor: string | null;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  success: boolean;
  err: string | null;
  decision: Record<string, unknown> | null;
  inserted_at: string;
}

export const MARKET_STATUS = [
  "pending",
  "open",
  "halted",
  "closed",
  "settled",
] as const;

export type MarketStatus = (typeof MARKET_STATUS)[number];

export type AgentRole = "market_ops" | "trader" | "risk_lp";

/**
 * Roll-up of an agent's lifecycle as the indexer + agent runtime see it.
 * Mirrors the `public.agents` table from
 * `app/supabase/migrations/0002_agent_trace.sql`.
 */
export interface AgentRow {
  owner_pubkey: string;
  agent_pda: string | null;
  role: AgentRole | null;
  label: string | null;
  current_policy: Record<string, unknown> | null;
  current_balance: number | string | null;
  registered_at: string | null;
  last_event_at: string | null;
  updated_at: string;
}
