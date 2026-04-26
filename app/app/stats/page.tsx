import Link from "next/link";
import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchPublicStats, type PublicStats } from "@/lib/db/queries";
import { relativeTime } from "@/lib/format";
import { showDevNav } from "@/lib/showDevNav";
import { MARKET_STATUS } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stats",
  description:
    "Kestrel indexer aggregates: markets, events, agents, and live window status.",
};

function StatBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export default async function StatsPage() {
  let stats: PublicStats | null = null;
  let loadError: string | null = null;
  try {
    stats = await fetchPublicStats();
  } catch (e) {
    loadError = String((e as Error)?.message ?? e);
  }

  const programId = process.env.KESTREL_PROGRAM_ID?.trim() || null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Network stats</h1>
        <p className="text-sm text-muted-foreground">
          Aggregates from the indexer (Supabase read replica).
          This page is available in production so operators and judges can
          verify liveness without dev-only routes.
        </p>
        {programId ? (
          <p className="font-mono text-xs text-muted-foreground">
            Program{" "}
            <span className="text-foreground/90">{programId}</span>
          </p>
        ) : null}
      </div>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Could not load stats
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Check <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
              and anon access to <code className="rounded bg-muted px-1">markets</code>,{" "}
              <code className="rounded bg-muted px-1">events</code>, and{" "}
              <code className="rounded bg-muted px-1">agents</code>.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs text-foreground/80">
              {loadError}
            </pre>
          </CardContent>
        </Card>
      ) : stats ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label="Markets (total)" value={stats.totalMarkets} />
            <StatBlock label="Events indexed" value={stats.totalEvents} />
            <StatBlock
              label="Events (24h)"
              value={stats.eventsLast24h}
              hint="Rows inserted in the last rolling 24 hours."
            />
            <StatBlock label="Agents tracked" value={stats.totalAgents} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Markets by status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                {MARKET_STATUS.map((status) => (
                  <div
                    key={status}
                    className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-sm"
                  >
                    <span className="capitalize text-muted-foreground">
                      {status}
                    </span>
                    <span className="font-mono font-medium tabular-nums">
                      {stats.marketsByStatus[status] ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Live window</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {stats.activeMarketId != null ? (
                <>
                  <p>
                    Active market{" "}
                    <span className="font-mono text-foreground">
                      #{stats.activeMarketId}
                    </span>
                    {stats.activeMarketStatus ? (
                      <>
                        {" "}
                        <span className="capitalize">
                          ({stats.activeMarketStatus})
                        </span>
                      </>
                    ) : null}
                  </p>
                  {showDevNav() ? (
                    <Link
                      href={`/markets/${stats.activeMarketId}`}
                      className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Open market timeline
                    </Link>
                  ) : null}
                </>
              ) : (
                <p>No market in the open window right now (by indexer clock).</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Indexer activity</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {stats.lastEventAt ? (
                <p>
                  Last indexed event{" "}
                  <span className="text-foreground">
                    {relativeTime(stats.lastEventAt)}
                  </span>{" "}
                  <span className="font-mono text-xs opacity-80">
                    ({stats.lastEventAt})
                  </span>
                </p>
              ) : (
                <p>No events in the database yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href="/docs"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          API reference
        </Link>
        {showDevNav() ? (
          <>
            <Link
              href="/markets"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Markets
            </Link>
            <Link
              href="/agents"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Agents
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
