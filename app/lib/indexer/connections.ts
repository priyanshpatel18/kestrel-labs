import { AnchorProvider, Idl, Program, Wallet } from "@coral-xyz/anchor";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { KESTREL_IDL, KESTREL_PROGRAM_ID } from "./decode";

export interface IndexerEnv {
  baseRpcUrl: string;
  baseWsUrl: string | undefined;
  erRpcUrl: string;
  erWsUrl: string | undefined;
  validatorLookupUrl: string;
  validatorLookupWsUrl: string | undefined;
  programId: PublicKey;
  backfillLimit: number;
}

export interface IndexerConnections {
  baseConnection: Connection;
  erConnection: Connection;
  routerConnection: ConnectionMagicRouter;
  baseProgram: Program<Idl>;
  erProgram: Program<Idl>;
  programId: PublicKey;
  env: IndexerEnv;
}

export function loadIndexerEnv(): IndexerEnv {
  const baseRpcUrl =
    process.env.KESTREL_BASE_RPC_URL || "https://api.devnet.solana.com";
  const baseWsUrl =
    process.env.KESTREL_BASE_WS_URL || undefined;
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

  const programIdEnv = process.env.KESTREL_PROGRAM_ID?.trim();
  const programId = programIdEnv
    ? new PublicKey(programIdEnv)
    : KESTREL_PROGRAM_ID;

  const backfillLimit = Number(
    process.env.KESTREL_INDEXER_BACKFILL_LIMIT || "1000",
  );

  return {
    baseRpcUrl,
    baseWsUrl,
    erRpcUrl,
    erWsUrl,
    validatorLookupUrl,
    validatorLookupWsUrl,
    programId,
    backfillLimit: Number.isFinite(backfillLimit) ? backfillLimit : 1000,
  };
}

export function buildIndexerConnections(
  env: IndexerEnv = loadIndexerEnv(),
): IndexerConnections {
  const baseConnection = new Connection(env.baseRpcUrl, {
    commitment: "confirmed",
    wsEndpoint: env.baseWsUrl,
  });
  const erConnection = new Connection(env.erRpcUrl, {
    commitment: "confirmed",
    wsEndpoint: env.erWsUrl,
  });
  const routerConnection = new ConnectionMagicRouter(env.validatorLookupUrl, {
    commitment: "confirmed",
    wsEndpoint: env.validatorLookupWsUrl,
  });

  // The indexer never signs, so a throwaway keypair is fine for the provider.
  const wallet = new Wallet(Keypair.generate());
  const baseProvider = new AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
  });
  const erProvider = new AnchorProvider(erConnection, wallet, {
    commitment: "confirmed",
  });

  const baseProgram = new Program(KESTREL_IDL, baseProvider) as Program<Idl>;
  const erProgram = new Program(KESTREL_IDL, erProvider) as Program<Idl>;

  return {
    baseConnection,
    erConnection,
    routerConnection,
    baseProgram,
    erProgram,
    programId: env.programId,
    env,
  };
}

export type Cluster = "base" | "er";

export function clusterConnection(
  conns: IndexerConnections,
  cluster: Cluster,
): Connection {
  return cluster === "base" ? conns.baseConnection : conns.erConnection;
}

export function clusterProgram(
  conns: IndexerConnections,
  cluster: Cluster,
): Program<Idl> {
  return cluster === "base" ? conns.baseProgram : conns.erProgram;
}
