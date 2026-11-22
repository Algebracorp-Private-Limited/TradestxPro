import "server-only";
import { db } from "./db";
import { getQuotes, type Quote } from "./brokers/quotes";
import { BSE_INDICES, DEFAULT_DASHBOARD_INDICES } from "./index-catalog";
import { isVaultConfigured } from "./brokers/vault";

export type Tile = {
  key: string;
  name: string;
  group: "NSE" | "BSE";
  chartSymbol: string;
  live: Quote | null;
  eod: { close: number; changePct: number | null; date: string } | null;
};

export async function getDashboardKeys(userId: number): Promise<{ keys: string[]; custom: boolean }> {
  const sql = await db();
  const [r] = await sql<{ dashboard_indices: string[] }[]>`SELECT dashboard_indices FROM user_prefs WHERE user_id = ${userId}`;
  return r && r.dashboard_indices.length ? { keys: r.dashboard_indices, custom: true } : { keys: DEFAULT_DASHBOARD_INDICES, custom: false };
}

export async function validIndexKeys(keys: string[]): Promise<string[]> {
  const sql = await db();
  const upper = [...new Set(keys.map((k) => String(k).toUpperCase().slice(0, 80)))];
  const rows = upper.length ? await sql<{ key: string }[]>`SELECT key FROM market_indices WHERE key IN ${sql(upper)}` : [];
  const ok = new Set([...rows.map((r) => r.key), ...BSE_INDICES.map((b) => b.key)]);
  return upper.filter((k) => ok.has(k));
}

export async function buildTiles(userId: number, keys: string[]): Promise<{ tiles: Tile[]; broker: string | null; error?: string }> {
  const sql = await db();
  const eodRows = keys.length
    ? await sql<{ key: string; name: string; close: number | null; change_pct: number | null; last_d: Date | null }[]>`
        SELECT key, name, close, change_pct, last_d FROM market_indices WHERE key IN ${sql(keys)}`
    : [];
  const eod = new Map(eodRows.map((r) => [r.key, r]));
  const q = isVaultConfigured()
    ? await getQuotes(userId, keys.map((k) => ({ key: k, kind: "index" as const, symbol: k }))).catch(() => null)
    : null;
  const tiles: Tile[] = keys.map((k) => {
    const bse = BSE_INDICES.find((b) => b.key === k);
    const e = eod.get(k);
    return {
      key: k,
      name: bse?.name ?? e?.name ?? k,
      group: bse ? "BSE" : "NSE",
      chartSymbol: bse ? `BSEIDX:${k}` : `NSEIDX:${k}`,
      live: q?.quotes[k] ?? null,
      eod: e && e.close !== null && e.last_d ? { close: e.close, changePct: e.change_pct, date: e.last_d.toISOString().slice(0, 10) } : null,
    };
  });
  return { tiles, broker: q?.brokerName ?? null, error: q?.error };
}
