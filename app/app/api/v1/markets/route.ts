import { NextRequest, NextResponse } from "next/server";

import { fetchAllMarkets } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/markets
 *
 * Returns a list of markets indexed by Kestrel.  Useful for agents to discover
 * the currently open market before placing a bet.
 *
 * Query params:
 *   status  – filter by market status: pending | open | halted | closed | settled
 *   limit   – max results (default 20, max 100)
 *
 * Response 200:
 *   { markets: MarketSummary[] }
 *
 * MarketSummary:
 *   marketId      number
 *   marketPubkey  string
 *   status        string
 *   strikePrice   string | null   (oracle strike in USD × 10^8)
 *   closePrice    string | null
 *   winner        "yes" | "no" | null
 *   openTs        number | null   (unix seconds)
 *   closeTs       number | null
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const limitRaw = Number(searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(1, limitRaw), 100)
      : 20;

    const rows = await fetchAllMarkets({ status, limit });

    const markets = rows.map((r) => ({
      marketId: r.market_id,
      marketPubkey: r.market_pubkey,
      status: r.status,
      strikePrice: r.strike_price !== null ? String(r.strike_price) : null,
      closePrice: r.close_price !== null ? String(r.close_price) : null,
      winner: r.winner,
      openTs: r.open_ts,
      closeTs: r.close_ts,
    }));

    return NextResponse.json({ markets });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
