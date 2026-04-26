/**
 * withdraw-demo — one-shot base-layer withdraw after ER trading.
 *
 * Prerequisites:
 *   - AgentProfile exists; optional ER positions should be settled / closed so
 *     `balance` reflects funds you intend to pull (this script does not settle).
 *   - If the profile is still delegated to the ER, this script runs
 *     `commit_and_undelegate_agent` first (same pattern as `ensureErTradingReady`).
 *
 * Usage:
 *   pnpm --filter @kestrel/agents withdraw -- --role trader
 *   pnpm --filter @kestrel/agents withdraw -- --role risk_lp --amount 1000000
 *
 * `--amount` is USDC token lamports (6 decimals). Omit to withdraw full on-chain balance.
 */
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import type { AgentRole } from "../src/common/connections";
import { buildConnections } from "../src/common/connections";
import { buildLogger } from "../src/common/logger";
import { DELEGATION_PROGRAM_ID } from "../src/common/markets";
import { agentPda } from "../src/common/registry";
import { sendBaseRefreshedTx, sendErTx } from "../src/common/tx";

const log = buildLogger("withdraw_demo");

function parseRole(argv: string[]): AgentRole {
  const idx = argv.indexOf("--role");
  const raw = idx >= 0 && argv[idx + 1] ? argv[idx + 1]!.toLowerCase() : "trader";
  if (raw === "market_ops" || raw === "trader" || raw === "risk_lp") return raw;
  throw new Error(`Invalid --role ${raw} (use market_ops | trader | risk_lp)`);
}

function parseAmount(argv: string[]): BN | null {
  const idx = argv.indexOf("--amount");
  if (idx < 0 || !argv[idx + 1]) return null;
  const n = argv[idx + 1]!;
  if (!/^\d+$/.test(n)) throw new Error("--amount must be a positive integer (lamports)");
  return new BN(n);
}

async function waitForAgentOwner(params: {
  conns: ReturnType<typeof buildConnections>;
  pda: PublicKey;
  expectedOwner: PublicKey;
  timeoutMs?: number;
}): Promise<void> {
  const { conns, pda, expectedOwner } = params;
  const timeoutMs = params.timeoutMs ?? 60_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
    if (info && info.owner.equals(expectedOwner)) return;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `Timed out waiting for agent PDA owner=${expectedOwner.toBase58()} (${pda.toBase58()})`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const role = parseRole(argv);
  const amountArg = parseAmount(argv);
  const conns = buildConnections(role);
  const owner = conns.signerKeypair.publicKey;
  const pda = agentPda(owner, conns.programId);

  const info = await conns.baseConnection.getAccountInfo(pda, "confirmed");
  if (!info) {
    throw new Error(`No AgentProfile at ${pda.toBase58()} — register this key first`);
  }

  if (info.owner.equals(DELEGATION_PROGRAM_ID)) {
    log.info({ owner: owner.toBase58() }, "agent delegated; commit_and_undelegate_agent on ER");
    const tx = await (conns.erProgram.methods as any)
      .commitAndUndelegateAgent()
      .accounts({ owner })
      .transaction();
    const sig = await sendErTx(conns, tx, [conns.signerKeypair], conns.signerKeypair);
    log.info({ sig }, "commit_and_undelegate_agent");
    await waitForAgentOwner({
      conns,
      pda,
      expectedOwner: conns.programId,
    });
  }

  const cfgPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    conns.programId,
  )[0];
  const cfg = await (conns.baseProgram as any).account.config.fetch(cfgPda);
  const usdcMint = cfg.usdcMint as PublicKey;
  const treasury = cfg.treasury as PublicKey;

  const acc = await (conns.baseProgram as any).account.agentProfile.fetch(pda);
  const balance = new BN(acc.balance.toString());
  if (balance.lte(new BN(0))) {
    log.info({ balance: balance.toString() }, "nothing to withdraw");
    return;
  }

  const amount = amountArg ?? balance;
  if (amount.lte(new BN(0))) throw new Error("withdraw amount must be > 0");
  if (amount.gt(balance)) {
    throw new Error(
      `withdraw amount ${amount.toString()} exceeds balance ${balance.toString()}`,
    );
  }

  const userAta = getAssociatedTokenAddressSync(usdcMint, owner, true);
  const treasuryAta = getAssociatedTokenAddressSync(usdcMint, treasury, true);

  const wdTx = await (conns.baseProgram.methods as any)
    .withdraw(amount)
    .accounts({
      owner,
      usdcMint,
      userAta,
      treasuryAta,
    })
    .transaction();

  const wdSig = await sendBaseRefreshedTx(
    conns.baseConnection,
    wdTx,
    [conns.signerKeypair],
    conns.signerKeypair,
  );
  log.info(
    {
      sig: wdSig,
      amount: amount.toString(),
      treasury: treasury.toBase58(),
      note: "Protocol fee (fee_bps) applies to profit portion only — see Withdrawn event / timeline.",
    },
    "withdraw",
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
