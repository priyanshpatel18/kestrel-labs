import "server-only";

import { getReadSupabase } from "../supabase/server";
import type { EventRow, MarketCloseOutcome, MarketRow } from "../types";

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
