import { PublicKey } from "@solana/web3.js";

import { getServiceSupabase } from "../supabase/server";

import {
  Cluster,
  IndexerConnections,
  clusterConnection,
  clusterProgram,
} from "./connections";
import { DecodedKestrelIx, decodeKestrelIx } from "./decode";
import { buildDecisionCard } from "./enrich";
import { log } from "./log";

const MARKET_SEED = Buffer.from("market");

interface EventRow {
  signature: string;
  ix_index: number;
  cluster: Cluster;
  slot: number | null;
  block_time: string | null;
  market_pubkey: string | null;
  market_id: number | null;
  kind: string;
  actor: string | null;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  success: boolean;
  err: string | null;
  decision: Record<string, unknown> | null;
}

interface MarketSigPatch {
  market_pubkey: string;
  market_id: number;
  patch: Record<string, unknown>;
}

function marketPda(programId: PublicKey, marketId: number): PublicKey {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(marketId >>> 0, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [MARKET_SEED, buf],
    programId,
  );
  return pda;
}

function extractMarketId(decoded: DecodedKestrelIx): number | null {
  const v = decoded.args.id;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sigColumnFor(kind: string): string | null {
  switch (kind) {
    case "create_market":
      return "created_sig";
    case "delegate_market":
      return "delegated_sig";
    case "open_market":
      return "opened_sig";
    case "close_market":
      return "closed_sig";
    case "settle_position":
    case "settle_positions":
      return "settled_sig";
    case "commit_and_undelegate_market":
      return "undelegated_sig";
    default:
      return null;
  }
}

function statusFor(kind: string): string | null {
  switch (kind) {
    case "create_market":
      return "pending";
    case "delegate_market":
      return "pending";
    case "open_market":
      return "open";
    case "halt_market":
      return "halted";
    case "resume_market":
      return "open";
    case "close_market":
      return "closed";
    case "commit_and_undelegate_market":
      return "settled";
    default:
      return null;
  }
}

function buildMarketPatch(
  signature: string,
  blockTime: string | null,
  decoded: DecodedKestrelIx,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const status = statusFor(decoded.name);
  if (status) patch.status = status;
  const sigCol = sigColumnFor(decoded.name);
  if (sigCol) patch[sigCol] = signature;
  if (decoded.name === "create_market") {
    if (decoded.args.open_ts !== undefined)
      patch.open_ts = Number(decoded.args.open_ts);
    if (decoded.args.close_ts !== undefined)
      patch.close_ts = Number(decoded.args.close_ts);
  }
  if (blockTime && decoded.name === "create_market") {
    // best-effort created_at = block time of the create tx
    patch.updated_at = blockTime;
  }
  return patch;
}

async function fetchMarketStrikePrice(params: {
  conns: IndexerConnections;
  cluster: Cluster;
  marketPda: string;
}): Promise<number | null> {
  const { conns, cluster, marketPda } = params;
  const program = clusterProgram(conns, cluster);
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const acc = await (
        program as unknown as {
          account: {
            market: { fetch: (pk: PublicKey) => Promise<Record<string, unknown>> };
          };
        }
      ).account.market.fetch(new PublicKey(marketPda));

      // `strike` is i64 on-chain, returned as BN-like.
      const strike = acc?.strike;
      const strikeAny = strike as unknown as { toString?: () => string };
      const asNum = Number(strikeAny?.toString?.() ?? strike);
      return Number.isFinite(asNum) ? asNum : null;
    } catch (err) {
      if (attempt === maxAttempts - 1) {
        log.debug("fetchMarketStrikePrice failed", {
          cluster,
          market: marketPda,
          err: String((err as unknown as { message?: string })?.message || err),
        });
        return null;
      }
      // ER account state can lag slightly right after the log fires.
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  return null;
}

async function fetchMarketClosePrice(params: {
  conns: IndexerConnections;
  cluster: Cluster;
  marketPda: string;
}): Promise<number | null> {
  const { conns, cluster, marketPda } = params;
  const program = clusterProgram(conns, cluster);
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const acc = await (
        program as unknown as {
          account: {
            market: { fetch: (pk: PublicKey) => Promise<Record<string, unknown>> };
          };
        }
      ).account.market.fetch(new PublicKey(marketPda));

      const closePrice = acc?.closePrice;
      const cp = closePrice as unknown as { toString?: () => string };
      const asNum = Number(cp?.toString?.() ?? closePrice);
      return Number.isFinite(asNum) ? asNum : null;
    } catch {
      if (attempt === maxAttempts - 1) return null;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  return null;
}

async function applyMarketPatches(patches: MarketSigPatch[]): Promise<void> {
  if (patches.length === 0) return;
  const sb = getServiceSupabase();
  // Group by pubkey so we issue one upsert per market with the merged patch.
  const merged = new Map<string, MarketSigPatch>();
  for (const p of patches) {
    const cur = merged.get(p.market_pubkey);
    if (!cur) merged.set(p.market_pubkey, { ...p, patch: { ...p.patch } });
    else cur.patch = { ...cur.patch, ...p.patch };
  }
  const rows = Array.from(merged.values()).map((m) => ({
    market_pubkey: m.market_pubkey,
    market_id: m.market_id,
    ...m.patch,
  }));
  const { error } = await sb
    .from("markets")
    .upsert(rows, { onConflict: "market_pubkey" });
  if (error) {
    const msg = String(error.message || error);
    log.warn("markets upsert failed", {
      error: msg.length > 500 ? `${msg.slice(0, 500)}…` : msg,
    });
  }
}

async function insertEvents(rows: EventRow[]): Promise<void> {
  if (rows.length === 0) return;
  const sb = getServiceSupabase();
  const { error } = await sb
    .from("events")
    .upsert(rows, { onConflict: "signature,ix_index", ignoreDuplicates: true });
  if (error) {
    const msg = String(error.message || error);
    log.warn("events upsert failed", {
      error: msg.length > 500 ? `${msg.slice(0, 500)}…` : msg,
      sample: rows[0]?.signature,
    });
  }
}

export interface IngestStats {
  decoded: number;
  written: number;
  skipped: number;
}

/**
 * Fetch the transaction for `signature`, decode every Kestrel program ix
 * (top-level + inner), upsert one row per ix into `events` and patch the
 * corresponding `markets` row.
 */
export async function ingestSignature(
  conns: IndexerConnections,
  cluster: Cluster,
  signature: string,
): Promise<IngestStats> {
  const conn = clusterConnection(conns, cluster);
  let tx;
  try {
    tx = await conn.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (err) {
    log.debug("getParsedTransaction failed", {
      cluster,
      signature,
      err: String((err as Error).message),
    });
    return { decoded: 0, written: 0, skipped: 1 };
  }

  if (!tx) {
    return { decoded: 0, written: 0, skipped: 1 };
  }

  const programId = conns.programId.toBase58();
  const blockTime = tx.blockTime
    ? new Date(tx.blockTime * 1000).toISOString()
    : null;
  const slot = tx.slot ?? null;
  const success = !tx.meta?.err;
  const errStr = tx.meta?.err ? JSON.stringify(tx.meta.err) : null;
  const signers = tx.transaction.message.accountKeys
    .filter((a) => ("signer" in a ? a.signer : false))
    .map((a) => ("pubkey" in a ? a.pubkey.toBase58() : ""))
    .filter(Boolean);
  const fallbackActor = signers[0] ?? null;

  type Candidate = {
    decoded: DecodedKestrelIx;
    ixIndex: number;
  };
  const candidates: Candidate[] = [];

  let ixCounter = 0;
  const collect = (
    pid: string,
    accounts: Array<PublicKey | string>,
    data: string,
  ) => {
    const idx = ixCounter++;
    if (pid !== programId) return;
    const decoded = decodeKestrelIx(data, accounts);
    if (!decoded) return;
    candidates.push({ decoded, ixIndex: idx });
  };

  for (const ix of tx.transaction.message.instructions) {
    if ("parsed" in ix) {
      // parsed by a built-in parser (token / system / …) — never the kestrel program
      ixCounter++;
      continue;
    }
    const partial = ix as {
      programId: PublicKey;
      accounts: PublicKey[];
      data: string;
    };
    collect(partial.programId.toBase58(), partial.accounts, partial.data);
  }

  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      if ("parsed" in ix) {
        ixCounter++;
        continue;
      }
      const partial = ix as {
        programId: PublicKey;
        accounts: PublicKey[];
        data: string;
      };
      collect(partial.programId.toBase58(), partial.accounts, partial.data);
    }
  }

  if (candidates.length === 0) {
    return { decoded: 0, written: 0, skipped: 0 };
  }

  // First pass: ensure parent market rows exist for the FK.
  const marketPatches: MarketSigPatch[] = [];
  const seenMarkets = new Set<string>();
  const eventRows: EventRow[] = [];

  for (const { decoded, ixIndex } of candidates) {
    const marketId = extractMarketId(decoded);
    let marketPubkey: string | null = null;
    if (marketId !== null) {
      marketPubkey = marketPda(conns.programId, marketId).toBase58();
      // Always seed the markets row so the FK in events is satisfied.
      if (!seenMarkets.has(marketPubkey)) {
        seenMarkets.add(marketPubkey);
        marketPatches.push({
          market_pubkey: marketPubkey,
          market_id: marketId,
          patch: buildMarketPatch(signature, blockTime, decoded),
        });
      } else {
        // merge later patches into the same pubkey
        marketPatches.push({
          market_pubkey: marketPubkey,
          market_id: marketId,
          patch: buildMarketPatch(signature, blockTime, decoded),
        });
      }
    }

    const actor =
      decoded.accounts.owner ||
      decoded.accounts.admin ||
      decoded.accounts.payer ||
      fallbackActor;

    const decision = await buildDecisionCard({
      conns,
      cluster,
      decoded,
      success,
      err: errStr,
    });

    // Persist the oracle-derived strike (\"target price\") at open time.
    // The program writes it into `Market.strike`; we read the account and
    // store it into `markets.strike_price` for fast UI queries.
    let strikePricePatch: Record<string, unknown> | null = null;
    if (decoded.name === "open_market" && marketPubkey) {
      const strike = await fetchMarketStrikePrice({
        conns,
        cluster,
        marketPda: marketPubkey,
      });
      if (strike !== null) strikePricePatch = { strike_price: strike };
    }

    // Persist the oracle close price at close time (for showing final price).
    let closePricePatch: Record<string, unknown> | null = null;
    if (decoded.name === "close_market" && marketPubkey) {
      const closePrice = await fetchMarketClosePrice({
        conns,
        cluster,
        marketPda: marketPubkey,
      });
      if (closePrice !== null) closePricePatch = { close_price: closePrice };
    }

    eventRows.push({
      signature,
      ix_index: ixIndex,
      cluster,
      slot,
      block_time: blockTime,
      market_pubkey: marketPubkey,
      market_id: marketId,
      kind: decoded.name,
      actor,
      args: decoded.args,
      accounts: decoded.accounts,
      success,
      err: errStr,
      decision,
    });

    if (strikePricePatch && marketId !== null && marketPubkey) {
      marketPatches.push({
        market_pubkey: marketPubkey,
        market_id: marketId,
        patch: { ...strikePricePatch, updated_at: new Date().toISOString() },
      });
    }

    if (closePricePatch && marketId !== null && marketPubkey) {
      marketPatches.push({
        market_pubkey: marketPubkey,
        market_id: marketId,
        patch: { ...closePricePatch, updated_at: new Date().toISOString() },
      });
    }
  }

  // Order matters: write markets first to satisfy the FK in events.
  await applyMarketPatches(marketPatches);
  await insertEvents(eventRows);

  log.debug("ingested", {
    cluster,
    signature,
    decoded: candidates.length,
  });

  return { decoded: candidates.length, written: eventRows.length, skipped: 0 };
}

export { accountKeysHelper };

// Exported only for tests.
function accountKeysHelper(): typeof PublicKey {
  return PublicKey;
}
