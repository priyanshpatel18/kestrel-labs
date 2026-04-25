import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

export interface SchedulerConfig {
  baseRpcUrl: string;
  erRpcUrl: string;
  erWsUrl: string;
  validatorLookupUrl: string;
  validatorLookupWsUrl: string;
  adminKeypair: Keypair;
  programId: PublicKey | null;
  windowSecs: number;
  horizonSecs: number;
  tickMs: number;
  seedLiquidity: bigint;
  agentKeypairsDir: string | null;
  btcUsdPriceUpdate: PublicKey | null;
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
}

function expandHome(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function loadKeypair(filePath: string): Keypair {
  const expanded = expandHome(filePath);
  const raw = fs.readFileSync(expanded, "utf8");
  const arr = JSON.parse(raw);
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

function num(envName: string, fallback: number): number {
  const v = process.env[envName];
  if (!v || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`${envName} must be a number, got ${v}`);
  }
  return n;
}

function bigint(envName: string, fallback: bigint): bigint {
  const v = process.env[envName];
  if (!v || v.trim() === "") return fallback;
  return BigInt(v);
}

export function loadConfig(): SchedulerConfig {
  const baseRpcUrl =
    process.env.KESTREL_BASE_RPC_URL || "https://api.devnet.solana.com";
  const erRpcUrl =
    process.env.KESTREL_ER_RPC_URL || "https://devnet-as.magicblock.app/";
  const erWsUrl =
    process.env.KESTREL_ER_WS_URL ||
    erRpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const validatorLookupUrl =
    process.env.KESTREL_VALIDATOR_LOOKUP_URL ||
    "https://devnet-router.magicblock.app/";
  const validatorLookupWsUrl =
    process.env.KESTREL_VALIDATOR_LOOKUP_WS_URL ||
    validatorLookupUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

  const adminKeypairPath =
    process.env.KESTREL_ADMIN_KEYPAIR ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  const adminKeypair = loadKeypair(adminKeypairPath);

  const programIdEnv = process.env.KESTREL_PROGRAM_ID?.trim();
  const programId = programIdEnv ? new PublicKey(programIdEnv) : null;

  const btcUsdPriceUpdateEnv = process.env.KESTREL_BTC_USD_PRICE_UPDATE?.trim();
  const btcUsdPriceUpdate = btcUsdPriceUpdateEnv
    ? new PublicKey(btcUsdPriceUpdateEnv)
    : null;

  const agentKeypairsDirRaw = process.env.KESTREL_AGENT_KEYPAIRS_DIR?.trim();
  const agentKeypairsDir =
    agentKeypairsDirRaw && agentKeypairsDirRaw.length > 0
      ? expandHome(agentKeypairsDirRaw)
      : null;

  const supabaseUrl = process.env.KESTREL_SUPABASE_URL?.trim() || null;
  const supabaseServiceRoleKey =
    process.env.KESTREL_SUPABASE_SERVICE_ROLE_KEY?.trim() || null;

  return {
    baseRpcUrl,
    erRpcUrl,
    erWsUrl,
    validatorLookupUrl,
    validatorLookupWsUrl,
    adminKeypair,
    programId,
    windowSecs: num("KESTREL_WINDOW_SECS", 300),
    horizonSecs: num("KESTREL_HORIZON_SECS", 86_400),
    tickMs: num("KESTREL_TICK_MS", 250),
    seedLiquidity: bigint("KESTREL_SEED_LIQUIDITY", 1_000_000n),
    agentKeypairsDir,
    btcUsdPriceUpdate,
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}
