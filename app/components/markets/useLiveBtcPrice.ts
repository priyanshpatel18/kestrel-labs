"use client";

import { useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  decodeOraclePriceFromAccountData,
  decodeOraclePublishTimeFromAccountData,
} from "@/lib/oraclePrice";

const DEFAULT_RPC = "https://devnet.magicblock.app";
const DEFAULT_FEED = "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr";

const PREBUFFER_SECONDS = 40;
/** Visible history window on the chart (seconds). */
const HISTORY_WINDOW_SEC = 40;
/** Hard cap (~40s at high refresh). */
const MAX_POINTS = 3000;

/** Per-frame blend toward oracle target (lower = silkier). */
const SMOOTH_ALPHA = 0.085;

export interface PricePoint {
  /** Unix time in seconds (fractional) — monotonic, many points per wall second. */
  time: number;
  value: number;
}

export interface LiveBtcPrice {
  price: number | null;
  history: PricePoint[];
  lastTickAt: number | null;
  /** Pyth `publish_time` in unix seconds (from the oracle account itself). */
  publishTimeSec: number | null;
}

function rpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_KESTREL_ORACLE_RPC_URL?.trim() || DEFAULT_RPC
  );
}

function feedPubkey(): PublicKey {
  const s =
    process.env.NEXT_PUBLIC_KESTREL_BTC_ORACLE_PUBKEY?.trim() || DEFAULT_FEED;
  return new PublicKey(s);
}

function seedPrebuffer(price: number): PricePoint[] {
  const t0 = Date.now() / 1000;
  const points: PricePoint[] = [];
  for (let i = PREBUFFER_SECONDS; i >= 0; i--) {
    points.push({ time: t0 - i, value: price });
  }
  return points;
}

function trimHistory(arr: PricePoint[]) {
  if (arr.length < 2) return;
  const newest = arr[arr.length - 1].time;
  while (arr.length > 2 && newest - arr[0].time > HISTORY_WINDOW_SEC) {
    arr.shift();
  }
  while (arr.length > MAX_POINTS) {
    arr.shift();
  }
}

export function useLiveBtcPrice(): LiveBtcPrice {
  const [state, setState] = useState<LiveBtcPrice>({
    price: null,
    history: [],
    lastTickAt: null,
    publishTimeSec: null,
  });
  const historyRef = useRef<PricePoint[]>([]);
  const publishTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    const connection = new Connection(rpcUrl(), "confirmed");
    let pubkey: PublicKey;
    try {
      pubkey = feedPubkey();
    } catch {
      return;
    }

    const model = {
      target: null as number | null,
      smoothed: null as number | null,
      loopStarted: false,
    };

    const commit = () => {
      if (cancelled) return;
      const arr = historyRef.current;
      const last = arr[arr.length - 1];
      setState({
        price: model.smoothed,
        history: arr.slice(),
        lastTickAt: last?.time ?? null,
        publishTimeSec: publishTimeRef.current,
      });
    };

    const tick = () => {
      if (cancelled) return;

      if (
        model.smoothed == null ||
        model.target == null ||
        historyRef.current.length === 0
      ) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      model.smoothed += (model.target - model.smoothed) * SMOOTH_ALPHA;

      const arr = historyRef.current;
      const last = arr[arr.length - 1];
      let t = Date.now() / 1000;
      if (t <= last.time) {
        t = last.time + 1e-4;
      }
      const y = model.smoothed;
      arr.push({ time: t, value: y });
      trimHistory(arr);

      commit();
      rafId = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (model.loopStarted || cancelled) return;
      model.loopStarted = true;
      rafId = requestAnimationFrame(tick);
    };

    const setOracleTarget = (price: number) => {
      if (!Number.isFinite(price)) return;
      model.target = price;
      if (model.smoothed == null) {
        model.smoothed = price;
      }
    };

    void connection.getAccountInfo(pubkey, "confirmed").then((info) => {
      if (cancelled || !info?.data) return;
      const decoded = decodeOraclePriceFromAccountData(info.data);
      if (decoded == null || !Number.isFinite(decoded)) return;
      const pubTs = decodeOraclePublishTimeFromAccountData(info.data);
      if (pubTs != null && Number.isFinite(pubTs)) {
        publishTimeRef.current = pubTs;
      }
      historyRef.current = seedPrebuffer(decoded);
      model.target = decoded;
      model.smoothed = decoded;
      commit();
      startLoop();
    });

    const subId = connection.onAccountChange(
      pubkey,
      (info) => {
        const decoded = decodeOraclePriceFromAccountData(info.data);
        if (decoded == null || !Number.isFinite(decoded)) return;
        const pubTs = decodeOraclePublishTimeFromAccountData(info.data);
        if (pubTs != null && Number.isFinite(pubTs)) {
          publishTimeRef.current = pubTs;
        }
        setOracleTarget(decoded);
        startLoop();
      },
      { commitment: "confirmed" },
    );

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      void connection.removeAccountChangeListener(subId);
    };
  }, []);

  return state;
}
