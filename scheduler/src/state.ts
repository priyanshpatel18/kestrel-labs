import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import type { KestrelConnections } from "./connections";

export const CONFIG_SEED = Buffer.from("config");
export const VAULT_SEED = Buffer.from("vault");
export const AGENT_SEED = Buffer.from("agent");
export const MARKET_SEED = Buffer.from("market");

// MagicBlock delegation program owns delegated PDAs while they live on the ER.
export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);

export type MarketStatusName = "pending" | "open" | "halted" | "closed";
export type OutcomeName = "yes" | "no";

export interface MarketSnapshot {
  pda: PublicKey;
  id: number;
  openTs: number;
  closeTs: number;
  status: MarketStatusName;
  strike: BN;
  oracleFeed: PublicKey;
  winner: OutcomeName | null;
  ownerProgram: PublicKey;
  isDelegated: boolean;
}

export interface OpenPositionSnapshot {
  marketId: number;
  yesShares: BN;
  noShares: BN;
  stake: BN;
  settled: boolean;
}

export interface AgentSnapshot {
  pda: PublicKey;
  owner: PublicKey;
  balance: BN;
  positions: OpenPositionSnapshot[];
  ownerProgram: PublicKey;
  isDelegated: boolean;
}

export interface ConfigSnapshot {
  pda: PublicKey;
  admin: PublicKey;
  treasury: PublicKey;
  usdcMint: PublicKey;
  btcUsdPriceUpdate: PublicKey;
  feeBps: number;
  marketCount: number;
}

function u32LE(id: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(id >>> 0, 0);
  return buf;
}

export function configPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  return pda;
}

export function vaultPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([VAULT_SEED], programId);
  return pda;
}

export function agentPda(owner: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [AGENT_SEED, owner.toBuffer()],
    programId,
  );
  return pda;
}

export function marketPda(id: number, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [MARKET_SEED, u32LE(id)],
    programId,
  );
  return pda;
}

function statusKeyToName(s: any): MarketStatusName {
  if (s.pending !== undefined) return "pending";
  if (s.open !== undefined) return "open";
  if (s.halted !== undefined) return "halted";
  if (s.closed !== undefined) return "closed";
  return "pending";
}

function winnerToName(w: any): OutcomeName | null {
  if (!w) return null;
  if (w.yes !== undefined) return "yes";
  if (w.no !== undefined) return "no";
  return null;
}

export async function loadConfig(
  conns: KestrelConnections,
): Promise<ConfigSnapshot | null> {
  const pda = configPda(conns.programId);
  const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  if (!info) return null;
  const acc = await (conns.baseProgram as any).account.config.fetch(pda);
  return {
    pda,
    admin: acc.admin as PublicKey,
    treasury: acc.treasury as PublicKey,
    usdcMint: acc.usdcMint as PublicKey,
    btcUsdPriceUpdate: acc.btcUsdPriceUpdate as PublicKey,
    feeBps: Number(acc.feeBps),
    marketCount: Number(acc.marketCount),
  };
}

export async function fetchMarketSnapshot(
  conns: KestrelConnections,
  pda: PublicKey,
): Promise<MarketSnapshot | null> {
  // Markets may live on base or on the ER (after delegation). Try both.
  const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  const owner = baseInfo?.owner ?? null;
  const isDelegated =
    !!owner && owner.equals(DELEGATION_PROGRAM_ID);
  const fetchProgram =
    isDelegated || !baseInfo ? conns.erProgram : conns.baseProgram;
  try {
    const acc = await (fetchProgram as any).account.market.fetch(pda);
    return {
      pda,
      id: Number(acc.id),
      openTs: Number(acc.openTs),
      closeTs: Number(acc.closeTs),
      status: statusKeyToName(acc.status),
      strike: acc.strike,
      oracleFeed: acc.oracleFeed as PublicKey,
      winner: winnerToName(acc.winner),
      ownerProgram: owner ?? conns.programId,
      isDelegated,
    };
  } catch {
    return null;
  }
}

export async function listMarkets(
  conns: KestrelConnections,
  upToId: number,
): Promise<MarketSnapshot[]> {
  if (upToId <= 0) return [];
  const pdas: PublicKey[] = [];
  for (let id = 0; id < upToId; id++) {
    pdas.push(marketPda(id, conns.programId));
  }

  // Cap to 100 per call (web3.js getMultipleAccountsInfo).
  const baseInfos: ({ owner: PublicKey } | null)[] = [];
  for (let i = 0; i < pdas.length; i += 100) {
    const chunk = pdas.slice(i, i + 100);
    const infos = await conns.baseConnection.getMultipleAccountsInfo(
      chunk,
      "confirmed",
    );
    baseInfos.push(...infos.map((x) => (x ? { owner: x.owner } : null)));
  }

  const out: MarketSnapshot[] = [];
  for (let id = 0; id < pdas.length; id++) {
    const pda = pdas[id];
    const baseInfo = baseInfos[id];
    if (!baseInfo) {
      // The PDA was never created (gap in id space). Skip silently.
      continue;
    }
    const isDelegated = baseInfo.owner.equals(DELEGATION_PROGRAM_ID);
    const fetchProgram = isDelegated ? conns.erProgram : conns.baseProgram;
    try {
      const acc = await (fetchProgram as any).account.market.fetch(pda);
      out.push({
        pda,
        id: Number(acc.id),
        openTs: Number(acc.openTs),
        closeTs: Number(acc.closeTs),
        status: statusKeyToName(acc.status),
        strike: acc.strike,
        oracleFeed: acc.oracleFeed as PublicKey,
        winner: winnerToName(acc.winner),
        ownerProgram: baseInfo.owner,
        isDelegated,
      });
    } catch {
      // Best-effort: ER may not yet have synced this account.
    }
  }
  return out;
}

export async function listAgents(
  conns: KestrelConnections,
): Promise<AgentSnapshot[]> {
  const all = await (conns.baseProgram as any).account.agentProfile.all();
  const out: AgentSnapshot[] = [];
  for (const entry of all as any[]) {
    const pda: PublicKey = entry.publicKey;
    const acc: any = entry.account;
    const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    const isDelegated =
      !!baseInfo && baseInfo.owner.equals(DELEGATION_PROGRAM_ID);
    out.push({
      pda,
      owner: acc.owner as PublicKey,
      balance: acc.balance,
      positions: (acc.positions as any[]).map((p: any) => ({
        marketId: Number(p.marketId),
        yesShares: p.yesShares,
        noShares: p.noShares,
        stake: p.stake,
        settled: !!p.settled,
      })),
      ownerProgram: baseInfo?.owner ?? conns.programId,
      isDelegated,
    });
  }
  return out;
}

export async function fetchAgentSnapshot(
  conns: KestrelConnections,
  pda: PublicKey,
): Promise<AgentSnapshot | null> {
  const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  if (!baseInfo) return null;
  const isDelegated = baseInfo.owner.equals(DELEGATION_PROGRAM_ID);
  const fetchProgram = isDelegated ? conns.erProgram : conns.baseProgram;
  try {
    const acc = await (fetchProgram as any).account.agentProfile.fetch(pda);
    return {
      pda,
      owner: acc.owner as PublicKey,
      balance: acc.balance,
      positions: (acc.positions as any[]).map((p: any) => ({
        marketId: Number(p.marketId),
        yesShares: p.yesShares,
        noShares: p.noShares,
        stake: p.stake,
        settled: !!p.settled,
      })),
      ownerProgram: baseInfo.owner,
      isDelegated,
    };
  } catch {
    return null;
  }
}
