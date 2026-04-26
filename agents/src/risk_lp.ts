/**
 * Risk-LP / Hedger role
 * ---------------------
 * Conservative counter-party that tries to dampen imbalanced order flow:
 *
 *   - Each tick, fetch the live market and observe `yes_reserve` vs
 *     `no_reserve`. Place a small bet on the *under-bought* side so price
 *     drifts back toward 50/50. This is dumb-on-purpose; the goal is to
 *     produce visible BetPlaced events with a tag the UI can render as
 *     "hedge".
 *   - If the oracle is stale OR the market is within `CANCEL_NEAR_CLOSE_SECS`
 *     of `close_ts`, call `cancel_bet` once per market to flatten the open
 *     position so the Hedger never gets stuck on a stale book.
 */
import { BN } from "@coral-xyz/anchor";

import { AgentConnections, buildConnections } from "./common/connections";
import { buildLogger } from "./common/logger";
import {
  MarketView,
  findActiveOpenMarket,
} from "./common/markets";
import { readOracleSnapshot } from "./common/oracle";
import { formatErrorForLog } from "./common/formatError";
import { flattenPositionsOutsideCurrentMarket } from "./common/flattenPositions";
import {
  cancelBetViaApi,
  getKestrelApiBaseUrl,
  placeBetViaApi,
} from "./common/kestrelApi";
import { DELEGATION_PROGRAM_ID } from "./common/markets";
import { defaultPolicyFor } from "./common/policy";
import {
  agentPda,
  ensureAgent,
  ensureErTradingReady,
  tagAgentRole,
} from "./common/registry";
import { extractCustomErrorCode, sendErTx } from "./common/tx";

const log = buildLogger("risk_lp");

const TICK_MS = 2500;
const HEDGE_SIZE = Number(process.env.AGENTS_RISK_LP_HEDGE_SIZE || 75_000);
const CANCEL_NEAR_CLOSE_SECS = Number(
  process.env.AGENTS_RISK_LP_CANCEL_NEAR_CLOSE_SECS || 30,
);
const STALE_THRESHOLD_SECS = Number(
  process.env.AGENTS_RISK_LP_STALE_THRESHOLD_SECS || 30,
);
const HEDGES_PER_MARKET = Number(
  process.env.AGENTS_RISK_LP_HEDGES_PER_MARKET || 2,
);
const TARGET_BALANCE = Number(process.env.AGENTS_RISK_LP_TARGET_BALANCE || 1_000_000);

interface MarketMemo {
  hedgesPlaced: number;
  cancelled: boolean;
}

const memos = new Map<number, MarketMemo>();

function decideUnderboughtSide(market: MarketView): "yes" | "no" | null {
  // In our constant-product book, buying side X *removes* X-side reserve and
  // adds to the opposite. Higher reserve => less demand for that side. We
  // hedge in the under-bought direction (the higher-reserve side) so the
  // imbalance shrinks.
  const y = BigInt(market.yesReserve.toString());
  const n = BigInt(market.noReserve.toString());
  if (y === n) return null;
  return y > n ? "yes" : "no";
}

async function submitHedgeTx(
  conns: AgentConnections,
  market: MarketView,
  side: "yes" | "no",
): Promise<string> {
  const apiBase = getKestrelApiBaseUrl(conns);
  if (apiBase) {
    return placeBetViaApi({
      conns,
      marketId: market.id,
      side,
      amount: new BN(HEDGE_SIZE),
    });
  }
  const sideArg = side === "yes" ? { yes: {} } : { no: {} };
  const tx = await (conns.erProgram.methods as any)
    .placeBet(market.id, sideArg, new BN(HEDGE_SIZE))
    .accounts({
      owner: conns.signerKeypair.publicKey,
      priceUpdate: market.oracleFeed,
    })
    .transaction();
  return sendErTx(conns, tx, [conns.signerKeypair]);
}

async function placeHedge(
  conns: AgentConnections,
  market: MarketView,
  side: "yes" | "no",
): Promise<string | null> {
  try {
    const sig = await submitHedgeTx(conns, market, side);
    log.info({ market: market.id, side, amount: HEDGE_SIZE, sig }, "hedge place_bet");
    return sig;
  } catch (err: unknown) {
    const code = extractCustomErrorCode(err);
    if (code === 6012) {
      const nowSec = Math.floor(Date.now() / 1000);
      await flattenPositionsOutsideCurrentMarket(conns, market, nowSec, log);
      try {
        const sig2 = await submitHedgeTx(conns, market, side);
        log.info(
          { market: market.id, side, amount: HEDGE_SIZE, sig: sig2 },
          "hedge place_bet (after slot flush)",
        );
        return sig2;
      } catch (err2: unknown) {
        log.warn(
          {
            market: market.id,
            side,
            amount: HEDGE_SIZE,
            code: extractCustomErrorCode(err2),
            err: formatErrorForLog(err2).slice(0, 800),
          },
          "hedge place_bet failed after slot flush",
        );
        return null;
      }
    }
    log.warn(
      {
        market: market.id,
        side,
        amount: HEDGE_SIZE,
        code,
        err: formatErrorForLog(err).slice(0, 800),
      },
      "hedge place_bet failed",
    );
    return null;
  }
}

