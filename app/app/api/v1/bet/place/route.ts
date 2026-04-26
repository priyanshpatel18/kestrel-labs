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
 * POST /api/v1/bet/place
 *
 * Builds an unsigned `place_bet` transaction.  The agent signs it with their
 * wallet and submits it to the **Ephemeral Rollup (ER) RPC** for near-instant
 * settlement.
 *
 * This is the core trading endpoint.  Under the hood, Kestrel is a CLMM-style
 * prediction market: you buy YES or NO shares and the AMM prices them from the
 * pool reserves.
 *
 * Prerequisites:
 *   1. Agent registered on base layer.
 *   2. USDC deposited on base layer.
 *   3. Agent account delegated to the ER (the scheduler handles this;
 *      contact the Kestrel team if you need to self-delegate).
 *   4. An "open" market exists — use GET /api/v1/markets?status=open.
 *
 * Request body (JSON):
 *   {
 *     pubkey:    string           // wallet public key (base58)
 *     marketId:  number           // integer market ID from GET /api/v1/markets
 *     side:      "yes" | "no"    // which outcome to buy
 *     amount:    number           // collateral in token lamports (<= your policy.maxStakePerWindow)
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

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return badRequest("amount must be a positive integer (token lamports)");
  }

  try {
    // place_bet runs on the ER.
    const { program, connection, env } = buildProgram("er");

    // Fetch the market from the ER to get the oracle feed pubkey.
    const mktPda = marketPda(marketId, env.programId);
    const market = await (program as any).account.market.fetch(mktPda).catch(
      () => null,
    );

    if (!market) {
      // Try base layer as fallback (market may not yet be delegated).
      const base = buildProgram("base");
      const baseMarket = await (base.program as any).account.market
        .fetch(mktPda)
        .catch(() => null);
      if (!baseMarket) {
        return NextResponse.json(
          { error: `market ${marketId} not found on chain` },
          { status: 404 },
        );
      }
      return NextResponse.json(
        {
          error: `market ${marketId} exists on base but is not yet open on the ER. Wait for delegation.`,
          marketStatus: Object.keys(baseMarket.status)[0],
        },
        { status: 409 },
      );
    }

    const oracleFeed = market.oracleFeed;
    const sideArg = side === "yes" ? { yes: {} } : { no: {} };

    const tx = await (program as any).methods
      .placeBet(marketId, sideArg, new BN(amount))
      .accounts({
        owner: ownerKey,
        priceUpdate: oracleFeed,
      })
      .transaction();

    const encoded = await serializeTx(tx, connection, ownerKey);

    return NextResponse.json({
      transaction: encoded,
      erRpcUrl: env.erRpcUrl,
      marketPubkey: mktPda.toBase58(),
      oracleFeed: oracleFeed.toBase58(),
      note: "Sign this transaction with your wallet and submit it to erRpcUrl. This runs on the Ephemeral Rollup for instant settlement.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
