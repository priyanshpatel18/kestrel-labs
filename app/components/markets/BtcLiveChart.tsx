"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import {
  ColorType,
  LineSeries,
  LineStyle,
  LineType,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

import type { PricePoint } from "./useLiveBtcPrice";

/** Brand line on the chart (lightweight-charts needs hex). */
const CHART_LINE_COLOR = "#F08E19";
const CHART_LINE_WIDTH = 3;
const TARGET_LINE_WIDTH = 2;

interface BtcLiveChartProps {
  history: PricePoint[];
  /** Grey dotted "Target" line in USD. */
  priceToBeat?: number | null;
  height?: number;
}

/** lightweight-charts only accepts hex/rgb/rgba — not lab()/oklch() from getComputedStyle. */
const PALETTE = {
  dark: {
    textMuted: "#a1a1aa",
    gridLine: "rgba(255,255,255,0.06)",
    crosshair: "rgba(255,255,255,0.18)",
    markerBorder: "#171717",
    targetLine: "#9ca3af",
  },
  light: {
    textMuted: "#71717a",
    gridLine: "rgba(0,0,0,0.08)",
    crosshair: "rgba(0,0,0,0.15)",
    markerBorder: "#fafafa",
    targetLine: "#71717a",
  },
} as const;

/** Keep strike in view: Y scale always spans live price and target (with padding). */
function mergeTargetIntoAutoscale(
  original: () => AutoscaleInfo | null,
  target: number | null,
): AutoscaleInfo | null {
  if (target == null || !Number.isFinite(target) || target <= 0) {
    return original();
  }
  const base = original();
  if (base === null || base.priceRange === null) {
    const pad = Math.max(Math.abs(target) * 1e-6, 25);
    return { priceRange: { minValue: target - pad, maxValue: target + pad } };
  }
  const pr = base.priceRange;
  const lo = Math.min(pr.minValue, pr.maxValue);
  const hi = Math.max(pr.minValue, pr.maxValue);
  const yMin = Math.min(lo, target);
  const yMax = Math.max(hi, target);
  const span = Math.max(yMax - yMin, 1e-9);
  const pad = span * 0.07;
  return {
    priceRange: {
      minValue: yMin - pad,
      maxValue: yMax + pad,
    },
    ...(base.margins ? { margins: base.margins } : {}),
  };
}

export function BtcLiveChart({
  history,
  priceToBeat,
  height = 300,
}: BtcLiveChartProps) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const c = PALETTE[theme];

  const priceToBeatRef = useRef<number | null>(null);
  priceToBeatRef.current =
    priceToBeat != null && Number.isFinite(priceToBeat) && priceToBeat > 0
      ? priceToBeat
      : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const targetLineRef = useRef<IPriceLine | null>(null);
  /** Sync incremental `update` vs full `setData` after trim or chart rebuild. */
  const appliedPointCountRef = useRef(0);
  const appliedHeadTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.textMuted,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: c.gridLine },
      },
      width: el.clientWidth,
      height,
      timeScale: {
        visible: false,
        borderVisible: false,
        rightOffset: 4,
        barSpacing: 0.4,
        minBarSpacing: 0.2,
      },
      rightPriceScale: {
        borderVisible: false,
      },
      leftPriceScale: { visible: false },
      crosshair: {
        vertLine: {
          color: c.crosshair,
          style: LineStyle.Dashed,
          width: 1,
        },
        horzLine: {
          color: c.crosshair,
          style: LineStyle.Dashed,
          width: 1,
        },
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(LineSeries, {
      color: CHART_LINE_COLOR,
      lineWidth: CHART_LINE_WIDTH,
      lineType: LineType.Curved,
      crosshairMarkerBackgroundColor: CHART_LINE_COLOR,
      crosshairMarkerBorderColor: c.markerBorder,
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerRadius: 5,
      lastValueVisible: true,
      priceLineVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      autoscaleInfoProvider: (orig: () => AutoscaleInfo | null) =>
        mergeTargetIntoAutoscale(orig, priceToBeatRef.current),
    });

    chartRef.current = chart;
    seriesRef.current = series;
    appliedPointCountRef.current = 0;
    appliedHeadTimeRef.current = null;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      const s = seriesRef.current;
      const tl = targetLineRef.current;
      if (s && tl) s.removePriceLine(tl);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      targetLineRef.current = null;
    };
  }, [height, theme, c]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (history.length === 0) {
      series.setData([]);
      appliedPointCountRef.current = 0;
      appliedHeadTimeRef.current = null;
      chartRef.current?.priceScale("right").setAutoScale(true);
      return;
    }

    const headT = history[0].time;
    const prevHead = appliedHeadTimeRef.current;
    const prevCount = appliedPointCountRef.current;

    const needsFullReload =
      prevCount === 0 ||
      history.length < prevCount ||
      (prevHead !== null && headT !== prevHead);

    if (needsFullReload) {
      series.setData(
        history.map((p) => ({
          time: p.time as Time,
          value: p.value,
        })),
      );
      appliedPointCountRef.current = history.length;
      appliedHeadTimeRef.current = headT;
      chartRef.current?.priceScale("right").setAutoScale(true);
      return;
    }

    for (let i = prevCount; i < history.length; i++) {
      series.update({
        time: history[i].time as Time,
        value: history[i].value,
      });
    }
    appliedPointCountRef.current = history.length;
    chartRef.current?.timeScale().scrollToRealTime();
    chartRef.current?.priceScale("right").setAutoScale(true);
  }, [history]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const prev = targetLineRef.current;
    if (prev) {
      series.removePriceLine(prev);
      targetLineRef.current = null;
    }

    if (
      priceToBeat == null ||
      !Number.isFinite(priceToBeat) ||
      priceToBeat <= 0
    ) {
      chartRef.current?.priceScale("right").setAutoScale(true);
      return;
    }

    targetLineRef.current = series.createPriceLine({
      price: priceToBeat,
      color: c.targetLine,
      lineWidth: TARGET_LINE_WIDTH,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: "Target",
    });

    chartRef.current?.priceScale("right").setAutoScale(true);

    return () => {
      const s = seriesRef.current;
      const tl = targetLineRef.current;
      if (s && tl) s.removePriceLine(tl);
      targetLineRef.current = null;
    };
  }, [priceToBeat, c]);

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height }}
    />
  );
}
