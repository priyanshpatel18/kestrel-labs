import { NextRequest, NextResponse } from "next/server";
import { Connection, Transaction } from "@solana/web3.js";

import { badRequest, loadApiEnv } from "@/lib/api/buildTx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/tx/send
 *
 * Convenience relay: accepts a **signed** base64 transaction and broadcasts it
 * to either the base-layer or ER RPC.  Returns the transaction signature.
 *
 * This is entirely optional — agents can submit directly to any Solana RPC.
 * Use this endpoint if you prefer not to manage the RPC URL yourself or want
 * a single HTTP endpoint for the entire flow.
 *
 * Request body (JSON):
 *   {
 *     transaction:  string               // base64 SIGNED transaction
 *     cluster?:     "base" | "er"        // default "er" (place_bet/cancel/close go to ER)
 *   }
 *
 * Response 200:
 *   {
 *     signature:   string   // Solana transaction signature
 *     cluster:     string
 *     rpcUrl:      string
 *     explorerUrl: string
 *   }
 *
 * Response 4xx / 5xx:
 *   { error: string }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest("request body must be JSON");
  }

  const rawTx = body.transaction;
  if (typeof rawTx !== "string" || rawTx.length === 0) {
    return badRequest('transaction is required (base64 signed transaction bytes)');
  }

  const cluster = body.cluster === "base" ? "base" : "er";
  const env = loadApiEnv();
  const rpcUrl = cluster === "base" ? env.baseRpcUrl : env.erRpcUrl;
  const connection = new Connection(rpcUrl, "confirmed");

  let txBytes: Buffer;
  try {
    txBytes = Buffer.from(rawTx, "base64");
  } catch {
    return badRequest("transaction is not valid base64");
  }

  // Sanity: ensure it deserialises without error before sending.
  let tx: Transaction;
  try {
    tx = Transaction.from(txBytes);
  } catch (e: any) {
    return badRequest(`invalid transaction bytes: ${String(e?.message ?? e)}`);
  }

  // Verify at least one signature is present.
  const hasSig = tx.signatures.some((s) => s.signature !== null);
  if (!hasSig) {
    return badRequest(
      "transaction has no signatures — sign it with your wallet before submitting",
    );
  }

  try {
    const signature = await connection.sendRawTransaction(txBytes, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    const explorerBase =
      env.baseRpcUrl.includes("devnet") || env.erRpcUrl.includes("devnet")
        ? "https://explorer.solana.com"
        : "https://explorer.solana.com";
    const clusterSuffix = env.baseRpcUrl.includes("devnet")
      ? "?cluster=devnet"
      : "";

    return NextResponse.json({
      signature,
      cluster,
      rpcUrl,
      explorerUrl: `${explorerBase}/tx/${signature}${clusterSuffix}`,
    });
  } catch (err: any) {
    // Surface on-chain program errors cleanly.
    const msg = String(err?.message ?? err);
    const status = msg.includes("insufficient") || msg.includes("custom program error")
      ? 400
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
