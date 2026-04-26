/**
 * Shared server-side helpers for building unsigned Anchor transactions.
 *
 * Every agent-facing POST endpoint calls `buildProgram` to get an Anchor
 * Program with a read-only provider (throwaway signer), builds the
 * instruction, and serialises the resulting Transaction to base64 so the
 * calling agent can sign + submit it independently.
 *
 * Usage pattern:
 *   const { program, connection, env } = buildProgram("base");
 *   const tx = await program.methods.someInstruction(...args)
 *     .accounts({ owner: ownerKey, ... })
 *     .transaction();
 *   return serializeTx(tx, connection);
 */

import "server-only";

import { AnchorProvider, BN, Idl, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { KESTREL_IDL } from "../indexer/decode";

// ── Environment ──────────────────────────────────────────────────────────────

export interface ApiEnv {
  baseRpcUrl: string;
  erRpcUrl: string;
  programId: PublicKey;
}

export function loadApiEnv(): ApiEnv {
  const baseRpcUrl =
    process.env.KESTREL_BASE_RPC_URL?.trim() ||
    "https://api.devnet.solana.com";
  const erRpcUrl =
    process.env.KESTREL_ER_RPC_URL?.trim() ||
    "https://devnet-as.magicblock.app/";
  const programIdStr = process.env.KESTREL_PROGRAM_ID?.trim();
  const programId = programIdStr
    ? new PublicKey(programIdStr)
    : new PublicKey((KESTREL_IDL as { address?: string }).address ?? "");

  return { baseRpcUrl, erRpcUrl, programId };
}

// ── Program builder ───────────────────────────────────────────────────────────

export type ChainTarget = "base" | "er";

export interface ProgramBundle {
  program: Program<Idl>;
  connection: Connection;
  env: ApiEnv;
}

/**
 * Returns a read-only Anchor Program instance for transaction *building*.
 * The provider uses a throwaway keypair — no funds, never signs.
 * Callers build the tx, serialise it, and return it to the agent to sign.
 */
export function buildProgram(target: ChainTarget = "base"): ProgramBundle {
  const env = loadApiEnv();
  const rpcUrl = target === "er" ? env.erRpcUrl : env.baseRpcUrl;
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    skipPreflight: false,
  });
  const program = new Program(KESTREL_IDL, provider) as Program<Idl>;
  return { program, connection, env };
}

// ── Serialisation ─────────────────────────────────────────────────────────────

/**
 * Fetches a recent blockhash, stamps it onto the transaction, and returns the
 * base64-encoded wire format.  The transaction is intentionally NOT signed —
 * the calling agent is responsible for signing before submission.
 */
export async function serializeTx(
  tx: Transaction,
  connection: Connection,
  feePayer: PublicKey,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = feePayer;
  // partial = true → do not require all signatures present
  return tx.serialize({ requireAllSignatures: false }).toString("base64");
}

// ── PDA helpers ───────────────────────────────────────────────────────────────

const AGENT_SEED = Buffer.from("agent");
const MARKET_SEED = Buffer.from("market");
const CONFIG_SEED = Buffer.from("config");
const VAULT_SEED = Buffer.from("vault");

export function agentPda(owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [AGENT_SEED, owner.toBuffer()],
    programId,
  )[0];
}

export function marketPda(id: number, programId: PublicKey): PublicKey {
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(id);
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, idBuf],
    programId,
  )[0];
}

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)[0];
}

export function vaultPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_SEED], programId)[0];
}

// ── Default policy ────────────────────────────────────────────────────────────

/** Sensible defaults for new agents.  allowedMarketsRoot = zeros disables the
 *  gate so the agent can bet on any market. */
export function defaultAgentPolicy(overrides?: {
  maxStakePerWindow?: number;
  maxOpenPositions?: number;
  paused?: boolean;
}) {
  return {
    maxStakePerWindow: new BN(overrides?.maxStakePerWindow ?? 500_000),
    maxOpenPositions: overrides?.maxOpenPositions ?? 8,
    allowedMarketsRoot: new Array(32).fill(0),
    paused: overrides?.paused ?? false,
  };
}

// ── Error helpers ─────────────────────────────────────────────────────────────

export function publicKeyOrNull(str: unknown): PublicKey | null {
  if (typeof str !== "string" || str.length < 32) return null;
  try {
    return new PublicKey(str);
  } catch {
    return null;
  }
}

export function badRequest(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}
