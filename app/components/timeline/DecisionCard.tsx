import {
  explorerTxUrl,
  formatStrike,
  formatUsdc,
  shortPubkey,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EventRow } from "@/lib/types";

interface PolicyShape {
  max_stake_per_window: string | null;
  max_open_positions: number | null;
  allowed_markets_root_hex: string | null;
  paused: boolean | null;
  balance: string | null;
}

interface IntentShape {
  side: string | null;
  amount: string | null;
}

interface DecisionShape {
  kind: string;
  side: string | null;
  amount: string | null;
  shares: string | null;
  strike_price: string | null;
  accepted: boolean;
  reason: string | null;
  reason_code: number | null;
  reason_human: string | null;
  intent: IntentShape | null;
  policy: PolicyShape | null;
}

const FOUR_COL_KINDS = new Set([
  "PlaceBetAttempted",
  "PlaceBetBlocked",
  "place_bet",
]);

/** On-chain Anchor error name → judge-friendly bucket (intent vs rails). */
function betBlockedGate(
  reason: string | null | undefined,
): "policy" | "chain" | "unknown" {
  if (!reason) return "unknown";
  const policy = new Set([
    "OverPolicyCap",
    "MarketNotAllowed",
    "AgentPaused",
  ]);
  const chain = new Set([
    "OracleStale",
    "OracleMismatch",
    "OracleDeserialize",
    "MarketHalted",
    "MarketNotOpen",
    "MarketClosed",
    "OutsideMarketWindow",
    "InsufficientBalance",
    "TooManyPositions",
  ]);
  if (policy.has(reason)) return "policy";
  if (chain.has(reason)) return "chain";
  return "unknown";
}

function blockedLabel(
  accepted: boolean,
  reason: string | null | undefined,
): string {
  if (accepted) return "accepted";
  const gate = betBlockedGate(reason);
  if (gate === "policy") return "policy blocked";
  if (gate === "chain") return "chain blocked";
  return "blocked";
}

function Stat({
  label,
  value,
  mono = true,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-xs text-foreground",
          mono && "font-mono",
        )}
      >
        {children ??
          (value === null || value === undefined || value === "" ? "—" : value)}
      </span>
    </div>
  );
}

function Column({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
        {title}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export function DecisionCard({ event }: { event: EventRow }) {
  if (!event.decision) return null;
  const d = event.decision as unknown as DecisionShape;
  const useFourCol = FOUR_COL_KINDS.has(event.kind);

  if (!useFourCol) {
    // Legacy compact layout for non-bet decisions (cancel_bet / close_position).
    return (
      <div className="mt-1 grid grid-cols-2 gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-3 sm:grid-cols-4">
        {d.side && <Stat label="Side" value={d.side.toUpperCase()} />}
        {d.amount && (
          <Stat label="Stake (USDC)" value={formatUsdc(d.amount)} />
        )}
        {d.shares && <Stat label="Shares" value={d.shares} />}
        {d.strike_price && (
          <Stat label="Strike" value={formatStrike(d.strike_price)} />
        )}
        <div className="col-span-2 sm:col-span-4">
          <span
            className={
              d.accepted
                ? "inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                : "inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
            }
          >
            {d.accepted ? "accepted" : blockedLabel(d.accepted, d.reason)}
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

  // Four-column layout for the headline placement decisions.
  const intentSide = d.intent?.side ?? d.side;
  const intentAmount = d.intent?.amount ?? d.amount;
  const policy = d.policy;
  const overCapCheck =
    policy?.max_stake_per_window && intentAmount
      ? BigInt(intentAmount) <= BigInt(policy.max_stake_per_window)
      : null;
  const allowlistDisabled =
    policy?.allowed_markets_root_hex &&
    /^0x0+$/.test(policy.allowed_markets_root_hex);

  return (
    <div className="mt-1 grid grid-cols-1 gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-3 md:grid-cols-2 xl:grid-cols-4">
      <Column title="Inputs">
        <Stat
          label="Side"
          value={intentSide ? intentSide.toUpperCase() : "—"}
        />
        <Stat
          label="Stake (USDC)"
          value={intentAmount ? formatUsdc(intentAmount) : "—"}
        />
        <Stat
          label="Strike"
          value={d.strike_price ? formatStrike(d.strike_price) : "—"}
        />
      </Column>

      <Column title="Policy checks">
        <Stat
          label="Max stake/window"
          value={
            policy?.max_stake_per_window
              ? formatUsdc(policy.max_stake_per_window)
              : "—"
          }
        />
        <Stat
          label="Within cap"
          value={overCapCheck === null ? "—" : overCapCheck ? "yes" : "no"}
        />
        <Stat
          label="Markets root"
          value={
            allowlistDisabled
              ? "open (0x0…)"
              : policy?.allowed_markets_root_hex
                ? `${policy.allowed_markets_root_hex.slice(0, 10)}…`
                : "—"
          }
        />
        <Stat
          label="Agent paused"
          value={policy?.paused === true ? "yes" : policy?.paused === false ? "no" : "—"}
        />
      </Column>

      <Column title="Decision">
        <div>
          <span
            className={
              d.accepted
                ? "inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                : "inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
            }
          >
            {blockedLabel(d.accepted, d.reason)}
          </span>
        </div>
        <Stat label="Reason" value={d.reason ?? (d.accepted ? "—" : "unknown")} />
        {d.reason_human && d.reason_human !== d.reason ? (
          <Stat
            label="Detail"
            mono={false}
            value={
              <span className="text-xs text-foreground/80">
                {d.reason_human}
              </span>
            }
          />
        ) : null}
        {d.reason_code != null ? (
          <Stat label="Anchor code" value={String(d.reason_code)} />
        ) : null}
      </Column>

      <Column title="Tx sig">
        <Stat
          label="Cluster"
          value={event.cluster.toUpperCase()}
          mono={false}
        />
        <Stat
          label="Signature"
          mono
          value={
            <a
              href={explorerTxUrl(event.signature)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-primary underline-offset-4 hover:underline"
              title={
                event.cluster === "er"
                  ? "ER signatures may not appear on the public Solana explorer."
                  : "Open in Solana Explorer (devnet)"
              }
            >
              {shortPubkey(event.signature, 6, 6)}
            </a>
          }
        />
        {event.actor ? (
          <Stat label="Actor" value={shortPubkey(event.actor)} />
        ) : null}
      </Column>
    </div>
  );
}
