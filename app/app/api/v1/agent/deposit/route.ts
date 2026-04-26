import { NextRequest, NextResponse } from "next/server";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import {
  badRequest,
  buildProgram,
  configPda,
  publicKeyOrNull,
  serializeTx,
  vaultPda,
} from "@/lib/api/buildTx";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1brs",
);

function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/agent/deposit
 *
 * Builds an unsigned `deposit` transaction.  The agent signs it with their
 * wallet and submits it to the **base-layer** RPC.
 *
 * Prerequisites:
 *   - Agent must be registered (call /api/v1/agent/register first).
 *   - Agent must hold USDC in their associated token account (ATA).
 *   - Agent account must NOT be delegated to the ER at the time of deposit.
 *
 * Request body (JSON):
 *   {
 *     pubkey:  string   // wallet public key (base58)
 *     amount:  number   // USDC amount in token lamports (1 USDC = 1_000_000 if 6 decimals)
 *   }
 *
 * Response 200:
 *   {
 *     transaction:  string   // base64 unsigned tx — sign + send to baseRpcUrl
 *     baseRpcUrl:   string
 *     usdcMint:     string   // the USDC mint used by Kestrel
 *     userAta:      string   // your USDC ATA that the tx will debit
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

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return badRequest("amount must be a positive integer (token lamports)");
  }

  try {
    const { program, connection, env } = buildProgram("base");

    // Fetch the config to learn the USDC mint.
    const cfgPda = configPda(env.programId);
    const config = await (program as any).account.config.fetch(cfgPda);
    const usdcMint: PublicKey = config.usdcMint;

    const userAta = getAssociatedTokenAddress(usdcMint, ownerKey);
    const vault = vaultPda(env.programId);

    const tx = await (program as any).methods
      .deposit(new BN(amount))
      .accounts({
        owner: ownerKey,
        userAta,
        vault,
        usdcMint,
      })
      .transaction();

    const encoded = await serializeTx(tx, connection, ownerKey);

    return NextResponse.json({
      transaction: encoded,
      baseRpcUrl: env.baseRpcUrl,
      usdcMint: usdcMint.toBase58(),
      userAta: userAta.toBase58(),
      note: "Sign this transaction with your wallet and submit it to baseRpcUrl. Your USDC ATA must already exist and hold sufficient balance.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
