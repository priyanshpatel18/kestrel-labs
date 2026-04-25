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
  strike_price: number | null;
  close_price: number | null;
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
