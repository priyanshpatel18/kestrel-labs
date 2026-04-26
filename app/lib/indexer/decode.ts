import { BorshEventCoder, BorshInstructionCoder, BN, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import idlJson from "../idl/kestrel.json";

export const KESTREL_IDL = idlJson as unknown as Idl;
export const KESTREL_PROGRAM_ID = new PublicKey(
  (idlJson as { address: string }).address,
);

const coder = new BorshInstructionCoder(KESTREL_IDL);
const eventCoder = new BorshEventCoder(KESTREL_IDL);

/** Anchor program-data prefix that tags emitted #[event]s in the log stream. */
const PROGRAM_DATA_LOG_PREFIX = "Program data: ";

export interface DecodedKestrelEvent {
  /** Canonical PascalCase event name from the IDL (e.g. `BetPlaced`). */
  name: string;
  /** Decoded event fields, normalised through `normalizeArgs`. */
  data: Record<string, unknown>;
  /** Order of this event in `logMessages` (used for the `event_seq` column). */
  logIndex: number;
}

/**
 * Anchor emits `#[event]`s as base64-encoded payloads on lines of the form
 * `Program data: <b64>`. We scan the entire log stream and decode every
 * Kestrel event we recognise; non-Kestrel events return `null` from the coder
 * and are silently skipped.
 */
export function decodeKestrelEvents(
  logs: ReadonlyArray<string> | null | undefined,
): DecodedKestrelEvent[] {
  if (!logs || logs.length === 0) return [];
  const out: DecodedKestrelEvent[] = [];
  for (let i = 0; i < logs.length; i++) {
    const line = logs[i];
    if (!line || !line.startsWith(PROGRAM_DATA_LOG_PREFIX)) continue;
    const payload = line.slice(PROGRAM_DATA_LOG_PREFIX.length).trim();
    if (!payload) continue;
    let decoded: ReturnType<BorshEventCoder["decode"]> | null = null;
    try {
      decoded = eventCoder.decode(payload);
    } catch {
      decoded = null;
    }
    if (!decoded) continue;
    const name = canonicalEventName(decoded.name);
    out.push({
      name,
      data: normalizeArgs(decoded.data as unknown),
      logIndex: i,
    });
  }
  return out;
}

/**
 * Anchor 0.30 lower-cases the first character of event names in some code
 * paths (`betPlaced`) but our IDL ships them PascalCase. We normalise to
 * PascalCase so the indexer's `kind` column always uses the documented form.
 */
function canonicalEventName(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const idlAccountsByIxName: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const ix of (KESTREL_IDL as any).instructions ?? []) {
    out[ix.name] = (ix.accounts ?? []).map((a: any) => a.name);
  }
  return out;
})();

export interface DecodedKestrelIx {
  name: string;
  args: Record<string, unknown>;
  accounts: Record<string, string>;
  accountList: string[];
}

export function decodeKestrelIx(
  data: string | Buffer,
  accounts: ReadonlyArray<PublicKey | string>,
): DecodedKestrelIx | null {
  try {
    const buf =
      typeof data === "string" ? Buffer.from(bs58.decode(data)) : data;
    const decoded = coder.decode(buf);
    if (!decoded) return null;
    const { name, data: rawArgs } = decoded;
    const accountList: string[] = accounts.map((a) =>
      typeof a === "string" ? a : a.toBase58(),
    );
    const names = idlAccountsByIxName[name] ?? [];
    const accountMap: Record<string, string> = {};
    names.forEach((n, i) => {
      const v = accountList[i];
      if (v !== undefined) accountMap[n] = v;
    });
    return {
      name,
      args: normalizeArgs(rawArgs),
      accounts: accountMap,
      accountList,
    };
  } catch {
    return null;
  }
}

export function normalizeArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = normalizeValue(v);
  }
  return out;
}

function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (BN.isBN(v)) return (v as BN).toString();
  if (v instanceof PublicKey) return v.toBase58();
  if (Buffer.isBuffer(v))
    return `0x${(v as Buffer).toString("hex")}`;
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>);
    if (
      keys.length === 1 &&
      typeof (v as Record<string, unknown>)[keys[0]] === "object" &&
      Object.keys(
        (v as Record<string, Record<string, unknown>>)[keys[0]],
      ).length === 0
    ) {
      // Anchor-encoded enum: { yes: {} } -> "yes".
      return keys[0];
    }
    return normalizeArgs(v);
  }
  return v;
}

export const KESTREL_INSTRUCTIONS = Object.keys(idlAccountsByIxName);
