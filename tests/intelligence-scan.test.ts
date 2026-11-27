import test from "node:test";
import assert from "node:assert/strict";
import { freshDb, makeUser, noDbReason } from "./helpers/test-db.ts";
import { advanceScan, cancelScan, createScan, getScan, listScans, saveScanConfig, listScanConfigs, scanResults, ScanError } from "../lib/intelligence/market-scan/jobs.ts";
import { AIClient } from "../lib/intelligence/ai-providers/client.ts";
import { MockProvider } from "../lib/intelligence/ai-providers/providers.ts";
import { parseFundamentals } from "../lib/intelligence/fundamentals/dataset.ts";
import { getCompany, importFundamentals, peersOf } from "../lib/intelligence/fundamentals/store.ts";
import { dashboardData } from "../lib/intelligence/dashboard.ts";

const NOW = new Date("2026-11-26T14:00:00Z");

/** Weekday dates ending 2026-11-26 (synthetic series: these are not market data). */
function weekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date("2026-11-26T00:00:00Z");
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

async function seed(sql: Awaited<ReturnType<typeof freshDb>>) {
  const days = weekdays(260);
  const shapes: Record<string, (i: number) => number> = {
    UPCO: (i) => 100 * Math.exp(i * 0.004) * (1 + 0.01 * Math.sin(i / 3)),
    BRKO: (i) => (i < 259 ? 500 + 6 * Math.sin(i / 4) : 525),
    DOWNCO: (i) => 300 * Math.exp(-i * 0.004),
    FLATCO: (i) => 200 + 3 * Math.sin(i / 2.5),
    THIN: (i) => 50 + i * 0.05,
  };
  for (const [sym, f] of Object.entries(shapes)) {
    const rows = days.map((d, i) => {
      const c = f(i), o = f(Math.max(0, i - 1));
      return { series: `NSE:${sym}`, d, o, h: Math.max(o, c) * 1.006, l: Math.min(o, c) * 0.994, c, v: sym === "THIN" ? 50 : sym === "BRKO" && i === 259 ? 9e6 : 2e6 };
    });
    await sql`INSERT INTO candles ${sql(rows)}`;
    const last = rows[rows.length - 1];
    await sql`INSERT INTO screener_snapshot (symbol, d, name, close, change_pct, ema50, ret20, rel_vol, adx14, ema200, high52, low52, has_derivatives)
              VALUES (${sym}, '2026-11-26', ${sym + " Ltd"}, ${last.c}, ${sym === "DOWNCO" ? -1 : 1}, ${sym === "DOWNCO" ? last.c * 1.1 : last.c * 0.9}, ${sym === "DOWNCO" ? -5 : 4}, 1.2, 25, ${last.c * 0.8}, ${last.c * 1.1}, ${last.c * 0.7}, false)`;
  }
  await sql`INSERT INTO index_constituents (index_key, symbol, industry) VALUES ('TEST A', 'UPCO', 'Widgets'), ('TEST A', 'BRKO', 'Widgets'), ('TEST A', 'DOWNCO', 'Gadgets'),
            ('TEST B', 'BRKO', 'Widgets'), ('TEST B', 'FLATCO', 'Gadgets'), ('TEST B', 'THIN', 'Gadgets'), ('TEST B', 'NOBARS', 'Gadgets')`;
  await sql`INSERT INTO candles (series, d, o, h, l, c, v) SELECT 'NSEIDX:NIFTY 50', d, o, h, l, c, v FROM candles WHERE series = 'NSE:UPCO'`;
  await sql`INSERT INTO market_indices (key, name, close, change_pct, last_d) VALUES ('NIFTY 50', 'Nifty 50', 24000, 0.5, '2026-11-26'), ('INDIA VIX', 'India VIX', 13.2, -2.1, '2026-11-26')`;
}

