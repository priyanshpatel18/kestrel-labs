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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * POST /api/v1/agent/withdraw
 *
 * Builds an unsigned `withdraw` transaction.  The agent signs it with their
 * wallet and submits it to the **base-layer** RPC.
 *
 * Prerequisites:
 *   - Agent must NOT be delegated to the ER at the time of withdrawal.
 *   - Agent must have sufficient free balance (balance >= amount).
 *   - Agent's USDC ATA must exist — create it with createAssociatedTokenAccount
 *     before calling this if it doesn't exist yet.
 *
 * Request body (JSON):
 *   {
 *     pubkey:  string   // wallet public key (base58)
 *     amount:  number   // USDC token lamports to withdraw
 *   }
 *
 * Response 200:
 *   {
 *     transaction:  string   // base64 unsigned tx — sign + send to baseRpcUrl
 *     baseRpcUrl:   string
 *     usdcMint:     string
 *     userAta:      string
 *     treasuryAta:  string   // fee destination (Kestrel treasury)
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

    // Fetch config to learn USDC mint + treasury.
    const cfgPda = configPda(env.programId);
    const config = await (program as any).account.config.fetch(cfgPda);
    const usdcMint: PublicKey = config.usdcMint;
    const treasury: PublicKey = config.treasury;

    const userAta = getAssociatedTokenAddress(usdcMint, ownerKey);
    const treasuryAta = getAssociatedTokenAddress(usdcMint, treasury);
    const vault = vaultPda(env.programId);

    const tx = await (program as any).methods
      .withdraw(new BN(amount))
      .accounts({
        owner: ownerKey,
        vault,
        usdcMint,
        userAta,
        treasuryAta,
      })
      .transaction();

    const encoded = await serializeTx(tx, connection, ownerKey);

    return NextResponse.json({
      transaction: encoded,
      baseRpcUrl: env.baseRpcUrl,
      usdcMint: usdcMint.toBase58(),
      userAta: userAta.toBase58(),
      treasuryAta: treasuryAta.toBase58(),
      note: "Sign this transaction with your wallet and submit it to baseRpcUrl. Agent must be undelegated from the ER first.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
