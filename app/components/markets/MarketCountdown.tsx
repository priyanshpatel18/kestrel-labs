"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface MarketCountdownProps {
  /** Unix seconds when the window closes. */
  closeTs: number | null | undefined;
  className?: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function MarketCountdown({ closeTs, className }: MarketCountdownProps) {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      250,
    );
    return () => window.clearInterval(id);
  }, []);

  if (closeTs == null) {
    return (
      <div className={cn("flex items-end gap-2 tabular", className)}>
        <Block label="MINS" value="--" />
        <Block label="SECS" value="--" />
      </div>
    );
  }

  const remaining = Math.max(0, closeTs - now);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  const urgent = remaining <= 30 && remaining > 0;

  return (
    <div className={cn("flex items-end gap-2 tabular", className)}>
      <Block label="MINS" value={pad(mins)} urgent={urgent} />
      <Block label="SECS" value={pad(secs)} urgent={urgent} />
    </div>
  );
}

function Block({
  label,
  value,
  urgent,
}: {
  label: string;
  value: string;
  urgent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span
        className={cn(
          "font-display text-2xl font-semibold tracking-tight tabular",
          urgent ? "text-down" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
