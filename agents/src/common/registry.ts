import { BN, Idl, Program } from "@coral-xyz/anchor";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotent,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { AgentConnections, AgentRole } from "./connections";
import type { Logger } from "./logger";
import { defaultPolicyFor } from "./policy";
import { getValidatorIdentity } from "./connections";
import { DELEGATION_PROGRAM_ID } from "./markets";
import {
  depositViaApi,
  getKestrelApiBaseUrl,
  registerAgentViaApi,
} from "./kestrelApi";
import { sendErTx } from "./tx";

export const AGENT_SEED = Buffer.from("agent");

export function agentPda(owner: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [AGENT_SEED, owner.toBuffer()],
    programId,
  );
  return pda;
}

export interface AgentBootResult {
  agentPda: PublicKey;
  registered: boolean;
}

/** Idempotently ensure an `AgentProfile` exists for the role's owner. */
export async function ensureAgent(params: {
  conns: AgentConnections;
  role: AgentRole;
  log: Logger;
}): Promise<AgentBootResult> {
  const { conns, role, log } = params;
  const owner = conns.signerKeypair.publicKey;
  const pda = agentPda(owner, conns.programId);

  // MarketOps doesn't actually trade; we still create the profile so the UI
  // has a row but only Trader/Risk-LP exercise placeBet/cancel.
  const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  if (info) {
    log.info({ owner: owner.toBase58(), agent: pda.toBase58() }, "agent already registered");
    void role;
    return { agentPda: pda, registered: false };
  }

  const policy = defaultPolicyFor(role);
  const apiBase = getKestrelApiBaseUrl(conns);
  const sig = apiBase
    ? await registerAgentViaApi({
        conns,
        maxStakePerWindow: policy.maxStakePerWindow,
        maxOpenPositions: policy.maxOpenPositions,
      })
    : await (async () => {
        const tx = await (conns.baseProgram.methods as any)
          .registerAgent(policy)
          .accounts({ owner })
          .transaction();
        return sendAndConfirmTransaction(
          conns.baseConnection,
          tx,
          [conns.signerKeypair],
          { skipPreflight: true, commitment: "confirmed" },
        );
      })();
  log.info(
    { owner: owner.toBase58(), agent: pda.toBase58(), sig },
    "agent registered",
  );
  return { agentPda: pda, registered: true };
}

async function ensureDelegated(params: {
  conns: AgentConnections;
  log: Logger;
  owner: PublicKey;
}): Promise<void> {
  const { conns, log, owner } = params;
  const validatorIdentity = await getValidatorIdentity(conns);
  const remainingAccounts = [
    { pubkey: validatorIdentity, isSigner: false, isWritable: false },
  ];
  const tx = await (conns.baseProgram.methods as any)
    .delegateAgent()
    .accounts({
      payer: owner,
      validator: null,
    })
    .remainingAccounts(remainingAccounts)
    .transaction();

  const sig = await sendAndConfirmTransaction(
    conns.baseConnection,
    tx,
    [conns.signerKeypair],
    { skipPreflight: true, commitment: "confirmed" },
  );
  log.info(
    { owner: owner.toBase58(), sig, validator: validatorIdentity.toBase58() },
    "delegate_agent",
  );
}

async function waitForOwner(params: {
  conns: AgentConnections;
  pda: PublicKey;
  expectedOwner: PublicKey;
  timeoutMs?: number;
}): Promise<void> {
  const { conns, pda, expectedOwner } = params;
  const timeoutMs = params.timeoutMs ?? 30_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    if (info && info.owner.equals(expectedOwner)) return;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `Timed out waiting for ${pda.toBase58()} owner=${expectedOwner.toBase58()}`,
  );
}

/**
 * Every-run startup routine for trading roles:
 * - If delegated, commit+undelegate on ER (so we can deposit on base).
 * - Ensure USDC ATA exists and deposit up to `targetBalance` on base.
 * - Delegate the agent PDA again for ER writes.
 */
