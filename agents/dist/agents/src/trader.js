"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Trader role
 * -----------
 * Honest momentum bet on each open market window plus two scripted policy
 * violations that produce the guaranteed `PlaceBetBlocked` demo cards:
 *
 *   T+0s   honest bet sized to `AGENTS_TRADER_BASE_SIZE`. Should succeed.
 *   T+10s  one bet at `policy.max_stake_per_window + 1`. Always trips
 *          KestrelError::OverPolicyCap.
 *   T+20s  rotate `allowed_markets_root` to a known-bad value via
 *          `update_policy`, attempt one place_bet (KestrelError::MarketNotAllowed),
 *          rotate the policy back. Fires two PolicyUpdated cards plus a blocked card.
 */
const anchor_1 = require("@coral-xyz/anchor");
const web3_js_1 = require("@solana/web3.js");
const connections_1 = require("./common/connections");
const logger_1 = require("./common/logger");
const markets_1 = require("./common/markets");
const oracle_1 = require("./common/oracle");
const policy_1 = require("./common/policy");
const registry_1 = require("./common/registry");
const tx_1 = require("./common/tx");
const log = (0, logger_1.buildLogger)("trader");
const TICK_MS = 1000;
const BASE_SIZE = Number(process.env.AGENTS_TRADER_BASE_SIZE || 200000);
const OVER_CAP_AT_SEC = Number(process.env.AGENTS_TRADER_OVER_CAP_AT_SEC || 10);
const WRONG_ALLOWLIST_AT_SEC = Number(process.env.AGENTS_TRADER_WRONG_ALLOWLIST_AT_SEC || 20);
const TARGET_BALANCE = Number(process.env.AGENTS_TRADER_TARGET_BALANCE || 2000000);
const memos = new Map();
async function placeBet(params) {
    const { conns, market, side, amount, expectFailure } = params;
    const sideArg = side === "yes" ? { yes: {} } : { no: {} };
    const tx = await conns.erProgram.methods
        .placeBet(market.id, sideArg, amount)
        .accounts({
        owner: conns.signerKeypair.publicKey,
        priceUpdate: market.oracleFeed,
    })
        .transaction();
    try {
        const sig = await (0, tx_1.sendErTx)(conns, tx, [conns.signerKeypair]);
        log.info({
            market: market.id,
            side,
            amount: amount.toString(),
            sig,
            intentional: expectFailure ?? null,
        }, expectFailure ? "place_bet (unexpectedly succeeded)" : "place_bet");
        return sig;
    }
    catch (err) {
        const code = (0, tx_1.extractCustomErrorCode)(err);
        log.warn({
            market: market.id,
            side,
            amount: amount.toString(),
            intentional: expectFailure ?? null,
            code,
            err: String(err?.message || err).slice(0, 220),
        }, expectFailure ? "place_bet blocked (expected)" : "place_bet failed");
        return null;
    }
}
async function updatePolicy(conns, policy, reason) {
    const tx = await conns.erProgram.methods
        .updatePolicy(policy)
        .accounts({ owner: conns.signerKeypair.publicKey })
        .transaction();
    try {
        const sig = await (0, tx_1.sendErTx)(conns, tx, [conns.signerKeypair]);
        log.info({ reason, sig }, "update_policy");
        return sig;
    }
    catch (err) {
        log.warn({ reason, err: String(err?.message || err) }, "update_policy failed");
        return null;
    }
}
async function inferMomentumSide(conns, market) {
    const snap = await (0, oracle_1.readOracleSnapshot)({
        connection: conns.baseConnection,
        feed: market.oracleFeed,
        log,
    });
    if (!snap)
        return "yes";
    // Toy momentum: if current price > strike, momentum is up so YES.
    const strike = Number(market.strike?.toString?.() ?? market.strike);
    const price = Number(snap.price);
    return price >= strike ? "yes" : "no";
}
async function tick(conns) {
    const market = await (0, markets_1.findActiveOpenMarket)(conns, log);
    if (!market)
        return;
    const nowSec = Math.floor(Date.now() / 1000);
    let memo = memos.get(market.id);
    if (!memo) {
        memo = {
            honestPlaced: false,
            overCapAttempted: false,
            wrongAllowlistAttempted: false,
        };
        memos.set(market.id, memo);
    }
    const elapsed = nowSec - market.openTs;
    // Refresh policy once so the over-cap demo uses the on-chain max+1.
    const policyTpl = (0, policy_1.defaultPolicyFor)("trader");
    const onchainMaxStake = await readOnchainMaxStake(conns).catch(() => null);
    const maxStake = onchainMaxStake ?? policyTpl.maxStakePerWindow;
    // Honest momentum bet at +0s.
    if (!memo.honestPlaced && elapsed >= 0) {
        const side = await inferMomentumSide(conns, market);
        const sig = await placeBet({
            conns,
            market,
            side,
            amount: new anchor_1.BN(BASE_SIZE),
        });
        if (sig)
            memo.honestPlaced = true;
    }
    // Over-cap violation at +10s.
    if (!memo.overCapAttempted && elapsed >= OVER_CAP_AT_SEC && memo.honestPlaced) {
        memo.overCapAttempted = true;
        const overCap = maxStake.add(new anchor_1.BN(1));
        await placeBet({
            conns,
            market,
            side: "yes",
            amount: overCap,
            expectFailure: "OverPolicyCap",
        });
    }
    // Wrong-allowlist violation at +20s.
    if (!memo.wrongAllowlistAttempted &&
        elapsed >= WRONG_ALLOWLIST_AT_SEC &&
        memo.honestPlaced) {
        memo.wrongAllowlistAttempted = true;
        // Tighten allowlist to a clearly-wrong root, attempt one bet, then restore.
        const tightened = {
            ...policyTpl,
            maxStakePerWindow: maxStake,
            allowedMarketsRoot: (0, policy_1.wrongAllowlistRoot)(),
        };
        const sigTight = await updatePolicy(conns, tightened, "demo: wrong allowlist");
        if (sigTight) {
            await placeBet({
                conns,
                market,
                side: "no",
                amount: new anchor_1.BN(Math.min(BASE_SIZE, Number(maxStake.toString()))),
                expectFailure: "MarketNotAllowed",
            });
            // Restore the original allowlist so honest bets work again.
            await updatePolicy(conns, { ...policyTpl, maxStakePerWindow: maxStake }, "demo: restore allowlist");
        }
    }
}
async function readOnchainMaxStake(conns) {
    const owner = conns.signerKeypair.publicKey;
    const pda = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("agent"), owner.toBuffer()], conns.programId)[0];
    const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    if (!baseInfo)
        return null;
    const program = baseInfo.owner.equals(new web3_js_1.PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"))
        ? conns.erProgram
        : conns.baseProgram;
    try {
        const acc = await program.account.agentProfile.fetch(pda);
        return new anchor_1.BN(acc.policy.maxStakePerWindow.toString());
    }
    catch {
        return null;
    }
}
async function main() {
    const conns = (0, connections_1.buildConnections)("trader");
    log.info({
        base: conns.env.baseRpcUrl,
        er: conns.env.erRpcUrl,
        owner: conns.signerKeypair.publicKey.toBase58(),
        baseSize: BASE_SIZE,
    }, "trader boot");
    try {
        const { agentPda: pda } = await (0, registry_1.ensureAgent)({ conns, role: "trader", log });
        await (0, registry_1.tagAgentRole)({ conns, role: "trader", agentPda: pda, log });
        await (0, registry_1.ensureErTradingReady)({
            conns,
            role: "trader",
            log,
            targetBalance: new anchor_1.BN(TARGET_BALANCE),
        });
    }
    catch (err) {
        log.warn({ err: String(err?.message || err) }, "trader: ensureAgent failed (continuing — may be already delegated)");
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
    log.fatal({ err: String(err?.message || err) }, "trader crashed");
    process.exit(1);
});
