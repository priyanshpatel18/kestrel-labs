/**
 * One-shot: create Config + vault on base layer for the program in KESTREL_PROGRAM_ID
 * (or the address in `scheduler/src/idl/kestrel.json` from `pnpm sync-idl`).
 *
 * Required in scheduler/.env:
 *   KESTREL_BTC_USD_PRICE_UPDATE
 *
 * Optional:
 *   KESTREL_USDC_MINT — defaults to Circle devnet USDC if unset and RPC looks like devnet.
 */
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { PublicKey } from "@solana/web3.js";

import { loadConfig } from "../src/config";
import { buildConnections } from "../src/connections";
import { configPda } from "../src/state";

const CIRCLE_DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);
const FEE_BPS = 100;

function rpcLooksLikeDevnet(url: string): boolean {
  return url.toLowerCase().includes("devnet");
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.btcUsdPriceUpdate) {
    throw new Error(
      "Set KESTREL_BTC_USD_PRICE_UPDATE in scheduler/.env (Pyth PriceUpdate pubkey).",
    );
  }

  const usdcEnv = process.env.KESTREL_USDC_MINT?.trim();
  const usdcMint = usdcEnv
    ? new PublicKey(usdcEnv)
    : rpcLooksLikeDevnet(cfg.baseRpcUrl)
      ? CIRCLE_DEVNET_USDC
      : (() => {
          throw new Error(
            "Set KESTREL_USDC_MINT in scheduler/.env (non-devnet RPC has no default mint).",
          );
        })();

  const conns = buildConnections(cfg);
  const pda = configPda(conns.programId);
  const existing = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  if (existing) {
    console.log("Config PDA already exists:", pda.toBase58(), "— nothing to do.");
    return;
  }

  const treasury = conns.wallet.publicKey;
  const sig = await conns.baseProgram.methods
    .initConfig(treasury, cfg.btcUsdPriceUpdate, FEE_BPS)
    .accounts({
      admin: conns.wallet.publicKey,
      usdcMint,
    })
    .rpc({ commitment: "confirmed" });

  console.log("init_config confirmed:", sig);
  console.log("config PDA:", pda.toBase58());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
