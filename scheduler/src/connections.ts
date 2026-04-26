import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet, Idl } from "@coral-xyz/anchor";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import type { SchedulerConfig } from "./config";

import idlJson from "./idl/kestrel.json";

export interface KestrelConnections {
  baseConnection: Connection;
  erConnection: Connection;
  routerConnection: ConnectionMagicRouter;
  baseProvider: AnchorProvider;
  erProvider: AnchorProvider;
  baseProgram: Program<Idl>;
  erProgram: Program<Idl>;
  programId: PublicKey;
  wallet: Wallet;
}

export function buildConnections(cfg: SchedulerConfig): KestrelConnections {
  const baseConnection = new Connection(cfg.baseRpcUrl, "confirmed");
  const erConnection = new Connection(cfg.erRpcUrl, {
    commitment: "confirmed",
    wsEndpoint: cfg.erWsUrl,
  });
  const routerConnection = new ConnectionMagicRouter(cfg.validatorLookupUrl, {
    commitment: "confirmed",
    wsEndpoint: cfg.validatorLookupWsUrl,
  });

  const wallet = new Wallet(cfg.adminKeypair);

  const baseProvider = new AnchorProvider(baseConnection, wallet, {
    commitment: "confirmed",
  });
  const erProvider = new AnchorProvider(erConnection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(baseProvider);

  const programId = cfg.programId
    ? cfg.programId
    : new PublicKey((idlJson as { address: string }).address);

  const idl = {
    ...(idlJson as object),
    address: programId.toBase58(),
  } as Idl;

  const baseProgram = new Program(idl, baseProvider) as Program<Idl>;
  const erProgram = new Program(idl, erProvider) as Program<Idl>;

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

let cachedValidatorIdentity: PublicKey | null = null;

export async function getValidatorIdentity(
  conns: KestrelConnections,
): Promise<PublicKey> {
  if (cachedValidatorIdentity) return cachedValidatorIdentity;
  const v = await conns.routerConnection.getClosestValidator();
  cachedValidatorIdentity = new PublicKey(v.identity);
  return cachedValidatorIdentity;
}

/** Path to the bundled IDL JSON (same folder layout in `src/` and compiled `dist/`). */
export function idlPath(): string {
  return path.resolve(__dirname, "idl", "kestrel.json");
}

export type { Keypair };
