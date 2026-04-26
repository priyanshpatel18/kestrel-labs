/**
 * Trader role
 * -----------
 * Honest momentum bet on each open market window plus two scripted policy
 * violations that produce the guaranteed `PlaceBetBlocked` demo cards:
 *
 *   T+0s   honest bet sized to `AGENTS_TRADER_BASE_SIZE`. Should succeed.
 *   T+10s  one bet at `policy.max_stake_per_window + 1`. Always trips
 *          KestrelError::OverPolicyCap.
 *   T+20s  rotate `allowed_markets_root` to a known-bad value via
 *          `update_policy`, attempt one place_bet (KestrelError::MarketNotAllowed),
 *          rotate the policy back. Fires two PolicyUpdated cards plus a blocked card.
 */
import { BN } from "@coral-xyz/anchor";

import { AgentConnections, buildConnections } from "./common/connections";
import { buildLogger } from "./common/logger";
import {
  flattenPositionsOutsideCurrentMarket,
  tryCancelBetOnMarket,
} from "./common/flattenPositions";
import { DELEGATION_PROGRAM_ID, MarketView, findActiveOpenMarket } from "./common/markets";
import { readOracleSnapshot } from "./common/oracle";
import {
  defaultPolicyFor,
  wrongAllowlistRoot,
} from "./common/policy";
import { formatErrorForLog } from "./common/formatError";
import { getKestrelApiBaseUrl, placeBetViaApi } from "./common/kestrelApi";
import {
  agentPda,
  ensureAgent,
  ensureErTradingReady,
  tagAgentRole,
} from "./common/registry";
import { extractCustomErrorCode, sendErTx } from "./common/tx";

const log = buildLogger("trader");

const TICK_MS = 1000;
const BASE_SIZE = Number(process.env.AGENTS_TRADER_BASE_SIZE || 200_000);
const OVER_CAP_AT_SEC = Number(process.env.AGENTS_TRADER_OVER_CAP_AT_SEC || 10);
const WRONG_ALLOWLIST_AT_SEC = Number(
  process.env.AGENTS_TRADER_WRONG_ALLOWLIST_AT_SEC || 20,
);
const TARGET_BALANCE = Number(process.env.AGENTS_TRADER_TARGET_BALANCE || 2_000_000);

interface MarketActions {
  honestPlaced: boolean;
  overCapAttempted: boolean;
  wrongAllowlistAttempted: boolean;
  /** After scripted demos, cancel once on this market before close to free the slot. */
  flattenedAfterDemo: boolean;
}

const memos = new Map<number, MarketActions>();

async function placeBet(params: {
  conns: AgentConnections;
  market: MarketView;
  side: "yes" | "no";
  amount: BN;
  expectFailure?: string;
}): Promise<string | null> {
  const { conns, market, side, amount, expectFailure } = params;
  const apiBase = getKestrelApiBaseUrl(conns);
  try {
    const sig = apiBase
      ? await placeBetViaApi({
          conns,
          marketId: market.id,
          side,
          amount,
        })
      : await (async () => {
          const sideArg = side === "yes" ? { yes: {} } : { no: {} };
          const tx = await (conns.erProgram.methods as any)
            .placeBet(market.id, sideArg, amount)
            .accounts({
              owner: conns.signerKeypair.publicKey,
              priceUpdate: market.oracleFeed,
            })
            .transaction();
          return sendErTx(conns, tx, [conns.signerKeypair]);
        })();
    log.info(
      {
        market: market.id,
        side,
        amount: amount.toString(),
        sig,
        intentional: expectFailure ?? null,
      },
      expectFailure ? "place_bet (unexpectedly succeeded)" : "place_bet",
    );
    return sig;
  } catch (err: any) {
    const code = extractCustomErrorCode(err);
    log.warn(
      {
        market: market.id,
        side,
        amount: amount.toString(),
        intentional: expectFailure ?? null,
        code,
        err: formatErrorForLog(err).slice(0, 800),
      },
      expectFailure ? "place_bet blocked (expected)" : "place_bet failed",
    );
    return null;
  }
}

async function updatePolicy(
  conns: AgentConnections,
  policy: ReturnType<typeof defaultPolicyFor>,
  reason: string,
): Promise<string | null> {
  const tx = await (conns.erProgram.methods as any)
    .updatePolicy(policy)
    .accounts({ owner: conns.signerKeypair.publicKey })
    .transaction();
  try {
    const sig = await sendErTx(conns, tx, [conns.signerKeypair]);
    log.info({ reason, sig }, "update_policy");
    return sig;
  } catch (err: any) {
    log.warn({ reason, err: String(err?.message || err) }, "update_policy failed");
    return null;
  }
}

async function inferMomentumSide(
  conns: AgentConnections,
  market: MarketView,
): Promise<"yes" | "no"> {
  const snap = await readOracleSnapshot({
    connection: conns.baseConnection,
    feed: market.oracleFeed,
    log,
  });
  if (!snap) return "yes";
  // Toy momentum: if current price > strike, momentum is up so YES.
  const strike = Number(market.strike?.toString?.() ?? market.strike);
  const price = Number(snap.price);
  return price >= strike ? "yes" : "no";
}

