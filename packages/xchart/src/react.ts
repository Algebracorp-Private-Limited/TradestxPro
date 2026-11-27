/**
 * React bindings for XChart. React is an optional peer dependency: import from
 * "@tradestxpro/xchart/react" only in React applications.
 *
 * SSR-safe: nothing touches the DOM until the component mounts in the browser.
 */
import { createElement, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createChart } from "./index.ts";
import type { ChartApi, ChartOptions } from "./types.ts";

/** Creates a chart in the returned ref's element after mount and removes it on unmount. */
export function useXChart(options: ChartOptions = {}): { ref: RefObject<HTMLDivElement | null>; chart: ChartApi | null } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [chart, setChart] = useState<ChartApi | null>(null);
  // Options are applied once at creation; use chart.applyOptions() for later changes.
  const initial = useRef(options);
  useEffect(() => {
    if (!ref.current) return;
    const c = createChart(ref.current, initial.current);
    setChart(c);
    return () => {
      c.remove();
      setChart(null);
    };
  }, []);
  return { ref, chart };
}

export type XChartProps = {
  options?: ChartOptions;
  /** Called once with the chart after it is created (add series, indicators … here). */
  onReady?: (chart: ChartApi) => void | (() => void);
  className?: string;
  style?: CSSProperties;
};

/** A container element with a chart inside. Size it with `className` / `style` (the chart follows the container). */
export function XChart({ options, onReady, className, style }: XChartProps) {
  const { ref, chart } = useXChart(options);
  const ready = useRef(onReady);
  useEffect(() => {
    if (!chart || !ready.current) return;
    const cleanup = ready.current(chart);
    return typeof cleanup === "function" ? cleanup : undefined;
  }, [chart]);
  return createElement("div", { ref, className, style: { position: "relative", ...style } });
}
