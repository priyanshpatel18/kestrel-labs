import {
  Connection,
  ConfirmedSignatureInfo,
  PublicKey,
} from "@solana/web3.js";

import {
  Cluster,
  IndexerConnections,
  buildIndexerConnections,
  clusterConnection,
  loadIndexerEnv,
} from "./connections";
import { loadCursor, saveCursor } from "./cursors";
import { ingestSignature } from "./ingest";
import { log } from "./log";

interface WorkerHandle {
  stop: () => Promise<void>;
}

const SINGLETON_KEY = Symbol.for("kestrel.indexer.worker");
type Globals = typeof globalThis & { [SINGLETON_KEY]?: WorkerHandle };

interface ClusterState {
  cluster: Cluster;
  conn: Connection;
  programId: PublicKey;
  subscriptionId: number | null;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempt: number;
  inflight: Set<string>;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const PROCESS_CONCURRENCY = 4;

async function processQueue<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency = PROCESS_CONCURRENCY,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }).map(
    async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        await worker(items[idx]).catch((err) => {
          log.warn("worker item failed", {
            err: String((err as Error)?.message || err),
          });
        });
      }
    },
  );
  await Promise.all(runners);
}

async function backfillCluster(
  conns: IndexerConnections,
  state: ClusterState,
): Promise<void> {
  const conn = state.conn;
  const programId = state.programId;
  const cursor = await loadCursor(state.cluster);
  const limit = conns.env.backfillLimit;

  log.info("backfill: start", {
    cluster: state.cluster,
    until: cursor.lastSignature ?? null,
    limit,
  });

  let before: string | undefined;
  const collected: ConfirmedSignatureInfo[] = [];
  while (collected.length < limit) {
    let page: ConfirmedSignatureInfo[];
    try {
      page = await conn.getSignaturesForAddress(programId, {
        before,
        until: cursor.lastSignature ?? undefined,
        limit: Math.min(1000, limit - collected.length),
      });
    } catch (err) {
      log.warn("backfill: getSignaturesForAddress failed", {
        cluster: state.cluster,
        err: String((err as Error)?.message),
      });
      break;
    }
    if (page.length === 0) break;
    collected.push(...page);
    before = page[page.length - 1].signature;
    if (page.length < 1000) break;
  }

  // Process oldest-first so cursors advance monotonically.
  collected.reverse();

  let lastSig: string | null = null;
  let lastSlot: number | null = null;

  await processQueue(collected, async (info) => {
    if (state.inflight.has(info.signature)) return;
    state.inflight.add(info.signature);
    try {
      await ingestSignature(conns, state.cluster, info.signature);
      lastSig = info.signature;
      lastSlot = info.slot ?? null;
    } finally {
      state.inflight.delete(info.signature);
    }
  });

  if (lastSig) {
    await saveCursor(state.cluster, lastSig, lastSlot);
  }

  log.info("backfill: done", {
    cluster: state.cluster,
    processed: collected.length,
  });
}

async function handleSignature(
  conns: IndexerConnections,
  state: ClusterState,
  signature: string,
  slot: number | null,
): Promise<void> {
  if (state.inflight.has(signature)) return;
  state.inflight.add(signature);
  try {
    await ingestSignature(conns, state.cluster, signature);
    await saveCursor(state.cluster, signature, slot);
  } catch (err) {
    log.warn("ingest failed", {
      cluster: state.cluster,
      signature,
      err: String((err as Error)?.message || err),
    });
  } finally {
    state.inflight.delete(signature);
  }
}

async function attachLogsSubscription(
  conns: IndexerConnections,
  state: ClusterState,
): Promise<void> {
  const conn = state.conn;
  const programId = state.programId;

  try {
    state.subscriptionId = conn.onLogs(
      programId,
      (logs, ctx) => {
        if (logs.err) return;
        void handleSignature(
          conns,
          state,
          logs.signature,
          ctx?.slot ?? null,
        );
      },
      "confirmed",
    );
    state.reconnectAttempt = 0;
    log.info("logs subscribed", {
      cluster: state.cluster,
      sub_id: state.subscriptionId,
    });
  } catch (err) {
    log.warn("logs subscribe failed", {
      cluster: state.cluster,
      err: String((err as Error)?.message),
    });
    scheduleReconnect(conns, state);
  }
}

function scheduleReconnect(
  conns: IndexerConnections,
  state: ClusterState,
): void {
  if (state.reconnectTimer) return;
  const attempt = state.reconnectAttempt++;
  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** attempt,
    RECONNECT_MAX_MS,
  );
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    log.info("reconnect: attempt", {
      cluster: state.cluster,
      attempt,
      delay_ms: delay,
    });
    try {
      // Catch up any sigs we missed while disconnected.
      await backfillCluster(conns, state);
    } catch {
      /* logged inside */
    }
    await attachLogsSubscription(conns, state);
  }, delay);
}

export async function startIndexer(): Promise<WorkerHandle> {
  const g = globalThis as Globals;
  const existing = g[SINGLETON_KEY];
  if (existing) {
    log.debug("startIndexer: reusing existing worker");
    return existing;
  }

  // Hard requirement: without Supabase service config we have nowhere to write.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    log.warn(
      "indexer disabled: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing",
    );
    const noop: WorkerHandle = { stop: async () => {} };
    g[SINGLETON_KEY] = noop;
    return noop;
  }

  const env = loadIndexerEnv();
  const conns = buildIndexerConnections(env);
  log.info("indexer boot", {
    program_id: conns.programId.toBase58(),
    base_rpc: env.baseRpcUrl,
    er_rpc: env.erRpcUrl,
  });

  const states: ClusterState[] = (["base", "er"] as Cluster[]).map(
    (cluster) => ({
      cluster,
      conn: clusterConnection(conns, cluster),
      programId: conns.programId,
      subscriptionId: null,
      reconnectTimer: null,
      reconnectAttempt: 0,
      inflight: new Set<string>(),
    }),
  );

  for (const state of states) {
    try {
      await backfillCluster(conns, state);
    } catch (err) {
      log.warn("backfill: failed", {
        cluster: state.cluster,
        err: String((err as Error)?.message),
      });
    }
    await attachLogsSubscription(conns, state);
  }

  const handle: WorkerHandle = {
    async stop() {
      for (const state of states) {
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        if (state.subscriptionId !== null) {
          try {
            await state.conn.removeOnLogsListener(state.subscriptionId);
          } catch {
            /* ignore */
          }
        }
      }
      delete g[SINGLETON_KEY];
      log.info("indexer stopped");
    },
  };
  g[SINGLETON_KEY] = handle;
  return handle;
}
