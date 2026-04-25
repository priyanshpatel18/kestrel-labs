import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import type { SchedulerConfig } from "../config";
import {
  KestrelConnections,
  getValidatorIdentity,
} from "../connections";
import { SchedulerLogger } from "../log";
import {
  ConfigSnapshot,
  MarketSnapshot,
  configPda,
  loadConfig,
  listMarkets,
  marketPda,
} from "../state";

export interface HorizonState {
  cachedMarketCount: number | null;
  cachedConfigAdmin: PublicKey | null;
  busy: boolean;
}

export function newHorizonState(): HorizonState {
  return {
    cachedMarketCount: null,
    cachedConfigAdmin: null,
    busy: false,
  };
}

function alignUp(ts: number, windowSecs: number): number {
  return Math.ceil(ts / windowSecs) * windowSecs;
}

export interface HorizonScanResult {
  config: ConfigSnapshot;
  markets: MarketSnapshot[];
  futurePending: MarketSnapshot[];
  needToCreate: number;
  nextOpenTs: number;
}

export async function scanHorizon(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
): Promise<HorizonScanResult | null> {
  const config = await loadConfig(conns);
  if (!config) return null;

  const markets = await listMarkets(conns, config.marketCount);
  const now = Math.floor(Date.now() / 1000);
  const futurePending = markets
    .filter((m) => m.status === "pending" && m.openTs >= now)
    .sort((a, b) => a.openTs - b.openTs);

  const target = Math.floor(cfg.horizonSecs / cfg.windowSecs);
  const have = futurePending.length;
  const needToCreate = Math.max(0, target - have);

  let nextOpenTs: number;
  if (have === 0) {
    nextOpenTs = alignUp(now, cfg.windowSecs);
  } else {
    const last = futurePending[have - 1].openTs;
    nextOpenTs = alignUp(last + cfg.windowSecs, cfg.windowSecs);
  }

  return { config, markets, futurePending, needToCreate, nextOpenTs };
}

// Create one market on base + delegate it to ER. Returns the id created, or
// null if the horizon is already full / config not found / scheduler is busy.
export async function ensureHorizonOnce(
  conns: KestrelConnections,
  cfg: SchedulerConfig,
  state: HorizonState,
  log: SchedulerLogger,
): Promise<number | null> {
  if (state.busy) return null;
  state.busy = true;
  try {
    const scan = await scanHorizon(conns, cfg);
    if (!scan) {
      log.warn("horizon: Config PDA not found yet; init_config first");
      return null;
    }
    if (scan.needToCreate <= 0) {
      // Cache for fast reuse by other stages.
      state.cachedMarketCount = scan.config.marketCount;
      state.cachedConfigAdmin = scan.config.admin;
      return null;
    }
    if (!scan.config.admin.equals(conns.wallet.publicKey)) {
      log.warn(
        { admin: scan.config.admin.toBase58() },
        "horizon: scheduler wallet is not Config.admin; cannot create_market",
      );
      return null;
    }

    const id = scan.config.marketCount;
    const openTs = scan.nextOpenTs;
    const closeTs = openTs + cfg.windowSecs;

    const validatorIdentity = await getValidatorIdentity(conns);

    const created = await sendCreateMarket(
      conns,
      cfg.adminKeypair,
      id,
      openTs,
      closeTs,
    );
    log.info(
      {
        market_id: id,
        open_ts: openTs,
        close_ts: closeTs,
        sig: created,
      },
      "horizon: create_market",
    );

    const delegated = await sendDelegateMarket(
      conns,
      cfg.adminKeypair,
      id,
      validatorIdentity,
    );
    log.info(
      { market_id: id, sig: delegated },
      "horizon: delegate_market",
    );

    state.cachedMarketCount = id + 1;
    state.cachedConfigAdmin = scan.config.admin;
    return id;
  } catch (err: any) {
    log.error({ err: String(err?.message || err) }, "horizon: tick failed");
    state.cachedMarketCount = null;
    return null;
  } finally {
    state.busy = false;
  }
}

async function sendCreateMarket(
  conns: KestrelConnections,
  admin: Keypair,
  id: number,
  openTs: number,
  closeTs: number,
): Promise<string> {
  const tx = await (conns.baseProgram.methods as any)
    .createMarket(id, new anchor.BN(openTs), new anchor.BN(closeTs))
    .accounts({ admin: admin.publicKey })
    .transaction();
  return await sendAndConfirmTransaction(conns.baseConnection, tx, [admin], {
    skipPreflight: true,
    commitment: "confirmed",
  });
}

async function sendDelegateMarket(
  conns: KestrelConnections,
  admin: Keypair,
  id: number,
  validatorIdentity: PublicKey,
): Promise<string> {
  const tx = await (conns.baseProgram.methods as any)
    .delegateMarket(id)
    .accounts({ payer: admin.publicKey, validator: null })
    .remainingAccounts([
      { pubkey: validatorIdentity, isSigner: false, isWritable: false },
    ])
    .transaction();
  return await sendAndConfirmTransaction(conns.baseConnection, tx, [admin], {
    skipPreflight: true,
    commitment: "confirmed",
  });
}
