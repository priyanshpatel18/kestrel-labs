import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import type { KestrelConnections } from "../connections";
import type { SchedulerLogger } from "../log";

export async function sendErTx(
  conns: KestrelConnections,
  tx: Transaction,
  signers: Keypair[],
  feePayer?: Keypair,
): Promise<string> {
  const fp = feePayer ?? signers[0];
  if (!fp) throw new Error("sendErTx: no fee payer or signers provided");
  tx.feePayer = fp.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await conns.erConnection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  const byPk = new Map<string, Keypair>();
  byPk.set(fp.publicKey.toBase58(), fp);
  for (const k of signers) byPk.set(k.publicKey.toBase58(), k);

  return sendAndConfirmTransaction(
    conns.erConnection,
    tx,
    Array.from(byPk.values()),
    { skipPreflight: true, commitment: "confirmed" },
  );
}

export async function openMarketOnEr(params: {
  conns: KestrelConnections;
  admin: Keypair;
  id: number;
  oracleFeed: PublicKey;
  seedLiquidity: bigint;
}): Promise<string> {
  const { conns, admin, id, oracleFeed, seedLiquidity } = params;
  const tx = await (conns.erProgram.methods as any)
    .openMarket(id, new anchor.BN(seedLiquidity.toString()))
    .accounts({
      admin: admin.publicKey,
      priceUpdate: oracleFeed,
    })
    .transaction();
  return sendErTx(conns, tx, [admin], admin);
}

export async function closeMarketOnEr(params: {
  conns: KestrelConnections;
  admin: Keypair;
  id: number;
  oracleFeed: PublicKey;
}): Promise<string> {
  const { conns, admin, id, oracleFeed } = params;
  const tx = await (conns.erProgram.methods as any)
    .closeMarket(id)
    .accounts({
      admin: admin.publicKey,
      priceUpdate: oracleFeed,
    })
    .transaction();
  return sendErTx(conns, tx, [admin], admin);
}

export function isRetriableErErr(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  if (msg.includes("OutsideMarketWindow")) return true;
  if (msg.includes("0x1776")) return true;
  if (/InstructionError.*6006/i.test(msg)) return true;
  if (msg.includes("InstructionFallbackNotFound")) return true;
  if (msg.includes("custom program error: 0x65")) return true;
  if (msg.includes("Blockhash not found")) return true;
  return false;
}

export function logOpenClose(
  log: SchedulerLogger,
  kind: "open" | "close",
  id: number,
  result: { sig?: string; err?: string },
): void {
  if (result.sig) {
    log.info({ market_id: id, sig: result.sig }, `${kind}_market`);
  } else if (result.err) {
    log.warn({ market_id: id, err: result.err }, `${kind}_market failed`);
  }
}
