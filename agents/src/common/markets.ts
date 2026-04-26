import { BN, Idl, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

import type { AgentConnections } from "./connections";
import type { Logger } from "./logger";

export const MARKET_SEED = Buffer.from("market");
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);

export type MarketStatus = "pending" | "open" | "halted" | "closed";

export interface MarketView {
  pda: PublicKey;
  id: number;
  openTs: number;
  closeTs: number;
  strike: BN;
  status: MarketStatus;
  yesReserve: BN;
  noReserve: BN;
  oracleFeed: PublicKey;
  isDelegated: boolean;
}

export function marketPda(id: number, programId: PublicKey): PublicKey {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(id >>> 0, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [MARKET_SEED, buf],
    programId,
  );
  return pda;
}

function statusKeyToName(s: any): MarketStatus {
  if (s.pending !== undefined) return "pending";
  if (s.open !== undefined) return "open";
  if (s.halted !== undefined) return "halted";
  if (s.closed !== undefined) return "closed";
  return "pending";
}

export async function fetchMarket(
  conns: AgentConnections,
  pda: PublicKey,
  log?: Logger,
): Promise<MarketView | null> {
  const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  const isDelegated =
    !!baseInfo && baseInfo.owner.equals(DELEGATION_PROGRAM_ID);
  const program: Program<Idl> =
    isDelegated || !baseInfo ? conns.erProgram : conns.baseProgram;
  try {
    const acc = await (program as any).account.market.fetch(pda);
    return {
      pda,
      id: Number(acc.id),
      openTs: Number(acc.openTs),
      closeTs: Number(acc.closeTs),
      strike: acc.strike as BN,
      status: statusKeyToName(acc.status),
      yesReserve: acc.yesReserve as BN,
      noReserve: acc.noReserve as BN,
      oracleFeed: acc.oracleFeed as PublicKey,
      isDelegated,
    };
  } catch (err: any) {
    log?.debug(
      { pda: pda.toBase58(), err: String(err?.message || err) },
      "fetchMarket: missing or undecodable",
    );
    return null;
  }
}

export async function findActiveOpenMarket(
  conns: AgentConnections,
  log?: Logger,
): Promise<MarketView | null> {
  // Read config.market_count to know how many candidate ids exist.
  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    conns.programId,
  )[0];
  let marketCount = 0;
  try {
    const cfg = await (conns.baseProgram as any).account.config.fetch(configPda);
    marketCount = Number(cfg.marketCount);
  } catch (err: any) {
    log?.warn({ err: String(err?.message || err) }, "config fetch failed");
    return null;
  }
  if (marketCount <= 0) return null;

  // Walk newest-first; the scheduler creates ids in increasing order.
  for (let id = marketCount - 1; id >= Math.max(0, marketCount - 8); id--) {
    const pda = marketPda(id, conns.programId);
    const view = await fetchMarket(conns, pda, log);
    if (!view) continue;
    // Only act on delegated markets. If a market is open on base but not
    // delegated to the ER validator, ER writes will fail (InvalidWritableAccount).
    if (view.status === "open" && view.isDelegated) return view;
  }
  return null;
}

export async function findHaltedMarket(
  conns: AgentConnections,
  log?: Logger,
): Promise<MarketView | null> {
  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    conns.programId,
  )[0];
  let marketCount = 0;
  try {
    const cfg = await (conns.baseProgram as any).account.config.fetch(configPda);
    marketCount = Number(cfg.marketCount);
  } catch {
    return null;
  }
  for (let id = marketCount - 1; id >= Math.max(0, marketCount - 8); id--) {
    const pda = marketPda(id, conns.programId);
    const view = await fetchMarket(conns, pda, log);
    if (!view) continue;
    if (view.status === "halted" && view.isDelegated) return view;
  }
  return null;
}
