import type { SchedulerConfig } from "./config";
import type { KestrelConnections } from "./connections";
import { getValidatorIdentity } from "./connections";
import { SchedulerLogger, marketLogger } from "./log";
import {
  MarketSnapshot,
  fetchMarketSnapshot,
  listMarkets,
  loadConfig,
  marketPda,
} from "./state";
import {
  HorizonState,
  ensureHorizonOnce,
  newHorizonState,
} from "./lifecycle/horizon";
import {
  closeMarketOnEr,
  isRetriableErErr,
  openMarketOnEr,
} from "./lifecycle/openClose";
import { delegateUndelegatedAgentsOnce } from "./lifecycle/agents";
import { finalizeMarket } from "./lifecycle/settle";

type OpKind = "open" | "close" | "settle";

function formatErr(err: any): Record<string, unknown> {
  const message =
    typeof err?.message === "string"
      ? err.message
      : (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })();

  const anchorCode =
    err?.error?.errorCode?.number ??
    err?.error?.errorCode?.code ??
    err?.errorCode?.number ??
    err?.errorCode?.code ??
    null;

  const logs = Array.isArray(err?.logs) ? err.logs : null;
  const stack = typeof err?.stack === "string" ? err.stack : null;

  return { message, anchorCode, logs, stack };
}

interface PerMarketState {
  inFlight: Set<OpKind>;
  lastOpenAttemptMs: number;
  lastCloseAttemptMs: number;
  lastSettleAttemptMs: number;
  // Treat as "permanently done" once status==closed && !isDelegated.
  doneAt: number | null;
}

interface SchedulerRuntimeState {
  horizon: HorizonState;
  perMarket: Map<number, PerMarketState>;
  markets: Map<number, MarketSnapshot>;
  lastFullRefreshMs: number;
  lastAgentDelegateMs: number;
  ticking: boolean;
}

const AGENT_DELEGATE_INTERVAL_MS = 30_000;
/** Max create+delegate pairs per tick so one slow tick cannot starve ER work forever. */
const MAX_HORIZON_CREATE_DELEGATE_PER_TICK = 8;
/**
 * ER open/close passes per tick — re-scan with a fresh clock after awaits so window
 * boundaries are not missed while `state.ticking` blocks the interval callback.
 */
const MAX_ER_OPEN_CLOSE_PASSES_PER_TICK = 24;

export async function startScheduler(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
  log: SchedulerLogger,
): Promise<() => Promise<void>> {
  log.info(
    {
      window_secs: cfg.windowSecs,
      horizon_secs: cfg.horizonSecs,
      tick_ms: cfg.tickMs,
      seed_liquidity: cfg.seedLiquidity.toString(),
      window_buffer_secs: cfg.onchainWindowBufferSecs,
      market_list_refresh_ms: cfg.marketListRefreshMs,
      open_close_cooldown_ms: cfg.openCloseCooldownMs,
      settle_cooldown_ms: cfg.settleCooldownMs,
    },
    "scheduler: starting",
  );

  await getValidatorIdentity(conns).catch((err) => {
    log.warn(
      { err: String(err?.message || err) },
      "scheduler: failed to resolve validator identity at startup",
    );
  });

  const state: SchedulerRuntimeState = {
    horizon: newHorizonState(),
    perMarket: new Map(),
    markets: new Map(),
    lastFullRefreshMs: 0,
    lastAgentDelegateMs: 0,
    ticking: false,
  };

  await refreshMarkets(conns, state, log).catch((err) => {
    log.warn(
      { err: String(err?.message || err) },
      "scheduler: initial market refresh failed",
    );
  });

  const interval = setInterval(() => {
    void tick(conns, cfg, state, log);
  }, cfg.tickMs);

  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    log.info("scheduler: stopped");
  };
}

function getOrInitPerMarket(
  state: SchedulerRuntimeState,
  id: number,
): PerMarketState {
  let s = state.perMarket.get(id);
  if (!s) {
    s = {
      inFlight: new Set(),
      lastOpenAttemptMs: 0,
      lastCloseAttemptMs: 0,
      lastSettleAttemptMs: 0,
      doneAt: null,
    };
    state.perMarket.set(id, s);
  }
  return s;
}

