import { BN } from "@coral-xyz/anchor";

import type { AgentConnections } from "./connections";
import type { Logger } from "./logger";
import { formatErrorForLog } from "./formatError";
import {
  DELEGATION_PROGRAM_ID,
  MarketView,
  fetchMarket,
  marketPda,
} from "./markets";
import { agentPda } from "./registry";
import {
  cancelBetViaApi,
  closePositionViaApi,
  getKestrelApiBaseUrl,
} from "./kestrelApi";
import { sendErTx } from "./tx";

const ownerPk = (conns: AgentConnections) => conns.signerKeypair.publicKey;

/** Settle an agent row on a **closed** market so the slot can be reused. */
export async function trySettlePositionOnMarket(
  conns: AgentConnections,
  marketId: number,
  log: Logger,
): Promise<void> {
  const owner = ownerPk(conns);
  try {
    const tx = await (conns.erProgram.methods as any)
      .settlePosition(marketId, owner)
      .accounts({ payer: owner })
      .transaction();
    await sendErTx(conns, tx, [conns.signerKeypair]);
    log.info({ marketId }, "settle_position (release slot)");
  } catch (err: unknown) {
    log.debug(
      { marketId, err: formatErrorForLog(err).slice(0, 200) },
      "settle_position noop",
    );
  }
}

/** Sell all YES then all NO shares (while market is open/halted and before close_ts). */
async function tryCloseAllHeldShares(
  conns: AgentConnections,
  marketId: number,
  yes: BN,
  no: BN,
  log: Logger,
): Promise<void> {
  const apiBase = getKestrelApiBaseUrl(conns);
  const owner = ownerPk(conns);
  const closeOne = async (side: "yes" | "no", shares: BN) => {
    if (shares.lte(new BN(0))) return;
    if (apiBase) {
      await closePositionViaApi({ conns, marketId, side, shares });
    } else {
      const sideArg = side === "yes" ? { yes: {} } : { no: {} };
      const tx = await (conns.erProgram.methods as any)
        .closePosition(marketId, sideArg, shares)
        .accounts({ owner })
        .transaction();
      await sendErTx(conns, tx, [conns.signerKeypair]);
    }
    log.info({ marketId, side, shares: shares.toString() }, "close_position (flatten)");
  };
  try {
    await closeOne("yes", yes);
    await closeOne("no", no);
  } catch (err: unknown) {
    log.debug(
      { marketId, err: formatErrorForLog(err).slice(0, 200) },
      "close_position flatten noop",
    );
  }
}

export async function tryCancelBetOnMarket(
  conns: AgentConnections,
  marketId: number,
  log: Logger,
  /** When set, `cancel_bet` failure falls back to selling all held shares. */
  closeFallback?: { yes: BN; no: BN },
): Promise<void> {
  const apiBase = getKestrelApiBaseUrl(conns);
  try {
    if (apiBase) {
      await cancelBetViaApi({ conns, marketId });
    } else {
      const tx = await (conns.erProgram.methods as any)
        .cancelBet(marketId)
        .accounts({ owner: ownerPk(conns) })
        .transaction();
      await sendErTx(conns, tx, [conns.signerKeypair]);
    }
    log.info({ marketId }, "cancel_bet (flatten)");
  } catch (err: unknown) {
    log.debug(
      { marketId, err: formatErrorForLog(err).slice(0, 160) },
      "cancel_bet flatten noop",
    );
    if (closeFallback) {
      await tryCloseAllHeldShares(
        conns,
        marketId,
        closeFallback.yes,
        closeFallback.no,
        log,
      );
    }
  }
}

/**
 * Release slots on **other** markets: settle closed books, cancel (or
 * close_position fallback) on still-open windows before `close_ts`.
 */
export async function flattenPositionsOutsideCurrentMarket(
  conns: AgentConnections,
  current: MarketView,
  nowSec: number,
  log: Logger,
): Promise<void> {
  const pda = agentPda(conns.signerKeypair.publicKey, conns.programId);
  const baseInfo = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  const prog =
    baseInfo?.owner.equals(DELEGATION_PROGRAM_ID) || !baseInfo
      ? conns.erProgram
      : conns.baseProgram;
  let acc: any;
  try {
    acc = await (prog as any).account.agentProfile.fetch(pda);
  } catch {
    return;
  }
  const seen = new Set<number>();
  for (const pos of acc.positions as any[]) {
    const mid = Number(pos.marketId ?? pos.market_id);
    if (!Number.isFinite(mid) || seen.has(mid)) continue;
    seen.add(mid);
    if (mid === current.id) continue;
    const yes = new BN(pos.yesShares?.toString?.() ?? pos.yes_shares ?? 0);
    const no = new BN(pos.noShares?.toString?.() ?? pos.no_shares ?? 0);
    const stake = new BN(pos.stake?.toString?.() ?? 0);
    const settled = !!(pos.settled ?? false);
    if (settled) continue;
    if (yes.isZero() && no.isZero() && stake.isZero()) continue;

    const m = await fetchMarket(conns, marketPda(mid, conns.programId), log);
    if (!m) continue;

    if (m.status === "closed") {
      await trySettlePositionOnMarket(conns, mid, log);
      continue;
    }

    if (m.status !== "open" && m.status !== "halted") continue;
    if (nowSec >= m.closeTs) continue;

    await tryCancelBetOnMarket(conns, mid, log, { yes, no });
  }
}
