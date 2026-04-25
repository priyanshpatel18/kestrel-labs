"use client";

import type { MarketCloseOutcome } from "@/lib/types";

function directionFromWinner(winner: string): "up" | "down" | null {
  const w = winner.trim().toLowerCase();
  if (w === "yes" || w === "up") return "up";
  if (w === "no" || w === "down") return "down";
  return null;
}

export function RecentClosesStrip({
  outcomes,
  maxDots = 8,
}: {
  outcomes: MarketCloseOutcome[];
  maxDots?: number;
}) {
  const slice = outcomes.slice(-maxDots);

  if (slice.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Past</span>
        <span>No closed markets yet</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Past
      </span>
      <div className="flex items-center gap-1.5" aria-label="Last market outcomes">
        {slice.map((o) => {
          const dir = directionFromWinner(o.winner);
          const up = dir === "up";
          const down = dir === "down";
          return (
            <span
              key={o.market_id}
              title={`Market #${o.market_id}: ${o.winner}`}
              className={
                up
                  ? "flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm"
                  : down
                    ? "flex size-7 items-center justify-center rounded-full bg-red-600 text-white shadow-sm"
                    : "flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"
              }
              aria-label={up ? "Up" : down ? "Down" : o.winner}
            >
              <span className="text-xs font-bold leading-none">
                {up ? "▲" : down ? "▼" : "?"}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
