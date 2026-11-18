import type { Metadata } from "next";
import { Screener } from "@/components/screener";

export const metadata: Metadata = { title: "Stock Screener" };

export default function ScreenerPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stock Screener</h1>
        <p className="mt-1 text-sm text-muted">Scan every NSE equity on price, volume, trend and momentum. Click a symbol to open its chart.</p>
      </div>
      <Screener />
    </>
  );
}
