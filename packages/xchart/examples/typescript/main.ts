// Type-checks against the published declarations (no DOM access at import time).
import { createChart, type ChartApi, type CandlestickData, type IndicatorDefinition, XChartError } from "@tradestxpro/xchart";
import { XChart, useXChart, type XChartProps } from "@tradestxpro/xchart/react";

export function mount(el: HTMLElement, data: CandlestickData[]): ChartApi {
  const chart = createChart(el, { theme: "light", timeZone: "Asia/Kolkata" });
  chart.addCandlestickSeries().setData(data);
  const ema = chart.addIndicator("ema", { length: 50 });
  ema.applyOptions({ color: "#2563eb" });
  chart.setChartType("renko", { method: "atr", size: 1, atrPeriod: 14 });
  return chart;
}

export const myIndicator: IndicatorDefinition = {
  id: "my-mid", name: "Mid price", description: "(high + low) / 2", params: [], inputs: ["high", "low"],
  outputs: [{ key: "value", label: "Mid", type: "line", color: "#f59e0b" }], pane: "overlay",
  warmup: () => 0,
  calculate: (i) => ({ value: i.high.map((h, k) => (h + i.low[k]) / 2) }),
};

export const isSdkError = (e: unknown) => e instanceof XChartError;
export type { XChartProps };
export { XChart, useXChart };
