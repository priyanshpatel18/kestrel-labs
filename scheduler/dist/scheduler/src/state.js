"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELEGATION_PROGRAM_ID = exports.MARKET_SEED = exports.AGENT_SEED = exports.VAULT_SEED = exports.CONFIG_SEED = void 0;
exports.configPda = configPda;
exports.vaultPda = vaultPda;
exports.agentPda = agentPda;
exports.marketPda = marketPda;
exports.loadConfig = loadConfig;
exports.fetchMarketSnapshot = fetchMarketSnapshot;
exports.listMarkets = listMarkets;
exports.listAgents = listAgents;
exports.fetchAgentSnapshot = fetchAgentSnapshot;
const web3_js_1 = require("@solana/web3.js");
exports.CONFIG_SEED = Buffer.from("config");
exports.VAULT_SEED = Buffer.from("vault");
exports.AGENT_SEED = Buffer.from("agent");
exports.MARKET_SEED = Buffer.from("market");
// MagicBlock delegation program owns delegated PDAs while they live on the ER.
exports.DELEGATION_PROGRAM_ID = new web3_js_1.PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
function u32LE(id) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(id >>> 0, 0);
    return buf;
}
function configPda(programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([exports.CONFIG_SEED], programId);
    return pda;
}
function vaultPda(programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([exports.VAULT_SEED], programId);
    return pda;
}
function agentPda(owner, programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([exports.AGENT_SEED, owner.toBuffer()], programId);
    return pda;
}
function marketPda(id, programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([exports.MARKET_SEED, u32LE(id)], programId);
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
function winnerToName(w) {
    if (!w)
        return null;
    if (w.yes !== undefined)
        return "yes";
    if (w.no !== undefined)
        return "no";
    return null;
}
async function loadConfig(conns) {
    const pda = configPda(conns.programId);
    const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    if (!info)
        return null;
    const acc = await conns.baseProgram.account.config.fetch(pda);
    return {
        pda,
        admin: acc.admin,
        treasury: acc.treasury,
        usdcMint: acc.usdcMint,
        btcUsdPriceUpdate: acc.btcUsdPriceUpdate,
        feeBps: Number(acc.feeBps),
        marketCount: Number(acc.marketCount),
    };
}
async function fetchMarketSnapshot(conns, pda) {
    // Markets may live on base or on the ER (after delegation). Try both.
    const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    const owner = baseInfo?.owner ?? null;
    const isDelegated = !!owner && owner.equals(exports.DELEGATION_PROGRAM_ID);
    const fetchProgram = isDelegated || !baseInfo ? conns.erProgram : conns.baseProgram;
    try {
        const acc = await fetchProgram.account.market.fetch(pda);
        return {
            pda,
            id: Number(acc.id),
            openTs: Number(acc.openTs),
            closeTs: Number(acc.closeTs),
            status: statusKeyToName(acc.status),
            strike: acc.strike,
            oracleFeed: acc.oracleFeed,
            winner: winnerToName(acc.winner),
            ownerProgram: owner ?? conns.programId,
            isDelegated,
        };
    }
    catch {
        return null;
    }
}
async function listMarkets(conns, upToId) {
    if (upToId <= 0)
        return [];
    const pdas = [];
    for (let id = 0; id < upToId; id++) {
        pdas.push(marketPda(id, conns.programId));
    }
    // Cap to 100 per call (web3.js getMultipleAccountsInfo).
    const baseInfos = [];
    for (let i = 0; i < pdas.length; i += 100) {
        const chunk = pdas.slice(i, i + 100);
        const infos = await conns.baseConnection.getMultipleAccountsInfo(chunk, "confirmed");
        baseInfos.push(...infos.map((x) => (x ? { owner: x.owner } : null)));
    }
    const out = [];
    for (let id = 0; id < pdas.length; id++) {
        const pda = pdas[id];
        const baseInfo = baseInfos[id];
        if (!baseInfo) {
            // The PDA was never created (gap in id space). Skip silently.
            continue;
        }
        const isDelegated = baseInfo.owner.equals(exports.DELEGATION_PROGRAM_ID);
        const fetchProgram = isDelegated ? conns.erProgram : conns.baseProgram;
        try {
            const acc = await fetchProgram.account.market.fetch(pda);
            out.push({
                pda,
                id: Number(acc.id),
                openTs: Number(acc.openTs),
                closeTs: Number(acc.closeTs),
                status: statusKeyToName(acc.status),
                strike: acc.strike,
                oracleFeed: acc.oracleFeed,
                winner: winnerToName(acc.winner),
                ownerProgram: baseInfo.owner,
                isDelegated,
            });
        }
        catch {
            // Best-effort: ER may not yet have synced this account.
        }
    }
    return out;
}
async function listAgents(conns) {
    const all = await conns.baseProgram.account.agentProfile.all();
    const out = [];
    for (const entry of all) {
        const pda = entry.publicKey;
        const acc = entry.account;
        const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
        const isDelegated = !!baseInfo && baseInfo.owner.equals(exports.DELEGATION_PROGRAM_ID);
        out.push({
            pda,
            owner: acc.owner,
            balance: acc.balance,
            positions: acc.positions.map((p) => ({
                marketId: Number(p.marketId),
                yesShares: p.yesShares,
                noShares: p.noShares,
                stake: p.stake,
                settled: !!p.settled,
            })),
            ownerProgram: baseInfo?.owner ?? conns.programId,
            isDelegated,
        });
    }
    return out;
}
async function fetchAgentSnapshot(conns, pda) {
    const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    if (!baseInfo)
        return null;
    const isDelegated = baseInfo.owner.equals(exports.DELEGATION_PROGRAM_ID);
    const fetchProgram = isDelegated ? conns.erProgram : conns.baseProgram;
    try {
        const acc = await fetchProgram.account.agentProfile.fetch(pda);
        return {
            pda,
            owner: acc.owner,
            balance: acc.balance,
            positions: acc.positions.map((p) => ({
                marketId: Number(p.marketId),
                yesShares: p.yesShares,
                noShares: p.noShares,
                stake: p.stake,
                settled: !!p.settled,
            })),
            ownerProgram: baseInfo.owner,
            isDelegated,
        };
    }
    catch {
        return null;
    }
}
