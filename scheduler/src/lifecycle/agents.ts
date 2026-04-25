import * as fs from "fs";
import * as path from "path";
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
import type { SchedulerLogger } from "../log";
import {
  AgentSnapshot,
  DELEGATION_PROGRAM_ID,
  agentPda,
  fetchAgentSnapshot,
  listAgents,
} from "../state";

let cachedAgentKeypairs: Map<string, Keypair> | null = null;

export function loadAgentKeypairs(
  cfg: SchedulerConfig,
  log: SchedulerLogger,
): Map<string, Keypair> {
  if (cachedAgentKeypairs) return cachedAgentKeypairs;
  const map = new Map<string, Keypair>();
  if (!cfg.agentKeypairsDir) {
    cachedAgentKeypairs = map;
    return map;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(cfg.agentKeypairsDir);
  } catch (err: any) {
    log.warn(
      {
        dir: cfg.agentKeypairsDir,
        err: String(err?.message || err),
      },
      "agents: cannot read KESTREL_AGENT_KEYPAIRS_DIR",
    );
    cachedAgentKeypairs = map;
    return map;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const full = path.join(cfg.agentKeypairsDir, entry);
    try {
      const raw = fs.readFileSync(full, "utf8");
      const arr = JSON.parse(raw);
      const kp = Keypair.fromSecretKey(Uint8Array.from(arr));
      map.set(kp.publicKey.toBase58(), kp);
    } catch (err: any) {
      log.warn(
        { file: full, err: String(err?.message || err) },
        "agents: cannot parse keypair file",
      );
    }
  }
  log.info({ count: map.size }, "agents: keypairs loaded");
  cachedAgentKeypairs = map;
  return map;
}

export async function delegateUndelegatedAgentsOnce(params: {
  conns: KestrelConnections;
  cfg: SchedulerConfig;
  feePayer: Keypair;
  log: SchedulerLogger;
}): Promise<{ delegated: number; observedUndelegated: number }> {
  const { conns, cfg, feePayer, log } = params;
  const keypairs = loadAgentKeypairs(cfg, log);
  if (keypairs.size === 0) {
    return { delegated: 0, observedUndelegated: 0 };
  }

  const agents = await listAgents(conns);
  let delegated = 0;
  let observedUndelegated = 0;

  for (const agent of agents) {
    if (agent.isDelegated) continue;
    observedUndelegated++;
    const ownerKp = keypairs.get(agent.owner.toBase58());
    if (!ownerKp) {
      log.debug(
        { owner: agent.owner.toBase58() },
        "agents: undelegated but no keypair on disk",
      );
      continue;
    }
    try {
      const sig = await sendDelegateAgent({
        conns,
        ownerKp,
        feePayer,
      });
      delegated++;
      log.info(
        { owner: agent.owner.toBase58(), sig },
        "delegate_agent",
      );
    } catch (err: any) {
      log.warn(
        {
          owner: agent.owner.toBase58(),
          err: String(err?.message || err),
        },
        "delegate_agent failed",
      );
    }
  }

  return { delegated, observedUndelegated };
}

async function sendDelegateAgent(params: {
  conns: KestrelConnections;
  ownerKp: Keypair;
  feePayer: Keypair;
}): Promise<string> {
  const { conns, ownerKp, feePayer } = params;
  const validatorIdentity = await getValidatorIdentity(conns);

  const tx = await (conns.baseProgram.methods as any)
    .delegateAgent()
    .accounts({ payer: ownerKp.publicKey, validator: null })
    .remainingAccounts([
      { pubkey: validatorIdentity, isSigner: false, isWritable: false },
    ])
    .transaction();

  const signers: Keypair[] = [];
  const seen = new Set<string>();
  for (const k of [feePayer, ownerKp]) {
    const id = k.publicKey.toBase58();
    if (seen.has(id)) continue;
    seen.add(id);
    signers.push(k);
  }

  return sendAndConfirmTransaction(conns.baseConnection, tx, signers, {
    skipPreflight: true,
    commitment: "confirmed",
  });
}

// Verify a single agent is delegated. Useful right before a settle pass so we
// don't try to settle an AgentProfile that is still owned by the program on
// base layer.
export async function isAgentDelegated(
  conns: KestrelConnections,
  owner: PublicKey,
): Promise<boolean> {
  const pda = agentPda(owner, conns.programId);
  const snap = await fetchAgentSnapshot(conns, pda);
  return !!snap && snap.isDelegated;
}

export const _delegationProgramForTests = DELEGATION_PROGRAM_ID;
