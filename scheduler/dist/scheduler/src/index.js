"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const connections_1 = require("./connections");
const log_1 = require("./log");
const loop_1 = require("./loop");
const state_1 = require("./state");
async function main() {
    const log = (0, log_1.getLogger)();
    const cfg = (0, config_1.loadConfig)();
    log.info({
        window_secs: cfg.windowSecs,
        horizon_secs: cfg.horizonSecs,
        tick_ms: cfg.tickMs,
        seed_liquidity: cfg.seedLiquidity.toString(),
        endpoints: (0, connections_1.describeEndpoints)(cfg),
    }, "kestrel-scheduler: boot");
    const conns = (0, connections_1.buildConnections)(cfg);
    // If the devnet Config PDA was created with an older layout (pre oracle pubkey),
    // migrate it in-place so the scheduler can decode it and new markets inherit
    // the correct Pyth PriceUpdate account.
    const cfgPda = (0, state_1.configPda)(conns.programId);
    const info = await conns.baseConnection.getAccountInfo(cfgPda, "confirmed");
    const V1_SIZE = 8 + 32 * 3 + 2 + 4 + 1 + 1;
    const V2_SIZE = 8 + 32 * 4 + 2 + 4 + 1 + 1;
    if (info && info.data.length === V1_SIZE) {
        if (!cfg.btcUsdPriceUpdate) {
            log.error("kestrel-scheduler: Config PDA is v1; set KESTREL_BTC_USD_PRICE_UPDATE to migrate");
            process.exit(4);
        }
        log.warn({ config: cfgPda.toBase58() }, "kestrel-scheduler: migrating v1 config to v2");
        try {
            await conns.baseProgram.methods
                .migrateConfig(cfg.btcUsdPriceUpdate)
                .accounts({ admin: conns.wallet.publicKey })
                .rpc({ commitment: "confirmed" });
        }
        catch (err) {
            log.error({
                err: String(err?.message || err),
                logs: err?.logs,
            }, "kestrel-scheduler: migrate_config failed (is devnet program upgraded?)");
            process.exit(5);
        }
    }
    else if (info && info.data.length !== V2_SIZE) {
        log.warn({ size: info.data.length, config: cfgPda.toBase58() }, "kestrel-scheduler: unexpected Config PDA size");
    }
    const onchain = await (0, state_1.loadConfig)(conns);
    if (!onchain) {
        log.error("kestrel-scheduler: Config PDA not found on base layer — run init_config first");
        process.exit(2);
    }
    if (!onchain.admin.equals(conns.wallet.publicKey)) {
        log.error({
            wallet: conns.wallet.publicKey.toBase58(),
            admin: onchain.admin.toBase58(),
        }, "kestrel-scheduler: configured admin keypair is not Config.admin");
        process.exit(3);
    }
    log.info({
        admin: onchain.admin.toBase58(),
        treasury: onchain.treasury.toBase58(),
        usdc_mint: onchain.usdcMint.toBase58(),
        market_count: onchain.marketCount,
        fee_bps: onchain.feeBps,
    }, "kestrel-scheduler: on-chain config");
    const stop = await (0, loop_1.startScheduler)(conns, cfg, log);
    let shuttingDown = false;
    const handleSignal = async (sig) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        log.info({ sig }, "kestrel-scheduler: shutdown");
        await stop();
        process.exit(0);
    };
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
    process.on("uncaughtException", (err) => {
        log.error({ err: String(err?.message || err), stack: err?.stack }, "kestrel-scheduler: uncaughtException");
    });
    process.on("unhandledRejection", (err) => {
        log.error({ err: String(err?.message || err) }, "kestrel-scheduler: unhandledRejection");
    });
}
main().catch((err) => {
    // Fall back to console because the logger may not have initialized.
    // eslint-disable-next-line no-console
    console.error("kestrel-scheduler: fatal", err);
    process.exit(1);
});
