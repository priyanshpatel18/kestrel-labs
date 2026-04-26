import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/markets/StatusBadge";
import { RealtimeTimeline } from "@/components/timeline/RealtimeTimeline";
import {
  fetchMarketById,
  fetchMarketEvents,
} from "@/lib/db/queries";
import {
  explorerTxUrl,
  formatDateTime,
  formatStrike,
  shortPubkey,
} from "@/lib/format";
import type { EventRow, MarketRow } from "@/lib/types";
import { buildIndexerConnections } from "@/lib/indexer/connections";
import { showDevNav } from "@/lib/showDevNav";
import { PublicKey } from "@solana/web3.js";

export const dynamic = "force-dynamic";

interface MarketDetailProps {
  params: Promise<{ id: string }>;
}

const SIG_FIELDS: Array<{
  key:
    | "created_sig"
    | "delegated_sig"
    | "opened_sig"
    | "closed_sig"
    | "settled_sig"
    | "undelegated_sig";
  label: string;
}> = [
  { key: "created_sig", label: "create_market" },
  { key: "delegated_sig", label: "delegate_market" },
  { key: "opened_sig", label: "open_market" },
  { key: "closed_sig", label: "close_market" },
  { key: "settled_sig", label: "settle_positions" },
  { key: "undelegated_sig", label: "commit_and_undelegate" },
];

export default async function MarketDetail({ params }: MarketDetailProps) {
  if (!showDevNav()) notFound();

  const { id } = await params;
  const marketId = Number(id);
  if (!Number.isFinite(marketId)) notFound();

  let market: MarketRow | null;
  let events: EventRow[];
  try {
    [market, events] = await Promise.all([
      fetchMarketById(marketId),
      fetchMarketEvents(marketId),
    ]);
  } catch {
    market = null;
    events = [];
  }

  if (!market) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        <Link
          href="/markets"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; All markets
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Market #{marketId} not indexed yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The indexer hasn&apos;t seen any instruction touching this market
            yet. It will appear here as soon as the scheduler creates it on the
            base layer.
          </CardContent>
        </Card>
      </div>
    );
  }

  const strikeValue =
    market.strike_price ?? (await fetchOnchainStrike(market.market_pubkey));
  const closeValue =
    market.close_price ?? (await fetchOnchainClose(market.market_pubkey));
  const outcomeLabel =
    market.winner === "yes" ? "UP" : market.winner === "no" ? "DOWN" : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/markets"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; All markets
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Market #{market.market_id}
          </h1>
          <StatusBadge status={market.status} />
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {shortPubkey(market.market_pubkey, 8, 8)}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Window</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Stat label="Open" value={formatDateTime(market.open_ts)} />
            <Stat label="Close" value={formatDateTime(market.close_ts)} />
            <Stat label="Strike" value={formatStrike(strikeValue)} />
            <Stat label="Final" value={formatStrike(closeValue)} />
            <Stat label="Winner" value={outcomeLabel ?? "—"} />
            <Stat label="Raw" value={market.winner ?? "—"} />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {SIG_FIELDS.map((f) => {
              const sig = market[f.key];
              if (!sig) return null;
              return (
                <a
                  key={f.key}
                  href={explorerTxUrl(sig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
                >
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-mono text-primary">
                    {shortPubkey(sig, 5, 5)}
                  </span>
                </a>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <RealtimeTimeline marketId={marketId} initialEvents={events} />
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

async function fetchOnchainStrike(marketPubkey: string): Promise<number | null> {
  try {
    const conns = buildIndexerConnections();
    const acc = await (conns.erProgram as any).account.market.fetch(
      new PublicKey(marketPubkey),
    );
    const strike = acc?.strike;
    const asNum = Number(strike?.toString?.() ?? strike);
    return Number.isFinite(asNum) ? asNum : null;
  } catch {
    return null;
  }
}

async function fetchOnchainClose(marketPubkey: string): Promise<number | null> {
  try {
    const conns = buildIndexerConnections();
    const acc = await (conns.erProgram as any).account.market.fetch(
      new PublicKey(marketPubkey),
    );
    const closePrice = acc?.closePrice;
    const asNum = Number(closePrice?.toString?.() ?? closePrice);
    return Number.isFinite(asNum) ? asNum : null;
  } catch {
    return null;
  }
}
