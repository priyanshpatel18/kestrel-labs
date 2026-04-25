import type { SchedulerConfig } from "./config";
import type { KestrelConnections } from "./connections";
import { describeEndpoints, getValidatorIdentity } from "./connections";
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

const FULL_REFRESH_INTERVAL_MS = 5_000;
const AGENT_DELEGATE_INTERVAL_MS = 30_000;
const PER_OP_COOLDOWN_MS = 8_000;

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
      endpoints: describeEndpoints(cfg),
      wallet: conns.wallet.publicKey.toBase58(),
      program_id: conns.programId.toBase58(),
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

async function tick(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
  state: SchedulerRuntimeState,
  log: SchedulerLogger,
): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const nowMs = Date.now();
    const nowSecs = Math.floor(nowMs / 1000);

    if (nowMs - state.lastFullRefreshMs > FULL_REFRESH_INTERVAL_MS) {
      await refreshMarkets(conns, state, log).catch((err) => {
        log.warn(
          { err: String(err?.message || err) },
          "tick: refresh markets failed",
        );
      });
    }

    void ensureHorizonOnce(conns, cfg, state.horizon, log);

    if (nowMs - state.lastAgentDelegateMs > AGENT_DELEGATE_INTERVAL_MS) {
      state.lastAgentDelegateMs = nowMs;
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

    const promises: Promise<void>[] = [];
    for (const market of state.markets.values()) {
      const per = getOrInitPerMarket(state, market.id);
      if (per.doneAt !== null) continue;

      if (
        market.status === "pending" &&
        market.isDelegated &&
        nowSecs >= market.openTs &&
        !per.inFlight.has("open") &&
        nowMs - per.lastOpenAttemptMs > PER_OP_COOLDOWN_MS
      ) {
        per.inFlight.add("open");
        per.lastOpenAttemptMs = nowMs;
        promises.push(handleOpen(conns, cfg, state, log, market));
        continue;
      }

      if (
        (market.status === "open" || market.status === "halted") &&
        market.isDelegated &&
        nowSecs >= market.closeTs &&
        !per.inFlight.has("close") &&
        nowMs - per.lastCloseAttemptMs > PER_OP_COOLDOWN_MS
      ) {
        per.inFlight.add("close");
        per.lastCloseAttemptMs = nowMs;
        promises.push(handleClose(conns, cfg, state, log, market));
        continue;
      }

      if (
        market.status === "closed" &&
        market.isDelegated &&
        !per.inFlight.has("settle") &&
        nowMs - per.lastSettleAttemptMs > PER_OP_COOLDOWN_MS
      ) {
        per.inFlight.add("settle");
        per.lastSettleAttemptMs = nowMs;
        promises.push(handleSettle(conns, cfg, state, log, market));
        continue;
      }

      if (market.status === "closed" && !market.isDelegated) {
        per.doneAt = nowMs;
      }
    }

    await Promise.allSettled(promises);
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
    const msg = String(err?.message || err);
    if (isRetriableErErr(err)) {
      mlog.debug({ err: msg }, "open_market: retriable");
    } else {
      mlog.warn({ err: msg }, "open_market failed");
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
    const msg = String(err?.message || err);
    if (isRetriableErErr(err)) {
      mlog.debug({ err: msg }, "close_market: retriable");
    } else {
      mlog.warn({ err: msg }, "close_market failed");
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
