import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import type { KestrelConnections } from "../connections";
import type { SchedulerLogger } from "../log";
import { marketPda } from "../state";
import { patchMarketRow } from "../marketDb";

export async function sendErTx(
  conns: KestrelConnections,
  tx: Transaction,
  signers: Keypair[],
  feePayer?: Keypair,
): Promise<string> {
  const fp = feePayer ?? signers[0];
  if (!fp) throw new Error("sendErTx: no fee payer or signers provided");

  const byPk = new Map<string, Keypair>();
  byPk.set(fp.publicKey.toBase58(), fp);
  for (const k of signers) byPk.set(k.publicKey.toBase58(), k);
  const uniqSigners = Array.from(byPk.values());

  // ER txs are very fast but can still miss the confirmation window and end up
  // with "block height exceeded". When that happens, retry with a fresh
  // blockhash instead of surfacing a permanent failure.
  const maxAttempts = 3;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      tx.feePayer = fp.publicKey;
      const { blockhash, lastValidBlockHeight } =
        await conns.erConnection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;

      return await sendAndConfirmTransaction(
        conns.erConnection,
        tx,
        uniqSigners,
        { skipPreflight: true, commitment: "confirmed" },
      );
    } catch (err) {
      lastErr = err;
      const msg = String((err as any)?.message || err || "");
      const expired =
        msg.includes("block height exceeded") ||
        msg.includes("has expired") ||
        msg.includes("Blockhash not found");
      if (!expired || attempt === maxAttempts - 1) break;
      // Small backoff before retrying with a new blockhash.
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastErr;
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
  const sig = await sendErTx(conns, tx, [admin], admin);
  try {
    const pda = marketPda(id, conns.programId);
    const acc = await (conns.erProgram as any).account.market.fetch(pda);
    const strike = Number(acc?.strike?.toString?.() ?? acc?.strike);
    await patchMarketRow({
      market_id: id,
      market_pubkey: pda.toBase58(),
      status: "open",
      opened_sig: sig,
      strike_price: Number.isFinite(strike) ? strike : undefined,
    });
  } catch {
    // best-effort; scheduler should not fail if DB is unreachable
  }
  return sig;
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
  const sig = await sendErTx(conns, tx, [admin], admin);
  try {
    const pda = marketPda(id, conns.programId);
    const acc = await (conns.erProgram as any).account.market.fetch(pda);
    const winner =
      acc?.winner?.yes !== undefined
        ? "yes"
        : acc?.winner?.no !== undefined
          ? "no"
          : null;
    const closePrice = Number(acc?.closePrice?.toString?.() ?? acc?.closePrice);
    await patchMarketRow({
      market_id: id,
      market_pubkey: pda.toBase58(),
      status: "closed",
      closed_sig: sig,
      winner,
      close_price: Number.isFinite(closePrice) ? closePrice : undefined,
    });
  } catch {
    // best-effort
  }
  return sig;
}

export function isRetriableErErr(err: unknown): boolean {
  const raw = (err as any)?.message || err || "";
  const msg = (() => {
    if (typeof raw === "string") return raw;
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  })();
  if (msg.includes("OutsideMarketWindow")) return true;
  if (msg.includes("0x1776")) return true;
  if (/InstructionError.*6006/i.test(msg)) return true;
  if (msg.includes("\"Custom\":6006")) return true;
  if (msg.includes("Custom\":6006")) return true;
  if (msg.includes("Custom\": 6006")) return true;
  if (msg.includes("InstructionFallbackNotFound")) return true;
  if (msg.includes("custom program error: 0x65")) return true;
  if (msg.includes("Blockhash not found")) return true;
  if (msg.includes("block height exceeded")) return true;
  if (msg.includes("has expired")) return true;
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
