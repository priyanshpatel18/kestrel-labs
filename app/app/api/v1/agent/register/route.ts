import { NextRequest, NextResponse } from "next/server";

import {
  agentPda,
  badRequest,
  buildProgram,
  defaultAgentPolicy,
  publicKeyOrNull,
  serializeTx,
} from "@/lib/api/buildTx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/agent/register
 *
 * Builds an unsigned `register_agent` transaction.  The agent signs it with
 * their wallet and submits it to the **base-layer** RPC.  This is the first
 * step — call this once per wallet before depositing or betting.
 *
 * Request body (JSON):
 *   {
 *     pubkey:              string   // wallet public key (base58)
 *     maxStakePerWindow?:  number   // token lamports (default 500_000)
 *     maxOpenPositions?:   number   // default 8
 *   }
 *
 * Response 200:
 *   {
 *     transaction:  string   // base64 unsigned tx — sign + send to baseRpcUrl
 *     agentPda:     string   // your on-chain agent profile address
 *     baseRpcUrl:   string
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

  const policy = defaultAgentPolicy({
    maxStakePerWindow:
      typeof body.maxStakePerWindow === "number"
        ? body.maxStakePerWindow
        : undefined,
    maxOpenPositions:
      typeof body.maxOpenPositions === "number"
        ? body.maxOpenPositions
        : undefined,
  });

  try {
    const { program, connection, env } = buildProgram("base");
    const pda = agentPda(ownerKey, env.programId);

    const tx = await (program as any).methods
      .registerAgent(policy)
      .accounts({ owner: ownerKey })
      .transaction();

    const encoded = await serializeTx(tx, connection, ownerKey);

    return NextResponse.json({
      transaction: encoded,
      agentPda: pda.toBase58(),
      baseRpcUrl: env.baseRpcUrl,
      note: "Sign this transaction with your wallet and submit it to baseRpcUrl",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
