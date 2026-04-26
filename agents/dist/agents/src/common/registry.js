"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_SEED = void 0;
exports.agentPda = agentPda;
exports.ensureAgent = ensureAgent;
exports.ensureErTradingReady = ensureErTradingReady;
exports.tagAgentRole = tagAgentRole;
const anchor_1 = require("@coral-xyz/anchor");
const supabase_js_1 = require("@supabase/supabase-js");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const policy_1 = require("./policy");
const connections_1 = require("./connections");
const markets_1 = require("./markets");
const kestrelApi_1 = require("./kestrelApi");
const tx_1 = require("./tx");
exports.AGENT_SEED = Buffer.from("agent");
function agentPda(owner, programId) {
    const [pda] = web3_js_1.PublicKey.findProgramAddressSync([exports.AGENT_SEED, owner.toBuffer()], programId);
    return pda;
}
/** Idempotently ensure an `AgentProfile` exists for the role's owner. */
async function ensureAgent(params) {
    const { conns, role, log } = params;
    const owner = conns.signerKeypair.publicKey;
    const pda = agentPda(owner, conns.programId);
    // MarketOps doesn't actually trade; we still create the profile so the UI
    // has a row but only Trader/Risk-LP exercise placeBet/cancel.
    const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    if (info) {
        log.info({ owner: owner.toBase58(), agent: pda.toBase58() }, "agent already registered");
        void role;
        return { agentPda: pda, registered: false };
    }
    const policy = (0, policy_1.defaultPolicyFor)(role);
    const apiBase = (0, kestrelApi_1.getKestrelApiBaseUrl)(conns);
    const sig = apiBase
        ? await (0, kestrelApi_1.registerAgentViaApi)({
            conns,
            maxStakePerWindow: policy.maxStakePerWindow,
            maxOpenPositions: policy.maxOpenPositions,
        })
        : await (async () => {
            const tx = await conns.baseProgram.methods
                .registerAgent(policy)
                .accounts({ owner })
                .transaction();
            return (0, web3_js_1.sendAndConfirmTransaction)(conns.baseConnection, tx, [conns.signerKeypair], { skipPreflight: true, commitment: "confirmed" });
        })();
    log.info({ owner: owner.toBase58(), agent: pda.toBase58(), sig }, "agent registered");
    return { agentPda: pda, registered: true };
}
async function ensureDelegated(params) {
    const { conns, log, owner } = params;
    const validatorIdentity = await (0, connections_1.getValidatorIdentity)(conns);
    const remainingAccounts = [
        { pubkey: validatorIdentity, isSigner: false, isWritable: false },
    ];
    const tx = await conns.baseProgram.methods
        .delegateAgent()
        .accounts({
        payer: owner,
        validator: null,
    })
        .remainingAccounts(remainingAccounts)
        .transaction();
    const sig = await (0, web3_js_1.sendAndConfirmTransaction)(conns.baseConnection, tx, [conns.signerKeypair], { skipPreflight: true, commitment: "confirmed" });
    log.info({ owner: owner.toBase58(), sig, validator: validatorIdentity.toBase58() }, "delegate_agent");
}
async function waitForOwner(params) {
    const { conns, pda, expectedOwner } = params;
    const timeoutMs = params.timeoutMs ?? 30000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
        if (info && info.owner.equals(expectedOwner))
            return;
        await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`Timed out waiting for ${pda.toBase58()} owner=${expectedOwner.toBase58()}`);
}
/**
 * Every-run startup routine for trading roles:
 * - If delegated, commit+undelegate on ER (so we can deposit on base).
 * - Ensure USDC ATA exists and deposit up to `targetBalance` on base.
 * - Delegate the agent PDA again for ER writes.
 */
