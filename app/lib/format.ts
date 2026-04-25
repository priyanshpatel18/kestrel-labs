export function shortPubkey(pk: string | null | undefined, head = 4, tail = 4): string {
  if (!pk) return "—";
  if (pk.length <= head + tail + 1) return pk;
  return `${pk.slice(0, head)}…${pk.slice(-tail)}`;
}

export function explorerTxUrl(sig: string, cluster = "devnet"): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
}

export function explorerAddressUrl(addr: string, cluster = "devnet"): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${cluster}`;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatTimeIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const STRIKE_DECIMALS = 8;

export function formatStrike(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  // Pyth/oracle quotes are typically scaled. We default to 1e8.
  const scaled = n / Math.pow(10, STRIKE_DECIMALS);
  if (Math.abs(scaled) < 1) return scaled.toFixed(2);
  return scaled.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function formatUsdc(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  // USDC has 6 decimals.
  return (n / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const delta = Math.round((now - then) / 1000);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h ago`;
  return `${Math.round(delta / 86400)}d ago`;
}
