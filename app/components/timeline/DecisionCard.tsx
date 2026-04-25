import { formatStrike, formatUsdc } from "@/lib/format";
import type { EventRow } from "@/lib/types";

interface PolicyShape {
  max_stake_per_window: string | null;
  max_open_positions: number | null;
  allowed_markets_root_hex: string | null;
  paused: boolean | null;
  balance: string | null;
}

interface DecisionShape {
  kind: string;
  side: string | null;
  amount: string | null;
  shares: string | null;
  strike_price: string | null;
  accepted: boolean;
  reason: string | null;
  policy: PolicyShape | null;
}

export function DecisionCard({ event }: { event: EventRow }) {
  if (!event.decision) return null;
  const d = event.decision as unknown as DecisionShape;

  const stat = (label: string, value: string | number | null | undefined) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs text-foreground">
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
    </div>
  );

  return (
    <div className="mt-1 grid grid-cols-2 gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-3 sm:grid-cols-4">
      {d.side && stat("Side", d.side.toUpperCase())}
      {d.amount && stat("Stake (USDC)", formatUsdc(d.amount))}
      {d.shares && stat("Shares", d.shares)}
      {d.strike_price && stat("Strike", formatStrike(d.strike_price))}
      {d.policy?.max_stake_per_window &&
        stat(
          "Policy max stake",
          formatUsdc(d.policy.max_stake_per_window),
        )}
      {d.policy?.max_open_positions !== undefined &&
        d.policy?.max_open_positions !== null &&
        stat("Max positions", d.policy.max_open_positions)}
      {d.policy?.balance &&
        stat("Agent balance", formatUsdc(d.policy.balance))}
      {d.policy?.allowed_markets_root_hex &&
        stat(
          "Markets root",
          `${d.policy.allowed_markets_root_hex.slice(0, 10)}…`,
        )}
      {d.policy?.paused === true && stat("Paused", "yes")}
      <div className="col-span-2 sm:col-span-4">
        <span
          className={
            d.accepted
              ? "inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
              : "inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
          }
        >
          {d.accepted ? "policy accepted" : "policy blocked"}
          {d.reason && (
            <span className="ml-1 font-mono text-[11px] opacity-80">
              {d.reason}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
