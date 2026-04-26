"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUnsettledAgentsForMarket = findUnsettledAgentsForMarket;
exports.settlePositionsBatched = settlePositionsBatched;
exports.commitAndUndelegateMarket = commitAndUndelegateMarket;
exports.finalizeMarket = finalizeMarket;
const state_1 = require("../state");
const openClose_1 = require("./openClose");
const SETTLE_BATCH_SIZE = 8;
async function findUnsettledAgentsForMarket(conns, marketId) {
    const all = await (0, state_1.listAgents)(conns);
    return all.filter((a) => a.positions.some((p) => p.marketId === marketId && !p.settled));
}
async function settlePositionsBatched(params) {
    const { conns, admin, marketId, agents, log } = params;
    const sigs = [];
    if (agents.length === 0) {
        return { signatures: sigs, agentsSettled: 0 };
    }
    for (let i = 0; i < agents.length; i += SETTLE_BATCH_SIZE) {
        const batch = agents.slice(i, i + SETTLE_BATCH_SIZE);
        const remaining = batch.map((a) => ({
            pubkey: a.pda,
            isSigner: false,
            isWritable: true,
        }));
        const tx = await conns.erProgram.methods
            .settlePositions(marketId)
            .accounts({ payer: admin.publicKey })
            .remainingAccounts(remaining)
            .transaction();
        const sig = await (0, openClose_1.sendErTx)(conns, tx, [admin], admin);
        sigs.push(sig);
        log.info({
            market_id: marketId,
            sig,
            batch_size: batch.length,
            batch_start: i,
        }, "settle_positions");
    }
    return { signatures: sigs, agentsSettled: agents.length };
}
async function commitAndUndelegateMarket(params) {
    const { conns, admin, marketId } = params;
    const tx = await conns.erProgram.methods
        .commitAndUndelegateMarket(marketId)
        .accounts({ admin: admin.publicKey })
        .transaction();
    return (0, openClose_1.sendErTx)(conns, tx, [admin], admin);
}
async function finalizeMarket(params) {
    const { conns, admin, marketId, log } = params;
    const agents = await findUnsettledAgentsForMarket(conns, marketId);
    let settled = 0;
    if (agents.length > 0) {
        const result = await settlePositionsBatched({
            conns,
            admin,
            marketId,
            agents,
            log,
        });
        settled = result.agentsSettled;
    }
    else {
        log.info({ market_id: marketId }, "settle: no agent positions to settle");
    }
    let commitSig = null;
    try {
        commitSig = await commitAndUndelegateMarket({ conns, admin, marketId });
        log.info({ market_id: marketId, sig: commitSig }, "commit_and_undelegate_market");
    }
    catch (err) {
        log.warn({
            market_id: marketId,
            err: String(err?.message || err),
        }, "commit_and_undelegate_market failed");
    }
    return { settled, commitSig };
}
