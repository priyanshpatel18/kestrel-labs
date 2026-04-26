import { PublicKey } from "@solana/web3.js";

import { getServiceSupabase } from "../supabase/server";

import {
  Cluster,
  IndexerConnections,
  clusterConnection,
  clusterProgram,
} from "./connections";
import {
  DecodedKestrelEvent,
  DecodedKestrelIx,
  decodeKestrelEvents,
  decodeKestrelIx,
} from "./decode";
import { buildDecisionCard } from "./enrich";
import { decodeKestrelErrorFromString } from "./errorMap";
import { log } from "./log";

const MARKET_SEED = Buffer.from("market");
const AGENT_SEED = Buffer.from("agent");

interface EventRow {
  signature: string;
  ix_index: number;
  event_seq: number;
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

interface AgentPatch {
  owner_pubkey: string;
  agent_pda?: string;
  current_policy?: Record<string, unknown> | null;
  current_balance?: number | null;
  registered_at?: string | null;
  last_event_at?: string | null;
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

function agentPda(programId: PublicKey, owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [AGENT_SEED, owner.toBuffer()],
    programId,
  );
  return pda;
}

/** Pull a `Pubkey` field out of a decoded Anchor event payload. */
function eventPubkey(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { toBase58?: () => string }).toBase58 === "function") {
    try {
      return (v as { toBase58: () => string }).toBase58();
    } catch {
      return null;
    }
  }
  return null;
}

function eventNumber(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
    .upsert(rows, {
      onConflict: "signature,ix_index,event_seq",
      ignoreDuplicates: true,
    });
  if (error) {
    const msg = String(error.message || error);
    log.warn("events upsert failed", {
      error: msg.length > 500 ? `${msg.slice(0, 500)}…` : msg,
      sample: rows[0]?.signature,
    });
  }
}

