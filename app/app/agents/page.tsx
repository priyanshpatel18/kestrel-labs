import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAllAgents } from "@/lib/db/queries";
import { formatUsdc, relativeTime, shortPubkey } from "@/lib/format";
import type { AgentRole, AgentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<AgentRole | "unknown", string> = {
  market_ops: "MarketOps",
  trader: "Trader",
  risk_lp: "Risk-LP",
  unknown: "Untagged",
};

const ROLE_TONE: Record<string, string> = {
  market_ops: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  trader: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  risk_lp: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  unknown: "bg-muted text-muted-foreground",
};

interface PolicyShape {
  max_stake_per_window?: number | string | null;
  maxStakePerWindow?: number | string | null;
  max_open_positions?: number | null;
  maxOpenPositions?: number | null;
  paused?: boolean | null;
}

function readPolicy(p: AgentRow["current_policy"]): PolicyShape {
  return (p ?? {}) as PolicyShape;
}

function policyMaxStake(p: AgentRow["current_policy"]): string | null {
  const o = readPolicy(p);
  const v = o.max_stake_per_window ?? o.maxStakePerWindow;
  if (v === null || v === undefined) return null;
  return String(v);
}

function policyMaxPositions(p: AgentRow["current_policy"]): number | null {
  const o = readPolicy(p);
  const v = o.max_open_positions ?? o.maxOpenPositions;
  return typeof v === "number" ? v : null;
}

export default async function AgentsPage() {
  if (process.env.NODE_ENV === "production") notFound();

  let agents: AgentRow[] = [];
  try {
    agents = await fetchAllAgents();
  } catch {
    agents = [];
  }

  const grouped = groupByRole(agents);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Bounded-autonomy runtimes the indexer has seen this session. Click
          any agent to follow its decision trace.
        </p>
      </div>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No agents indexed yet. Start the runtimes with{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              pnpm --filter @kestrel/agents dev:all
            </code>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(({ role, rows }) => (
            <Card key={role}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                      ROLE_TONE[role] ?? ROLE_TONE.unknown
                    }`}
                  >
                    {ROLE_LABEL[(role as AgentRole) ?? "unknown"] ??
                      ROLE_LABEL.unknown}
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {rows.length} agent{rows.length === 1 ? "" : "s"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {rows.map((a) => {
                    const maxStake = policyMaxStake(a.current_policy);
                    const maxPos = policyMaxPositions(a.current_policy);
                    const policy = readPolicy(a.current_policy);
                    const paused = policy.paused === true;
                    return (
                      <Link
                        key={a.owner_pubkey}
                        href={`/agents/${a.owner_pubkey}`}
                        className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">
                            {a.label ?? shortPubkey(a.owner_pubkey, 6, 6)}
                          </span>
                          {paused && (
                            <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                              paused
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {a.owner_pubkey}
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-xs">
                          <Stat
                            label="Balance"
                            value={
                              a.current_balance != null
                                ? formatUsdc(a.current_balance)
                                : "—"
                            }
                          />
                          <Stat
                            label="Max stake"
                            value={maxStake ? formatUsdc(maxStake) : "—"}
                          />
                          <Stat
                            label="Max positions"
                            value={maxPos != null ? String(maxPos) : "—"}
                          />
                          <Stat
                            label="Last action"
                            value={
                              a.last_event_at
                                ? relativeTime(a.last_event_at)
                                : "—"
                            }
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function groupByRole(rows: AgentRow[]): Array<{
  role: AgentRole | "unknown";
  rows: AgentRow[];
}> {
  const order: Array<AgentRole | "unknown"> = [
    "market_ops",
    "trader",
    "risk_lp",
    "unknown",
  ];
  const buckets = new Map<AgentRole | "unknown", AgentRow[]>();
  for (const r of rows) {
    const k = (r.role ?? "unknown") as AgentRole | "unknown";
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }
  return order
    .map((role) => ({ role, rows: buckets.get(role) ?? [] }))
    .filter((g) => g.rows.length > 0);
}
