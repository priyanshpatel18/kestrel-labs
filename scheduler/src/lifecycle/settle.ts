import { Keypair, PublicKey } from "@solana/web3.js";

import type { KestrelConnections } from "../connections";
import type { SchedulerLogger } from "../log";
import { AgentSnapshot, listAgents } from "../state";
import { sendErTx } from "./openClose";

const SETTLE_BATCH_SIZE = 8;

export interface SettleResult {
  signatures: string[];
  agentsSettled: number;
}

export async function findUnsettledAgentsForMarket(
  conns: KestrelConnections,
  marketId: number,
): Promise<AgentSnapshot[]> {
  const all = await listAgents(conns);
  return all.filter((a) =>
    a.positions.some((p) => p.marketId === marketId && !p.settled),
  );
}

export async function settlePositionsBatched(params: {
  conns: KestrelConnections;
  admin: Keypair;
  marketId: number;
  agents: AgentSnapshot[];
  log: SchedulerLogger;
}): Promise<SettleResult> {
  const { conns, admin, marketId, agents, log } = params;
  const sigs: string[] = [];
  if (agents.length === 0) {
    return { signatures: sigs, agentsSettled: 0 };
  }

  for (let i = 0; i < agents.length; i += SETTLE_BATCH_SIZE) {
    const batch = agents.slice(i, i + SETTLE_BATCH_SIZE);
    const remaining = batch.map((a) => ({
      pubkey: a.pda,
      isSigner: false,
      isWritable: true,
    }));
    const tx = await (conns.erProgram.methods as any)
      .settlePositions(marketId)
      .accounts({ payer: admin.publicKey })
      .remainingAccounts(remaining)
      .transaction();
    const sig = await sendErTx(conns, tx, [admin], admin);
    sigs.push(sig);
    log.info(
      {
        market_id: marketId,
        sig,
        batch_size: batch.length,
        batch_start: i,
      },
      "settle_positions",
    );
  }

  return { signatures: sigs, agentsSettled: agents.length };
}

export async function commitAndUndelegateMarket(params: {
  conns: KestrelConnections;
  admin: Keypair;
  marketId: number;
}): Promise<string> {
  const { conns, admin, marketId } = params;
  const tx = await (conns.erProgram.methods as any)
    .commitAndUndelegateMarket(marketId)
    .accounts({ admin: admin.publicKey })
    .transaction();
  return sendErTx(conns, tx, [admin], admin);
}

export async function finalizeMarket(params: {
  conns: KestrelConnections;
  admin: Keypair;
  marketId: number;
  log: SchedulerLogger;
}): Promise<{ settled: number; commitSig: string | null }> {
  const { conns, admin, marketId, log } = params;

  const agents = await findUnsettledAgentsForMarket(conns, marketId);
  let settled = 0;
  if (agents.length > 0) {
    const result = await settlePositionsBatched({
      conns,
      admin,
      marketId,
      agents,
      log,
    });
    settled = result.agentsSettled;
  } else {
    log.info({ market_id: marketId }, "settle: no agent positions to settle");
  }

  let commitSig: string | null = null;
  try {
    commitSig = await commitAndUndelegateMarket({ conns, admin, marketId });
    log.info(
      { market_id: marketId, sig: commitSig },
      "commit_and_undelegate_market",
    );
  } catch (err: any) {
    log.warn(
      {
        market_id: marketId,
        err: String(err?.message || err),
      },
      "commit_and_undelegate_market failed",
    );
  }

  return { settled, commitSig };
}