async function refreshMarkets(
  conns: KestrelConnections,
  state: SchedulerRuntimeState,
  log: SchedulerLogger,
): Promise<void> {
  const cfg = await loadConfig(conns);
  if (!cfg) return;
  const markets = await listMarkets(conns, cfg.marketCount);
  const map = new Map<number, MarketSnapshot>();
  for (const m of markets) map.set(m.id, m);
  state.markets = map;
  state.lastFullRefreshMs = Date.now();
  log.debug(
    { count: markets.length },
    "scheduler: market cache refreshed",
  );
}

async function refreshOneMarket(
  conns: KestrelConnections,
  state: SchedulerRuntimeState,
  id: number,
): Promise<void> {
  const pda = marketPda(id, conns.programId);
  const snap = await fetchMarketSnapshot(conns, pda);
  if (snap) state.markets.set(id, snap);
}

/**
 * Dispatch all eligible ER `open_market` / `close_market` txs for the current cache,
 * using a **fresh** wall clock (not the tick's frozen snapshot).
 */
async function runErOpenClosePass(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
  state: SchedulerRuntimeState,
  log: SchedulerLogger,
): Promise<number> {
  const nowMs = Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const erPhase: Promise<void>[] = [];
  for (const market of state.markets.values()) {
    const per = getOrInitPerMarket(state, market.id);
    if (per.doneAt !== null) continue;

    if (
      market.status === "pending" &&
      market.isDelegated &&
      nowSecs >= market.openTs + cfg.onchainWindowBufferSecs &&
      !per.inFlight.has("open") &&
      nowMs - per.lastOpenAttemptMs > cfg.openCloseCooldownMs
    ) {
      per.inFlight.add("open");
      per.lastOpenAttemptMs = nowMs;
      erPhase.push(handleOpen(conns, cfg, state, log, market));
      continue;
    }

    if (
      (market.status === "open" || market.status === "halted") &&
      market.isDelegated &&
      nowSecs >= market.closeTs + cfg.onchainWindowBufferSecs &&
      !per.inFlight.has("close") &&
      nowMs - per.lastCloseAttemptMs > cfg.openCloseCooldownMs
    ) {
      per.inFlight.add("close");
      per.lastCloseAttemptMs = nowMs;
      erPhase.push(handleClose(conns, cfg, state, log, market));
    }
  }
  if (erPhase.length === 0) return 0;
  await Promise.allSettled(erPhase);
  return erPhase.length;
}

