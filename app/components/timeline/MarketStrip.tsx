import Link from "next/link";

import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketRow } from "@/lib/types";

const dotByStatus = (status: string | null) => {
  switch ((status ?? "").toLowerCase()) {
    case "open":
      return "bg-emerald-500";
    case "halted":
      return "bg-amber-500";
    case "closed":
      return "bg-zinc-400";
    case "settled":
      return "bg-zinc-700 dark:bg-zinc-200";
    case "pending":
    default:
      return "bg-border";
  }
};

export function MarketStrip({
  markets,
  activeMarketId,
}: {
  markets: MarketRow[];
  activeMarketId?: number;
}) {
  if (markets.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No markets indexed yet.
      </div>
    );
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2">
      {markets.map((m) => {
        const isActive = m.market_id === activeMarketId;
        return (
          <Link
            key={m.market_id}
            href={`/markets/${m.market_id}`}
            className={cn(
              "flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg border border-border px-2 py-2 transition-colors hover:bg-muted",
              isActive && "border-primary bg-muted",
            )}
          >
            <span className="text-xs font-medium text-muted-foreground">
              #{m.market_id}
            </span>
            <span
              className={cn("h-2 w-2 rounded-full", dotByStatus(m.status))}
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatTime(m.open_ts)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
