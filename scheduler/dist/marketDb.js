"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMarketDbEnv = loadMarketDbEnv;
exports.getMarketDb = getMarketDb;
exports.patchMarketRow = patchMarketRow;
const supabase_js_1 = require("@supabase/supabase-js");
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function jitter(ms) {
    return Math.round(ms * (0.7 + Math.random() * 0.6));
}
function retryingFetch(fetchImpl) {
    return async (input, init) => {
        const maxAttempts = 6;
        let lastErr = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const res = await fetchImpl(input, init);
                if ([429, 502, 503, 504, 520].includes(res.status) && attempt < maxAttempts - 1) {
                    await sleep(jitter(250 * 2 ** attempt));
                    continue;
                }
                return res;
            }
            catch (err) {
                lastErr = err;
                if (attempt >= maxAttempts - 1)
                    break;
                await sleep(jitter(250 * 2 ** attempt));
            }
        }
        throw lastErr ?? new Error("retryingFetch: exhausted attempts");
    };
}
function loadMarketDbEnv() {
    const url = process.env.KESTREL_SUPABASE_URL?.trim();
    const key = process.env.KESTREL_SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key)
        return null;
    return { url, serviceRoleKey: key };
}
let cached = null;
function getMarketDb() {
    if (cached)
        return cached;
    const env = loadMarketDbEnv();
    if (!env)
        return null;
    cached = (0, supabase_js_1.createClient)(env.url, env.serviceRoleKey, {
        auth: { persistSession: false },
        global: { fetch: retryingFetch(fetch) },
    });
    return cached;
}
async function patchMarketRow(patch) {
    const sb = getMarketDb();
    if (!sb)
        return;
    const row = { updated_at: new Date().toISOString(), ...patch };
    const { error } = await sb
        .from("markets")
        .upsert([row], { onConflict: "market_pubkey" });
    if (error) {
        throw new Error(`markets upsert failed: ${error.message}`);
    }
}