test("scan jobs: coverage, dedup, chunked leased processing, cancellation, isolation, AI explanations", { skip: noDbReason }, async () => {
  const sql = await freshDb("intel_scan");
  try {
    await seed(sql);
    const alice = await makeUser(sql, "alice@example.test"), bob = await makeUser(sql, "bob@example.test");
    const cfg = { universes: ["TEST A", "TEST B", "TEST MISSING"], horizon: "swing", capital: 1e6, maxRiskPerTrade: 10_000, maxCapitalPerTrade: 300_000, minRewardRisk: 1.5, minLiquidity: 1e7 };
    const job = await createScan(sql, alice, cfg, "comprehensive", "idem-key-0001");
    assert.equal((await createScan(sql, alice, cfg, "comprehensive", "idem-key-0001")).id, job.id, "idempotent");
    let s = (await getScan(sql, alice, job.id))!;
    assert.equal(s.coverage.selected, 7);
    assert.equal(s.coverage.unique, 6);
    assert.equal(s.coverage.duplicates, 1);
    assert.deepEqual(s.coverage.unavailableUniverses, ["TEST MISSING"]);
    assert.equal(await getScan(sql, bob, job.id), null, "another user cannot see the job");
    assert.equal(await advanceScan(sql, job.id, bob), null, "or advance it");

    // Two concurrent advances: only one gets the lease.
    const ai = new AIClient({ providers: [new MockProvider(Array.from({ length: 10 }, () => ({ text: JSON.stringify({ summary: "Breakout confirmed on volume.", reasoning: [], risks: [], avoidIf: [] }), model: "mock-1", inputTokens: 100, outputTokens: 20 })))], pricing: { "mock-1": { input: 4, output: 20 } }, sleep: async () => {} });
    const [a, b] = await Promise.all([advanceScan(sql, job.id, alice, { chunk: 4, now: NOW, ai }), advanceScan(sql, job.id, alice, { chunk: 4, now: NOW, ai })]);
    const after = Math.max(a!.coverage.scanned, b!.coverage.scanned);
    assert.equal(after, 4, "exactly one chunk processed");
    s = (await advanceScan(sql, job.id, alice, { chunk: 4, now: NOW, ai }))!;
    assert.equal(s.status, "completed");
    assert.equal(s.coverage.scanned, 6);
    assert.equal(s.coverage.missingData >= 1, true, "NOBARS has no history");
    assert.equal(s.coverage.excluded["no price history"], 1);
    const opp = s.coverage.opportunities;
    assert.equal(Object.values(opp).reduce((x, y) => x + y, 0), 5, "every symbol with data has a status");
    assert.ok(opp["NO TRADE"] >= 1, "bearish DOWNCO is NO TRADE for cash equity");

    const res = await scanResults(sql, alice, job.id, { pageSize: 2 });
    assert.equal(res.total, 5);
    assert.equal(res.results.length, 2);
    assert.ok((res.results[0].score ?? -1) >= (res.results[1].score ?? -1), "ranked by score");
    await assert.rejects(scanResults(sql, bob, job.id), (e: unknown) => e instanceof ScanError && e.status === 404);
    const brko = (await scanResults(sql, alice, job.id, { pageSize: 50 })).results.find((r) => r.symbol === "BRKO")!;
    assert.equal((brko.payload as { setup: string }).setup, "Breakout");
    if (["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"].includes(brko.status)) {
      assert.equal((brko.payload as { explanation?: { source: string } }).explanation?.source, "ai", "top candidates get grounded AI explanations");
      assert.ok(s.coverage.aiRequests >= 1 && s.coverage.aiCostUsd > 0, "AI usage and cost recorded in coverage");
    }

    // Accelerated mode: shortlist reported, not presented as comprehensive.
    const acc = await createScan(sql, alice, { ...cfg, universes: ["TEST A", "TEST B"] }, "accelerated", null);
    const sa = (await getScan(sql, alice, acc.id))!;
    assert.equal(sa.coverage.mode, "accelerated");
    assert.ok(sa.coverage.shortlisted !== null && sa.coverage.notDeepEvaluated === sa.coverage.unique - sa.coverage.shortlisted);
    assert.ok(sa.coverage.notDeepEvaluated >= 1);

    // Cancellation and the concurrent-scan limit.
    const c2 = await createScan(sql, alice, cfg, "comprehensive", null);
    await assert.rejects(createScan(sql, alice, cfg, "comprehensive", null), (e: unknown) => e instanceof ScanError && e.status === 429);
    assert.equal(await cancelScan(sql, alice, c2.id), true);
    assert.equal((await advanceScan(sql, c2.id, alice, { now: NOW }))!.status, "cancelled");
    assert.equal(await cancelScan(sql, bob, acc.id), false);
    assert.ok((await listScans(sql, alice)).length >= 3);
    assert.equal((await listScans(sql, bob)).length, 0);

    await saveScanConfig(sql, alice, "My swing scan", cfg);
    assert.equal((await listScanConfigs(sql, alice))[0].config.universes.length, 3);
    assert.equal((await listScanConfigs(sql, bob)).length, 0);

    // Fundamentals store and dashboard.
    const ds = parseFundamentals({
      format: "txp-fundamentals", version: 1, revision: "t1", provider: { id: "test", name: "Test", source: { name: "synthetic" }, retrievedAt: "2026-06-01" },
      companies: Object.fromEntries(["UPCO", "BRKO"].map((sym) => [sym, { name: sym, industry: "Widgets", periods: [2024, 2025].map((y) => ({ period: `FY${y}`, periodEnd: `${y}-03-31`, reportedAt: `${y}-05-15`, type: "annual", consolidated: true, revenue: 1000, ebitda: 200, operatingProfit: 150, netProfit: 100, eps: 10, operatingCashFlow: 120, capex: 40, totalDebt: 200, cash: 50, equity: 800, interestExpense: 20, sharesOutstanding: 10 })) }])),
    });
    assert.equal(await importFundamentals(sql, ds), 2);
    assert.equal((await getCompany(sql, "UPCO"))!.company.industry, "Widgets");
    assert.deepEqual((await peersOf(sql, "UPCO", "Widgets")).map((p) => p.symbol), ["BRKO"]);
    const d = await dashboardData(sql, NOW);
    assert.equal(d.provenance.freshness, "eod");
    assert.ok(d.marketRegime, "NIFTY 50 regime computed");
    assert.equal(d.breadth!.total, 5);
    assert.ok(d.sectors.length >= 1);
    assert.equal(d.vix!.close, 13.2);
  } finally {
    await sql.end();
  }
});
