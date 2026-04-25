"use client";

import type { MarketCloseOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

function direction(winner: string): "up" | "down" | null {
  const w = winner.trim().toLowerCase();
  if (w === "yes" || w === "up") return "up";
  if (w === "no" || w === "down") return "down";
  return null;
}

interface RecentClosesStripProps {
  outcomes: MarketCloseOutcome[];
  maxDots?: number;
  className?: string;
}

export function RecentClosesStrip({
  outcomes,
  maxDots = 5,
  className,
}: RecentClosesStripProps) {
  const slice = outcomes.slice(-maxDots);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Past
      </span>
      <div
        className="flex items-center gap-1"
        aria-label="Recent market outcomes"
      >
        {slice.length === 0
          ? Array.from({ length: 3 }).map((_, i) => (
              <span
                key={`placeholder-${i}`}
                className="size-5 rounded-full bg-muted/60"
                aria-hidden
              />
            ))
          : slice.map((o) => {
              const dir = direction(o.winner);
              return (
                <span
                  key={o.market_id}
                  title={`#${o.market_id}`}
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[10px] leading-none text-white",
                    dir === "up" && "bg-up",
                    dir === "down" && "bg-down",
                    !dir && "bg-muted text-muted-foreground",
                  )}
                  aria-label={dir ?? o.winner}
                >
                  {dir === "up" ? "▲" : dir === "down" ? "▼" : "·"}
                </span>
              );
            })}
      </div>
    </div>
  );
}
