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
exports.sendErTx = sendErTx;
exports.openMarketOnEr = openMarketOnEr;
exports.closeMarketOnEr = closeMarketOnEr;
exports.isRetriableErErr = isRetriableErErr;
exports.logOpenClose = logOpenClose;
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const state_1 = require("../state");
const marketDb_1 = require("../marketDb");
async function sendErTx(conns, tx, signers, feePayer) {
    const fp = feePayer ?? signers[0];
    if (!fp)
        throw new Error("sendErTx: no fee payer or signers provided");
    const byPk = new Map();
    byPk.set(fp.publicKey.toBase58(), fp);
    for (const k of signers)
        byPk.set(k.publicKey.toBase58(), k);
    const uniqSigners = Array.from(byPk.values());
    // ER txs are very fast but can still miss the confirmation window and end up
    // with "block height exceeded". When that happens, retry with a fresh
    // blockhash instead of surfacing a permanent failure.
    const maxAttempts = 3;
    let lastErr = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            tx.feePayer = fp.publicKey;
            const { blockhash, lastValidBlockHeight } = await conns.erConnection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = blockhash;
            tx.lastValidBlockHeight = lastValidBlockHeight;
            return await (0, web3_js_1.sendAndConfirmTransaction)(conns.erConnection, tx, uniqSigners, { skipPreflight: true, commitment: "confirmed" });
        }
        catch (err) {
            lastErr = err;
            const msg = String(err?.message || err || "");
            const expired = msg.includes("block height exceeded") ||
                msg.includes("has expired") ||
                msg.includes("Blockhash not found");
            if (!expired || attempt === maxAttempts - 1)
                break;
            // Small backoff before retrying with a new blockhash.
            await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
    }
    throw lastErr;
}
async function openMarketOnEr(params) {
    const { conns, admin, id, oracleFeed, seedLiquidity } = params;
    const tx = await conns.erProgram.methods
        .openMarket(id, new anchor.BN(seedLiquidity.toString()))
        .accounts({
        admin: admin.publicKey,
        priceUpdate: oracleFeed,
    })
        .transaction();
    const sig = await sendErTx(conns, tx, [admin], admin);
    try {
        const pda = (0, state_1.marketPda)(id, conns.programId);
        const acc = await conns.erProgram.account.market.fetch(pda);
        const strike = Number(acc?.strike?.toString?.() ?? acc?.strike);
        await (0, marketDb_1.patchMarketRow)({
            market_id: id,
            market_pubkey: pda.toBase58(),
            status: "open",
            opened_sig: sig,
            strike_price: Number.isFinite(strike) ? strike : undefined,
        });
    }
    catch {
        // best-effort; scheduler should not fail if DB is unreachable
    }
    return sig;
}
async function closeMarketOnEr(params) {
    const { conns, admin, id, oracleFeed } = params;
    const tx = await conns.erProgram.methods
        .closeMarket(id)
        .accounts({
        admin: admin.publicKey,
        priceUpdate: oracleFeed,
    })
        .transaction();
    const sig = await sendErTx(conns, tx, [admin], admin);
    try {
        const pda = (0, state_1.marketPda)(id, conns.programId);
        const acc = await conns.erProgram.account.market.fetch(pda);
        const winner = acc?.winner?.yes !== undefined
            ? "yes"
            : acc?.winner?.no !== undefined
                ? "no"
                : null;
        const closePrice = Number(acc?.closePrice?.toString?.() ?? acc?.closePrice);
        await (0, marketDb_1.patchMarketRow)({
            market_id: id,
            market_pubkey: pda.toBase58(),
            status: "closed",
            closed_sig: sig,
            winner,
            close_price: Number.isFinite(closePrice) ? closePrice : undefined,
        });
    }
    catch {
        // best-effort
    }
    return sig;
}
function isRetriableErErr(err) {
    const raw = err?.message || err || "";
    const msg = (() => {
        if (typeof raw === "string")
            return raw;
        try {
            return JSON.stringify(raw);
        }
        catch {
            return String(raw);
        }
    })();
    if (msg.includes("OutsideMarketWindow"))
        return true;
    if (msg.includes("0x1776"))
        return true;
    if (/InstructionError.*6006/i.test(msg))
        return true;
    if (msg.includes("\"Custom\":6006"))
        return true;
    if (msg.includes("Custom\":6006"))
        return true;
    if (msg.includes("Custom\": 6006"))
        return true;
    if (msg.includes("InstructionFallbackNotFound"))
        return true;
    if (msg.includes("custom program error: 0x65"))
        return true;
    if (msg.includes("Blockhash not found"))
        return true;
    if (msg.includes("block height exceeded"))
        return true;
    if (msg.includes("has expired"))
        return true;
    return false;
}
function logOpenClose(log, kind, id, result) {
    if (result.sig) {
        log.info({ market_id: id, sig: result.sig }, `${kind}_market`);
    }
    else if (result.err) {
        log.warn({ market_id: id, err: result.err }, `${kind}_market failed`);
    }
}
