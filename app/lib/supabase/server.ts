import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;
let cachedRead: SupabaseClient | null = null;

function stripQuotes(v: string): string {
  // Support values written as KEY="..." in .env (some parsers keep quotes).
  return v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number): number {
  return Math.round(ms * (0.7 + Math.random() * 0.6));
}

function retryingFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const maxAttempts = 6;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetchImpl(input, init);
        // Supabase is behind Cloudflare; transient failures show up as 520/5xx.
        if ([429, 502, 503, 504, 520].includes(res.status) && attempt < maxAttempts - 1) {
          const backoff = jitter(250 * 2 ** attempt);
          await sleep(backoff);
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt >= maxAttempts - 1) break;
        const backoff = jitter(250 * 2 ** attempt);
        await sleep(backoff);
      }
    }

    throw lastErr ?? new Error("retryingFetch: exhausted attempts");
  };
}

/**
 * Server-side Supabase client using the service-role key. Bypasses RLS so the
 * indexer worker can write events / markets / cursors.
 */
export function getServiceSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase service config missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  cached = createClient(url, stripQuotes(key), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingFetch(fetch) },
  });
  return cached;
}

/**
 * Read-only Supabase client for server components / route handlers. Uses the
 * anon key and goes through RLS (which is set up to allow public select).
 */
export function getReadSupabase(): SupabaseClient {
  if (cachedRead) return cachedRead;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase public config missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  cachedRead = createClient(url, stripQuotes(key), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: retryingFetch(fetch) },
  });
  return cachedRead;
}
