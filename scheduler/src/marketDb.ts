import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface MarketDbEnv {
  url: string;
  serviceRoleKey: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number): number {
  return Math.round(ms * (0.7 + Math.random() * 0.6));
}

function retryingFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input: any, init?: any) => {
    const maxAttempts = 6;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetchImpl(input, init);
        if ([429, 502, 503, 504, 520].includes(res.status) && attempt < maxAttempts - 1) {
          await sleep(jitter(250 * 2 ** attempt));
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt >= maxAttempts - 1) break;
        await sleep(jitter(250 * 2 ** attempt));
      }
    }

    throw lastErr ?? new Error("retryingFetch: exhausted attempts");
  };
}

export function loadMarketDbEnv(): MarketDbEnv | null {
  const url = process.env.KESTREL_SUPABASE_URL?.trim();
  const key = process.env.KESTREL_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, serviceRoleKey: key };
}

let cached: SupabaseClient | null = null;

export function getMarketDb(): SupabaseClient | null {
  if (cached) return cached;
  const env = loadMarketDbEnv();
  if (!env) return null;
  cached = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: retryingFetch(fetch) },
  });
  return cached;
}

export async function patchMarketRow(patch: {
  market_id: number;
  market_pubkey: string;
  status?: string;
  strike_price?: number;
  close_price?: number;
  open_ts?: number;
  close_ts?: number;
  winner?: string | null;
  created_sig?: string;
  delegated_sig?: string;
  opened_sig?: string;
  closed_sig?: string;
  settled_sig?: string;
  undelegated_sig?: string;
  updated_at?: string;
}): Promise<void> {
  const sb = getMarketDb();
  if (!sb) return;
  const row = { updated_at: new Date().toISOString(), ...patch };
  const { error } = await sb
    .from("markets")
    .upsert([row], { onConflict: "market_pubkey" });
  if (error) {
    throw new Error(`markets upsert failed: ${error.message}`);
  }
}