async function tick(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
  state: SchedulerRuntimeState,
  log: SchedulerLogger,
): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const tickStartMs = Date.now();

    if (tickStartMs - state.lastFullRefreshMs > cfg.marketListRefreshMs) {
      await refreshMarkets(conns, state, log).catch((err) => {
        log.warn(
          { err: String(err?.message || err) },
          "tick: refresh markets failed",
        );
      });
    }

    // Phase 1 — ER: re-scan with fresh clock after each parallel batch so we never sit
    // through long horizon RPCs across open_ts/close_ts without dispatching.
    for (let p = 0; p < MAX_ER_OPEN_CLOSE_PASSES_PER_TICK; p++) {
      const n = await runErOpenClosePass(conns, cfg, state, log);
      if (n === 0) break;
    }

    // Phase 2 — base: create_market then delegate_market (ordered per market id); may run multiple pairs per tick up to cap.
    for (let h = 0; h < MAX_HORIZON_CREATE_DELEGATE_PER_TICK; h++) {
      const createdId = await ensureHorizonOnce(conns, cfg, state.horizon, log);
      if (createdId === null) break;
      await refreshMarkets(conns, state, log).catch((err) => {
        log.warn(
          { err: String(err?.message || err) },
          "tick: post-create market refresh failed",
        );
      });
      await runErOpenClosePass(conns, cfg, state, log);
    }

    for (let p = 0; p < MAX_ER_OPEN_CLOSE_PASSES_PER_TICK; p++) {
      const n = await runErOpenClosePass(conns, cfg, state, log);
      if (n === 0) break;
    }

    // Phase 3 — ER: settle_positions batched + commit_and_undelegate_market per market, all markets in parallel.
    const settleNow = Date.now();
    const settlePhase: Promise<void>[] = [];
    for (const market of state.markets.values()) {
      const per = getOrInitPerMarket(state, market.id);
      if (per.doneAt !== null) continue;

      if (
        market.status === "closed" &&
        market.isDelegated &&
        !per.inFlight.has("settle") &&
        settleNow - per.lastSettleAttemptMs > cfg.settleCooldownMs
      ) {
        per.inFlight.add("settle");
        per.lastSettleAttemptMs = settleNow;
        settlePhase.push(handleSettle(conns, cfg, state, log, market));
        continue;
      }

      if (market.status === "closed" && !market.isDelegated) {
        per.doneAt = settleNow;
      }
    }
    await Promise.allSettled(settlePhase);

    const tailNow = Date.now();
    if (tailNow - state.lastAgentDelegateMs > AGENT_DELEGATE_INTERVAL_MS) {
      state.lastAgentDelegateMs = tailNow;
      void delegateUndelegatedAgentsOnce({
        conns,
        cfg,
        feePayer: cfg.adminKeypair,
        log,
      }).catch((err) => {
        log.warn(
          { err: String(err?.message || err) },
          "tick: delegate_agent pass failed",
        );
      });
    }
  } catch (err: any) {
    log.error({ err: String(err?.message || err) }, "tick: unexpected error");
  } finally {
    state.ticking = false;
  }
}

async function handleOpen(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
  state: SchedulerRuntimeState,
  log: SchedulerLogger,
  market: MarketSnapshot,
): Promise<void> {
  const mlog = marketLogger(log, market.id);
  const per = getOrInitPerMarket(state, market.id);
  try {
    const sig = await openMarketOnEr({
      conns,
      admin: cfg.adminKeypair,
      id: market.id,
      oracleFeed: market.oracleFeed,
      seedLiquidity: cfg.seedLiquidity,
    });
    mlog.info({ sig }, "open_market");
    await refreshOneMarket(conns, state, market.id);
  } catch (err: any) {
    if (isRetriableErErr(err)) {
      mlog.debug({ err: formatErr(err) }, "open_market: retriable");
    } else {
      mlog.warn({ err: formatErr(err) }, "open_market failed");
    }
  } finally {
    per.inFlight.delete("open");
  }
}

async function handleClose(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
  state: SchedulerRuntimeState,
  log: SchedulerLogger,
  market: MarketSnapshot,
): Promise<void> {
  const mlog = marketLogger(log, market.id);
  const per = getOrInitPerMarket(state, market.id);
  try {
    const sig = await closeMarketOnEr({
      conns,
      admin: cfg.adminKeypair,
      id: market.id,
      oracleFeed: market.oracleFeed,
    });
    mlog.info({ sig }, "close_market");
    await refreshOneMarket(conns, state, market.id);
  } catch (err: any) {
    if (isRetriableErErr(err)) {
      mlog.debug({ err: formatErr(err) }, "close_market: retriable");
    } else {
      mlog.warn({ err: formatErr(err) }, "close_market failed");
    }
  } finally {
    per.inFlight.delete("close");
  }
}

async function handleSettle(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
  state: SchedulerRuntimeState,
  log: SchedulerLogger,
  market: MarketSnapshot,
): Promise<void> {
  const mlog = marketLogger(log, market.id);
  const per = getOrInitPerMarket(state, market.id);
  try {
    const result = await finalizeMarket({
      conns,
      admin: cfg.adminKeypair,
      marketId: market.id,
      log: mlog,
    });
    if (result.commitSig) {
      per.doneAt = Date.now();
    }
    await refreshOneMarket(conns, state, market.id);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (isRetriableErErr(err)) {
      mlog.debug({ err: msg }, "finalize: retriable");
    } else {
      mlog.warn({ err: msg }, "finalize failed");
    }
  } finally {
    per.inFlight.delete("settle");
  }
}
