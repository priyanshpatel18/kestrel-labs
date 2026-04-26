import { NextRequest, NextResponse } from "next/server";

import {
  badRequest,
  buildProgram,
  marketPda,
  publicKeyOrNull,
  serializeTx,
} from "@/lib/api/buildTx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/bet/cancel
 *
 * Builds an unsigned `cancel_bet` transaction.  Cancels **all** open shares
 * for a single market (both YES and NO if you hold both) and returns the
 * collateral to your agent balance.
 *
 * Submit the signed transaction to the **ER RPC** while the market is still
 * open.  Cancellation is not possible after market.close_ts.
 *
 * Request body (JSON):
 *   {
 *     pubkey:    string   // wallet public key (base58)
 *     marketId:  number   // integer market ID
 *   }
 *
 * Response 200:
 *   {
 *     transaction:  string   // base64 unsigned tx — sign + send to erRpcUrl
 *     erRpcUrl:     string
 *     marketPubkey: string
 *     note:         string
 *   }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("request body must be JSON");
  }

  const ownerKey = publicKeyOrNull(body.pubkey);
  if (!ownerKey) return badRequest("pubkey is required and must be a valid base58 public key");

  const marketId = Number(body.marketId);
  if (!Number.isInteger(marketId) || marketId < 0) {
    return badRequest("marketId must be a non-negative integer");
  }

  try {
    const { program, connection, env } = buildProgram("er");

    const mktPda = marketPda(marketId, env.programId);

    const tx = await (program as any).methods
      .cancelBet(marketId)
      .accounts({ owner: ownerKey })
      .transaction();
    const encoded = await serializeTx(tx, connection, ownerKey);

    return NextResponse.json({
      transaction: encoded,
      erRpcUrl: env.erRpcUrl,
      marketPubkey: mktPda.toBase58(),
      note: "Sign this transaction and submit it to erRpcUrl while the market is still open.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
