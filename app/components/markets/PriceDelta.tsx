"use client";

import { formatPriceDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PriceDeltaProps {
  delta: number | null;
  className?: string;
  /** Inline arrow + dollar amount, e.g. `▲ $837`. */
  withDollar?: boolean;
}

export function PriceDelta({
  delta,
  className,
  withDollar = true,
}: PriceDeltaProps) {
  if (delta == null || !Number.isFinite(delta)) {
    return (
      <span className={cn("tabular text-sm text-muted-foreground", className)}>
        —
      </span>
    );
  }

  const isUp = delta > 0;
  const isDown = delta < 0;
  const arrow = isUp ? "▲" : isDown ? "▼" : "•";
  const colorClass = isUp
    ? "text-up"
    : isDown
      ? "text-down"
      : "text-muted-foreground";

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 text-sm font-medium",
        colorClass,
        className,
      )}
    >
      <span aria-hidden className="text-[10px] leading-none">
        {arrow}
      </span>
      <span>
        {withDollar ? "$" : ""}
        {formatPriceDelta(delta)}
      </span>
    </span>
  );
}
