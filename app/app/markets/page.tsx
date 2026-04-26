import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/markets/StatusBadge";
import { fetchAllMarkets } from "@/lib/db/queries";
import { showDevNav } from "@/lib/showDevNav";
import {
  formatDateTime,
  formatStrike,
  shortPubkey,
} from "@/lib/format";
import type { MarketRow, MarketStatus } from "@/lib/types";
import { MARKET_STATUS } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  ...MARKET_STATUS.map((s) => ({ key: s, label: s })),
];

interface MarketsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function MarketsPage({ searchParams }: MarketsPageProps) {
  if (!showDevNav()) notFound();

  const sp = await searchParams;
  const statusFilter = sp.status && sp.status !== "all" ? sp.status : undefined;

  let markets: MarketRow[];
  try {
    markets = await fetchAllMarkets({
      status: statusFilter as MarketStatus | undefined,
      limit: 200,
    });
  } catch {
    markets = [];
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <p className="text-sm text-muted-foreground">
          Every 5-minute window the scheduler has produced.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active =
            (f.key === "all" && !statusFilter) || f.key === statusFilter;
          return (
            <Link
              key={f.key}
              href={f.key === "all" ? "/markets" : `/markets?status=${f.key}`}
              className={
                active
                  ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                  : "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {markets.length} market{markets.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {markets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No markets yet for this filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <Th>ID</Th>
                    <Th>Status</Th>
                    <Th>Open</Th>
                    <Th>Close</Th>
                    <Th>Strike</Th>
                    <Th>Final</Th>
                    <Th>Winner</Th>
                    <Th>Pubkey</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {markets.map((m) => (
                    <tr
                      key={m.market_pubkey}
                      className="transition-colors hover:bg-muted/40"
                    >
                      <Td>
                        <Link
                          href={`/markets/${m.market_id}`}
                          className="font-mono font-medium underline-offset-4 hover:underline"
                        >
                          #{m.market_id}
                        </Link>
                      </Td>
                      <Td>
                        <StatusBadge status={m.status} />
                      </Td>
                      <Td className="font-mono text-xs">
                        {formatDateTime(m.open_ts)}
                      </Td>
                      <Td className="font-mono text-xs">
                        {formatDateTime(m.close_ts)}
                      </Td>
                      <Td className="font-mono text-xs">
                        {formatStrike(m.strike_price)}
                      </Td>
                      <Td className="font-mono text-xs">
                        {formatStrike(m.close_price)}
                      </Td>
                      <Td className="font-mono text-xs">{m.winner ?? "—"}</Td>
                      <Td className="font-mono text-xs text-muted-foreground">
                        {shortPubkey(m.market_pubkey, 6, 6)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 font-medium">{children}</th>;
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-2 py-2 ${className ?? ""}`}>{children}</td>;
}
