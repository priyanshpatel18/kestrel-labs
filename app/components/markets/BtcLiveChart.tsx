"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  ColorType,
  LineStyle,
  LineSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { Connection, PublicKey } from "@solana/web3.js";

import { decodeOraclePriceFromAccountData } from "@/lib/oraclePrice";

const DEFAULT_RPC = "https://devnet.magicblock.app";
/** Devnet BTC/USD pull oracle feed (README); override with NEXT_PUBLIC_KESTREL_BTC_ORACLE_PUBKEY. */
const DEFAULT_FEED = "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr";

const MAX_POINTS = 600;

function utcNumber(time: Time): number | null {
  return typeof time === "number" ? time : null;
}

function chartRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_KESTREL_ORACLE_RPC_URL?.trim() || DEFAULT_RPC
  );
}

function feedPubkey(): PublicKey {
  const s =
    process.env.NEXT_PUBLIC_KESTREL_BTC_ORACLE_PUBKEY?.trim() || DEFAULT_FEED;
  return new PublicKey(s);
}

export function BtcLiveChart({
  strikeUsd,
  height = 280,
}: {
  /** Strike from indexer / on-chain when the window opened — not derived from the chart. */
  strikeUsd?: number | null;
  height?: number;
}) {
  const feedPreview = useMemo(() => {
    try {
      return feedPubkey().toBase58();
    } catch {
      return DEFAULT_FEED.slice(0, 8);
    }
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const pointsRef = useRef<{ time: Time; value: number }[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#737373",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(0,0,0,0.06)" },
        horzLines: { color: "rgba(0,0,0,0.06)" },
      },
      width: el.clientWidth,
      height,
      timeScale: {
        borderColor: "#e5e5e5",
        timeVisible: true,
        secondsVisible: true,
      },
      rightPriceScale: {
        borderColor: "#e5e5e5",
      },
      crosshair: {
        vertLine: {
          color: "rgba(0,0,0,0.12)",
          style: LineStyle.Dashed,
          width: 1,
        },
        horzLine: {
          color: "rgba(0,0,0,0.12)",
          style: LineStyle.Dashed,
          width: 1,
        },
      },
    });

    const series = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 2,
      crosshairMarkerBackgroundColor: "#f59e0b",
      crosshairMarkerBorderColor: "#0a0a0a",
      crosshairMarkerBorderWidth: 1,
      crosshairMarkerRadius: 4,
      title: "BTC",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      const s = seriesRef.current;
      const pl = priceLineRef.current;
      if (s && pl) s.removePriceLine(pl);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLineRef.current = null;
      pointsRef.current = [];
    };
  }, [height]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const prev = priceLineRef.current;
    if (prev) {
      series.removePriceLine(prev);
      priceLineRef.current = null;
    }

    if (
      strikeUsd == null ||
      !Number.isFinite(strikeUsd) ||
      strikeUsd <= 0
    ) {
      return;
    }

    priceLineRef.current = series.createPriceLine({
      price: strikeUsd,
      color: "#f59e0b",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "Strike",
    });

    return () => {
      const s = seriesRef.current;
      const pl = priceLineRef.current;
      if (s && pl) s.removePriceLine(pl);
      priceLineRef.current = null;
    };
  }, [strikeUsd]);

  useEffect(() => {
    const connection = new Connection(chartRpcUrl(), "confirmed");
    const pubkey = feedPubkey();

    const sub = connection.onAccountChange(
      pubkey,
      (info) => {
        const decoded = decodeOraclePriceFromAccountData(info.data);
        if (decoded == null || !Number.isFinite(decoded)) return;

        const t = Date.now() / 1000;
        const arr = pointsRef.current;
        const last = arr[arr.length - 1];
        const prevN = last ? utcNumber(last.time) : null;
        const tn =
          prevN !== null && t <= prevN ? prevN + 1e-6 : t;
        arr.push({ time: tn as Time, value: decoded });
        if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);

        const s = seriesRef.current;
        if (s) s.setData(arr);
      },
      { commitment: "confirmed" },
    );

    void connection.getAccountInfo(pubkey, "confirmed").then((acc) => {
      if (!acc?.data) return;
      const decoded = decodeOraclePriceFromAccountData(acc.data);
      if (decoded == null || !Number.isFinite(decoded)) return;
      const t = Date.now() / 1000;
      pointsRef.current = [{ time: t as Time, value: decoded }];
      seriesRef.current?.setData(pointsRef.current);
    });

    return () => {
      void connection.removeAccountChangeListener(sub);
    };
  }, []);

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-md border border-border bg-muted/20"
        style={{ height }}
      />
      <p className="mt-1 text-[10px] text-muted-foreground">
        Live BTC/USD from on-chain oracle account (
        <span className="font-mono">{feedPreview.slice(0, 8)}…</span>
        ). Strike line is the market open price from the indexer, not computed
        here.
      </p>
    </div>
  );
}
