"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPolicyFor = defaultPolicyFor;
exports.emptyAllowlistRoot = emptyAllowlistRoot;
exports.wrongAllowlistRoot = wrongAllowlistRoot;
const anchor_1 = require("@coral-xyz/anchor");
const web3_js_1 = require("@solana/web3.js");
function envBn(name, fallback) {
    const v = process.env[name];
    if (!v)
        return new anchor_1.BN(fallback);
    const n = Number(v);
    return Number.isFinite(n) ? new anchor_1.BN(n) : new anchor_1.BN(fallback);
}
function feedBytes() {
    const feed = new web3_js_1.PublicKey(process.env.KESTREL_BTC_USD_PRICE_UPDATE ||
        "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr");
    return Array.from(feed.toBytes());
}
/**
 * Default per-role policy templates. The Trader cap is *deliberately* tight
 * so the scripted over-cap demo bet (`max + 1`) reliably trips OverPolicyCap.
 */
function defaultPolicyFor(role) {
    switch (role) {
        case "trader":
            return {
                maxStakePerWindow: envBn("AGENTS_TRADER_MAX_STAKE", 500000),
                maxOpenPositions: 8,
                allowedMarketsRoot: feedBytes(),
                paused: false,
            };
        case "risk_lp":
            return {
                maxStakePerWindow: envBn("AGENTS_RISK_LP_MAX_STAKE", 250000),
                maxOpenPositions: 4,
                allowedMarketsRoot: feedBytes(),
                paused: false,
            };
        case "market_ops":
        default:
            return {
                // Market ops still has a profile so it can deposit if needed for
                // emergency hedges, but normally never bets.
                maxStakePerWindow: new anchor_1.BN(100000),
                maxOpenPositions: 2,
                allowedMarketsRoot: feedBytes(),
                paused: true,
            };
    }
}
/** Allowlist root of all-zeros disables the gate (matches on-chain check). */
function emptyAllowlistRoot() {
    return new Array(32).fill(0);
}
/** Build a deliberately-wrong allowlist root so the scripted "wrong allowlist"
 *  bet trips KestrelError::MarketNotAllowed. We replace the feed bytes with
 *  the SystemProgram id so it's clearly not a real Pyth feed. */
function wrongAllowlistRoot() {
    const fake = web3_js_1.PublicKey.default; // 0..0 is the all-zeros disable case, so use SystemProgram instead.
    void fake;
    return Array.from(new web3_js_1.PublicKey("11111111111111111111111111111112").toBytes());
}
