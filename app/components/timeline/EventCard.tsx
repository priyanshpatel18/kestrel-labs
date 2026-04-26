import { Badge } from "@/components/ui/badge";
import { explorerTxUrl, formatTimeIso, shortPubkey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EventRow } from "@/lib/types";

import { DecisionCard } from "./DecisionCard";

const KIND_LABEL: Record<string, string> = {
  // Instruction-level rows (snake_case from Anchor IDL).
  init_config: "Init config",
  register_agent: "Register agent",
  update_policy: "Policy updated",
  deposit: "Deposit",
  withdraw: "Withdraw",
  create_market: "Create market",
  delegate_market: "Delegate market",
  delegate_agent: "Delegate agent",
  open_market: "Open market",
  place_bet: "Place bet",
  cancel_bet: "Cancel bet",
  close_position: "Close position",
  halt_market: "Halt market",
  resume_market: "Resume market",
  close_market: "Close market",
  settle_position: "Settle position",
  settle_positions: "Batch settle",
  commit_market: "Commit",
  commit_and_undelegate_agent: "Undelegate agent",
  commit_and_undelegate_market: "Commit + undelegate",

  // Anchor event rows + indexer-synthesised rows (PascalCase canonical names
  // from programs/kestrel/src/events.rs).
  AgentRegistered: "Agent registered",
  PolicyUpdated: "Policy updated",
  PlaceBetAttempted: "Bet attempted",
  PlaceBetBlocked: "Bet blocked",
  BetPlaced: "Bet placed",
  MarketHalted: "Market halted",
  MarketResumed: "Market resumed",
  MarketClosed: "Market closed",
  AgentSettled: "Agent settled",
  Withdrawn: "Withdrawn",
};

const KIND_TONE: Record<string, string> = {
  // Instruction-level (legacy).
  create_market: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  delegate_market: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  delegate_agent: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  open_market: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  close_market: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  place_bet: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  cancel_bet: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  close_position: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  settle_position: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  settle_positions: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  commit_and_undelegate_market:
    "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  halt_market: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  resume_market: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  update_policy: "bg-violet-500/10 text-violet-700 dark:text-violet-400",

  // Canonical Anchor event + synthesised kinds.
  AgentRegistered: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  PolicyUpdated: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  PlaceBetAttempted: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  PlaceBetBlocked: "bg-destructive/15 text-destructive",
  BetPlaced: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  MarketHalted: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  MarketResumed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  MarketClosed: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  AgentSettled: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Withdrawn: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
};

const DESTRUCTIVE_KINDS = new Set([
  "PlaceBetBlocked",
  "MarketHalted",
]);

function summary(ev: EventRow): string {
  const a = (ev.args ?? {}) as Record<string, any>;
  const d = (ev.decision ?? {}) as Record<string, any>;
  switch (ev.kind) {
    case "create_market":
      return `id=${a.id} open=${a.open_ts} close=${a.close_ts}`;
    case "open_market":
      return `seed=${a.seed_liquidity}`;
    case "place_bet":
    case "PlaceBetAttempted":
      return `${(a.side ?? d.side)?.toString().toUpperCase() ?? ""} • ${a.amount ?? d.amount ?? ""}`;
    case "PlaceBetBlocked":
      return `${(a.side ?? d.side)?.toString().toUpperCase() ?? ""} • blocked${d.reason_human ? `: ${d.reason_human}` : ""}`;
    case "BetPlaced":
      return `${a.side?.toString().toUpperCase() ?? ""} • amount=${a.amount ?? "—"} shares=${a.shares_out ?? "—"}`;
    case "close_position":
      return `${a.side?.toString().toUpperCase()} • shares=${a.shares}`;
    case "cancel_bet":
      return "full position";
    case "MarketHalted":
      return `id=${a.market_id ?? "?"}`;
    case "MarketResumed":
      return `id=${a.market_id ?? "?"}`;
    case "MarketClosed":
      return `id=${a.market_id ?? "?"} winner=${a.winner ?? "?"}`;
    case "AgentSettled":
      return `payout=${a.payout ?? "—"} side=${a.side_won ?? "?"}`;
    case "Withdrawn":
      return `gross=${a.amount_gross ?? "—"} net=${a.amount_net ?? "—"}`;
    case "PolicyUpdated":
      return "policy diff";
    default:
      return "";
  }
}

export function EventCard({ event }: { event: EventRow }) {
  const label = KIND_LABEL[event.kind] ?? event.kind;
  const tone = KIND_TONE[event.kind] ?? "bg-muted text-foreground";
  const sub = summary(event);
  const actor = event.actor;
  const isDestructive = !event.success || DESTRUCTIVE_KINDS.has(event.kind);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-2xl border border-border bg-card p-4",
        isDestructive && "border-destructive/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-semibold",
            tone,
          )}
        >
          {label}
        </span>
        <Badge variant={event.cluster === "er" ? "default" : "outline"}>
          {event.cluster.toUpperCase()}
        </Badge>
        {!event.success && event.kind !== "PlaceBetBlocked" && (
          <Badge variant="destructive">blocked</Badge>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {formatTimeIso(event.block_time ?? event.inserted_at)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {sub && <span className="text-foreground">{sub}</span>}
        {actor && (
          <span className="font-mono text-xs text-muted-foreground">
            actor {shortPubkey(actor)}
          </span>
        )}
        <a
          href={explorerTxUrl(event.signature)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto font-mono text-xs text-primary underline-offset-4 hover:underline"
          title={
            event.cluster === "er"
              ? "ER signatures may not appear on the public Solana explorer."
              : "Open in Solana Explorer (devnet)"
          }
        >
          {shortPubkey(event.signature, 6, 6)}
        </a>
      </div>

      {event.err && (
        <div className="rounded-md bg-destructive/5 px-2 py-1 font-mono text-xs text-destructive">
          {event.err}
        </div>
      )}

      <DecisionCard event={event} />
    </div>
  );
}
