"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * fund-agents — operator helper for seeding the three role keypairs on devnet.
 *
 * What it does (read-only by default):
 *   1. Loads each role keypair (market_ops, trader, risk_lp) from
 *      KESTREL_AGENT_KEYPAIRS_DIR.
 *   2. Derives the per-owner Kestrel AgentProfile PDA, the Config + USDC mint
 *      from on-chain Config, and each role's USDC ATA.
 *   3. Prints a copy/paste-ready block of `solana airdrop` and
 *      `spl-token transfer` commands so the operator can fund SOL + USDC in
 *      one shell session before starting the agent runtimes.
 *
 * With `--apply` it will also:
 *   - solana airdrop 1 SOL per role (skipping if balance > MIN_SOL_LAMPORTS)
 *   - create the ATA if missing (admin pays)
 *
 * USDC seeding is intentionally left as a printed `spl-token transfer` command
 * because the dev's USDC source can vary (faucet ATA, custom mint authority,
 * pre-funded wallet) and we don't want this script to silently choose one.
 */
const anchor_1 = require("@coral-xyz/anchor");
const spl_token_1 = require("@solana/spl-token");
const web3_js_1 = require("@solana/web3.js");
const kestrel_json_1 = __importDefault(require("../../target/idl/kestrel.json"));
const connections_1 = require("../src/common/connections");
const logger_1 = require("../src/common/logger");
const registry_1 = require("../src/common/registry");
const log = (0, logger_1.buildLogger)("fund");
const ROLES = ["market_ops", "trader", "risk_lp"];
const MIN_SOL_LAMPORTS = 0.5 * web3_js_1.LAMPORTS_PER_SOL;
const AIRDROP_SOL = 1;
const SUGGESTED_USDC_PER_AGENT = 50000000; // 50 USDC at 6 decimals
async function fetchConfig(connection, programId) {
    const idl = kestrel_json_1.default;
    const wallet = new anchor_1.Wallet(web3_js_1.Keypair.generate());
    const provider = new anchor_1.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const program = new anchor_1.Program(idl, provider);
    const [configPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
    try {
        const cfg = await program.account.config.fetch(configPda);
        return { usdcMint: cfg.usdcMint };
    }
    catch (err) {
        log.error({ err: String(err?.message || err), config: configPda.toBase58() }, "config not initialized — run init_config first");
        return null;
    }
}
async function summariseRole(connection, programId, role, owner, usdcMint) {
    const profilePda = (0, registry_1.agentPda)(owner, programId);
    const ata = (0, spl_token_1.getAssociatedTokenAddressSync)(usdcMint, owner, false);
    const [solBalance, ataInfo] = await Promise.all([
        connection.getBalance(owner, "confirmed"),
        connection.getAccountInfo(ata, "confirmed"),
    ]);
    return {
        role,
        owner,
        agentProfilePda: profilePda,
        usdcAta: ata,
        solBalance,
        ataExists: !!ataInfo,
    };
}
function printPlan(summaries, usdcMint) {
    console.log("");
    console.log("Kestrel agents — funding plan");
    console.log("=================================");
    for (const s of summaries) {
        const sol = (s.solBalance / web3_js_1.LAMPORTS_PER_SOL).toFixed(3);
        console.log(`role: ${s.role.padEnd(11)}`);
        console.log(`  owner       ${s.owner.toBase58()}`);
        console.log(`  agentPDA    ${s.agentProfilePda.toBase58()}`);
        console.log(`  usdcATA     ${s.usdcAta.toBase58()} (${s.ataExists ? "exists" : "missing"})`);
        console.log(`  solBalance  ${sol} SOL`);
        console.log("");
    }
    console.log("USDC mint:", usdcMint.toBase58());
    console.log("");
    console.log("Commands to run (or pass --apply to do it inline):");
    console.log("---------------------------------------------------");
    for (const s of summaries) {
        if (s.solBalance < MIN_SOL_LAMPORTS) {
            console.log(`solana airdrop ${AIRDROP_SOL} ${s.owner.toBase58()} --url devnet`);
        }
        if (!s.ataExists) {
            console.log(`spl-token create-account ${usdcMint.toBase58()} --owner ${s.owner.toBase58()} --url devnet --fee-payer ~/.config/solana/id.json`);
        }
        console.log(`spl-token transfer ${usdcMint.toBase58()} ${SUGGESTED_USDC_PER_AGENT / 1e6} ${s.owner.toBase58()} --fund-recipient --allow-unfunded-recipient --url devnet`);
    }
    console.log("");
}
async function applyFunding(connection, admin, summaries, usdcMint) {
    for (const s of summaries) {
        if (s.solBalance < MIN_SOL_LAMPORTS) {
            try {
                const sig = await connection.requestAirdrop(s.owner, AIRDROP_SOL * web3_js_1.LAMPORTS_PER_SOL);
                await connection.confirmTransaction(sig, "confirmed");
                log.info({ role: s.role, owner: s.owner.toBase58(), sig }, "airdropped SOL");
            }
            catch (err) {
                log.warn({ role: s.role, err: String(err?.message || err) }, "airdrop failed (devnet faucet rate-limit?) — fund manually");
            }
        }
        if (!s.ataExists) {
            try {
                const tx = new web3_js_1.Transaction().add((0, spl_token_1.createAssociatedTokenAccountInstruction)(admin.publicKey, s.usdcAta, s.owner, usdcMint, spl_token_1.TOKEN_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
                const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [admin], {
                    skipPreflight: true,
                    commitment: "confirmed",
                });
                log.info({ role: s.role, ata: s.usdcAta.toBase58(), sig }, "created USDC ATA");
            }
            catch (err) {
                log.warn({ role: s.role, err: String(err?.message || err) }, "createAta failed");
            }
        }
    }
    console.log("\nNow fund USDC into each ATA — see the printed `spl-token transfer` commands above.");
}
async function main() {
    const env = (0, connections_1.loadEnv)();
    const connection = new web3_js_1.Connection(env.baseRpcUrl, "confirmed");
    const cfg = await fetchConfig(connection, env.programId);
    if (!cfg)
        process.exit(1);
    const summaries = [];
    for (const role of ROLES) {
        let kp;
        try {
            kp = (0, connections_1.resolveRoleKeypair)(env, role);
        }
        catch (err) {
            log.error({ role, err: String(err?.message || err) }, "missing role keypair");
            continue;
        }
        summaries.push(await summariseRole(connection, env.programId, role, kp.publicKey, cfg.usdcMint));
    }
    printPlan(summaries, cfg.usdcMint);
    if (process.argv.includes("--apply")) {
        await applyFunding(connection, env.adminKeypair, summaries, cfg.usdcMint);
    }
    else {
        console.log("(dry run; pass --apply to airdrop SOL + create missing ATAs)");
    }
}
main().catch((err) => {
    log.fatal({ err: String(err?.message || err) }, "fund-agents crashed");
    process.exit(1);
});
