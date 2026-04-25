"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.newHorizonState = newHorizonState;
exports.scanHorizon = scanHorizon;
exports.ensureHorizonOnce = ensureHorizonOnce;
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const connections_1 = require("../connections");
const state_1 = require("../state");
function newHorizonState() {
    return {
        cachedMarketCount: null,
        cachedConfigAdmin: null,
        busy: false,
    };
}
function alignUp(ts, windowSecs) {
    return Math.ceil(ts / windowSecs) * windowSecs;
}
async function scanHorizon(conns, cfg) {
    const config = await (0, state_1.loadConfig)(conns);
    if (!config)
        return null;
    const markets = await (0, state_1.listMarkets)(conns, config.marketCount);
    const now = Math.floor(Date.now() / 1000);
    const futurePending = markets
        .filter((m) => m.status === "pending" && m.openTs >= now)
        .sort((a, b) => a.openTs - b.openTs);
    const target = Math.floor(cfg.horizonSecs / cfg.windowSecs);
    const have = futurePending.length;
    const needToCreate = Math.max(0, target - have);
    let nextOpenTs;
    if (have === 0) {
        nextOpenTs = alignUp(now, cfg.windowSecs);
    }
    else {
        const last = futurePending[have - 1].openTs;
        nextOpenTs = alignUp(last + cfg.windowSecs, cfg.windowSecs);
    }
    return { config, markets, futurePending, needToCreate, nextOpenTs };
}
// Create one market on base + delegate it to ER. Returns the id created, or
// null if the horizon is already full / config not found / scheduler is busy.
async function ensureHorizonOnce(conns, cfg, state, log) {
    if (state.busy)
        return null;
    state.busy = true;
    try {
        const scan = await scanHorizon(conns, cfg);
        if (!scan) {
            log.warn("horizon: Config PDA not found yet; init_config first");
            return null;
        }
        if (scan.needToCreate <= 0) {
            // Cache for fast reuse by other stages.
            state.cachedMarketCount = scan.config.marketCount;
            state.cachedConfigAdmin = scan.config.admin;
            return null;
        }
        if (!scan.config.admin.equals(conns.wallet.publicKey)) {
            log.warn({ admin: scan.config.admin.toBase58() }, "horizon: scheduler wallet is not Config.admin; cannot create_market");
            return null;
        }
        const id = scan.config.marketCount;
        const openTs = scan.nextOpenTs;
        const closeTs = openTs + cfg.windowSecs;
        const validatorIdentity = await (0, connections_1.getValidatorIdentity)(conns);
        const created = await sendCreateMarket(conns, cfg.adminKeypair, id, openTs, closeTs);
        log.info({
            market_id: id,
            open_ts: openTs,
            close_ts: closeTs,
            sig: created,
        }, "horizon: create_market");
        const delegated = await sendDelegateMarket(conns, cfg.adminKeypair, id, validatorIdentity);
        log.info({ market_id: id, sig: delegated }, "horizon: delegate_market");
        state.cachedMarketCount = id + 1;
        state.cachedConfigAdmin = scan.config.admin;
        return id;
    }
    catch (err) {
        log.error({ err: String(err?.message || err) }, "horizon: tick failed");
        state.cachedMarketCount = null;
        return null;
    }
    finally {
        state.busy = false;
    }
}
async function sendCreateMarket(conns, admin, id, openTs, closeTs) {
    const tx = await conns.baseProgram.methods
        .createMarket(id, new anchor.BN(openTs), new anchor.BN(closeTs))
        .accounts({ admin: admin.publicKey })
        .transaction();
    return await (0, web3_js_1.sendAndConfirmTransaction)(conns.baseConnection, tx, [admin], {
        skipPreflight: true,
        commitment: "confirmed",
    });
}
async function sendDelegateMarket(conns, admin, id, validatorIdentity) {
    const tx = await conns.baseProgram.methods
        .delegateMarket(id)
        .accounts({ payer: admin.publicKey, validator: null })
        .remainingAccounts([
        { pubkey: validatorIdentity, isSigner: false, isWritable: false },
    ])
        .transaction();
    return await (0, web3_js_1.sendAndConfirmTransaction)(conns.baseConnection, tx, [admin], {
        skipPreflight: true,
        commitment: "confirmed",
    });
}
