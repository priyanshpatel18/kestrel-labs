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
exports._delegationProgramForTests = void 0;
exports.loadAgentKeypairs = loadAgentKeypairs;
exports.delegateUndelegatedAgentsOnce = delegateUndelegatedAgentsOnce;
exports.isAgentDelegated = isAgentDelegated;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const web3_js_1 = require("@solana/web3.js");
const connections_1 = require("../connections");
const state_1 = require("../state");
let cachedAgentKeypairs = null;
function loadAgentKeypairs(cfg, log) {
    if (cachedAgentKeypairs)
        return cachedAgentKeypairs;
    const map = new Map();
    if (!cfg.agentKeypairsDir) {
        cachedAgentKeypairs = map;
        return map;
    }
    let entries;
    try {
        entries = fs.readdirSync(cfg.agentKeypairsDir);
    }
    catch (err) {
        log.warn({
            dir: cfg.agentKeypairsDir,
            err: String(err?.message || err),
        }, "agents: cannot read KESTREL_AGENT_KEYPAIRS_DIR");
        cachedAgentKeypairs = map;
        return map;
    }
    for (const entry of entries) {
        if (!entry.endsWith(".json"))
            continue;
        const full = path.join(cfg.agentKeypairsDir, entry);
        try {
            const raw = fs.readFileSync(full, "utf8");
            const arr = JSON.parse(raw);
            const kp = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(arr));
            map.set(kp.publicKey.toBase58(), kp);
        }
        catch (err) {
            log.warn({ file: full, err: String(err?.message || err) }, "agents: cannot parse keypair file");
        }
    }
    log.info({ count: map.size }, "agents: keypairs loaded");
    cachedAgentKeypairs = map;
    return map;
}
async function delegateUndelegatedAgentsOnce(params) {
    const { conns, cfg, feePayer, log } = params;
    const keypairs = loadAgentKeypairs(cfg, log);
    if (keypairs.size === 0) {
        return { delegated: 0, observedUndelegated: 0 };
    }
    const agents = await (0, state_1.listAgents)(conns);
    let delegated = 0;
    let observedUndelegated = 0;
    for (const agent of agents) {
        if (agent.isDelegated)
            continue;
        observedUndelegated++;
        const ownerKp = keypairs.get(agent.owner.toBase58());
        if (!ownerKp) {
            log.debug({ owner: agent.owner.toBase58() }, "agents: undelegated but no keypair on disk");
            continue;
        }
        try {
            const sig = await sendDelegateAgent({
                conns,
                ownerKp,
                feePayer,
            });
            delegated++;
            log.info({ owner: agent.owner.toBase58(), sig }, "delegate_agent");
        }
        catch (err) {
            log.warn({
                owner: agent.owner.toBase58(),
                err: String(err?.message || err),
            }, "delegate_agent failed");
        }
    }
    return { delegated, observedUndelegated };
}
async function sendDelegateAgent(params) {
    const { conns, ownerKp, feePayer } = params;
    const validatorIdentity = await (0, connections_1.getValidatorIdentity)(conns);
    const tx = await conns.baseProgram.methods
        .delegateAgent()
        .accounts({ payer: ownerKp.publicKey, validator: null })
        .remainingAccounts([
        { pubkey: validatorIdentity, isSigner: false, isWritable: false },
    ])
        .transaction();
    const signers = [];
    const seen = new Set();
    for (const k of [feePayer, ownerKp]) {
        const id = k.publicKey.toBase58();
        if (seen.has(id))
            continue;
        seen.add(id);
        signers.push(k);
    }
    return (0, web3_js_1.sendAndConfirmTransaction)(conns.baseConnection, tx, signers, {
        skipPreflight: true,
        commitment: "confirmed",
    });
}
// Verify a single agent is delegated. Useful right before a settle pass so we
// don't try to settle an AgentProfile that is still owned by the program on
// base layer.
async function isAgentDelegated(conns, owner) {
    const pda = (0, state_1.agentPda)(owner, conns.programId);
    const snap = await (0, state_1.fetchAgentSnapshot)(conns, pda);
    return !!snap && snap.isDelegated;
}
exports._delegationProgramForTests = state_1.DELEGATION_PROGRAM_ID;
