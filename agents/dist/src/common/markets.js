"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELEGATION_PROGRAM_ID = exports.MARKET_SEED = void 0;
exports.marketPda = marketPda;
exports.fetchMarket = fetchMarket;
exports.findActiveOpenMarket = findActiveOpenMarket;
exports.findHaltedMarket = findHaltedMarket;
const web3_js_1 = require("@solana/web3.js");
exports.MARKET_SEED = Buffer.from("market");
exports.DELEGATION_PROGRAM_ID = new web3_js_1.PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
function marketPda(id, programId) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(id >>> 0, 0);
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([exports.MARKET_SEED, buf], programId);
    return pda;
}
function statusKeyToName(s) {
    if (s.pending !== undefined)
        return "pending";
    if (s.open !== undefined)
        return "open";
    if (s.halted !== undefined)
        return "halted";
    if (s.closed !== undefined)
        return "closed";
    return "pending";
}
async function fetchMarket(conns, pda, log) {
    const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    const isDelegated = !!baseInfo && baseInfo.owner.equals(exports.DELEGATION_PROGRAM_ID);
    const program = isDelegated || !baseInfo ? conns.erProgram : conns.baseProgram;
    try {
        const acc = await program.account.market.fetch(pda);
        return {
            pda,
            id: Number(acc.id),
            openTs: Number(acc.openTs),
            closeTs: Number(acc.closeTs),
            strike: acc.strike,
            status: statusKeyToName(acc.status),
            yesReserve: acc.yesReserve,
            noReserve: acc.noReserve,
            oracleFeed: acc.oracleFeed,
            isDelegated,
        };
    }
    catch (err) {
        log?.debug({ pda: pda.toBase58(), err: String(err?.message || err) }, "fetchMarket: missing or undecodable");
        return null;
    }
}
async function findActiveOpenMarket(conns, log) {
    // Read config.market_count to know how many candidate ids exist.
    const configPda = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("config")], conns.programId)[0];
    let marketCount = 0;
    try {
        const cfg = await conns.baseProgram.account.config.fetch(configPda);
        marketCount = Number(cfg.marketCount);
    }
    catch (err) {
        log?.warn({ err: String(err?.message || err) }, "config fetch failed");
        return null;
    }
    if (marketCount <= 0)
        return null;
    // Walk newest-first; the scheduler creates ids in increasing order.
    for (let id = marketCount - 1; id >= Math.max(0, marketCount - 8); id--) {
        const pda = marketPda(id, conns.programId);
        const view = await fetchMarket(conns, pda, log);
        if (!view)
            continue;
        if (view.status === "open")
            return view;
    }
    return null;
}
async function findHaltedMarket(conns, log) {
    const configPda = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("config")], conns.programId)[0];
    let marketCount = 0;
    try {
        const cfg = await conns.baseProgram.account.config.fetch(configPda);
        marketCount = Number(cfg.marketCount);
    }
    catch {
        return null;
    }
    for (let id = marketCount - 1; id >= Math.max(0, marketCount - 8); id--) {
        const pda = marketPda(id, conns.programId);
        const view = await fetchMarket(conns, pda, log);
        if (!view)
            continue;
        if (view.status === "halted")
            return view;
    }
    return null;
}
