"use client";

import { useEffect, useState } from "react";
import type { Bar } from "@/lib/ta/catalog";

export type BarsState = {
  status: "loading" | "ready" | "error";
  bars: Bar[];
  name: string;
  source: string;
  delayed: string | null;
  error?: string;
};

/** Loads bars for a chart symbol; refreshes every 30 s for live (non end-of-day) sources. */
export function useBars(symbol: string, tf: string): BarsState {
  const [state, setState] = useState<BarsState>({ status: "loading", bars: [], name: "", source: "", delayed: null });

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (first: boolean) => {
      try {
        const res = await fetch(`/api/charts/bars?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`);
        const d = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(d.error ?? "Could not load chart data.");
        setState({ status: "ready", bars: d.bars, name: d.name, source: d.source, delayed: d.delayed });
        if (!d.delayed) timer = setTimeout(() => load(false), 30_000);
      } catch (e) {
        if (alive && first) setState((s) => ({ ...s, status: "error", error: (e as Error).message }));
      }
    };
    Promise.resolve().then(() => {
      if (alive) setState((s) => ({ ...s, status: "loading" }));
      load(true);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [symbol, tf]);

  return state;
}
