"use client";

import { useMemo, useState } from "react";

import { EventCard } from "@/components/timeline/EventCard";
import { RealtimeTimeline } from "@/components/timeline/RealtimeTimeline";
import { cn } from "@/lib/utils";
import { formatTimeIso, formatUsdc } from "@/lib/format";
import type { EventRow } from "@/lib/types";

type TabKey = "trace" | "policy" | "bets";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "trace", label: "Trace" },
  { key: "policy", label: "Policy history" },
  { key: "bets", label: "Bets" },
];

interface AgentDetailTabsProps {
  ownerPubkey: string;
  initialEvents: EventRow[];
}

export function AgentDetailTabs({
  ownerPubkey,
  initialEvents,
}: AgentDetailTabsProps) {
  const [active, setActive] = useState<TabKey>("trace");

  const policyEvents = useMemo(
    () =>
      initialEvents
        .filter(
          (ev) => ev.kind === "PolicyUpdated" || ev.kind === "update_policy",
        )
        .sort((a, b) =>
          (b.block_time ?? b.inserted_at).localeCompare(
            a.block_time ?? a.inserted_at,
          ),
        ),
    [initialEvents],
  );

  const betEvents = useMemo(
    () =>
      initialEvents
        .filter((ev) =>
          ["BetPlaced", "PlaceBetAttempted", "PlaceBetBlocked", "place_bet"].includes(
            ev.kind,
          ),
        )
        .sort((a, b) =>
          (b.block_time ?? b.inserted_at).localeCompare(
            a.block_time ?? a.inserted_at,
          ),
        ),
    [initialEvents],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              active === t.key
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "trace" && (
        <RealtimeTimeline
          actor={ownerPubkey}
          initialEvents={initialEvents}
          emptyHint="No events yet for this agent. Indexer is running — actions will stream in here."
        />
      )}

      {active === "policy" && <PolicyHistory events={policyEvents} />}
      {active === "bets" && <BetsList events={betEvents} />}
    </div>
  );
}

interface PolicyDiffRow {
  field: string;
  oldValue: string;
  newValue: string;
  changed: boolean;
}

function policyDiff(args: Record<string, any>): PolicyDiffRow[] {
  const oldP = (args?.old ?? {}) as Record<string, any>;
  const newP = (args?.new ?? {}) as Record<string, any>;
  const fields: Array<{ key: string; pretty: string; format?: (v: any) => string }> = [
    { key: "max_stake_per_window", pretty: "Max stake/window", format: (v) => formatUsdc(v) },
    { key: "maxStakePerWindow", pretty: "Max stake/window", format: (v) => formatUsdc(v) },
    { key: "max_open_positions", pretty: "Max positions" },
    { key: "maxOpenPositions", pretty: "Max positions" },
    { key: "paused", pretty: "Paused" },
    { key: "allowed_markets_root", pretty: "Markets root" },
    { key: "allowedMarketsRoot", pretty: "Markets root" },
  ];
  const seen = new Set<string>();
  const rows: PolicyDiffRow[] = [];
  for (const f of fields) {
    if (seen.has(f.pretty)) continue;
    const o = oldP[f.key];
    const n = newP[f.key];
    if (o === undefined && n === undefined) continue;
    seen.add(f.pretty);
    const fmt = (v: any) => {
      if (v === undefined || v === null) return "—";
      if (typeof v === "boolean") return v ? "yes" : "no";
      if (Array.isArray(v)) {
        const hex = Buffer.from(v as number[]).toString("hex");
        return `0x${hex.slice(0, 12)}…`;
      }
      if (f.format) return f.format(v);
      return String(v);
    };
    rows.push({
      field: f.pretty,
      oldValue: fmt(o),
      newValue: fmt(n),
      changed: JSON.stringify(o) !== JSON.stringify(n),
    });
  }
  return rows;
}

function PolicyHistory({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No policy updates recorded yet. The Trader role rotates its policy
        every market window for the demo, so one will appear shortly.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {events.map((ev) => {
        const rows = policyDiff(ev.args ?? {});
        return (
          <div
            key={ev.id}
            className="rounded-2xl border border-border bg-card p-4"
          >
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">
                {formatTimeIso(ev.block_time ?? ev.inserted_at)}
              </span>
              <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-violet-700 dark:text-violet-400">
                Policy updated
              </span>
            </div>
            {rows.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                policy diff unavailable — see the Trace tab for the raw event
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-4 font-medium">Field</th>
                    <th className="py-1 pr-4 font-medium">Old</th>
                    <th className="py-1 pr-4 font-medium">New</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((r) => (
                    <tr key={r.field}>
                      <td className="py-1 pr-4 text-xs">{r.field}</td>
                      <td className="py-1 pr-4 font-mono text-xs text-muted-foreground">
                        {r.oldValue}
                      </td>
                      <td
                        className={cn(
                          "py-1 pr-4 font-mono text-xs",
                          r.changed
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {r.newValue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BetsList({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No bets observed for this agent yet.
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
