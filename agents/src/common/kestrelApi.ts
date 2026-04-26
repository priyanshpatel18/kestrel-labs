/**
 * Optional HTTP client for the Kestrel Next.js Agent API (`/api/v1/...`).
 *
 * Set `KESTREL_API_BASE_URL` (e.g. `http://localhost:3000`) so trading agents
 * build txs through the same REST surface you test in the browser before prod.
 * When unset, agents keep using Anchor `.methods` directly.
 */

import { BN } from "@coral-xyz/anchor";
import { Transaction } from "@solana/web3.js";

import type { AgentConnections } from "./connections";
import { sendBaseRefreshedTx, sendRefreshedTx } from "./tx";

function normalizeApiBaseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return t.replace(/\/+$/, "");
}

/** Non-null when `KESTREL_API_BASE_URL` is set (trimmed, no trailing slash). */
export function getKestrelApiBaseUrl(conns: AgentConnections): string | null {
  return normalizeApiBaseUrl(conns.env.kestrelApiBaseUrl);
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`kestrel API ${path}: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = (json as { error?: string })?.error ?? text.slice(0, 200);
    throw new Error(`kestrel API ${path}: ${res.status} ${err}`);
  }
  return json as T;
}

function decodeTxB64(b64: string): Transaction {
  return Transaction.from(Buffer.from(b64, "base64"));
}

interface ApiTxResponse {
  transaction: string;
}

export async function placeBetViaApi(params: {
  conns: AgentConnections;
  marketId: number;
  side: "yes" | "no";
  amount: BN;
}): Promise<string> {
  const base = getKestrelApiBaseUrl(params.conns);
  if (!base) throw new Error("placeBetViaApi: KESTREL_API_BASE_URL not set");

  const pubkey = params.conns.signerKeypair.publicKey.toBase58();
  const json = await postJson<ApiTxResponse>(base, "/api/v1/bet/place", {
    pubkey,
    marketId: params.marketId,
    side: params.side,
    amount: Number(params.amount.toString()),
  });
  const tx = decodeTxB64(json.transaction);
  return sendRefreshedTx(
    params.conns.erConnection,
    tx,
    [params.conns.signerKeypair],
  );
}

export async function cancelBetViaApi(params: {
  conns: AgentConnections;
  marketId: number;
}): Promise<string> {
  const base = getKestrelApiBaseUrl(params.conns);
  if (!base) throw new Error("cancelBetViaApi: KESTREL_API_BASE_URL not set");

  const pubkey = params.conns.signerKeypair.publicKey.toBase58();
  const json = await postJson<ApiTxResponse>(base, "/api/v1/bet/cancel", {
    pubkey,
    marketId: params.marketId,
  });
  const tx = decodeTxB64(json.transaction);
  return sendRefreshedTx(
    params.conns.erConnection,
    tx,
    [params.conns.signerKeypair],
  );
}

export async function registerAgentViaApi(params: {
  conns: AgentConnections;
  maxStakePerWindow: BN;
  maxOpenPositions: number;
}): Promise<string> {
  const base = getKestrelApiBaseUrl(params.conns);
  if (!base) throw new Error("registerAgentViaApi: KESTREL_API_BASE_URL not set");

  const pubkey = params.conns.signerKeypair.publicKey.toBase58();
  const json = await postJson<ApiTxResponse>(base, "/api/v1/agent/register", {
    pubkey,
    maxStakePerWindow: Number(params.maxStakePerWindow.toString()),
    maxOpenPositions: params.maxOpenPositions,
  });
  const tx = decodeTxB64(json.transaction);
  return sendBaseRefreshedTx(
    params.conns.baseConnection,
    tx,
    [params.conns.signerKeypair],
  );
}

export async function depositViaApi(params: {
  conns: AgentConnections;
  amount: BN;
}): Promise<string> {
  const base = getKestrelApiBaseUrl(params.conns);
  if (!base) throw new Error("depositViaApi: KESTREL_API_BASE_URL not set");

  const pubkey = params.conns.signerKeypair.publicKey.toBase58();
  const json = await postJson<ApiTxResponse>(base, "/api/v1/agent/deposit", {
    pubkey,
    amount: Number(params.amount.toString()),
  });
  const tx = decodeTxB64(json.transaction);
  return sendBaseRefreshedTx(
    params.conns.baseConnection,
    tx,
    [params.conns.signerKeypair],
  );
}
