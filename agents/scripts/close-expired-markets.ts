/**
 * close-expired-markets — one-shot operator script to run `close_market` on
 * any market that is still `open` or `halted` after `close_ts` (wall clock).
 *
 * Typical use: scheduler or market_ops missed a close during debugging; agent
 * PDAs fill with stuck positions until books are `closed` and settled.
 *
 * Env: same as `agents/` (dotenv loads `agents/.env` via connections). The
 * tx must be signed by **config.admin** — use `KESTREL_ADMIN_KEYPAIR` (same
 * file market_ops uses).
 *
 * Usage:
 *   pnpm close-expired-markets
 *   pnpm close-expired-markets -- --dry-run
 *   pnpm close-expired-markets -- --market-id 42
 */
import { PublicKey } from "@solana/web3.js";

import type { AgentConnections } from "../src/common/connections";
import { buildConnections } from "../src/common/connections";
import type { MarketView } from "../src/common/markets";
import { fetchMarket, marketPda } from "../src/common/markets";
import { sendBaseRefreshedTx, sendErTx } from "../src/common/tx";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const idIdx = argv.indexOf("--market-id");
  const marketIdOnly =
    idIdx >= 0 && argv[idIdx + 1] != null
      ? Number(argv[idIdx + 1])
      : null;
  return {
    dryRun,
    marketIdOnly:
      marketIdOnly != null && Number.isFinite(marketIdOnly)
        ? marketIdOnly
        : null,
  };
}

function isExpiredOpen(m: MarketView, nowSec: number): boolean {
  if (m.status !== "open" && m.status !== "halted") return false;
  return nowSec >= m.closeTs;
}

async function closeOneMarket(
  conns: AgentConnections,
  m: MarketView,
): Promise<string> {
  const admin = conns.signerKeypair;
  const program = m.isDelegated ? conns.erProgram : conns.baseProgram;
  const tx = await (program.methods as any)
    .closeMarket(m.id)
    .accounts({
      admin: admin.publicKey,
      priceUpdate: m.oracleFeed,
    })
    .transaction();
  return m.isDelegated
    ? await sendErTx(conns, tx, [admin], admin)
    : await sendBaseRefreshedTx(conns.baseConnection, tx, [admin], admin);
}

async function main(): Promise<void> {
  const { dryRun, marketIdOnly } = parseArgs(process.argv.slice(2));
  const conns = buildConnections("market_ops");
  const admin = conns.signerKeypair.publicKey;

  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    conns.programId,
  )[0];

  let marketCount = 0;
  try {
    const cfg = await (conns.baseProgram as any).account.config.fetch(
      configPda,
    );
    marketCount = Number(cfg.marketCount);
  } catch (e: unknown) {
    console.error(
      "Failed to fetch config — is KESTREL_PROGRAM_ID / RPC correct?",
      String((e as Error)?.message || e),
    );
    process.exit(1);
  }

  if (!Number.isFinite(marketCount) || marketCount <= 0) {
    console.log("config.market_count is zero; nothing to scan.");
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const nowIso = new Date(nowSec * 1000).toISOString();
  console.log(`Admin (signer): ${admin.toBase58()}`);
  console.log(`Program:        ${conns.programId.toBase58()}`);
  console.log(`Wall clock:     ${nowIso} (unix ${nowSec})`);
  console.log(`Scanning market ids 0 .. ${marketCount - 1}`);
  if (dryRun) console.log("(dry-run: no transactions will be sent)\n");
  if (marketIdOnly != null)
    console.log(`(filter: only market_id === ${marketIdOnly})\n`);

  let eligible = 0;
  let closed = 0;

  const ids =
    marketIdOnly != null
      ? [marketIdOnly].filter((id) => id >= 0 && id < marketCount)
      : Array.from({ length: marketCount }, (_, i) => i);

  for (const id of ids) {
    const m = await fetchMarket(conns, marketPda(id, conns.programId));
    if (!m) {
      console.log(`market ${id}: missing or undecodable`);
      continue;
    }
    if (!isExpiredOpen(m, nowSec)) {
      continue;
    }

    eligible += 1;
    const closeIso = new Date(m.closeTs * 1000).toISOString();
    const layer = m.isDelegated ? "ER" : "base";
    console.log(
      `market ${m.id}: status=${m.status} close_ts=${closeIso} (${m.closeTs}) layer=${layer}`,
    );

    if (dryRun) continue;

    try {
      const sig = await closeOneMarket(conns, m);
      console.log(`  -> close_market ok: ${sig}`);
      closed += 1;
    } catch (e: unknown) {
      console.error(`  -> close_market FAILED:`, String((e as Error)?.message || e));
    }
  }

  console.log(
    `\nDone. eligible=${eligible} closed=${closed}${dryRun ? " (dry-run)" : ""}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
