"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * When the Supabase indexer writes `markets`, re-run server components on the
 * current route so `/`, `/markets`, `/markets/[id]`, `/stats`, etc. pick up new
 * rows without a manual reload. Debounced to avoid refresh storms during bulk upserts.
 */
export function IndexerMarketsRouterRefresh() {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let supabase: ReturnType<typeof getBrowserSupabase>;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        router.refresh();
      }, 450);
    };

    const channel = supabase
      .channel("indexer-markets-router-refresh")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "markets" },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
