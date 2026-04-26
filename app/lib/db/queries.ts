import "server-only";

import { getReadSupabase } from "../supabase/server";
import {
  MARKET_STATUS,
  type AgentRow,
  type EventRow,
  type MarketCloseOutcome,
  type MarketRow,
  type MarketStatus,
} from "../types";

export async function fetchAllMarkets(opts?: {
  status?: string;
  limit?: number;
}): Promise<MarketRow[]> {
  const sb = getReadSupabase();
  let q = sb
    .from("markets")
    .select("*")
    .order("market_id", { ascending: false });
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MarketRow[];
}

export async function fetchMarketById(
  marketId: number,
): Promise<MarketRow | null> {
  const sb = getReadSupabase();
  const { data, error } = await sb
    .from("markets")
    .select("*")
    .eq("market_id", marketId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as MarketRow | null;
}

export async function fetchMarketEvents(
  marketId: number,
  limit = 500,
): Promise<EventRow[]> {
  const sb = getReadSupabase();
  const { data, error } = await sb
    .from("events")
    .select("*")
    .eq("market_id", marketId)
    .order("inserted_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function fetchRecentEvents(limit = 50): Promise<EventRow[]> {
  const sb = getReadSupabase();
  const { data, error } = await sb
    .from("events")
    .select("*")
    .order("inserted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function fetchAgentEvents(
  ownerPubkey: string,
  limit = 200,
): Promise<EventRow[]> {
  const sb = getReadSupabase();
  const { data, error } = await sb
    .from("events")
    .select("*")
    .eq("actor", ownerPubkey)
    .order("inserted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Newest-first from the query, oldest-first for the timeline UI.
  return ((data ?? []) as EventRow[]).reverse();
}

export async function fetchAgentRow(
  ownerPubkey: string,
): Promise<AgentRow | null> {
  const sb = getReadSupabase();
  const { data, error } = await sb
    .from("agents")
    .select("*")
    .eq("owner_pubkey", ownerPubkey)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AgentRow | null;
}

export async function fetchAllAgents(): Promise<AgentRow[]> {
  const sb = getReadSupabase();
  const { data, error } = await sb
    .from("agents")
    .select("*")
    .order("last_event_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as AgentRow[];
}

export interface DashboardSnapshot {
  recentMarkets: MarketRow[];
  nowMarket: MarketRow | null;
  /** Last N settled windows, oldest → newest (newest on the right in the UI). */
  recentCloseOutcomes: MarketCloseOutcome[];
  totalMarkets: number;
}

export async function fetchDashboardSnapshot(): Promise<DashboardSnapshot> {
  const sb = getReadSupabase();
  const nowSec = Math.floor(Date.now() / 1000);

  const [{ count: totalMarkets }, recent, now, closed] = await Promise.all([
    sb.from("markets").select("market_id", { count: "exact", head: true }),
    sb
      .from("markets")
      .select("*")
      .order("market_id", { ascending: false })
      .limit(20),
    sb
      .from("markets")
      .select("*")
      .lte("open_ts", nowSec)
      .gte("close_ts", nowSec)
      .order("market_id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("markets")
      .select("market_id,winner")
      .in("status", ["closed", "settled"])
      .not("winner", "is", null)
      .order("market_id", { ascending: false })
      .limit(12),
  ]);

  const rawCloses = (closed.data ?? []) as Pick<MarketRow, "market_id" | "winner">[];
  const recentCloseOutcomes: MarketCloseOutcome[] = rawCloses
    .filter((r) => r.winner)
    .map((r) => ({ market_id: r.market_id, winner: r.winner as string }))
    .reverse();

  return {
    recentMarkets: ((recent.data ?? []) as MarketRow[]).reverse(),
    nowMarket: (now.data ?? null) as MarketRow | null,
    recentCloseOutcomes,
    totalMarkets: totalMarkets ?? 0,
  };
}

/** Read-only aggregates for the public `/stats` page (prod-safe). */
export interface PublicStats {
  totalMarkets: number;
  marketsByStatus: Partial<Record<MarketStatus, number>>;
  totalEvents: number;
  eventsLast24h: number;
  totalAgents: number;
  activeMarketId: number | null;
  activeMarketStatus: string | null;
  lastEventAt: string | null;
}

export async function fetchPublicStats(): Promise<PublicStats> {
  const sb = getReadSupabase();
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceIso = new Date(Date.now() - 86_400_000).toISOString();

  const statusTuples = await Promise.all(
    MARKET_STATUS.map(async (status) => {
      const { count, error } = await sb
        .from("markets")
        .select("market_id", { count: "exact", head: true })
        .eq("status", status);
      if (error) throw error;
      return [status, count ?? 0] as const;
    }),
  );

  const [
    { count: totalMarkets },
    { count: totalEvents },
    { count: eventsLast24h },
    { count: totalAgents },
    now,
    recent,
  ] = await Promise.all([
    sb.from("markets").select("market_id", { count: "exact", head: true }),
    sb.from("events").select("id", { count: "exact", head: true }),
    sb
      .from("events")
      .select("id", { count: "exact", head: true })
      .gte("inserted_at", sinceIso),
    sb.from("agents").select("owner_pubkey", { count: "exact", head: true }),
    sb
      .from("markets")
      .select("market_id,status")
      .lte("open_ts", nowSec)
      .gte("close_ts", nowSec)
      .order("market_id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("events")
      .select("inserted_at")
      .order("inserted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const marketsByStatus = Object.fromEntries(statusTuples) as Partial<
    Record<MarketStatus, number>
  >;

  const nowRow = (now.data ?? null) as Pick<
    MarketRow,
    "market_id" | "status"
  > | null;

  return {
    totalMarkets: totalMarkets ?? 0,
    marketsByStatus,
    totalEvents: totalEvents ?? 0,
    eventsLast24h: eventsLast24h ?? 0,
    totalAgents: totalAgents ?? 0,
    activeMarketId: nowRow?.market_id ?? null,
    activeMarketStatus: nowRow?.status ?? null,
    lastEventAt: (recent.data as { inserted_at?: string } | null)?.inserted_at ?? null,
  };
}
