// Next 16 instrumentation hook: runs once on server boot. We use it to start
// the long-lived Kestrel trace/event indexer when KESTREL_INDEXER_ENABLED=true
// and the runtime is Node (skip Edge / browser / build).

export async function register(): Promise<void> {
  // In Next dev/prod Node runtime this is usually unset. On Edge it becomes "edge".
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (process.env.KESTREL_INDEXER_ENABLED !== "true") return;

  try {
    const { startIndexer } = await import("./lib/indexer/worker");
    await startIndexer();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[indexer] failed to start",
      err instanceof Error ? err.message : String(err),
    );
  }
}
