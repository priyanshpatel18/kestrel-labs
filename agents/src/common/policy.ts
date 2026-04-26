import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import type { AgentRole } from "./connections";

export interface AgentPolicyTpl {
  maxStakePerWindow: BN;
  maxOpenPositions: number;
  /** 32-byte allowlist root; we set this to the BTC oracle feed pubkey so
   *  every market the scheduler creates is implicitly allowed. */
  allowedMarketsRoot: number[];
  paused: boolean;
}

function envBn(name: string, fallback: number): BN {
  const v = process.env[name];
  if (!v) return new BN(fallback);
  const n = Number(v);
  return Number.isFinite(n) ? new BN(n) : new BN(fallback);
}

function feedBytes(): number[] {
  const feed = new PublicKey(
    process.env.KESTREL_BTC_USD_PRICE_UPDATE ||
      "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr",
  );
  return Array.from(feed.toBytes());
}

/**
 * Default per-role policy templates. The Trader cap is *deliberately* tight
 * so the scripted over-cap demo bet (`max + 1`) reliably trips OverPolicyCap.
 */
export function defaultPolicyFor(role: AgentRole): AgentPolicyTpl {
  switch (role) {
    case "trader":
      return {
        maxStakePerWindow: envBn("AGENTS_TRADER_MAX_STAKE", 500_000),
        // Match on-chain MAX_POSITIONS (16) so long-running demos are not capped
        // below physical slots; stale windows are flattened in trader.ts.
        maxOpenPositions: Number(process.env.AGENTS_TRADER_MAX_OPEN_POSITIONS || 16),
        allowedMarketsRoot: feedBytes(),
        paused: false,
      };
    case "risk_lp":
      return {
        maxStakePerWindow: envBn("AGENTS_RISK_LP_MAX_STAKE", 250_000),
        maxOpenPositions: Number(process.env.AGENTS_RISK_LP_MAX_OPEN_POSITIONS || 16),
        allowedMarketsRoot: feedBytes(),
        paused: false,
      };
    case "market_ops":
    default:
      return {
        // Market ops still has a profile so it can deposit if needed for
        // emergency hedges, but normally never bets.
        maxStakePerWindow: new BN(100_000),
        maxOpenPositions: 2,
        allowedMarketsRoot: feedBytes(),
        paused: true,
      };
  }
}

/** Allowlist root of all-zeros disables the gate (matches on-chain check). */
export function emptyAllowlistRoot(): number[] {
  return new Array(32).fill(0);
}

/** Build a deliberately-wrong allowlist root so the scripted "wrong allowlist"
 *  bet trips KestrelError::MarketNotAllowed. We replace the feed bytes with
 *  the SystemProgram id so it's clearly not a real Pyth feed. */
export function wrongAllowlistRoot(): number[] {
  const fake = PublicKey.default; // 0..0 is the all-zeros disable case, so use SystemProgram instead.
  void fake;
  return Array.from(
    new PublicKey("11111111111111111111111111111112").toBytes(),
  );
}
