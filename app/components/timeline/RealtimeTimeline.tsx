"use client";

import { useEffect, useRef, useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/types";

import { EventCard } from "./EventCard";

const POLL_FALLBACK_MS = 5_000;

export function RealtimeTimeline({
  marketId,
  initialEvents,
}: {
  marketId: number;
  initialEvents: EventRow[];
}) {
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const seenIds = useRef<Set<string>>(new Set(initialEvents.map((e) => e.id)));
  const realtimeOk = useRef<boolean>(false);

  useEffect(() => {
    seenIds.current = new Set(initialEvents.map((e) => e.id));
    setEvents(initialEvents);
  }, [initialEvents]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: NodeJS.Timeout | null = null;

    const sb = getBrowserSupabase();

    const append = (row: EventRow) => {
      if (seenIds.current.has(row.id)) return;
      seenIds.current.add(row.id);
      setEvents((prev) => {
        const next = [...prev, row];
        next.sort((a, b) =>
          (a.block_time ?? a.inserted_at).localeCompare(
            b.block_time ?? b.inserted_at,
          ),
        );
        return next;
      });
    };

    const channel = sb
      .channel(`events:market_${marketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `market_id=eq.${marketId}`,
        },
        (payload) => {
          if (cancelled) return;
          realtimeOk.current = true;
          append(payload.new as EventRow);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeOk.current = true;
        }
      });

    const poll = async () => {
      if (cancelled) return;
      if (realtimeOk.current) {
        pollTimer = setTimeout(poll, POLL_FALLBACK_MS * 4);
        return;
      }
      try {
        const { data } = await sb
          .from("events")
          .select("*")
          .eq("market_id", marketId)
          .order("inserted_at", { ascending: true })
          .limit(500);
        if (data && !cancelled) {
          for (const row of data as EventRow[]) append(row);
        }
      } catch {
        /* ignore */
      }
      pollTimer = setTimeout(poll, POLL_FALLBACK_MS);
    };
    pollTimer = setTimeout(poll, POLL_FALLBACK_MS);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      sb.removeChannel(channel);
    };
  }, [marketId]);

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No events yet for this market. Indexer is running — they will appear
        here as soon as the scheduler/agents act.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {events.map((ev) => (
        <EventCard key={ev.id} event={ev} />
      ))}
    </div>
  );
}
