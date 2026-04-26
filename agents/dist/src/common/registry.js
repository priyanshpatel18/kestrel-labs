"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_SEED = void 0;
exports.agentPda = agentPda;
exports.ensureAgent = ensureAgent;
exports.tagAgentRole = tagAgentRole;
const supabase_js_1 = require("@supabase/supabase-js");
const web3_js_1 = require("@solana/web3.js");
const policy_1 = require("./policy");
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
        return { agentPda: pda, registered: false };
    }
    const policy = (0, policy_1.defaultPolicyFor)(role);
    const tx = await conns.baseProgram.methods
        .registerAgent(policy)
        .accounts({ owner })
        .transaction();
    const sig = await (0, web3_js_1.sendAndConfirmTransaction)(conns.baseConnection, tx, [conns.signerKeypair], { skipPreflight: true, commitment: "confirmed" });
    log.info({ owner: owner.toBase58(), agent: pda.toBase58(), sig }, "agent registered");
    return { agentPda: pda, registered: true };
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
