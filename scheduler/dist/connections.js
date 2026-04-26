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
exports.buildConnections = buildConnections;
exports.describeEndpoints = describeEndpoints;
exports.getValidatorIdentity = getValidatorIdentity;
exports.idlPath = idlPath;
const path = __importStar(require("path"));
const anchor = __importStar(require("@coral-xyz/anchor"));
const anchor_1 = require("@coral-xyz/anchor");
const ephemeral_rollups_sdk_1 = require("@magicblock-labs/ephemeral-rollups-sdk");
const web3_js_1 = require("@solana/web3.js");
const kestrel_json_1 = __importDefault(require("./idl/kestrel.json"));
function buildConnections(cfg) {
    const baseConnection = new web3_js_1.Connection(cfg.baseRpcUrl, "confirmed");
    const erConnection = new web3_js_1.Connection(cfg.erRpcUrl, {
        commitment: "confirmed",
        wsEndpoint: cfg.erWsUrl,
    });
    const routerConnection = new ephemeral_rollups_sdk_1.ConnectionMagicRouter(cfg.validatorLookupUrl, {
        commitment: "confirmed",
        wsEndpoint: cfg.validatorLookupWsUrl,
    });
    const wallet = new anchor_1.Wallet(cfg.adminKeypair);
    const baseProvider = new anchor_1.AnchorProvider(baseConnection, wallet, {
        commitment: "confirmed",
    });
    const erProvider = new anchor_1.AnchorProvider(erConnection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(baseProvider);
    const programId = cfg.programId
        ? cfg.programId
        : new web3_js_1.PublicKey(kestrel_json_1.default.address);
    const idl = {
        ...kestrel_json_1.default,
        address: programId.toBase58(),
    };
    const baseProgram = new anchor_1.Program(idl, baseProvider);
    const erProgram = new anchor_1.Program(idl, erProvider);
    return {
        baseConnection,
        erConnection,
        routerConnection,
        baseProvider,
        erProvider,
        baseProgram,
        erProgram,
        programId,
        wallet,
    };
}
function describeEndpoints(cfg) {
    return [
        `base=${cfg.baseRpcUrl}`,
        `er=${cfg.erRpcUrl}`,
        `router=${cfg.validatorLookupUrl}`,
    ].join(" ");
}
let cachedValidatorIdentity = null;
async function getValidatorIdentity(conns) {
    if (cachedValidatorIdentity)
        return cachedValidatorIdentity;
    const v = await conns.routerConnection.getClosestValidator();
    cachedValidatorIdentity = new web3_js_1.PublicKey(v.identity);
    return cachedValidatorIdentity;
}
/** Path to the bundled IDL JSON (same folder layout in `src/` and compiled `dist/`). */
function idlPath() {
    return path.resolve(__dirname, "idl", "kestrel.json");
}
