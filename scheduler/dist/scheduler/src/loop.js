"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
const connections_1 = require("./connections");
const log_1 = require("./log");
const state_1 = require("./state");
const horizon_1 = require("./lifecycle/horizon");
const openClose_1 = require("./lifecycle/openClose");
const agents_1 = require("./lifecycle/agents");
const settle_1 = require("./lifecycle/settle");
function formatErr(err) {
    const message = typeof err?.message === "string"
        ? err.message
        : (() => {
            try {
                return JSON.stringify(err);
            }
            catch {
                return String(err);
            }
        })();
    const anchorCode = err?.error?.errorCode?.number ??
        err?.error?.errorCode?.code ??
        err?.errorCode?.number ??
        err?.errorCode?.code ??
        null;
    const logs = Array.isArray(err?.logs) ? err.logs : null;
    const stack = typeof err?.stack === "string" ? err.stack : null;
    return { message, anchorCode, logs, stack };
}
const FULL_REFRESH_INTERVAL_MS = 5000;
const AGENT_DELEGATE_INTERVAL_MS = 30000;
const PER_OP_COOLDOWN_MS = 8000;
// Small delay helps avoid clock skew between local wall-clock and on-chain Clock sysvar.
const ONCHAIN_CLOCK_SKEW_BUFFER_SECS = 2;
async function startScheduler(conns, cfg, log) {
    log.info({
        window_secs: cfg.windowSecs,
        horizon_secs: cfg.horizonSecs,
        tick_ms: cfg.tickMs,
        seed_liquidity: cfg.seedLiquidity.toString(),
        endpoints: (0, connections_1.describeEndpoints)(cfg),
        wallet: conns.wallet.publicKey.toBase58(),
        program_id: conns.programId.toBase58(),
    }, "scheduler: starting");
    await (0, connections_1.getValidatorIdentity)(conns).catch((err) => {
        log.warn({ err: String(err?.message || err) }, "scheduler: failed to resolve validator identity at startup");
    });
    const state = {
        horizon: (0, horizon_1.newHorizonState)(),
        perMarket: new Map(),
        markets: new Map(),
        lastFullRefreshMs: 0,
        lastAgentDelegateMs: 0,
        ticking: false,
    };
    await refreshMarkets(conns, state, log).catch((err) => {
        log.warn({ err: String(err?.message || err) }, "scheduler: initial market refresh failed");
    });
    const interval = setInterval(() => {
        void tick(conns, cfg, state, log);
    }, cfg.tickMs);
    let stopped = false;
    return async () => {
        if (stopped)
            return;
        stopped = true;
        clearInterval(interval);
        log.info("scheduler: stopped");
    };
}
function getOrInitPerMarket(state, id) {
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
async function refreshMarkets(conns, state, log) {
    const cfg = await (0, state_1.loadConfig)(conns);
    if (!cfg)
        return;
    const markets = await (0, state_1.listMarkets)(conns, cfg.marketCount);
    const map = new Map();
    for (const m of markets)
        map.set(m.id, m);
    state.markets = map;
    state.lastFullRefreshMs = Date.now();
    log.debug({ count: markets.length }, "scheduler: market cache refreshed");
}
async function refreshOneMarket(conns, state, id) {
    const pda = (0, state_1.marketPda)(id, conns.programId);
    const snap = await (0, state_1.fetchMarketSnapshot)(conns, pda);
    if (snap)
        state.markets.set(id, snap);
}
async function tick(conns, cfg, state, log) {
    if (state.ticking)
        return;
    state.ticking = true;
    try {
        const nowMs = Date.now();
        const nowSecs = Math.floor(nowMs / 1000);
        if (nowMs - state.lastFullRefreshMs > FULL_REFRESH_INTERVAL_MS) {
            await refreshMarkets(conns, state, log).catch((err) => {
                log.warn({ err: String(err?.message || err) }, "tick: refresh markets failed");
            });
        }
        void (0, horizon_1.ensureHorizonOnce)(conns, cfg, state.horizon, log);
        if (nowMs - state.lastAgentDelegateMs > AGENT_DELEGATE_INTERVAL_MS) {
            state.lastAgentDelegateMs = nowMs;
            void (0, agents_1.delegateUndelegatedAgentsOnce)({
                conns,
                cfg,
                feePayer: cfg.adminKeypair,
                log,
            }).catch((err) => {
                log.warn({ err: String(err?.message || err) }, "tick: delegate_agent pass failed");
            });
        }
        const promises = [];
        for (const market of state.markets.values()) {
            const per = getOrInitPerMarket(state, market.id);
            if (per.doneAt !== null)
                continue;
            if (market.status === "pending" &&
                market.isDelegated &&
                nowSecs >= market.openTs + ONCHAIN_CLOCK_SKEW_BUFFER_SECS &&
                !per.inFlight.has("open") &&
                nowMs - per.lastOpenAttemptMs > PER_OP_COOLDOWN_MS) {
                per.inFlight.add("open");
                per.lastOpenAttemptMs = nowMs;
                promises.push(handleOpen(conns, cfg, state, log, market));
                continue;
            }
            if ((market.status === "open" || market.status === "halted") &&
                market.isDelegated &&
                nowSecs >= market.closeTs + ONCHAIN_CLOCK_SKEW_BUFFER_SECS &&
                !per.inFlight.has("close") &&
                nowMs - per.lastCloseAttemptMs > PER_OP_COOLDOWN_MS) {
                per.inFlight.add("close");
                per.lastCloseAttemptMs = nowMs;
                promises.push(handleClose(conns, cfg, state, log, market));
                continue;
            }
            if (market.status === "closed" &&
                market.isDelegated &&
                !per.inFlight.has("settle") &&
                nowMs - per.lastSettleAttemptMs > PER_OP_COOLDOWN_MS) {
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
    }
    catch (err) {
        log.error({ err: String(err?.message || err) }, "tick: unexpected error");
    }
    finally {
        state.ticking = false;
    }
}
async function handleOpen(conns, cfg, state, log, market) {
    const mlog = (0, log_1.marketLogger)(log, market.id);
    const per = getOrInitPerMarket(state, market.id);
    try {
        const sig = await (0, openClose_1.openMarketOnEr)({
            conns,
            admin: cfg.adminKeypair,
            id: market.id,
            oracleFeed: market.oracleFeed,
            seedLiquidity: cfg.seedLiquidity,
        });
        mlog.info({ sig }, "open_market");
        await refreshOneMarket(conns, state, market.id);
    }
    catch (err) {
        if ((0, openClose_1.isRetriableErErr)(err)) {
            mlog.debug({ err: formatErr(err) }, "open_market: retriable");
        }
        else {
            mlog.warn({ err: formatErr(err) }, "open_market failed");
        }
    }
    finally {
        per.inFlight.delete("open");
    }
}
async function handleClose(conns, cfg, state, log, market) {
    const mlog = (0, log_1.marketLogger)(log, market.id);
    const per = getOrInitPerMarket(state, market.id);
    try {
        const sig = await (0, openClose_1.closeMarketOnEr)({
            conns,
            admin: cfg.adminKeypair,
            id: market.id,
            oracleFeed: market.oracleFeed,
        });
        mlog.info({ sig }, "close_market");
        await refreshOneMarket(conns, state, market.id);
    }
    catch (err) {
        if ((0, openClose_1.isRetriableErErr)(err)) {
            mlog.debug({ err: formatErr(err) }, "close_market: retriable");
        }
        else {
            mlog.warn({ err: formatErr(err) }, "close_market failed");
        }
    }
    finally {
        per.inFlight.delete("close");
    }
}
async function handleSettle(conns, cfg, state, log, market) {
    const mlog = (0, log_1.marketLogger)(log, market.id);
    const per = getOrInitPerMarket(state, market.id);
    try {
        const result = await (0, settle_1.finalizeMarket)({
            conns,
            admin: cfg.adminKeypair,
            marketId: market.id,
            log: mlog,
        });
        if (result.commitSig) {
            per.doneAt = Date.now();
        }
        await refreshOneMarket(conns, state, market.id);
    }
    catch (err) {
        const msg = String(err?.message || err);
        if ((0, openClose_1.isRetriableErErr)(err)) {
            mlog.debug({ err: msg }, "finalize: retriable");
        }
        else {
            mlog.warn({ err: msg }, "finalize failed");
        }
    }
    finally {
        per.inFlight.delete("settle");
    }
}
