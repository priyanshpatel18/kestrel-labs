import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Idl, Program, Wallet } from "@coral-xyz/anchor";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";

import idlJson from "../../../target/idl/kestrel.json";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

export type AgentRole = "market_ops" | "trader" | "risk_lp";

export interface AgentEnv {
  baseRpcUrl: string;
  erRpcUrl: string;
  erWsUrl: string;
  validatorLookupUrl: string;
  validatorLookupWsUrl: string;
  programId: PublicKey;
  btcUsdPriceUpdate: PublicKey;
  agentKeypairsDir: string | null;
  adminKeypair: Keypair;
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  /**
   * When set (e.g. `http://localhost:3000`), trading helpers use the Next.js
   * `/api/v1/*` transaction builders instead of Anchor `.methods` for the same
   * instructions — useful to validate the HTTP API before prod.
   */
  kestrelApiBaseUrl: string | null;
}

export interface AgentConnections {
  env: AgentEnv;
  baseConnection: Connection;
  erConnection: Connection;
  routerConnection: ConnectionMagicRouter;
  baseProvider: AnchorProvider;
  erProvider: AnchorProvider;
  baseProgram: Program<Idl>;
  erProgram: Program<Idl>;
  programId: PublicKey;
  /** The keypair driving the runtime (different per role). */
  signerKeypair: Keypair;
  signerWallet: Wallet;
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

export function loadEnv(): AgentEnv {
  const baseRpcUrl =
    process.env.KESTREL_BASE_RPC_URL || "https://api.devnet.solana.com";
  const erRpcUrl =
    process.env.KESTREL_ER_RPC_URL || "https://devnet-as.magicblock.app/";
  const erWsUrl = erRpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const validatorLookupUrl =
    process.env.KESTREL_VALIDATOR_LOOKUP_URL ||
    "https://devnet-router.magicblock.app/";
  const validatorLookupWsUrl = validatorLookupUrl
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:");

  const idl = idlJson as Idl;
  const programIdEnv = process.env.KESTREL_PROGRAM_ID?.trim();
  const programId = programIdEnv
    ? new PublicKey(programIdEnv)
    : new PublicKey((idl as any).address as string);

  const btcUsdPriceUpdate = new PublicKey(
    process.env.KESTREL_BTC_USD_PRICE_UPDATE ||
      "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr",
  );

  const agentKeypairsDirRaw = process.env.KESTREL_AGENT_KEYPAIRS_DIR?.trim();
  const agentKeypairsDir =
    agentKeypairsDirRaw && agentKeypairsDirRaw.length > 0
      ? expandHome(agentKeypairsDirRaw)
      : null;

  const adminKeypairPath =
    process.env.KESTREL_ADMIN_KEYPAIR ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  const adminKeypair = loadKeypair(adminKeypairPath);

  const supabaseUrl = process.env.KESTREL_SUPABASE_URL?.trim() || null;
  const supabaseServiceRoleKey =
    process.env.KESTREL_SUPABASE_SERVICE_ROLE_KEY?.trim() || null;

  const kestrelApiBaseUrlRaw = process.env.KESTREL_API_BASE_URL?.trim();
  const kestrelApiBaseUrl =
    kestrelApiBaseUrlRaw && kestrelApiBaseUrlRaw.length > 0
      ? kestrelApiBaseUrlRaw.replace(/\/+$/, "")
      : null;

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
    kestrelApiBaseUrl,
  };
}

/**
 * Resolve the keypair file for a given role. MarketOps reuses
 * `config.admin` so the program's `has_one = admin` checks succeed.
 */
export function resolveRoleKeypair(env: AgentEnv, role: AgentRole): Keypair {
  if (role === "market_ops") {
    // MarketOps == admin so halt_market / close_market authorise.
    return env.adminKeypair;
  }
  if (!env.agentKeypairsDir) {
    throw new Error(
      `KESTREL_AGENT_KEYPAIRS_DIR must be set to load the ${role} keypair`,
    );
  }
  const filename =
    role === "trader" ? "trader.json" : "risk_lp.json";
  return loadKeypair(path.join(env.agentKeypairsDir, filename));
}

export function buildConnections(role: AgentRole): AgentConnections {
  const env = loadEnv();
  const signerKeypair = resolveRoleKeypair(env, role);
  const signerWallet = new Wallet(signerKeypair);

  const baseConnection = new Connection(env.baseRpcUrl, "confirmed");
  const erConnection = new Connection(env.erRpcUrl, {
    commitment: "confirmed",
    wsEndpoint: env.erWsUrl,
  });
  const routerConnection = new ConnectionMagicRouter(env.validatorLookupUrl, {
    commitment: "confirmed",
    wsEndpoint: env.validatorLookupWsUrl,
  });
  const baseProvider = new AnchorProvider(baseConnection, signerWallet, {
    commitment: "confirmed",
  });
  const erProvider = new AnchorProvider(erConnection, signerWallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(baseProvider);

  const idl = idlJson as Idl;
  const baseProgram = new Program(idl, baseProvider) as Program<Idl>;
  const erProgram = new Program(idl, erProvider) as Program<Idl>;

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

let cachedValidatorIdentity: PublicKey | null = null;

export async function getValidatorIdentity(
  conns: AgentConnections,
): Promise<PublicKey> {
  if (cachedValidatorIdentity) return cachedValidatorIdentity;
  const v = await conns.routerConnection.getClosestValidator();
  cachedValidatorIdentity = new PublicKey(v.identity);
  return cachedValidatorIdentity;
}
