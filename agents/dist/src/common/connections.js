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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnv = loadEnv;
exports.resolveRoleKeypair = resolveRoleKeypair;
exports.buildConnections = buildConnections;
exports.getValidatorIdentity = getValidatorIdentity;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const anchor = __importStar(require("@coral-xyz/anchor"));
const anchor_1 = require("@coral-xyz/anchor");
const ephemeral_rollups_sdk_1 = require("@magicblock-labs/ephemeral-rollups-sdk");
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
const kestrel_json_1 = __importDefault(require("../../../target/idl/kestrel.json"));
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
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
function loadEnv() {
    const baseRpcUrl = process.env.KESTREL_BASE_RPC_URL || "https://api.devnet.solana.com";
    const erRpcUrl = process.env.KESTREL_ER_RPC_URL || "https://devnet-as.magicblock.app/";
    const erWsUrl = erRpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    const validatorLookupUrl = process.env.KESTREL_VALIDATOR_LOOKUP_URL ||
        "https://devnet-router.magicblock.app/";
    const validatorLookupWsUrl = validatorLookupUrl
        .replace(/^https:/, "wss:")
        .replace(/^http:/, "ws:");
    const idl = kestrel_json_1.default;
    const programIdEnv = process.env.KESTREL_PROGRAM_ID?.trim();
    const programId = programIdEnv
        ? new web3_js_1.PublicKey(programIdEnv)
        : new web3_js_1.PublicKey(idl.address);
    const btcUsdPriceUpdate = new web3_js_1.PublicKey(process.env.KESTREL_BTC_USD_PRICE_UPDATE ||
        "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr");
    const agentKeypairsDirRaw = process.env.KESTREL_AGENT_KEYPAIRS_DIR?.trim();
    const agentKeypairsDir = agentKeypairsDirRaw && agentKeypairsDirRaw.length > 0
        ? expandHome(agentKeypairsDirRaw)
        : null;
    const adminKeypairPath = process.env.KESTREL_ADMIN_KEYPAIR ||
        path.join(os.homedir(), ".config", "solana", "id.json");
    const adminKeypair = loadKeypair(adminKeypairPath);
    const supabaseUrl = process.env.KESTREL_SUPABASE_URL?.trim() || null;
    const supabaseServiceRoleKey = process.env.KESTREL_SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
    return {
        baseRpcUrl,
        erRpcUrl,
        erWsUrl,
        validatorLookupUrl,
        validatorLookupWsUrl,
        programId,
        btcUsdPriceUpdate,
        agentKeypairsDir,
        adminKeypair,
        supabaseUrl,
        supabaseServiceRoleKey,
    };
}
/**
 * Resolve the keypair file for a given role. MarketOps reuses
 * `config.admin` so the program's `has_one = admin` checks succeed.
 */
function resolveRoleKeypair(env, role) {
    if (role === "market_ops") {
        // MarketOps == admin so halt_market / close_market authorise.
        return env.adminKeypair;
    }
    if (!env.agentKeypairsDir) {
        throw new Error(`KESTREL_AGENT_KEYPAIRS_DIR must be set to load the ${role} keypair`);
    }
    const filename = role === "trader" ? "trader.json" : "risk_lp.json";
    return loadKeypair(path.join(env.agentKeypairsDir, filename));
}
function buildConnections(role) {
    const env = loadEnv();
    const signerKeypair = resolveRoleKeypair(env, role);
    const signerWallet = new anchor_1.Wallet(signerKeypair);
    const baseConnection = new web3_js_1.Connection(env.baseRpcUrl, "confirmed");
    const erConnection = new web3_js_1.Connection(env.erRpcUrl, {
        commitment: "confirmed",
        wsEndpoint: env.erWsUrl,
    });
    const routerConnection = new ephemeral_rollups_sdk_1.ConnectionMagicRouter(env.validatorLookupUrl, {
        commitment: "confirmed",
        wsEndpoint: env.validatorLookupWsUrl,
    });
    const baseProvider = new anchor_1.AnchorProvider(baseConnection, signerWallet, {
        commitment: "confirmed",
    });
    const erProvider = new anchor_1.AnchorProvider(erConnection, signerWallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(baseProvider);
    const idl = kestrel_json_1.default;
    const baseProgram = new anchor_1.Program(idl, baseProvider);
    const erProgram = new anchor_1.Program(idl, erProvider);
    return {
        env,
        baseConnection,
        erConnection,
        routerConnection,
        baseProvider,
        erProvider,
        baseProgram,
        erProgram,
        programId: env.programId,
        signerKeypair,
        signerWallet,
    };
}
let cachedValidatorIdentity = null;
async function getValidatorIdentity(conns) {
    if (cachedValidatorIdentity)
        return cachedValidatorIdentity;
    const v = await conns.routerConnection.getClosestValidator();
    cachedValidatorIdentity = new web3_js_1.PublicKey(v.identity);
    return cachedValidatorIdentity;
}
