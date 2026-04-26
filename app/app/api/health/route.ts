import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/health
 *
 * Lightweight liveness probe used by the System Status strip. Returns the
 * current base-layer slot from a confirmed RPC ping plus the wall-clock
 * timestamp the request hit the server. Cached for 5s on the client side
 * (`Cache-Control: public, max-age=5`) so the strip stays roughly real-time
 * without hammering the RPC.
 */
export async function GET() {
  const url =
    process.env.KESTREL_BASE_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_KESTREL_BASE_RPC_URL?.trim() ||
    "https://api.devnet.solana.com";

  const connection = new Connection(url, "confirmed");

  try {
    const slot = await connection.getSlot("confirmed");
    return NextResponse.json(
      {
        ok: true,
        cluster: "base",
        slot,
        servedAt: Date.now(),
      },
      { headers: { "cache-control": "public, max-age=5" } },
    );
  } catch (err: any) {
    const msg = String(err?.message || err);
    return NextResponse.json(
      {
        ok: false,
        error: msg.length > 200 ? `${msg.slice(0, 200)}…` : msg,
        servedAt: Date.now(),
      },
      { status: 503 },
    );
  }
}
