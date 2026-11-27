import test from "node:test";
import assert from "node:assert/strict";
import { freshDb, makeUser, noDbReason, scratchDb } from "./helpers/test-db.ts";
import { advanceScan, createScan, getScan, scanResults } from "../lib/intelligence/market-scan/jobs.ts";
import { eodFutures } from "../lib/intelligence/market-data/data.ts";
import { bsPrice } from "../lib/options/bs.ts";

const NOW = new Date("2026-11-26T14:00:00Z");
const EXP = "2026-12-29";

function weekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date("2026-11-26T00:00:00Z");
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** Synthetic uptrending underlying (not market data) with option and futures rows for one session. */
async function seed(sql: Awaited<ReturnType<typeof freshDb>>) {
  const days = weekdays(260);
  const f = (i: number) => 100 * Math.exp(i * 0.004) * (1 + 0.01 * Math.sin(i / 3));
  const rows = days.map((d, i) => ({ series: "NSE:UPCO", d, o: f(Math.max(0, i - 1)), h: Math.max(f(i), f(Math.max(0, i - 1))) * 1.006, l: Math.min(f(i), f(Math.max(0, i - 1))) * 0.994, c: f(i), v: 2e6 }));
  await sql`INSERT INTO candles ${sql(rows)}`;
  await sql`INSERT INTO candles (series, d, o, h, l, c, v) SELECT 'NSEIDX:NIFTY 50', d, o * 85, h * 85, l * 85, c * 85, 0 FROM candles WHERE series = 'NSE:UPCO'`;
  const spot = rows.at(-1)!.c;
  await sql`INSERT INTO screener_snapshot (symbol, d, name, close, change_pct, ema50, ret20, rel_vol, adx14, ema200, high52, low52, has_derivatives)
            VALUES ('UPCO', '2026-11-26', 'Up Co', ${spot}, 1, ${spot * 0.9}, 4, 1.2, 25, ${spot * 0.8}, ${spot * 1.1}, ${spot * 0.7}, true)`;
  await sql`INSERT INTO index_constituents (index_key, symbol, industry) VALUES ('TEST A', 'UPCO', 'Widgets'), ('TEST A', 'NOFO', 'Widgets')`;
  await sql`INSERT INTO candles (series, d, o, h, l, c, v) SELECT 'NSE:NOFO', d, o, h, l, c, v FROM candles WHERE series = 'NSE:UPCO'`;
  const T = (Date.parse(`${EXP}T10:00:00Z`) - NOW.getTime()) / (365 * 864e5);
  const opt = (und: string, inst: string, S: number, step: number, lot: number) => {
    const out = [];
    for (let k = -10; k <= 10; k++) for (const o of ["CE", "PE"] as const) {
      const K = Math.round(S / step) * step + k * step;
      out.push({ d: "2026-11-26", underlying: und, inst, expiry: EXP, strike: K, opt: o, close: Math.max(0.05, Math.round(bsPrice({ S, K, T, r: 0.065, sigma: 0.25, right: o }) * 20) / 20), prev_close: null, underlying_px: S, oi_qty: 1e5, oi_chg_qty: 1e3, contracts: 100, lot });
    }
    return out;
  };
  await sql`INSERT INTO fo_contracts ${sql([...opt("UPCO", "STO", spot, 5, 1000), ...opt("NIFTY", "IDO", spot * 85, 50, 75)])}`;
  await sql`INSERT INTO fo_futures ${sql([
    { d: "2026-11-26", underlying: "UPCO", inst: "STF", expiry: EXP, close: spot * 1.006, prev_close: spot * 0.995, settle: spot * 1.006, underlying_px: spot, oi_qty: 5e6, oi_chg_qty: 1e5, contracts: 3000, lot: 1000 },
    { d: "2026-11-26", underlying: "NIFTY", inst: "IDF", expiry: EXP, close: spot * 85 * 1.005, prev_close: spot * 85, settle: spot * 85 * 1.005, underlying_px: spot * 85, oi_qty: 1e7, oi_chg_qty: 2e5, contracts: 9e4, lot: 75 },
  ])}`;
}

test("F&O scan: futures and strategy results for stock and index underlyings; BUY ONLY honoured; EOD never enters", { skip: noDbReason }, async () => {
  const sql = await freshDb("intel_fo_scan");
  try {
    await seed(sql);
    const u = await makeUser(sql, "fo@example.test");
    const cfg = { universes: ["TEST A"], instruments: ["stock-futures", "stock-options", "index-futures", "index-options"], capital: 2e6, maxRiskPerTrade: 50_000, maxCapitalPerTrade: 2e6, minRewardRisk: 1.2, optionBuyingOnly: true, definedRiskOnly: false };
    const job = await createScan(sql, u, cfg, "comprehensive", null);
    const [{ kind }] = await sql<{ kind: string }[]>`SELECT kind FROM scan_jobs WHERE id = ${job.id}`;
    assert.equal(kind, "fo");
    let s = (await getScan(sql, u, job.id))!;
    assert.equal(s.remaining, 3, "IDX:NIFTY + UPCO + NOFO");
    for (let i = 0; i < 5 && s.status !== "completed"; i++) s = (await advanceScan(sql, job.id, u, { now: NOW }))!;
    assert.equal(s.status, "completed");
    assert.deepEqual(s.coverage.instrumentsNotScanned, []);
    assert.ok(s.coverage.chainsRetrieved >= 2);
    assert.ok(Object.keys(s.coverage.excluded).some((k) => k.startsWith("no F&O data")), JSON.stringify(s.coverage.excluded));
    const res = await scanResults(sql, u, job.id, { pageSize: 50 });
    const rows = res.results as { key: string; kind: string; status: string; payload: Record<string, unknown> }[];
    assert.ok(rows.some((r) => r.key === "UPCO|FUT" && r.kind === "futures"));
    assert.ok(rows.some((r) => r.key === "NIFTY|FUT"));
    const strats = rows.filter((r) => r.kind === "strategy");
    assert.ok(strats.some((r) => r.key.startsWith("UPCO|STRAT|")) && strats.some((r) => r.key.startsWith("NIFTY|STRAT|")));
    assert.ok(strats.every((r) => r.payload.classification === "BUY_ONLY"), "BUY ONLY filter");
    assert.ok(rows.every((r) => !["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"].includes(r.status)), "EOD data never yields an entry");
    assert.ok(!rows.some((r) => r.key === "NOFO" || r.key.startsWith("NOFO|")), "equity not requested");
  } finally {
    await sql.end();
  }
});

test("eodFutures reports the dataset as not configured when migration 004 is absent", { skip: noDbReason }, async () => {
  const { sql } = await scratchDb("intel_fo_nomig", { migrate: false });
  try {
    const r = await eodFutures(sql, ["NIFTY"]);
    assert.deepEqual(r.value, []);
    assert.match(r.provenance.missing[0], /not configured/);
  } finally {
    await sql.end();
  }
});