async function cancelMarket(
  conns: AgentConnections,
  market: MarketView,
  reason: string,
): Promise<string | null> {
  const apiBase = getKestrelApiBaseUrl(conns);
  try {
    const sig = apiBase
      ? await cancelBetViaApi({ conns, marketId: market.id })
      : await (async () => {
          const tx = await (conns.erProgram.methods as any)
            .cancelBet(market.id)
            .accounts({
              owner: conns.signerKeypair.publicKey,
            })
            .transaction();
          return sendErTx(conns, tx, [conns.signerKeypair]);
        })();
    log.info({ market: market.id, reason, sig }, "cancel_bet");
    return sig;
  } catch (err: any) {
    // PositionNotFound is fine — nothing to cancel.
    log.debug(
      { market: market.id, reason, err: String(err?.message || err).slice(0, 200) },
      "cancel_bet noop or failed",
    );
    return null;
  }
}

async function maybeRaiseRiskLpOpenPositionsCap(conns: AgentConnections): Promise<void> {
  const tpl = defaultPolicyFor("risk_lp");
  const pda = agentPda(conns.signerKeypair.publicKey, conns.programId);
  const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  const program =
    baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) || !baseInfo
      ? conns.erProgram
      : conns.baseProgram;
  let cap: number;
  try {
    const acc = await (program as any).account.agentProfile.fetch(pda);
    cap = Number(acc.policy.maxOpenPositions);
  } catch {
    return;
  }
  if (cap >= tpl.maxOpenPositions) return;
  const tx = await (conns.erProgram.methods as any)
    .updatePolicy({
      maxStakePerWindow: tpl.maxStakePerWindow,
      maxOpenPositions: tpl.maxOpenPositions,
      allowedMarketsRoot: tpl.allowedMarketsRoot,
      paused: tpl.paused,
    })
    .accounts({ owner: conns.signerKeypair.publicKey })
    .transaction();
  const sig = await sendErTx(conns, tx, [conns.signerKeypair]);
  log.info({ reason: "boot: raise max_open_positions (risk_lp)", sig }, "update_policy");
}

async function tick(conns: AgentConnections): Promise<void> {
  const market = await findActiveOpenMarket(conns, log);
  if (!market) return;

  const nowSec = Math.floor(Date.now() / 1000);
  await flattenPositionsOutsideCurrentMarket(conns, market, nowSec, log);

  const memo = memos.get(market.id) ?? {
    hedgesPlaced: 0,
    cancelled: false,
  };
  memos.set(market.id, memo);

  const secsToClose = market.closeTs - nowSec;

  // Cancel-on-staleness / near-close. Once per market.
  if (!memo.cancelled) {
    const snap = await readOracleSnapshot({
      connection: conns.baseConnection,
      feed: market.oracleFeed,
      log,
    });
    const stale = !!snap && snap.ageSecs > STALE_THRESHOLD_SECS;
    const nearClose = secsToClose > 0 && secsToClose <= CANCEL_NEAR_CLOSE_SECS;
    if (stale || nearClose) {
      const reason = stale
        ? `oracle stale (age=${snap?.ageSecs}s)`
        : `near close (${secsToClose}s left)`;
      await cancelMarket(conns, market, reason);
      memo.cancelled = true;
      return;
    }
  }

  // Bounded hedging: place at most N hedges per market window.
  if (memo.hedgesPlaced >= HEDGES_PER_MARKET) {
    return;
  }

  const side = decideUnderboughtSide(market);
  if (!side) return; // perfectly balanced, nothing to dampen yet

  const sig = await placeHedge(conns, market, side);
  if (sig) memo.hedgesPlaced += 1;
}

async function main(): Promise<void> {
  const conns = buildConnections("risk_lp");
  log.info(
    {
      kestrel_api_mode: conns.env.kestrelApiBaseUrl ? "http" : "chain",
      owner: conns.signerKeypair.publicKey.toBase58(),
      hedgeSize: HEDGE_SIZE,
      hedgesPerMarket: HEDGES_PER_MARKET,
      cancelNearCloseSecs: CANCEL_NEAR_CLOSE_SECS,
    },
    "risk_lp boot",
  );

  const { agentPda: pda } = await ensureAgent({ conns, role: "risk_lp", log });
  await tagAgentRole({ conns, role: "risk_lp", agentPda: pda, log });
  await ensureErTradingReady({
    conns,
    role: "risk_lp",
    log,
    targetBalance: new BN(TARGET_BALANCE),
  });
  try {
    await maybeRaiseRiskLpOpenPositionsCap(conns);
  } catch (err: unknown) {
    log.warn(
      { err: formatErrorForLog(err) },
      "risk_lp: maybeRaiseRiskLpOpenPositionsCap failed (continuing)",
    );
  }

  while (true) {
    try {
      await tick(conns);
    } catch (err: any) {
      log.error({ err: String(err?.message || err) }, "tick failure");
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main().catch((err) => {
  log.fatal({ err: formatErrorForLog(err) }, "risk_lp crashed");
  process.exit(1);
});
