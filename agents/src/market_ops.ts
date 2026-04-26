/**
 * MarketOps role
 * --------------
 * Runs as the same admin keypair that initialised the Kestrel config so the
 * program's `has_one = admin` check on `halt_market` / `resume_market` /
 * `close_market` succeeds. Has two responsibilities:
 *
 *  1. Oracle freshness watchdog. Every tick we read the on-chain
 *     `price_update` account, compute `now - publish_time`, and halt the live
 *     market if the gap exceeds `AGENTS_OPS_STALE_THRESHOLD_SECS`. When the
 *     oracle recovers we resume.
 *
 *  2. Demo determinism — every Nth market we force a 20s halt regardless of
 *     oracle state so judges always see a `MarketHalted` / `MarketResumed`
 *     pair on the timeline within a few minutes of pressing play.
 */
import { PublicKey } from "@solana/web3.js";

import {
  AgentConnections,
  buildConnections,
} from "./common/connections";
import { buildLogger } from "./common/logger";
import {
  MarketView,
  findActiveOpenMarket,
  findHaltedMarket,
} from "./common/markets";
import { OracleSnapshot, readOracleSnapshot } from "./common/oracle";
import { ensureAgent, tagAgentRole } from "./common/registry";
import { sendErTx } from "./common/tx";

const log = buildLogger("market_ops");

const TICK_MS = 1500;
const STALE_THRESHOLD_SECS = Number(
  process.env.AGENTS_OPS_STALE_THRESHOLD_SECS || 30,
);
const FORCE_HALT_EVERY = Number(
  process.env.AGENTS_OPS_FORCE_HALT_EVERY_MARKETS || 4,
);
const FORCE_HALT_SECS = Number(process.env.AGENTS_OPS_FORCE_HALT_SECS || 20);

interface ForceHaltMemo {
  marketId: number;
  /** When we should automatically resume the forced halt. */
  resumeAtMs: number;
}

let forceHaltActive: ForceHaltMemo | null = null;
const seenMarkets = new Set<number>();

async function haltMarket(
  conns: AgentConnections,
  market: MarketView,
  reason: string,
): Promise<void> {
  try {
    const tx = await (conns.erProgram.methods as any)
      .haltMarket(market.id)
      .accounts({ admin: conns.signerKeypair.publicKey })
      .transaction();
    const sig = await sendErTx(conns, tx, [conns.signerKeypair]);
    log.info({ market: market.id, reason, sig }, "halt_market");
  } catch (err: any) {
    log.warn(
      { err: String(err?.message || err), market: market.id, reason },
      "halt_market failed",
    );
  }
}

async function resumeMarket(
  conns: AgentConnections,
  market: MarketView,
  reason: string,
): Promise<void> {
  try {
    const tx = await (conns.erProgram.methods as any)
      .resumeMarket(market.id)
      .accounts({ admin: conns.signerKeypair.publicKey })
      .transaction();
    const sig = await sendErTx(conns, tx, [conns.signerKeypair]);
    log.info({ market: market.id, reason, sig }, "resume_market");
  } catch (err: any) {
    log.warn(
      { err: String(err?.message || err), market: market.id, reason },
      "resume_market failed",
    );
  }
}

async function tickStaleness(
  conns: AgentConnections,
  feed: PublicKey,
): Promise<{ snap: OracleSnapshot | null; isStale: boolean }> {
  const snap = await readOracleSnapshot({
    connection: conns.baseConnection,
    feed,
    log,
  });
  const isStale = !!snap && snap.ageSecs > STALE_THRESHOLD_SECS;
  return { snap, isStale };
}

async function tick(conns: AgentConnections): Promise<void> {
  const open = await findActiveOpenMarket(conns, log);
  const haltedView = await findHaltedMarket(conns, log);
  const live = open ?? haltedView;
  if (!live) {
    log.debug("no active or halted market this tick");
    forceHaltActive = null;
    return;
  }

  // Demo determinism — force a halt on every Nth distinct market id we see.
  if (
    FORCE_HALT_EVERY > 0 &&
    open &&
    !seenMarkets.has(open.id) &&
    open.status === "open"
  ) {
    seenMarkets.add(open.id);
    if (open.id % FORCE_HALT_EVERY === 0) {
      forceHaltActive = {
        marketId: open.id,
        resumeAtMs: Date.now() + FORCE_HALT_SECS * 1000,
      };
      await haltMarket(conns, open, `forced demo halt (every ${FORCE_HALT_EVERY})`);
      return;
    }
  }

  // If a forced halt is active, resume when its window elapses.
  if (forceHaltActive && Date.now() >= forceHaltActive.resumeAtMs) {
    if (haltedView && haltedView.id === forceHaltActive.marketId) {
      await resumeMarket(conns, haltedView, "forced demo halt elapsed");
    }
    forceHaltActive = null;
    return;
  }

  // Oracle freshness loop.
  const { snap, isStale } = await tickStaleness(conns, conns.env.btcUsdPriceUpdate);
  log.debug(
    {
      market: live.id,
      status: live.status,
      ageSecs: snap?.ageSecs,
      isStale,
      forceHaltActive,
    },
    "tick",
  );

  if (open && isStale) {
    await haltMarket(
      conns,
      open,
      `oracle stale (age=${snap?.ageSecs}s > ${STALE_THRESHOLD_SECS}s)`,
    );
    return;
  }

  if (haltedView && !isStale && !forceHaltActive) {
    await resumeMarket(conns, haltedView, "oracle fresh again");
  }
}

async function main(): Promise<void> {
  const conns = buildConnections("market_ops");
  log.info(
    {
      base: conns.env.baseRpcUrl,
      er: conns.env.erRpcUrl,
      admin: conns.signerKeypair.publicKey.toBase58(),
      forceHaltEvery: FORCE_HALT_EVERY,
      staleThresholdSecs: STALE_THRESHOLD_SECS,
    },
    "market_ops boot",
  );

  // MarketOps doesn't need an AgentProfile to call halt/resume/close, but we
  // create one anyway so the /agents UI has a row for the role.
  try {
    const { agentPda: pda } = await ensureAgent({ conns, role: "market_ops", log });
    await tagAgentRole({ conns, role: "market_ops", agentPda: pda, log });
  } catch (err: any) {
    log.warn(
      { err: String(err?.message || err) },
      "market_ops: ensureAgent skipped (continuing)",
    );
  }

  // Forever loop.
  while (true) {
    try {
      await tick(conns);
    } catch (err: any) {
      log.error({ err: String(err?.message || err) }, "tick failure");
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main().catch((err) => {
  log.fatal({ err: String(err?.message || err) }, "market_ops crashed");
  process.exit(1);
});
