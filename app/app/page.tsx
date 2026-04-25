import Link from "next/link";

import { BtcLiveChart } from "@/components/markets/BtcLiveChart";
import { RecentClosesStrip } from "@/components/markets/RecentClosesStrip";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/markets/StatusBadge";
import { fetchDashboardSnapshot } from "@/lib/db/queries";
import { formatDateTime, formatStrike } from "@/lib/format";

const STRIKE_SCALE = 100_000_000;

export const dynamic = "force-dynamic";

function MissingSupabase() {
  return (
    <div className="mx-auto max-w-2xl p-12">
      <Card>
        <CardHeader>
          <CardTitle>Supabase not configured</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Set <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
          <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and{" "}
          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
          <code className="font-mono">app/.env.local</code> and run{" "}
          <code className="font-mono">supabase/migrations/0001_indexer.sql</code>{" "}
          on your project.
        </CardContent>
      </Card>
    </div>
  );
}

export default async function Home() {
  let snapshot;
  try {
    snapshot = await fetchDashboardSnapshot();
  } catch {
    return <MissingSupabase />;
  }

  const now = snapshot.nowMarket;
  const strikeUsd =
    now?.strike_price != null && Number.isFinite(Number(now.strike_price))
      ? Number(now.strike_price) / STRIKE_SCALE
      : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>BTC / USD</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Last settled windows (Yes = up, No = down)
            </div>
            <RecentClosesStrip outcomes={snapshot.recentCloseOutcomes} />
          </div>
          <BtcLiveChart strikeUsd={strikeUsd} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current open market</CardTitle>
        </CardHeader>
        <CardContent>
          {now ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <Link
                  href={`/markets/${now.market_id}`}
                  className="text-3xl font-semibold tracking-tight underline-offset-4 hover:underline"
                >
                  Market #{now.market_id}
                </Link>
                <StatusBadge status={now.status} />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Open" value={formatDateTime(now.open_ts)} />
                <Stat label="Close" value={formatDateTime(now.close_ts)} />
                <Stat label="Strike" value={formatStrike(now.strike_price)} />
                <Stat label="Winner" value={now.winner ?? "—"} />
              </div>

              <div className="text-sm text-muted-foreground">
                Tip: open the market page to see the full timeline.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-sm text-muted-foreground">
                No market is currently open.
              </div>
              <div className="text-xs text-muted-foreground">
                The scheduler creates a 5-minute window — this will appear right
                after the next open.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}
