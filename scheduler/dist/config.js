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
exports.loadConfig = loadConfig;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
function expandHome(p) {
    if (p.startsWith("~")) {
        return path.join(os.homedir(), p.slice(1));
    }
    return p;
}
function loadKeypair(filePath) {
    const expanded = expandHome(filePath);
    const raw = fs.readFileSync(expanded, "utf8");
    const arr = JSON.parse(raw);
    return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(arr));
}
function num(envName, fallback) {
    const v = process.env[envName];
    if (!v || v.trim() === "")
        return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) {
        throw new Error(`${envName} must be a number, got ${v}`);
    }
    return n;
}
function bigint(envName, fallback) {
    const v = process.env[envName];
    if (!v || v.trim() === "")
        return fallback;
    return BigInt(v);
}
function loadConfig() {
    const baseRpcUrl = process.env.KESTREL_BASE_RPC_URL || "https://api.devnet.solana.com";
    const erRpcUrl = process.env.KESTREL_ER_RPC_URL || "https://devnet-as.magicblock.app/";
    const erWsUrl = process.env.KESTREL_ER_WS_URL ||
        erRpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    const validatorLookupUrl = process.env.KESTREL_VALIDATOR_LOOKUP_URL ||
        "https://devnet-router.magicblock.app/";
    const validatorLookupWsUrl = process.env.KESTREL_VALIDATOR_LOOKUP_WS_URL ||
        validatorLookupUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    const adminKeypairPath = process.env.KESTREL_ADMIN_KEYPAIR ||
        path.join(os.homedir(), ".config", "solana", "id.json");
    const adminKeypair = loadKeypair(adminKeypairPath);
    const programIdEnv = process.env.KESTREL_PROGRAM_ID?.trim();
    const programId = programIdEnv ? new web3_js_1.PublicKey(programIdEnv) : null;
    const btcUsdPriceUpdateEnv = process.env.KESTREL_BTC_USD_PRICE_UPDATE?.trim();
    const btcUsdPriceUpdate = btcUsdPriceUpdateEnv
        ? new web3_js_1.PublicKey(btcUsdPriceUpdateEnv)
        : null;
    const agentKeypairsDirRaw = process.env.KESTREL_AGENT_KEYPAIRS_DIR?.trim();
    const agentKeypairsDir = agentKeypairsDirRaw && agentKeypairsDirRaw.length > 0
        ? expandHome(agentKeypairsDirRaw)
        : null;
    const supabaseUrl = process.env.KESTREL_SUPABASE_URL?.trim() || null;
    const supabaseServiceRoleKey = process.env.KESTREL_SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
    return {
        baseRpcUrl,
        erRpcUrl,
        erWsUrl,
        validatorLookupUrl,
        validatorLookupWsUrl,
        adminKeypair,
        programId,
        windowSecs: num("KESTREL_WINDOW_SECS", 300),
        horizonSecs: num("KESTREL_HORIZON_SECS", 86400),
        tickMs: num("KESTREL_TICK_MS", 250),
        seedLiquidity: bigint("KESTREL_SEED_LIQUIDITY", 1000000n),
        agentKeypairsDir,
        btcUsdPriceUpdate,
        supabaseUrl,
        supabaseServiceRoleKey,
    };
}
