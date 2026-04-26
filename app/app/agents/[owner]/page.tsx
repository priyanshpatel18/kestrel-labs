import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentDetailTabs } from "@/components/agents/AgentDetailTabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchAgentEvents,
  fetchAgentRow,
} from "@/lib/db/queries";
import {
  explorerAddressUrl,
  formatUsdc,
  relativeTime,
  shortPubkey,
} from "@/lib/format";
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

interface PageProps {
  params: Promise<{ owner: string }>;
}

interface PolicyShape {
  max_stake_per_window?: string | number | null;
  maxStakePerWindow?: string | number | null;
  max_open_positions?: number | null;
  maxOpenPositions?: number | null;
  paused?: boolean | null;
  allowed_markets_root?: number[] | null;
  allowedMarketsRoot?: number[] | null;
}

function readPolicy(agent: AgentRow | null): PolicyShape {
  if (!agent?.current_policy) return {};
  return agent.current_policy as PolicyShape;
}

function policyMaxStake(p: PolicyShape): string | null {
  const v = p.max_stake_per_window ?? p.maxStakePerWindow;
  return v != null ? String(v) : null;
}

function policyMaxPositions(p: PolicyShape): number | null {
  const v = p.max_open_positions ?? p.maxOpenPositions;
  return typeof v === "number" ? v : null;
}

function policyAllowlistHex(p: PolicyShape): string | null {
  const arr = p.allowed_markets_root ?? p.allowedMarketsRoot;
  if (!Array.isArray(arr)) return null;
  return `0x${Buffer.from(arr).toString("hex").slice(0, 12)}…`;
}

export default async function AgentDetailPage({ params }: PageProps) {
  if (process.env.NODE_ENV === "production") notFound();

  const { owner } = await params;

  const [agent, events] = await Promise.all([
    fetchAgentRow(owner).catch(() => null),
    fetchAgentEvents(owner, 200).catch(() => []),
  ]);

  if (!agent && events.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
        <Link
          href="/agents"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← All agents
        </Link>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No agent or event history for{" "}
            <span className="font-mono">{shortPubkey(owner, 6, 6)}</span> yet.
          </CardContent>
        </Card>
      </div>
    );
  }

  const role = (agent?.role ?? "unknown") as AgentRole | "unknown";
  const policy = readPolicy(agent);
  const maxStake = policyMaxStake(policy);
  const maxPositions = policyMaxPositions(policy);
  const allowlist = policyAllowlistHex(policy);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <Link
        href="/agents"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← All agents
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                ROLE_TONE[role] ?? ROLE_TONE.unknown
              }`}
            >
              {ROLE_LABEL[role] ?? ROLE_LABEL.unknown}
            </span>
            <span className="font-mono text-base">
              {agent?.label ?? shortPubkey(owner, 6, 6)}
            </span>
            {policy.paused === true && (
              <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                paused
              </span>
            )}
            <a
              href={explorerAddressUrl(owner)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto font-mono text-xs text-primary underline-offset-4 hover:underline"
            >
              explorer
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="font-mono text-[11px] text-muted-foreground">
            {owner}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-3 sm:grid-cols-4">
            <Stat
              label="Balance"
              value={
                agent?.current_balance != null
                  ? formatUsdc(agent.current_balance)
                  : "—"
              }
            />
            <Stat
              label="Max stake/window"
              value={maxStake ? formatUsdc(maxStake) : "—"}
            />
            <Stat
              label="Max positions"
              value={maxPositions != null ? String(maxPositions) : "—"}
            />
            <Stat
              label="Allowlist root"
              value={allowlist ?? "—"}
            />
            <Stat
              label="Registered"
              value={
                agent?.registered_at
                  ? relativeTime(agent.registered_at)
                  : "—"
              }
            />
            <Stat
              label="Last action"
              value={
                agent?.last_event_at
                  ? relativeTime(agent.last_event_at)
                  : "—"
              }
            />
            <Stat
              label="Agent PDA"
              value={
                agent?.agent_pda
                  ? shortPubkey(agent.agent_pda, 6, 6)
                  : "—"
              }
            />
          </div>
        </CardContent>
      </Card>

      <AgentDetailTabs ownerPubkey={owner} initialEvents={events} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
