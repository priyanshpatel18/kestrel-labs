"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connections_1 = require("./common/connections");
const logger_1 = require("./common/logger");
const markets_1 = require("./common/markets");
const oracle_1 = require("./common/oracle");
const registry_1 = require("./common/registry");
const tx_1 = require("./common/tx");
const log = (0, logger_1.buildLogger)("market_ops");
const TICK_MS = 1500;
const STALE_THRESHOLD_SECS = Number(process.env.AGENTS_OPS_STALE_THRESHOLD_SECS || 30);
const FORCE_HALT_EVERY = Number(process.env.AGENTS_OPS_FORCE_HALT_EVERY_MARKETS || 4);
const FORCE_HALT_SECS = Number(process.env.AGENTS_OPS_FORCE_HALT_SECS || 20);
let forceHaltActive = null;
const seenMarkets = new Set();
async function haltMarket(conns, market, reason) {
    try {
        const tx = await conns.erProgram.methods
            .haltMarket(market.id)
            .accounts({ admin: conns.signerKeypair.publicKey })
            .transaction();
        const sig = await (0, tx_1.sendErTx)(conns, tx, [conns.signerKeypair]);
        log.info({ market: market.id, reason, sig }, "halt_market");
    }
    catch (err) {
        log.warn({ err: String(err?.message || err), market: market.id, reason }, "halt_market failed");
    }
}
async function resumeMarket(conns, market, reason) {
    try {
        const tx = await conns.erProgram.methods
            .resumeMarket(market.id)
            .accounts({ admin: conns.signerKeypair.publicKey })
            .transaction();
        const sig = await (0, tx_1.sendErTx)(conns, tx, [conns.signerKeypair]);
        log.info({ market: market.id, reason, sig }, "resume_market");
    }
    catch (err) {
        log.warn({ err: String(err?.message || err), market: market.id, reason }, "resume_market failed");
    }
}
async function tickStaleness(conns, feed) {
    const snap = await (0, oracle_1.readOracleSnapshot)({
        connection: conns.baseConnection,
        feed,
        log,
    });
    const isStale = !!snap && snap.ageSecs > STALE_THRESHOLD_SECS;
    return { snap, isStale };
}
async function tick(conns) {
    const open = await (0, markets_1.findActiveOpenMarket)(conns, log);
    const haltedView = await (0, markets_1.findHaltedMarket)(conns, log);
    const live = open ?? haltedView;
    if (!live) {
        log.debug("no active or halted market this tick");
        forceHaltActive = null;
        return;
    }
    // Demo determinism — force a halt on every Nth distinct market id we see.
    if (FORCE_HALT_EVERY > 0 &&
        open &&
        !seenMarkets.has(open.id) &&
        open.status === "open") {
        seenMarkets.add(open.id);
        if (open.id % FORCE_HALT_EVERY === 0) {
            forceHaltActive = {
                marketId: open.id,
                resumeAtMs: Date.now() + FORCE_HALT_SECS * 1000,
            };
            await haltMarket(conns, open, `forced demo halt (every ${FORCE_HALT_EVERY})`);
            return;
        }
    }
    // If a forced halt is active, resume when its window elapses.
    if (forceHaltActive && Date.now() >= forceHaltActive.resumeAtMs) {
        if (haltedView && haltedView.id === forceHaltActive.marketId) {
            await resumeMarket(conns, haltedView, "forced demo halt elapsed");
        }
        forceHaltActive = null;
        return;
    }
    // Oracle freshness loop.
    const { snap, isStale } = await tickStaleness(conns, conns.env.btcUsdPriceUpdate);
    log.debug({
        market: live.id,
        status: live.status,
        ageSecs: snap?.ageSecs,
        isStale,
        forceHaltActive,
    }, "tick");
    if (open && isStale) {
        await haltMarket(conns, open, `oracle stale (age=${snap?.ageSecs}s > ${STALE_THRESHOLD_SECS}s)`);
        return;
    }
    if (haltedView && !isStale && !forceHaltActive) {
        await resumeMarket(conns, haltedView, "oracle fresh again");
    }
}
async function main() {
    const conns = (0, connections_1.buildConnections)("market_ops");
    log.info({
        base: conns.env.baseRpcUrl,
        er: conns.env.erRpcUrl,
        admin: conns.signerKeypair.publicKey.toBase58(),
        forceHaltEvery: FORCE_HALT_EVERY,
        staleThresholdSecs: STALE_THRESHOLD_SECS,
    }, "market_ops boot");
    // MarketOps doesn't need an AgentProfile to call halt/resume/close, but we
    // create one anyway so the /agents UI has a row for the role.
    try {
        const { agentPda: pda } = await (0, registry_1.ensureAgent)({ conns, role: "market_ops", log });
        await (0, registry_1.tagAgentRole)({ conns, role: "market_ops", agentPda: pda, log });
    }
    catch (err) {
        log.warn({ err: String(err?.message || err) }, "market_ops: ensureAgent skipped (continuing)");
    }
    // Forever loop.
    while (true) {
        try {
            await tick(conns);
        }
        catch (err) {
            log.error({ err: String(err?.message || err) }, "tick failure");
        }
        await new Promise((r) => setTimeout(r, TICK_MS));
    }
}
main().catch((err) => {
    log.fatal({ err: String(err?.message || err) }, "market_ops crashed");
    process.exit(1);
});
