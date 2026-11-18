import "server-only";
import type { Bar } from "./ta/catalog";

// Delta Exchange India public market data (no API key needed for candles, tickers, products).
const BASE = "https://api.india.delta.exchange";

export const DELTA_RESOLUTIONS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
};

type Cache<T> = { at: number; value: T };
const g = globalThis as unknown as { __deltaCache?: Map<string, Cache<unknown>> };
const cache = (g.__deltaCache ??= new Map());

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cache<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Delta Exchange responded ${res.status}`);
  const body = (await res.json()) as { success: boolean; result: T };
  if (!body.success) throw new Error("Delta Exchange returned an error");
  return body.result;
}

export async function deltaCandles(symbol: string, resolution: string, count = 1000): Promise<Bar[]> {
  const step = DELTA_RESOLUTIONS[resolution];
  if (!step) throw new Error("Unsupported resolution");
  const end = Math.floor(Date.now() / 1000);
  const start = end - step * Math.min(count, 2000);
  const ttl = step <= 300 ? 15_000 : 60_000;
  return cached(`c:${symbol}:${resolution}`, ttl, async () => {
    const rows = await get<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]>(
      `/v2/history/candles?resolution=${resolution}&symbol=${encodeURIComponent(symbol)}&start=${start}&end=${end}`,
    );
    return rows
      .map((r) => ({ t: r.time, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume ?? 0 }))
      .sort((a, b) => a.t - b.t);
  });
}

export type DeltaProduct = { symbol: string; description: string; type: string };

/** Perpetual futures and spot pairs (options are excluded from the chart symbol list). */
export async function deltaProducts(): Promise<DeltaProduct[]> {
  return cached("products", 3600_000, async () => {
    const out: DeltaProduct[] = [];
    let after = "";
    for (let page = 0; page < 5; page++) {
      const res = await fetch(`${BASE}/v2/products?page_size=1000${after ? `&after=${encodeURIComponent(after)}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Delta Exchange responded ${res.status}`);
      const body = (await res.json()) as { result: { symbol: string; description: string; contract_type: string; state: string }[]; meta: { after: string | null } };
      for (const p of body.result) {
        if ((p.contract_type === "perpetual_futures" || p.contract_type === "spot") && p.state === "live") {
          out.push({ symbol: p.symbol, description: p.description, type: p.contract_type });
        }
      }
      if (!body.meta?.after) break;
      after = body.meta.after;
    }
    return out;
  });
}
