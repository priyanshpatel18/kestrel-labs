type Level = "debug" | "info" | "warn" | "error";

const levelOrder: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): Level {
  const v = (process.env.KESTREL_INDEXER_LOG_LEVEL || "info").toLowerCase();
  return (["debug", "info", "warn", "error"] as Level[]).includes(v as Level)
    ? (v as Level)
    : "info";
}

function emit(level: Level, msg: string, data?: Record<string, unknown>): void {
  if (levelOrder[level] < levelOrder[currentLevel()]) return;
  const stamp = new Date().toISOString();
  const prefix = `[${stamp}] indexer ${level.toUpperCase()}`;
  if (data) {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](`${prefix} ${msg}`, data);
  } else {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](`${prefix} ${msg}`);
  }
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) =>
    emit("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) =>
    emit("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) =>
    emit("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) =>
    emit("error", msg, data),
};