export async function ensureErTradingReady(params: {
  conns: AgentConnections;
  role: Exclude<AgentRole, "market_ops">;
  log: Logger;
  targetBalance: BN;
}): Promise<void> {
  const { conns, log, targetBalance } = params;
  const owner = conns.signerKeypair.publicKey;
  const pda = agentPda(owner, conns.programId);

  // If already delegated, we must commit+undelegate before we can deposit.
  const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  if (info && info.owner.equals(DELEGATION_PROGRAM_ID)) {
    log.info({ owner: owner.toBase58() }, "agent delegated; committing+undelegating");
    const tx = await (conns.erProgram.methods as any)
      .commitAndUndelegateAgent()
      .accounts({ owner })
      .transaction();
    await sendErTx(conns, tx, [conns.signerKeypair], conns.signerKeypair);
    await waitForOwner({
      conns,
      pda,
      expectedOwner: conns.programId,
      timeoutMs: 60_000,
    });
  }

  // Fetch config to learn USDC mint.
  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    conns.programId,
  )[0];
  const cfg = await (conns.baseProgram as any).account.config.fetch(configPda);
  const usdcMint = cfg.usdcMint as PublicKey;

  // Ensure ATA exists.
  const userAta = getAssociatedTokenAddressSync(usdcMint, owner, true);
  await createAssociatedTokenAccountIdempotent(
    conns.baseConnection,
    conns.signerKeypair,
    usdcMint,
    owner,
  );

  // Check on-chain agent balance (base side).
  const acc = await (conns.baseProgram as any).account.agentProfile.fetch(pda);
  const current = new BN(acc.balance.toString());

  if (current.lt(targetBalance)) {
    const delta = targetBalance.sub(current);
    const ataAcc = await getAccount(conns.baseConnection, userAta, "confirmed");
    if (new BN(ataAcc.amount.toString()).lt(delta)) {
      throw new Error(
        `Insufficient USDC in ${userAta.toBase58()} to deposit ${delta.toString()} (have ${ataAcc.amount.toString()}). Fund the owner ${owner.toBase58()} with devnet USDC first.`,
      );
    }

    const apiBase = getKestrelApiBaseUrl(conns);
    const sig = apiBase
      ? await depositViaApi({ conns, amount: delta })
      : await (async () => {
          const depTx = await (conns.baseProgram.methods as any)
            .deposit(delta)
            .accounts({
              owner,
              usdcMint,
              userAta,
            })
            .transaction();
          return sendAndConfirmTransaction(
            conns.baseConnection,
            depTx,
            [conns.signerKeypair],
            { skipPreflight: true, commitment: "confirmed" },
          );
        })();
    log.info(
      { owner: owner.toBase58(), amount: delta.toString(), sig },
      "deposit",
    );
  } else {
    log.info(
      { owner: owner.toBase58(), balance: current.toString() },
      "deposit skipped (already funded)",
    );
  }

  await ensureDelegated({ conns, log, owner });
  await waitForOwner({
    conns,
    pda,
    expectedOwner: DELEGATION_PROGRAM_ID,
    timeoutMs: 60_000,
  });
}

let cachedSb: SupabaseClient | null = null;

function supabase(conns: AgentConnections): SupabaseClient | null {
  if (cachedSb) return cachedSb;
  const { supabaseUrl, supabaseServiceRoleKey } = conns.env;
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  cachedSb = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedSb;
}

const ROLE_LABEL: Record<AgentRole, string> = {
  market_ops: "MarketOps",
  trader: "Trader",
  risk_lp: "Risk-LP",
};

/**
 * Tag the agent row with its role+label. The indexer creates the row on
 * `register_agent` decode, but only the runtime knows which role identifier
 * to attach. Safe to call repeatedly.
 */
export async function tagAgentRole(params: {
  conns: AgentConnections;
  role: AgentRole;
  agentPda: PublicKey;
  log: Logger;
}): Promise<void> {
  const sb = supabase(params.conns);
  if (!sb) {
    params.log.debug("supabase not configured; skipping role tag");
    return;
  }
  const owner = params.conns.signerKeypair.publicKey.toBase58();
  const { error } = await sb.from("agents").upsert(
    {
      owner_pubkey: owner,
      agent_pda: params.agentPda.toBase58(),
      role: params.role,
      label: ROLE_LABEL[params.role],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_pubkey" },
  );
  if (error) {
    params.log.warn({ err: error.message }, "supabase tagAgentRole failed");
  } else {
    params.log.info({ role: params.role, owner }, "tagged agent role in supabase");
  }
}
