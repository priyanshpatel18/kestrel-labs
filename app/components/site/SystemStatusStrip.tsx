"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useLiveBtcPrice } from "@/components/markets/useLiveBtcPrice";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { EventRow, MarketRow } from "@/lib/types";

const ER_FRESH_MS = 30_000;
const ORACLE_STALE_AFTER_SEC = 30;
const HEALTH_REFRESH_MS = 5_000;

interface HealthResp {
  ok: boolean;
  slot?: number | null;
  servedAt?: number;
}

type ToneClass = string;

function Pill({
  label,
  value,
  tone = "muted",
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "ok" | "warn" | "bad" | "muted" | "info";
  title?: string;
}) {
  const tones: Record<string, ToneClass> = {
    ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warn: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
    bad: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
    info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  };
  return (
    <div
      title={title}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
        tones[tone],
      )}
    >
      <span className="text-[10px] uppercase tracking-wide opacity-70">
        {label}
      </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function fmtSecs(s: number): string {
  if (!Number.isFinite(s)) return "—";
  if (s < 60) return `${Math.max(0, Math.floor(s))}s`;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

function fmtMs(ms: number): string {
  return fmtSecs(ms / 1000);
}

/**
 * One-line systemic state summary that lives directly under TopNav. Designed
 * to give judges a 5-second answer to "is the ER live, is the oracle fresh,
 * what is the active market doing right now?".
 */
export function SystemStatusStrip() {
  const { publishTimeSec } = useLiveBtcPrice();

  const [now, setNow] = useState(Date.now());
  const [erLastEventAt, setErLastEventAt] = useState<number | null>(null);
  const [lastCommitAt, setLastCommitAt] = useState<number | null>(null);
  const [activeMarket, setActiveMarket] = useState<MarketRow | null>(null);
  const [haltedMarket, setHaltedMarket] = useState<MarketRow | null>(null);
  const [health, setHealth] = useState<HealthResp | null>(null);

  const sbRef = useRef<ReturnType<typeof getBrowserSupabase> | null>(null);

  // wall clock tick — drives countdown / staleness display
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // base-layer health
  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;
    const tick = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = (await r.json()) as HealthResp;
        if (!cancelled) setHealth(j);
      } catch {
        if (!cancelled) setHealth({ ok: false });
      }
      timer = setTimeout(tick, HEALTH_REFRESH_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Initial loads + realtime subscriptions to events / markets.
  useEffect(() => {
    let cancelled = false;
    let sb: ReturnType<typeof getBrowserSupabase>;
    try {
      sb = getBrowserSupabase();
    } catch {
      return; // supabase not configured — strip will render with muted pills
    }
    sbRef.current = sb;

    const loadInitial = async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const [activeRes, haltedRes, lastEr, lastCommit] = await Promise.all([
        sb
          .from("markets")
          .select("*")
          .lte("open_ts", nowSec)
          .gte("close_ts", nowSec)
          .order("market_id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("markets")
          .select("*")
          .eq("status", "halted")
          .order("market_id", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("events")
          .select("inserted_at,block_time")
          .eq("cluster", "er")
          .order("inserted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("events")
          .select("inserted_at,block_time")
          .eq("kind", "commit_and_undelegate_market")
          .order("inserted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setActiveMarket((activeRes.data as MarketRow | null) ?? null);
      setHaltedMarket((haltedRes.data as MarketRow | null) ?? null);
      const erIso = lastEr.data?.block_time ?? lastEr.data?.inserted_at;
      setErLastEventAt(erIso ? new Date(erIso).getTime() : null);
      const commIso =
        lastCommit.data?.block_time ?? lastCommit.data?.inserted_at;
      setLastCommitAt(commIso ? new Date(commIso).getTime() : null);
    };
    void loadInitial();

    const eventsCh = sb
      .channel("status:events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as EventRow;
          const iso = row.block_time ?? row.inserted_at;
          const t = iso ? new Date(iso).getTime() : Date.now();
          if (row.cluster === "er") setErLastEventAt(t);
          if (row.kind === "commit_and_undelegate_market") {
            setLastCommitAt(t);
          }
        },
      )
      .subscribe();

    const marketsCh = sb
      .channel("status:markets")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "markets" },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as MarketRow | undefined;
          if (!row) return;
          // Recompute active vs halted from this row's status alone — good
          // enough for the strip.
          if (row.status === "halted") {
            setHaltedMarket(row);
            // If the active row was this same market, keep it for window
            // display but mark halted.
            setActiveMarket((prev) =>
              prev && prev.market_id === row.market_id ? row : prev,
            );
            return;
          }
          if (row.status === "open") {
            setActiveMarket(row);
            setHaltedMarket((prev) =>
              prev && prev.market_id === row.market_id ? null : prev,
            );
            return;
          }
          if (row.status === "closed" || row.status === "settled") {
            setActiveMarket((prev) =>
              prev && prev.market_id === row.market_id ? null : prev,
            );
            setHaltedMarket((prev) =>
              prev && prev.market_id === row.market_id ? null : prev,
            );
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void sb.removeChannel(eventsCh);
      void sb.removeChannel(marketsCh);
    };
  }, []);

  const erTone: "ok" | "warn" | "bad" = useMemo(() => {
    if (!erLastEventAt) return "warn";
    const age = now - erLastEventAt;
    if (age < ER_FRESH_MS) return "ok";
    if (age < ER_FRESH_MS * 4) return "warn";
    return "bad";
  }, [erLastEventAt, now]);

  const oracleAgeSec = publishTimeSec
    ? Math.max(0, Math.floor(now / 1000) - publishTimeSec)
    : null;
  const oracleTone: "ok" | "warn" | "bad" =
    oracleAgeSec == null
      ? "warn"
      : oracleAgeSec <= ORACLE_STALE_AFTER_SEC
        ? "ok"
        : oracleAgeSec <= ORACLE_STALE_AFTER_SEC * 2
          ? "warn"
          : "bad";

  const haltActive = !!haltedMarket;
  const liveMarket = haltedMarket ?? activeMarket;
  const windowSecsLeft = liveMarket?.close_ts
    ? Math.max(0, liveMarket.close_ts - Math.floor(now / 1000))
    : null;

  const baseSlot = health?.slot ?? null;
  const baseTone: "ok" | "warn" | "bad" = health?.ok
    ? baseSlot
      ? "ok"
      : "warn"
    : "bad";

  return (
    <div
      className={cn(
        "sticky top-14 z-20 border-b border-border/60 bg-background/70 backdrop-blur",
      )}
      data-testid="system-status-strip"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-6 py-2 text-xs">
        <Pill
          label="ER"
          tone={erTone}
          value={
            erLastEventAt
              ? `active ${fmtMs(now - erLastEventAt)} ago`
              : "no events yet"
          }
          title="Time since the most recent ER cluster event was indexed."
        />
        <Pill
          label="Base"
          tone={baseTone}
          value={baseSlot ? `slot ${baseSlot.toLocaleString()}` : "…"}
          title={`Solana base layer slot from /api/health (${health?.servedAt ? new Date(health.servedAt).toLocaleTimeString() : "—"}).`}
        />
        <Pill
          label="Oracle"
          tone={oracleTone}
          value={
            oracleAgeSec != null
              ? `${fmtSecs(oracleAgeSec)} since publish`
              : "no feed"
          }
          title={`Pyth publish_time delta. Stale at >${ORACLE_STALE_AFTER_SEC}s — place_bet returns OracleStale.`}
        />
        <Pill
          label="Window"
          tone={liveMarket ? "info" : "muted"}
          value={
            liveMarket
              ? `#${liveMarket.market_id} • ${windowSecsLeft != null ? fmtSecs(windowSecsLeft) + " left" : "—"}`
              : "no live market"
          }
        />
        <Pill
          label="Halt"
          tone={haltActive ? "bad" : "ok"}
          value={haltActive ? "HALTED" : "open"}
          title={haltActive ? `Market #${haltedMarket?.market_id} halted by admin/MarketOps.` : undefined}
        />
        <Pill
          label="Last commit"
          tone={lastCommitAt ? "info" : "muted"}
          value={lastCommitAt ? `${fmtMs(now - lastCommitAt)} ago` : "—"}
          title="Time since the most recent commit_and_undelegate_market event."
        />
      </div>
    </div>
  );
}
