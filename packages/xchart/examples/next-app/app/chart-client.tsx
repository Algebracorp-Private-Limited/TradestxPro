"use client";
import { XChart } from "@tradestxpro/xchart/react";
import type { CandlestickData } from "@tradestxpro/xchart";

const data: CandlestickData[] = Array.from({ length: 200 }, (_, i) => {
  const c = 100 + Math.sin(i / 10) * 8 + i * 0.05;
  return { time: 1704067200 + i * 86400, open: c - 0.5, high: c + 1, low: c - 1.5, close: c + (i % 2 ? 0.4 : -0.4) };
});

export function ChartClient() {
  return (
    <XChart
      style={{ height: 420 }}
      options={{ theme: "dark" }}
      onReady={(chart) => {
        chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444", wickUpColor: "#22c55e", wickDownColor: "#ef4444" }).setData(data);
        chart.addIndicator("bb");
        (window as unknown as { ready?: boolean }).ready = true;
      }}
    />
  );
}
