"use client";

import { useEffect, useRef, useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/types";

import { EventCard } from "./EventCard";

const POLL_FALLBACK_MS = 5_000;

export interface RealtimeTimelineProps {
  /** Filter to one market window. Mutually exclusive with `actor`. */
  marketId?: number;
  /** Filter to one agent owner pubkey. Mutually exclusive with `marketId`. */
  actor?: string;
  initialEvents: EventRow[];
  /** Override the empty-state copy (e.g. for the per-agent view). */
  emptyHint?: string;
}

export function RealtimeTimeline({
  marketId,
  actor,
  initialEvents,
  emptyHint,
}: RealtimeTimelineProps) {
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

    const channelKey = marketId
      ? `events:market_${marketId}`
      : actor
        ? `events:actor_${actor}`
        : `events:all`;
    const filter = marketId
      ? `market_id=eq.${marketId}`
      : actor
        ? `actor=eq.${actor}`
        : undefined;

    const channel = sb
      .channel(channelKey)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          ...(filter ? { filter } : {}),
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
        let q = sb
          .from("events")
          .select("*")
          .order("inserted_at", { ascending: true })
          .limit(500);
        if (marketId !== undefined) q = q.eq("market_id", marketId);
        if (actor) q = q.eq("actor", actor);
        const { data } = await q;
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
  }, [marketId, actor]);

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {emptyHint ??
          "No events yet. Indexer is running — they will appear here as soon as the scheduler/agents act."}
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
