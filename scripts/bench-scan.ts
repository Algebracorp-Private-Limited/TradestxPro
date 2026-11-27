/**
 * Scanner throughput benchmark on SYNTHETIC data in a scratch database (never production).
 *
 *   TEST_DATABASE_URL=postgres://… node --experimental-strip-types scripts/bench-scan.ts [sizes] [foSizes]
 *
 * Seeds N synthetic equities (300 daily bars each) into `<db>_bench_scan`, then times comprehensive scans
 * through the real job code (createScan + leased advanceScan chunks, as the status poll / cron would).
 * F&O runs seed option chains (21 strikes × 2 rights × 1 expiry) and futures for each underlying.
 * Measures database + CPU time on this machine only: it says nothing about market-data provider latency.
 */
import { scratchDb, makeUser } from "../tests/helpers/test-db.ts";
import { advanceScan, createScan, getScan } from "../lib/intelligence/market-scan/jobs.ts";
import { bsPrice } from "../lib/options/bs.ts";

const sizes = (process.argv[2] ?? "50,100,200,500,2000").split(",").map(Number);
const foSizes = (process.argv[3] ?? "50,180").split(",").map(Number);
if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to a scratch Postgres (never production).");

const { sql } = await scratchDb("bench_scan");
const days: string[] = [];
for (const d = new Date("2026-11-26T00:00:00Z"); days.length < 300; d.setUTCDate(d.getUTCDate() - 1)) if (d.getUTCDay() % 6 !== 0) days.unshift(d.toISOString().slice(0, 10));
const maxN = Math.max(...sizes, ...foSizes);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
console.log(`seeding ${maxN} synthetic symbols × ${days.length} bars…`);
for (let s = 0; s < maxN; s += 20) {
  const rows = [];
  const snaps = [];
  for (let k = s; k < Math.min(maxN, s + 20); k++) {
    let c = 50 + rnd() * 500;
    const drift = (rnd() - 0.45) * 0.003;
    for (const d of days) {
      const o = c;
      c *= 1 + drift + (rnd() - 0.5) * 0.03;
      rows.push({ series: `NSE:S${k}`, d, o, h: Math.max(o, c) * 1.008, l: Math.min(o, c) * 0.992, c, v: 1e5 + rnd() * 5e6 });
    }
    snaps.push({ symbol: `S${k}`, d: "2026-11-26", name: `Synthetic ${k}`, close: c, change_pct: 0, ema50: c * 0.97, ret20: 2, rel_vol: 1.1, adx14: 22, ema200: c * 0.9, high52: c * 1.1, low52: c * 0.7, has_derivatives: k < Math.max(...foSizes) });
  }
  await sql`INSERT INTO candles ${sql(rows)}`;
  await sql`INSERT INTO screener_snapshot ${sql(snaps)}`;
}
for (const n of [...sizes, ...foSizes]) await sql`INSERT INTO index_constituents ${sql(Array.from({ length: n }, (_, k) => ({ index_key: `BENCH ${n}`, symbol: `S${k}`, industry: "Synthetic" })))} ON CONFLICT DO NOTHING`;
// F&O rows for the first max(foSizes) symbols.
const foN = Math.max(...foSizes);
const T = 33 / 365;
for (let s = 0; s < foN; s += 20) {
  const opt = [], fut = [];
  for (let k = s; k < Math.min(foN, s + 20); k++) {
    const [last] = await sql<{ c: number }[]>`SELECT c FROM candles WHERE series = ${`NSE:S${k}`} ORDER BY d DESC LIMIT 1`;
    const S = Number(last.c), step = S > 1000 ? 20 : S > 200 ? 5 : 1;
    for (let j = -10; j <= 10; j++) for (const right of ["CE", "PE"] as const) {
      const K = Math.round(S / step) * step + j * step;
      opt.push({ d: "2026-11-26", underlying: `S${k}`, inst: "STO", expiry: "2026-12-29", strike: K, opt: right, close: Math.max(0.05, bsPrice({ S, K, T, r: 0.065, sigma: 0.3, right })), prev_close: null, underlying_px: S, oi_qty: 1e5, oi_chg_qty: 0, contracts: 100, lot: 500 });
    }
    fut.push({ d: "2026-11-26", underlying: `S${k}`, inst: "STF", expiry: "2026-12-29", close: S * 1.005, prev_close: S, settle: S * 1.005, underlying_px: S, oi_qty: 1e6, oi_chg_qty: 1e4, contracts: 500, lot: 500 });
  }
  await sql`INSERT INTO fo_contracts ${sql(opt)}`;
  await sql`INSERT INTO fo_futures ${sql(fut)}`;
}

const user = await makeUser(sql, "bench@example.test");
const now = new Date("2026-11-26T14:00:00Z");
async function run(universe: string, instruments: string[]) {
  const t0 = performance.now();
  const job = await createScan(sql, user, { universes: [universe], instruments, capital: 1e6, maxRiskPerTrade: 1e4, maxCapitalPerTrade: 3e5, minRewardRisk: 1.5, minLiquidity: 0, definedRiskOnly: true }, "comprehensive", null);
  let s = (await getScan(sql, user, job.id))!;
  let chunks = 0;
  while (s.status === "queued" || s.status === "running") { s = (await advanceScan(sql, job.id, user, { chunk: 40, now }))!; chunks++; }
  const ms = performance.now() - t0;
  await sql`DELETE FROM scan_jobs WHERE id = ${job.id}`;
  return { universe, instruments: instruments.join("+"), status: s.status, unique: s.coverage.unique, scanned: s.coverage.scanned, chainsRetrieved: s.coverage.chainsRetrieved, contractsEvaluated: s.coverage.contractsEvaluated, dbRequests: s.coverage.marketDataRequests, chunks, totalMs: Math.round(ms), msPerSymbol: Math.round((ms / Math.max(1, s.coverage.scanned)) * 10) / 10, aiRequests: s.coverage.aiRequests };
}
const results = [];
for (const n of sizes) results.push(await run(`BENCH ${n}`, ["equity"]));
for (const n of foSizes) results.push(await run(`BENCH ${n}`, ["stock-futures", "stock-options"]));
console.table(results);
console.log(JSON.stringify({ machine: `${process.platform} ${process.arch} node ${process.version}`, results }));
await sql.end();
