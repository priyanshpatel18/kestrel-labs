import { PublicKey } from "@solana/web3.js";

import {
  Cluster,
  IndexerConnections,
  clusterProgram,
} from "./connections";
import { DecodedKestrelIx } from "./decode";
import { decodeKestrelErrorFromString } from "./errorMap";

const DECISION_KINDS = new Set([
  "place_bet",
  "cancel_bet",
  "close_position",
]);

interface PolicySnapshot {
  max_stake_per_window: string | null;
  max_open_positions: number | null;
  allowed_markets_root_hex: string | null;
  paused: boolean | null;
  balance: string | null;
}

interface CachedAgent {
  expiresAt: number;
  policy: PolicySnapshot | null;
}

const agentCache = new Map<string, CachedAgent>();
const CACHE_TTL_MS = 30_000;

function cacheKey(cluster: Cluster, agent: string): string {
  return `${cluster}:${agent}`;
}

function bnToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof (v as { toString: () => string }).toString === "function") {
    try {
      return (v as { toString: () => string }).toString();
    } catch {
      return null;
    }
  }
  return null;
}

function bytesToHex(v: unknown): string | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    return `0x${Buffer.from(v as number[]).toString("hex")}`;
  }
  if (Buffer.isBuffer(v)) {
    return `0x${(v as Buffer).toString("hex")}`;
  }
  return null;
}

async function loadPolicy(
  conns: IndexerConnections,
  cluster: Cluster,
  agentPda: string,
): Promise<PolicySnapshot | null> {
  const key = cacheKey(cluster, agentPda);
  const now = Date.now();
  const hit = agentCache.get(key);
  if (hit && hit.expiresAt > now) return hit.policy;

  const program = clusterProgram(conns, cluster);
  let policy: PolicySnapshot | null = null;
  try {
    const acc = await (program as unknown as {
      account: { agentProfile: { fetch: (pk: PublicKey) => Promise<unknown> } };
    }).account.agentProfile.fetch(new PublicKey(agentPda));
    const a = acc as Record<string, unknown>;
    const p = (a.policy ?? {}) as Record<string, unknown>;
    policy = {
      max_stake_per_window: bnToString(p.maxStakePerWindow ?? p.max_stake_per_window),
      max_open_positions:
        typeof p.maxOpenPositions === "number"
          ? (p.maxOpenPositions as number)
          : typeof p.max_open_positions === "number"
            ? (p.max_open_positions as number)
            : null,
      allowed_markets_root_hex: bytesToHex(
        p.allowedMarketsRoot ?? p.allowed_markets_root,
      ),
      paused: typeof p.paused === "boolean" ? (p.paused as boolean) : null,
      balance: bnToString(a.balance),
    };
  } catch {
    policy = null;
  }
  agentCache.set(key, { expiresAt: now + CACHE_TTL_MS, policy });
  return policy;
}

async function loadStrike(
  conns: IndexerConnections,
  cluster: Cluster,
  marketPda: string,
): Promise<string | null> {
  const program = clusterProgram(conns, cluster);
  try {
    const acc = await (program as unknown as {
      account: { market: { fetch: (pk: PublicKey) => Promise<unknown> } };
    }).account.market.fetch(new PublicKey(marketPda));
    const a = acc as Record<string, unknown>;
    return bnToString(a.strike);
  } catch {
    return null;
  }
}

export interface BuildDecisionCardArgs {
  conns: IndexerConnections;
  cluster: Cluster;
  decoded: DecodedKestrelIx;
  success: boolean;
  err: string | null;
}

export async function buildDecisionCard(
  args: BuildDecisionCardArgs,
): Promise<Record<string, unknown> | null> {
  const { conns, cluster, decoded, success, err } = args;
  if (!DECISION_KINDS.has(decoded.name)) return null;

  const agent = decoded.accounts.agent;
  const market = decoded.accounts.market;
  const policy = agent ? await loadPolicy(conns, cluster, agent) : null;
  const strike = market ? await loadStrike(conns, cluster, market) : null;

  const side =
    decoded.args.side !== undefined ? String(decoded.args.side) : null;
  const amount =
    decoded.args.amount !== undefined ? String(decoded.args.amount) : null;
  const shares =
    decoded.args.shares !== undefined ? String(decoded.args.shares) : null;

  // For failed txs, surface the Anchor-named error so the UI can render
  // `OverPolicyCap` / `OracleStale` / `MarketNotAllowed` cards instead of an
  // opaque `Custom: 6011`. Falls through to the raw err string when the
  // failure is not a Kestrel custom error.
  const errInfo = success ? null : decodeKestrelErrorFromString(err);
  const reasonName = errInfo?.name ?? null;
  const reasonHuman = errInfo?.message ?? (success ? null : err);
  const reasonCode = errInfo?.code ?? null;

  return {
    kind: decoded.name,
    side,
    amount,
    shares,
    strike_price: strike,
    accepted: success,
    reason: success ? null : reasonName ?? err,
    reason_code: reasonCode,
    reason_human: reasonHuman,
    policy,
  };
}
