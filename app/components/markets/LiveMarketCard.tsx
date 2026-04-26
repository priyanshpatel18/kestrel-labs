"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { BtcLiveChart } from "./BtcLiveChart";
import { MarketCountdown } from "./MarketCountdown";
import { PriceDelta } from "./PriceDelta";
import { RecentClosesStrip } from "./RecentClosesStrip";
import { useLiveBtcPrice } from "./useLiveBtcPrice";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { STRIKE_SCALE, formatPrice } from "@/lib/format";
import type { EventRow, MarketCloseOutcome, MarketRow } from "@/lib/types";

interface LiveMarketCardProps {
  initialMarket: MarketRow | null;
  initialCloses: MarketCloseOutcome[];
}

function strikeToUsd(
  strike: number | string | null | undefined,
): number | null {
  if (strike == null) return null;
  const n = typeof strike === "string" ? Number(strike) : strike;
  if (!Number.isFinite(n)) return null;
  return n / STRIKE_SCALE;
}

function dateRangeLabel(openTs: number | null, closeTs: number | null): string {
  if (!openTs || !closeTs) return "";
  const openDate = new Date(openTs * 1000);
  const closeDate = new Date(closeTs * 1000);
  const month = openDate.toLocaleString(undefined, { month: "long" });
  const day = openDate.getDate();
  const fmt = (d: Date) =>
    d
      .toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
      .replace(/\s/g, "");
  return `${month} ${day}, ${fmt(openDate)}–${fmt(closeDate)}`;
}

export function LiveMarketCard({
  initialMarket,
  initialCloses,
}: LiveMarketCardProps) {
  const [market, setMarket] = useState<MarketRow | null>(initialMarket);
  const [closes, setCloses] = useState<MarketCloseOutcome[]>(initialCloses);
  const { price, history } = useLiveBtcPrice();
  const [tradeToasts, setTradeToasts] = useState<
    Array<{ id: string; side: "yes" | "no"; amount: number }>
  >([]);

  useEffect(() => {
    let supabase;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }

    const refreshNow = async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const { data } = await supabase
        .from("markets")
        .select("*")
        .lte("open_ts", nowSec)
        .gte("close_ts", nowSec)
        .order("market_id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setMarket(data as MarketRow);
    };

    const refreshCloses = async () => {
      const { data } = await supabase
        .from("markets")
        .select("market_id,winner")
        .in("status", ["closed", "settled"])
        .not("winner", "is", null)
        .order("market_id", { ascending: false })
        .limit(12);
      if (data) {
        const next = (data as { market_id: number; winner: string | null }[])
          .filter((r) => r.winner)
          .map((r) => ({ market_id: r.market_id, winner: r.winner as string }))
          .reverse();
        setCloses(next);
      }
    };

    const channel = supabase
      .channel("markets-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "markets" },
        () => {
          void refreshNow();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "markets" },
        (payload: { new: MarketRow }) => {
          const row = payload.new;
          if (!row) return;
          if (row.status === "open") {
            setMarket(row);
          } else if (
            market &&
            row.market_id === market.market_id &&
            (row.status === "closed" || row.status === "settled")
          ) {
            void refreshNow();
            void refreshCloses();
          } else {
            void refreshCloses();
          }
        },
      )
      .subscribe();

    const tick = window.setInterval(() => {
      if (!market || !market.close_ts) return;
      const now = Math.floor(Date.now() / 1000);
      if (now >= market.close_ts) {
        void refreshNow();
        void refreshCloses();
      }
    }, 5000);

    return () => {
      window.clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [market]);

  useEffect(() => {
    if (!market?.market_id) return;
    let supabase;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }

    const marketId = market.market_id;
    const channel = supabase
      .channel(`chart-toasts:market_${marketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `market_id=eq.${marketId}`,
        },
        (payload) => {
          const row = payload.new as EventRow;
          if (!row || row.kind !== "PlaceBetAttempted" || !row.success) return;
          const intent =
            (row.decision as any)?.intent ??
            (row.args as any)?.intent ??
            (row.args as any);
          const sideRaw = String(intent?.side ?? "");
          const side = sideRaw === "yes" || sideRaw === "no" ? sideRaw : null;
          const amountRaw = intent?.amount ?? (row.args as any)?.amount;
          const amountNum = Number(amountRaw);
          if (!side || !Number.isFinite(amountNum) || amountNum <= 0) return;

          const toast = {
            id: row.id,
            side,
            amount: amountNum,
          } as const;

          setTradeToasts((prev) => {
            const next = [...prev, toast].slice(-3);
            return next;
          });

          window.setTimeout(() => {
            setTradeToasts((prev) => prev.filter((t) => t.id !== toast.id));
          }, 1200);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [market?.market_id]);

  const priceToBeat = useMemo(
    () => strikeToUsd(market?.strike_price ?? null),
    [market?.strike_price],
  );
  const delta =
    price != null && priceToBeat != null ? price - priceToBeat : null;
  const dateLabel = dateRangeLabel(
    market?.open_ts ?? null,
    market?.close_ts ?? null,
  );

  return (
    <section className="overflow-hidden rounded-3xl bg-card shadow-[0_1px_0_0_rgba(255,255,255,0.04),0_30px_60px_-30px_rgba(0,0,0,0.4)]">
      <header className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <BtcMark />
          <div className="flex flex-col">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Bitcoin Up or Down
            </h2>
            <p className="text-sm text-muted-foreground">
              {market ? (
                <>
                  Market #{market.market_id}
                  {dateLabel ? <> · {dateLabel}</> : null}
                </>
              ) : (
                "Waiting for the next window…"
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <MarketCountdown closeTs={market?.close_ts ?? null} />
          <RecentClosesStrip outcomes={closes} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2">
        <Stat
          label="Price to beat"
          value={`$${priceToBeat != null ? formatPrice(priceToBeat) : "—"}`}
          mute
        />
        <Stat
          label="Current price"
          value={`$${price != null ? formatPrice(price) : "—"}`}
          accent
          trailing={<PriceDelta delta={delta} />}
        />
      </div>

      <div className="px-2 pb-2">
        <BtcLiveChart
          history={history}
          priceToBeat={priceToBeat}
          tradeToasts={tradeToasts}
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  trailing,
  mute,
  accent,
}: {
  label: string;
  value: string;
  trailing?: React.ReactNode;
  mute?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-baseline gap-3">
        <span
          className={
            "font-display text-3xl font-semibold tracking-tight tabular " +
            (accent ? "text-brand" : mute ? "text-foreground" : "text-foreground")
          }
        >
          {value}
        </span>
        {trailing}
      </div>
    </div>
  );
}

function BtcMark() {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-10 w-10 shrink-0 overflow-hidden rounded-full shadow-sm ring-1 ring-black/10 dark:ring-white/10"
    >
      <Image
        src="/BTC.png"
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 object-cover"
        priority
      />
    </span>
  );
}
