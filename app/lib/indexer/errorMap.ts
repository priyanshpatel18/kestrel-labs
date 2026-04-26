import { KESTREL_IDL } from "./decode";

export interface KestrelErrorInfo {
  code: number;
  name: string;
  message: string;
}

const idlErrors = ((KESTREL_IDL as { errors?: Array<{ code: number; name: string; msg?: string }> }).errors ?? []) as Array<{
  code: number;
  name: string;
  msg?: string;
}>;

const byCode = new Map<number, KestrelErrorInfo>();
for (const e of idlErrors) {
  byCode.set(e.code, {
    code: e.code,
    name: e.name,
    message: e.msg ?? e.name,
  });
}

/**
 * Map a `tx.meta.err` value (typed `unknown` from the JSON-RPC response) into
 * a Kestrel-named error if the failure was a custom Anchor error coming from
 * our program. Returns `null` when the failure was not a Kestrel custom error
 * (system error, account-not-writable, etc.).
 */
export function decodeKestrelError(err: unknown): KestrelErrorInfo | null {
  if (!err) return null;

  // Anchor / web3.js typical shape: { InstructionError: [ix_index, { Custom: 6011 }] }
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    const ie = obj.InstructionError;
    if (Array.isArray(ie) && ie.length === 2) {
      const inner = ie[1];
      if (inner && typeof inner === "object") {
        const c = (inner as Record<string, unknown>).Custom;
        if (typeof c === "number") return byCode.get(c) ?? null;
        if (typeof c === "string") {
          const n = Number(c);
          if (Number.isFinite(n)) return byCode.get(n) ?? null;
        }
      }
    }
  }

  // Stringified form often shipped through logs: search for `Custom: <n>`.
  if (typeof err === "string") {
    const m = err.match(/Custom[":\s]+(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return byCode.get(n) ?? null;
    }
  }

  return null;
}

export function decodeKestrelErrorFromString(s: string | null): KestrelErrorInfo | null {
  if (!s) return null;
  try {
    return decodeKestrelError(JSON.parse(s));
  } catch {
    return decodeKestrelError(s);
  }
}

export function listKestrelErrors(): KestrelErrorInfo[] {
  return Array.from(byCode.values()).sort((a, b) => a.code - b.code);
}
