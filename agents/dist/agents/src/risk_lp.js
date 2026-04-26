"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const anchor_1 = require("@coral-xyz/anchor");
const connections_1 = require("./common/connections");
const logger_1 = require("./common/logger");
const markets_1 = require("./common/markets");
const oracle_1 = require("./common/oracle");
const kestrelApi_1 = require("./common/kestrelApi");
const registry_1 = require("./common/registry");
const tx_1 = require("./common/tx");
const log = (0, logger_1.buildLogger)("risk_lp");
const TICK_MS = 2500;
const HEDGE_SIZE = Number(process.env.AGENTS_RISK_LP_HEDGE_SIZE || 75000);
const CANCEL_NEAR_CLOSE_SECS = Number(process.env.AGENTS_RISK_LP_CANCEL_NEAR_CLOSE_SECS || 30);
const STALE_THRESHOLD_SECS = Number(process.env.AGENTS_RISK_LP_STALE_THRESHOLD_SECS || 30);
const HEDGES_PER_MARKET = Number(process.env.AGENTS_RISK_LP_HEDGES_PER_MARKET || 2);
const TARGET_BALANCE = Number(process.env.AGENTS_RISK_LP_TARGET_BALANCE || 1000000);
const memos = new Map();
function decideUnderboughtSide(market) {
    // In our constant-product book, buying side X *removes* X-side reserve and
    // adds to the opposite. Higher reserve => less demand for that side. We
    // hedge in the under-bought direction (the higher-reserve side) so the
    // imbalance shrinks.
    const y = BigInt(market.yesReserve.toString());
    const n = BigInt(market.noReserve.toString());
    if (y === n)
        return null;
    return y > n ? "yes" : "no";
}
async function placeHedge(conns, market, side) {
    const apiBase = (0, kestrelApi_1.getKestrelApiBaseUrl)(conns);
    try {
        const sig = apiBase
            ? await (0, kestrelApi_1.placeBetViaApi)({
                conns,
                marketId: market.id,
                side,
                amount: new anchor_1.BN(HEDGE_SIZE),
            })
            : await (async () => {
                const sideArg = side === "yes" ? { yes: {} } : { no: {} };
                const tx = await conns.erProgram.methods
                    .placeBet(market.id, sideArg, new anchor_1.BN(HEDGE_SIZE))
                    .accounts({
                    owner: conns.signerKeypair.publicKey,
                    priceUpdate: market.oracleFeed,
                })
                    .transaction();
                return (0, tx_1.sendErTx)(conns, tx, [conns.signerKeypair]);
            })();
        log.info({ market: market.id, side, amount: HEDGE_SIZE, sig }, "hedge place_bet");
        return sig;
    }
    catch (err) {
        const code = (0, tx_1.extractCustomErrorCode)(err);
        log.warn({ market: market.id, side, amount: HEDGE_SIZE, code, err: String(err?.message || err).slice(0, 200) }, "hedge place_bet failed");
        return null;
    }
}
async function cancelMarket(conns, market, reason) {
    const apiBase = (0, kestrelApi_1.getKestrelApiBaseUrl)(conns);
    try {
        const sig = apiBase
            ? await (0, kestrelApi_1.cancelBetViaApi)({ conns, marketId: market.id })
            : await (async () => {
                const tx = await conns.erProgram.methods
                    .cancelBet(market.id)
                    .accounts({
                    owner: conns.signerKeypair.publicKey,
                })
                    .transaction();
                return (0, tx_1.sendErTx)(conns, tx, [conns.signerKeypair]);
            })();
        log.info({ market: market.id, reason, sig }, "cancel_bet");
        return sig;
    }
    catch (err) {
        // PositionNotFound is fine — nothing to cancel.
        log.debug({ market: market.id, reason, err: String(err?.message || err).slice(0, 200) }, "cancel_bet noop or failed");
        return null;
    }
}
async function tick(conns) {
    const market = await (0, markets_1.findActiveOpenMarket)(conns, log);
    if (!market)
        return;
    const memo = memos.get(market.id) ?? {
        hedgesPlaced: 0,
        cancelled: false,
    };
    memos.set(market.id, memo);
    const nowSec = Math.floor(Date.now() / 1000);
    const secsToClose = market.closeTs - nowSec;
    // Cancel-on-staleness / near-close. Once per market.
    if (!memo.cancelled) {
        const snap = await (0, oracle_1.readOracleSnapshot)({
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
    if (!side)
        return; // perfectly balanced, nothing to dampen yet
    const sig = await placeHedge(conns, market, side);
    if (sig)
        memo.hedgesPlaced += 1;
}
async function main() {
    const conns = (0, connections_1.buildConnections)("risk_lp");
    log.info({
        base: conns.env.baseRpcUrl,
        er: conns.env.erRpcUrl,
        kestrelApi: conns.env.kestrelApiBaseUrl ?? null,
        owner: conns.signerKeypair.publicKey.toBase58(),
        hedgeSize: HEDGE_SIZE,
        hedgesPerMarket: HEDGES_PER_MARKET,
        cancelNearCloseSecs: CANCEL_NEAR_CLOSE_SECS,
    }, "risk_lp boot");
    try {
        const { agentPda: pda } = await (0, registry_1.ensureAgent)({ conns, role: "risk_lp", log });
        await (0, registry_1.tagAgentRole)({ conns, role: "risk_lp", agentPda: pda, log });
        await (0, registry_1.ensureErTradingReady)({
            conns,
            role: "risk_lp",
            log,
            targetBalance: new anchor_1.BN(TARGET_BALANCE),
        });
    }
    catch (err) {
        log.warn({ err: String(err?.message || err) }, "risk_lp: ensureAgent failed (continuing)");
    }
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
    log.fatal({ err: String(err?.message || err) }, "risk_lp crashed");
    process.exit(1);
});