async function tick(conns: AgentConnections): Promise<void> {
  const market = await findActiveOpenMarket(conns, log);
  if (!market) return;

  const nowSec = Math.floor(Date.now() / 1000);
  let memo = memos.get(market.id);
  if (!memo) {
    memo = {
      honestPlaced: false,
      overCapAttempted: false,
      wrongAllowlistAttempted: false,
      flattenedAfterDemo: false,
    };
    memos.set(market.id, memo);
  }

  await flattenPositionsOutsideCurrentMarket(conns, market, nowSec, log);

  const elapsed = nowSec - market.openTs;
  // Refresh policy once so the over-cap demo uses the on-chain max+1.
  const policyTpl = defaultPolicyFor("trader");
  const onchainMaxStake = await readOnchainMaxStake(conns).catch(() => null);
  const maxStake = onchainMaxStake ?? policyTpl.maxStakePerWindow;

  // Honest momentum bet at +0s.
  if (!memo.honestPlaced && elapsed >= 0) {
    const side = await inferMomentumSide(conns, market);
    const sig = await placeBet({
      conns,
      market,
      side,
      amount: new BN(BASE_SIZE),
    });
    if (sig) memo.honestPlaced = true;
  }

  // Over-cap violation at +10s.
  if (!memo.overCapAttempted && elapsed >= OVER_CAP_AT_SEC && memo.honestPlaced) {
    memo.overCapAttempted = true;
    const overCap = maxStake.add(new BN(1));
    await placeBet({
      conns,
      market,
      side: "yes",
      amount: overCap,
      expectFailure: "OverPolicyCap",
    });
  }

  // Wrong-allowlist violation at +20s.
  if (
    !memo.wrongAllowlistAttempted &&
    elapsed >= WRONG_ALLOWLIST_AT_SEC &&
    memo.honestPlaced
  ) {
    memo.wrongAllowlistAttempted = true;
    // Tighten allowlist to a clearly-wrong root, attempt one bet, then restore.
    const tightened = {
      ...policyTpl,
      maxStakePerWindow: maxStake,
      allowedMarketsRoot: wrongAllowlistRoot(),
    };
    const sigTight = await updatePolicy(conns, tightened, "demo: wrong allowlist");
    if (sigTight) {
      await placeBet({
        conns,
        market,
        side: "no",
        amount: new BN(Math.min(BASE_SIZE, Number(maxStake.toString()))),
        expectFailure: "MarketNotAllowed",
      });
      // Restore the original allowlist so honest bets work again.
      await updatePolicy(
        conns,
        { ...policyTpl, maxStakePerWindow: maxStake },
        "demo: restore allowlist",
      );
    }
  }

  // Flatten this window once demos are done so the slot is free before
  // close_ts (cancel_bet is not allowed after the market leaves Open/Halted).
  if (
    memo.honestPlaced &&
    memo.overCapAttempted &&
    memo.wrongAllowlistAttempted &&
    !memo.flattenedAfterDemo
  ) {
    const secsToClose = market.closeTs - nowSec;
    if (secsToClose > 15 && secsToClose <= 180) {
      memo.flattenedAfterDemo = true;
      await tryCancelBetOnMarket(conns, market.id, log);
    }
  }
}

async function maybeRaiseOpenPositionsCap(conns: AgentConnections): Promise<void> {
  const tpl = defaultPolicyFor("trader");
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
  await updatePolicy(conns, tpl, "boot: raise max_open_positions");
}

async function readOnchainMaxStake(conns: AgentConnections): Promise<BN | null> {
  const owner = conns.signerKeypair.publicKey;
  const pda = agentPda(owner, conns.programId);
  const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  if (!baseInfo) return null;
  const program = baseInfo.owner.equals(DELEGATION_PROGRAM_ID)
    ? conns.erProgram
    : conns.baseProgram;
  try {
    const acc = await (program as any).account.agentProfile.fetch(pda);
    return new BN(acc.policy.maxStakePerWindow.toString());
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const conns = buildConnections("trader");
  log.info(
    {
      base: conns.env.baseRpcUrl,
      er: conns.env.erRpcUrl,
      kestrelApi: conns.env.kestrelApiBaseUrl ?? null,
      owner: conns.signerKeypair.publicKey.toBase58(),
      baseSize: BASE_SIZE,
    },
    "trader boot",
  );

  const { agentPda: pda } = await ensureAgent({ conns, role: "trader", log });
  await tagAgentRole({ conns, role: "trader", agentPda: pda, log });
  await ensureErTradingReady({
    conns,
    role: "trader",
    log,
    targetBalance: new BN(TARGET_BALANCE),
  });
  try {
    await maybeRaiseOpenPositionsCap(conns);
  } catch (err: unknown) {
    log.warn(
      { err: formatErrorForLog(err) },
      "trader: maybeRaiseOpenPositionsCap failed (continuing)",
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
  log.fatal({ err: formatErrorForLog(err) }, "trader crashed");
  process.exit(1);
});
