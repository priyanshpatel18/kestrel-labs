import { getServiceSupabase } from "../supabase/server";

import type { Cluster } from "./connections";

export interface Cursor {
  cluster: Cluster;
  lastSignature: string | null;
  lastSlot: number | null;
}

export async function loadCursor(cluster: Cluster): Promise<Cursor> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("cursors")
    .select("cluster, last_signature, last_slot")
    .eq("cluster", cluster)
    .maybeSingle();
  if (error) throw error;
  return {
    cluster,
    lastSignature: data?.last_signature ?? null,
    lastSlot: data?.last_slot ?? null,
  };
}

export async function saveCursor(
  cluster: Cluster,
  lastSignature: string,
  lastSlot: number | null,
): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb
    .from("cursors")
    .upsert(
      {
        cluster,
        last_signature: lastSignature,
        last_slot: lastSlot,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cluster" },
    );
  if (error) throw error;
}
