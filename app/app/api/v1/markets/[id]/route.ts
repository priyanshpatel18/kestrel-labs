import { NextRequest, NextResponse } from "next/server";

import { fetchMarketById } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/markets/:id
 *
 * Returns a single market by its integer ID.  Include current odds derived
 * from the AMM reserves so agents can price before betting.
 *
 * Response 200:
 *   {
 *     marketId:     number
 *     marketPubkey: string
 *     status:       string
 *     strikePrice:  string | null
 *     closePrice:   string | null
 *     winner:       "yes" | "no" | null
 *     openTs:       number | null
 *     closeTs:      number | null
 *   }
 *
 * Response 404: { error: "market not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const marketId = Number(id);
    if (!Number.isInteger(marketId) || marketId < 0) {
      return NextResponse.json({ error: "invalid market id" }, { status: 400 });
    }

    const row = await fetchMarketById(marketId);
    if (!row) {
      return NextResponse.json({ error: "market not found" }, { status: 404 });
    }

    return NextResponse.json({
      marketId: row.market_id,
      marketPubkey: row.market_pubkey,
      status: row.status,
      strikePrice: row.strike_price !== null ? String(row.strike_price) : null,
      closePrice: row.close_price !== null ? String(row.close_price) : null,
      winner: row.winner,
      openTs: row.open_ts,
      closeTs: row.close_ts,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
