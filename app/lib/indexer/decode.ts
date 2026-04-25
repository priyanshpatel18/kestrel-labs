import { BorshInstructionCoder, BN, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

import idlJson from "../../../target/idl/kestrel.json";

export const KESTREL_IDL = idlJson as unknown as Idl;
export const KESTREL_PROGRAM_ID = new PublicKey(
  (idlJson as { address: string }).address,
);

const coder = new BorshInstructionCoder(KESTREL_IDL);

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

function normalizeArgs(value: unknown): Record<string, unknown> {
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