async function ensureErTradingReady(params) {
    const { conns, log, targetBalance } = params;
    const owner = conns.signerKeypair.publicKey;
    const pda = agentPda(owner, conns.programId);
    // If already delegated, we must commit+undelegate before we can deposit.
    const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    if (info && info.owner.equals(markets_1.DELEGATION_PROGRAM_ID)) {
        log.info({ owner: owner.toBase58() }, "agent delegated; committing+undelegating");
        const tx = await conns.erProgram.methods
            .commitAndUndelegateAgent()
            .accounts({ owner })
            .transaction();
        await (0, tx_1.sendErTx)(conns, tx, [conns.signerKeypair], conns.signerKeypair);
        await waitForOwner({
            conns,
            pda,
            expectedOwner: conns.programId,
            timeoutMs: 60000,
        });
    }
    // Fetch config to learn USDC mint.
    const configPda = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("config")], conns.programId)[0];
    const cfg = await conns.baseProgram.account.config.fetch(configPda);
    const usdcMint = cfg.usdcMint;
    // Ensure ATA exists.
    const userAta = (0, spl_token_1.getAssociatedTokenAddressSync)(usdcMint, owner, true);
    await (0, spl_token_1.createAssociatedTokenAccountIdempotent)(conns.baseConnection, conns.signerKeypair, usdcMint, owner);
    // Check on-chain agent balance (base side).
    const acc = await conns.baseProgram.account.agentProfile.fetch(pda);
    const current = new anchor_1.BN(acc.balance.toString());
    if (current.lt(targetBalance)) {
        const delta = targetBalance.sub(current);
        const ataAcc = await (0, spl_token_1.getAccount)(conns.baseConnection, userAta, "confirmed");
        if (new anchor_1.BN(ataAcc.amount.toString()).lt(delta)) {
            throw new Error(`Insufficient USDC in ${userAta.toBase58()} to deposit ${delta.toString()} (have ${ataAcc.amount.toString()}). Fund the owner ${owner.toBase58()} with devnet USDC first.`);
        }
        const apiBase = (0, kestrelApi_1.getKestrelApiBaseUrl)(conns);
        const sig = apiBase
            ? await (0, kestrelApi_1.depositViaApi)({ conns, amount: delta })
            : await (async () => {
                const depTx = await conns.baseProgram.methods
                    .deposit(delta)
                    .accounts({
                    owner,
                    usdcMint,
                    userAta,
                })
                    .transaction();
                return (0, web3_js_1.sendAndConfirmTransaction)(conns.baseConnection, depTx, [conns.signerKeypair], { skipPreflight: true, commitment: "confirmed" });
            })();
        log.info({ owner: owner.toBase58(), amount: delta.toString(), sig }, "deposit");
    }
    else {
        log.info({ owner: owner.toBase58(), balance: current.toString() }, "deposit skipped (already funded)");
    }
    await ensureDelegated({ conns, log, owner });
    await waitForOwner({
        conns,
        pda,
        expectedOwner: markets_1.DELEGATION_PROGRAM_ID,
        timeoutMs: 60000,
    });
}
let cachedSb = null;
function supabase(conns) {
    if (cachedSb)
        return cachedSb;
    const { supabaseUrl, supabaseServiceRoleKey } = conns.env;
    if (!supabaseUrl || !supabaseServiceRoleKey)
        return null;
    cachedSb = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return cachedSb;
}
const ROLE_LABEL = {
    market_ops: "MarketOps",
    trader: "Trader",
    risk_lp: "Risk-LP",
};
/**
 * Tag the agent row with its role+label. The indexer creates the row on
 * `register_agent` decode, but only the runtime knows which role identifier
 * to attach. Safe to call repeatedly.
 */
async function tagAgentRole(params) {
    const sb = supabase(params.conns);
    if (!sb) {
        params.log.debug("supabase not configured; skipping role tag");
        return;
    }
    const owner = params.conns.signerKeypair.publicKey.toBase58();
    const { error } = await sb.from("agents").upsert({
        owner_pubkey: owner,
        agent_pda: params.agentPda.toBase58(),
        role: params.role,
        label: ROLE_LABEL[params.role],
        updated_at: new Date().toISOString(),
    }, { onConflict: "owner_pubkey" });
    if (error) {
        params.log.warn({ err: error.message }, "supabase tagAgentRole failed");
    }
    else {
        params.log.info({ role: params.role, owner }, "tagged agent role in supabase");
    }
}