async function applyAgentPatches(patches: AgentPatch[]): Promise<void> {
  if (patches.length === 0) return;
  const sb = getServiceSupabase();
  const merged = new Map<string, AgentPatch>();
  for (const p of patches) {
    const cur = merged.get(p.owner_pubkey);
    if (!cur) {
      merged.set(p.owner_pubkey, { ...p });
    } else {
      // Later events win for time-varying fields; first-seen wins for
      // identity fields like agent_pda / registered_at.
      merged.set(p.owner_pubkey, {
        owner_pubkey: p.owner_pubkey,
        agent_pda: cur.agent_pda ?? p.agent_pda,
        registered_at: cur.registered_at ?? p.registered_at,
        current_policy:
          p.current_policy !== undefined ? p.current_policy : cur.current_policy,
        current_balance:
          p.current_balance !== undefined
            ? p.current_balance
            : cur.current_balance,
        last_event_at:
          (p.last_event_at && cur.last_event_at && p.last_event_at > cur.last_event_at)
            ? p.last_event_at
            : (p.last_event_at ?? cur.last_event_at),
      });
    }
  }
  const rows = Array.from(merged.values()).map((m) => ({
    ...m,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sb
    .from("agents")
    .upsert(rows, { onConflict: "owner_pubkey" });
  if (error) {
    const msg = String(error.message || error);
    log.warn("agents upsert failed", {
      error: msg.length > 500 ? `${msg.slice(0, 500)}…` : msg,
      sample: rows[0]?.owner_pubkey,
    });
  }
}

/** Convert an Anchor `AgentPolicy` into the snake-case shape the UI expects. */
function policyToSnake(p: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!p) return null;
  const root = p.allowedMarketsRoot ?? p.allowed_markets_root;
  let rootHex: string | null = null;
  if (Array.isArray(root)) {
    rootHex = `0x${Buffer.from(root as number[]).toString("hex")}`;
  } else if (typeof root === "string") {
    rootHex = root.startsWith("0x") ? root : `0x${root}`;
  }
  return {
    max_stake_per_window:
      p.maxStakePerWindow !== undefined
        ? String(p.maxStakePerWindow)
        : p.max_stake_per_window !== undefined
          ? String(p.max_stake_per_window)
          : null,
    max_open_positions:
      typeof p.maxOpenPositions === "number"
        ? p.maxOpenPositions
        : typeof p.max_open_positions === "number"
          ? p.max_open_positions
          : null,
    allowed_markets_root_hex: rootHex,
    paused: typeof p.paused === "boolean" ? p.paused : null,
  };
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

  // Pre-decode every Anchor `#[event]` payload so we can interleave them with
  // the ix rows (and key the per-agent feed off them).
  const anchorEvents = decodeKestrelEvents(tx.meta?.logMessages ?? []);

  const marketPatches: MarketSigPatch[] = [];
  const seenMarkets = new Set<string>();
  const eventRows: EventRow[] = [];
  const agentPatches: AgentPatch[] = [];
  const eventTime = blockTime ?? new Date().toISOString();
  // Tracks how many events_seq slots we've used per (signature, ix_index).
  const seqByIx = new Map<number, number>();
  const nextSeq = (ix: number): number => {
    const cur = seqByIx.get(ix) ?? 0;
    seqByIx.set(ix, cur + 1);
    return cur;
  };

  // Errors caused by a require!/check inside `place_bet` ship as Anchor
  // custom errors; map them to a canonical name for the synthetic Blocked row.
  const errorInfo = success ? null : decodeKestrelErrorFromString(errStr);

  for (const { decoded, ixIndex } of candidates) {
    const marketId = extractMarketId(decoded);
    let marketPubkey: string | null = null;
    if (marketId !== null) {
      marketPubkey = marketPda(conns.programId, marketId).toBase58();
      if (!seenMarkets.has(marketPubkey)) {
        seenMarkets.add(marketPubkey);
      }
      marketPatches.push({
        market_pubkey: marketPubkey,
        market_id: marketId,
        patch: buildMarketPatch(signature, blockTime, decoded),
      });
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

    let strikePricePatch: Record<string, unknown> | null = null;
    if (decoded.name === "open_market" && marketPubkey) {
      const strike = await fetchMarketStrikePrice({
        conns,
        cluster,
        marketPda: marketPubkey,
      });
      if (strike !== null) strikePricePatch = { strike_price: strike };
    }

    let closePricePatch: Record<string, unknown> | null = null;
    if (decoded.name === "close_market" && marketPubkey) {
      const closePrice = await fetchMarketClosePrice({
        conns,
        cluster,
        marketPda: marketPubkey,
      });
      if (closePrice !== null) closePricePatch = { close_price: closePrice };
    }

    // Row 0: the raw decoded instruction (kept for back-compat with existing
    // dashboards and queries).
    const baseSeq = nextSeq(ixIndex);
    eventRows.push({
      signature,
      ix_index: ixIndex,
      event_seq: baseSeq,
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

    // Synthetic rows: every place_bet — successful or failed — emits a
    // PlaceBetAttempted card so judges always see the four-column trace, and
    // a PlaceBetBlocked card piggy-backs on the same signature when the bet
    // actually got rejected on-chain.
    if (decoded.name === "place_bet") {
      const intentSide =
        decoded.args.side !== undefined ? String(decoded.args.side) : null;
      const intentAmount =
        decoded.args.amount !== undefined ? String(decoded.args.amount) : null;
      const baseDecision = decision ?? {};
      const attemptedDecision: Record<string, unknown> = {
        ...baseDecision,
        kind: "PlaceBetAttempted",
        intent: { side: intentSide, amount: intentAmount },
        accepted: success,
      };
      eventRows.push({
        signature,
        ix_index: ixIndex,
        event_seq: nextSeq(ixIndex),
        cluster,
        slot,
        block_time: blockTime,
        market_pubkey: marketPubkey,
        market_id: marketId,
        kind: "PlaceBetAttempted",
        actor,
        args: decoded.args,
        accounts: decoded.accounts,
        success,
        err: errStr,
        decision: attemptedDecision,
      });

      if (!success) {
        const blockedDecision: Record<string, unknown> = {
          ...baseDecision,
          kind: "PlaceBetBlocked",
          intent: { side: intentSide, amount: intentAmount },
          accepted: false,
          reason: errorInfo?.name ?? errStr ?? "unknown",
          reason_code: errorInfo?.code ?? null,
          reason_human: errorInfo?.message ?? errStr ?? "Unknown error",
        };
        eventRows.push({
          signature,
          ix_index: ixIndex,
          event_seq: nextSeq(ixIndex),
          cluster,
          slot,
          block_time: blockTime,
          market_pubkey: marketPubkey,
          market_id: marketId,
          kind: "PlaceBetBlocked",
          actor,
          args: decoded.args,
          accounts: decoded.accounts,
          success: false,
          err: errStr,
          decision: blockedDecision,
        });
      }
    }

    // Agents-table upserts derived from ix decode (cheap path; the more
    // detailed policy / balance snapshots come from event decode below).
    const ownerKey = decoded.accounts.owner;
    if (ownerKey) {
      const patch: AgentPatch = {
        owner_pubkey: ownerKey,
        last_event_at: eventTime,
      };
      try {
        patch.agent_pda = agentPda(
          conns.programId,
          new PublicKey(ownerKey),
        ).toBase58();
      } catch {
        /* malformed pubkey — drop */
      }
      if (decoded.name === "register_agent") {
        patch.registered_at = eventTime;
        const policy = (decoded.args.policy ?? null) as Record<string, unknown> | null;
        if (policy) patch.current_policy = policyToSnake(policy);
      }
      agentPatches.push(patch);
    }

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

  // Anchor `#[event]` rows. Each one becomes its own row so the timeline can
  // render them as first-class cards with the canonical PascalCase kind.
  for (const ev of anchorEvents) {
    const marketIdFromEv = eventNumber(ev.data, "market_id") ?? eventNumber(ev.data, "marketId");
    const marketPubkeyFromEv =
      marketIdFromEv !== null
        ? marketPda(conns.programId, marketIdFromEv).toBase58()
        : null;
    if (marketPubkeyFromEv && !seenMarkets.has(marketPubkeyFromEv)) {
      seenMarkets.add(marketPubkeyFromEv);
      marketPatches.push({
        market_pubkey: marketPubkeyFromEv,
        market_id: marketIdFromEv as number,
        patch: { updated_at: new Date().toISOString() },
      });
    }
    const owner =
      eventPubkey(ev.data, "owner") ??
      eventPubkey(ev.data, "by") ??
      fallbackActor;
    const ixIndexForEvent = candidates[0]?.ixIndex ?? 0;
    const seq = nextSeq(ixIndexForEvent);

    eventRows.push({
      signature,
      ix_index: ixIndexForEvent,
      event_seq: seq,
      cluster,
      slot,
      block_time: blockTime,
      market_pubkey: marketPubkeyFromEv,
      market_id: marketIdFromEv,
      kind: ev.name,
      actor: owner,
      args: ev.data,
      accounts: {},
      success: true,
      err: null,
      decision: null,
    });

    // Per-event agents table updates. Carries policy / balance snapshots into
    // public.agents so the /agents pages don't have to scan the event stream.
    if (ev.name === "AgentRegistered") {
      const ownerPk = eventPubkey(ev.data, "owner");
      const agentPk = eventPubkey(ev.data, "agent");
      if (ownerPk) {
        const patch: AgentPatch = {
          owner_pubkey: ownerPk,
          agent_pda: agentPk ?? undefined,
          registered_at: eventTime,
          last_event_at: eventTime,
          current_policy: policyToSnake(
            ev.data.policy as Record<string, unknown> | undefined,
          ),
        };
        agentPatches.push(patch);
      }
    } else if (ev.name === "PolicyUpdated") {
      const ownerPk = eventPubkey(ev.data, "owner");
      const agentPk = eventPubkey(ev.data, "agent");
      if (ownerPk) {
        agentPatches.push({
          owner_pubkey: ownerPk,
          agent_pda: agentPk ?? undefined,
          last_event_at: eventTime,
          current_policy: policyToSnake(
            (ev.data.new ?? ev.data.policy) as Record<string, unknown> | undefined,
          ),
        });
      }
    } else if (ev.name === "BetPlaced" || ev.name === "AgentSettled") {
      const ownerPk = eventPubkey(ev.data, "owner");
      if (ownerPk) {
        agentPatches.push({
          owner_pubkey: ownerPk,
          last_event_at: eventTime,
        });
      }
    } else if (ev.name === "Withdrawn") {
      const ownerPk = eventPubkey(ev.data, "owner");
      if (ownerPk) {
        agentPatches.push({
          owner_pubkey: ownerPk,
          last_event_at: eventTime,
        });
      }
    }
  }

  // Order matters: write markets first to satisfy the FK in events, then
  // events, then the agents roll-up.
  await applyMarketPatches(marketPatches);
  await insertEvents(eventRows);
  await applyAgentPatches(agentPatches);

  log.debug("ingested", {
    cluster,
    signature,
    decoded: candidates.length,
    events: anchorEvents.length,
    rows: eventRows.length,
  });

  return { decoded: candidates.length, written: eventRows.length, skipped: 0 };
}

export { accountKeysHelper };

// Exported only for tests.
function accountKeysHelper(): typeof PublicKey {
  return PublicKey;
}
