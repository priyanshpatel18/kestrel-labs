import { NextRequest, NextResponse } from "next/server";
import { BN } from "@coral-xyz/anchor";

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
 * POST /api/v1/bet/close
 *
 * Builds an unsigned `close_position` transaction.  Partially or fully sells
 * shares of one side (YES or NO) back to the AMM while the market is still
 * open, receiving USDC at the current pool price.
 *
 * Unlike `cancel_bet` (which closes your entire position), `close_position`
 * lets you sell a specific number of shares of one side.
 *
 * Submit the signed transaction to the **ER RPC**.
 *
 * Request body (JSON):
 *   {
 *     pubkey:    string          // wallet public key (base58)
 *     marketId:  number          // integer market ID
 *     side:      "yes" | "no"   // which side's shares to sell
 *     shares:    number          // number of shares to sell (must be > 0 and <= held)
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

  const side = body.side;
  if (side !== "yes" && side !== "no") {
    return badRequest('side must be "yes" or "no"');
  }

  const shares = Number(body.shares);
  if (!Number.isFinite(shares) || shares <= 0) {
    return badRequest("shares must be a positive integer");
  }

  try {
    const { program, connection, env } = buildProgram("er");
    const mktPda = marketPda(marketId, env.programId);
    const sideArg = side === "yes" ? { yes: {} } : { no: {} };

    const tx = await (program as any).methods
      .closePosition(marketId, sideArg, new BN(shares))
      .accounts({ owner: ownerKey })
      .transaction();

    const encoded = await serializeTx(tx, connection, ownerKey);

    return NextResponse.json({
      transaction: encoded,
      erRpcUrl: env.erRpcUrl,
      marketPubkey: mktPda.toBase58(),
      note: "Sign this transaction and submit it to erRpcUrl while the market is still open. Partial closes are allowed.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
