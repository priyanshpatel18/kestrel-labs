"use strict";
/**
 * Optional HTTP client for the Kestrel Next.js Agent API (`/api/v1/...`).
 *
 * Set `KESTREL_API_BASE_URL` (e.g. `http://localhost:3000`) so trading agents
 * build txs through the same REST surface you test in the browser before prod.
 * When unset, agents keep using Anchor `.methods` directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKestrelApiBaseUrl = getKestrelApiBaseUrl;
exports.placeBetViaApi = placeBetViaApi;
exports.cancelBetViaApi = cancelBetViaApi;
exports.registerAgentViaApi = registerAgentViaApi;
exports.depositViaApi = depositViaApi;
const web3_js_1 = require("@solana/web3.js");
const tx_1 = require("./tx");
function normalizeApiBaseUrl(raw) {
    if (!raw)
        return null;
    const t = raw.trim();
    if (!t)
        return null;
    return t.replace(/\/+$/, "");
}
/** Non-null when `KESTREL_API_BASE_URL` is set (trimmed, no trailing slash). */
function getKestrelApiBaseUrl(conns) {
    return normalizeApiBaseUrl(conns.env.kestrelApiBaseUrl);
}
async function postJson(baseUrl, path, body) {
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
        json = text ? JSON.parse(text) : {};
    }
    catch {
        throw new Error(`kestrel API ${path}: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
        const err = json?.error ?? text.slice(0, 200);
        throw new Error(`kestrel API ${path}: ${res.status} ${err}`);
    }
    return json;
}
function decodeTxB64(b64) {
    return web3_js_1.Transaction.from(Buffer.from(b64, "base64"));
}
async function placeBetViaApi(params) {
    const base = getKestrelApiBaseUrl(params.conns);
    if (!base)
        throw new Error("placeBetViaApi: KESTREL_API_BASE_URL not set");
    const pubkey = params.conns.signerKeypair.publicKey.toBase58();
    const json = await postJson(base, "/api/v1/bet/place", {
        pubkey,
        marketId: params.marketId,
        side: params.side,
        amount: Number(params.amount.toString()),
    });
    const tx = decodeTxB64(json.transaction);
    return (0, tx_1.sendRefreshedTx)(params.conns.erConnection, tx, [params.conns.signerKeypair]);
}
async function cancelBetViaApi(params) {
    const base = getKestrelApiBaseUrl(params.conns);
    if (!base)
        throw new Error("cancelBetViaApi: KESTREL_API_BASE_URL not set");
    const pubkey = params.conns.signerKeypair.publicKey.toBase58();
    const json = await postJson(base, "/api/v1/bet/cancel", {
        pubkey,
        marketId: params.marketId,
    });
    const tx = decodeTxB64(json.transaction);
    return (0, tx_1.sendRefreshedTx)(params.conns.erConnection, tx, [params.conns.signerKeypair]);
}
async function registerAgentViaApi(params) {
    const base = getKestrelApiBaseUrl(params.conns);
    if (!base)
        throw new Error("registerAgentViaApi: KESTREL_API_BASE_URL not set");
    const pubkey = params.conns.signerKeypair.publicKey.toBase58();
    const json = await postJson(base, "/api/v1/agent/register", {
        pubkey,
        maxStakePerWindow: Number(params.maxStakePerWindow.toString()),
        maxOpenPositions: params.maxOpenPositions,
    });
    const tx = decodeTxB64(json.transaction);
    return (0, tx_1.sendBaseRefreshedTx)(params.conns.baseConnection, tx, [params.conns.signerKeypair]);
}
async function depositViaApi(params) {
    const base = getKestrelApiBaseUrl(params.conns);
    if (!base)
        throw new Error("depositViaApi: KESTREL_API_BASE_URL not set");
    const pubkey = params.conns.signerKeypair.publicKey.toBase58();
    const json = await postJson(base, "/api/v1/agent/deposit", {
        pubkey,
        amount: Number(params.amount.toString()),
    });
    const tx = decodeTxB64(json.transaction);
    return (0, tx_1.sendBaseRefreshedTx)(params.conns.baseConnection, tx, [params.conns.signerKeypair]);
}
