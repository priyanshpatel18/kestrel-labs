"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendErTx = sendErTx;
exports.sendBaseTx = sendBaseTx;
exports.isErProgramNotUpgradedYet = isErProgramNotUpgradedYet;
exports.extractCustomErrorCode = extractCustomErrorCode;
const web3_js_1 = require("@solana/web3.js");
/**
 * Send a transaction on the ER, retrying on `block height exceeded` /
 * blockhash expiry. Mirrors `scheduler/src/lifecycle/openClose.ts:sendErTx`.
 */
async function sendErTx(conns, tx, signers, feePayer) {
    const fp = feePayer ?? signers[0];
    if (!fp)
        throw new Error("sendErTx: no fee payer or signers provided");
    const byPk = new Map();
    byPk.set(fp.publicKey.toBase58(), fp);
    for (const k of signers)
        byPk.set(k.publicKey.toBase58(), k);
    const uniqSigners = Array.from(byPk.values());
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
            await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
    }
    throw lastErr;
}
async function sendBaseTx(connection, tx, signers) {
    return (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, signers, {
        skipPreflight: true,
        commitment: "confirmed",
    });
}
/** Compact "did this fail because the program isn't deployed yet?" check. */
function isErProgramNotUpgradedYet(err) {
    const msg = String(err?.message || err || "");
    if (msg.includes("InstructionFallbackNotFound"))
        return true;
    if (msg.includes("Custom\":101") || msg.includes("custom program error: 0x65"))
        return true;
    return false;
}
/** Returns the Anchor `Custom` error number from a thrown error, if any. */
function extractCustomErrorCode(err) {
    const msg = String(err?.message || err || "");
    const m = msg.match(/Custom[":\s]+(\d+)/);
    if (!m)
        return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}
