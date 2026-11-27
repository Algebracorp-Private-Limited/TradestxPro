import test from "node:test";
import assert from "node:assert/strict";
import { freshDb, makeUser, noDbReason } from "./helpers/test-db.ts";
import { contractsOf, dailyBars, eodChain, latestSnapshot, resolveInstrument, resolveUniverse } from "../lib/intelligence/market-data/data.ts";
import { listAnalyses, recordAnalysis, recordUsage, usageSummary } from "../lib/intelligence/audit/store.ts";

const NOW = new Date("2026-11-26T14:00:00Z"); // Thursday 19:30 IST, after the close

test("market data with provenance, instrument resolution, universes, immutable analyses", { skip: noDbReason }, async () => {
  const sql = await freshDb("intel_data");
  try {
    // Reference and EOD data (synthetic rows for the test).
    await sql`INSERT INTO market_indices (key, name) VALUES ('NIFTY 50', 'Nifty 50'), ('NIFTY IT', 'Nifty IT')`;
    await sql`INSERT INTO instruments (exchange, token, symbol, breeze_code, name, series, isin, tick_size, lot_size, has_derivatives)
              VALUES ('NSE', '2885', 'RELIANCE', 'RELIND', 'Reliance Industries', 'EQ', 'INE002A01018', 0.1, 1, true),
                     ('NSE', '11536', 'TCS', 'TCS', 'Tata Consultancy Services', 'EQ', 'INE467B01029', 0.1, 1, true)`;
    await sql`INSERT INTO index_constituents (index_key, symbol, name, industry, isin) VALUES
              ('NIFTY 50', 'RELIANCE', 'Reliance', 'Oil Gas & Consumable Fuels', 'INE002A01018'), ('NIFTY 50', 'TCS', 'TCS', 'Information Technology', null),
              ('NIFTY IT', 'TCS', 'TCS', 'Information Technology', null), ('NIFTY IT', 'INFY', 'Infosys', 'Information Technology', null)`;
    await sql`INSERT INTO derivative_contracts (exchange, token, instrument_type, underlying, underlying_name, breeze_code, expiry, strike, option_type, lot_size, tick_size) VALUES
              ('NFO', '1', 'FUTSTK', 'RELIANCE', 'Reliance', 'RELIND', '2099-12-31', null, null, 500, 0.1),
              ('NFO', '2', 'OPTSTK', 'RELIANCE', 'Reliance', 'RELIND', '2099-12-31', 1300, 'CE', 500, 0.05),
              ('NFO', '3', 'OPTSTK', 'RELIANCE', 'Reliance', 'RELIND', '2099-12-31', 1300, 'PE', 500, 0.05)`;
    for (let i = 0; i < 5; i++) {
      const d = `2026-11-${String(20 + i).padStart(2, "0")}`;
      if ([new Date(d).getUTCDay()].some((x) => x === 0 || x === 6)) continue;
      await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:RELIANCE', ${d}, 100, 102, 99, 101, 1000)`;
    }
    await sql`INSERT INTO candles (series, d, o, h, l, c, v) VALUES ('NSE:RELIANCE', '2026-11-26', 101, 104, 100, 103, 1500)`;
    await sql`INSERT INTO fo_contracts (d, underlying, inst, expiry, strike, opt, close, prev_close, underlying_px, oi_qty, oi_chg_qty, contracts, lot)
              VALUES ('2026-11-26', 'RELIANCE', 'OPTSTK', '2099-12-31', 1300, 'CE', 25.5, 22, 1290, 100000, 5000, 1200, 500)`;
    await sql`INSERT INTO screener_snapshot (symbol, d, name, close, change_pct, has_derivatives) VALUES ('RELIANCE', '2026-11-26', 'Reliance', 103, 1.9, true), ('TCS', '2026-11-26', 'TCS', 3500, -0.5, true)`;

    const bars = await dailyBars(sql, "NSE:RELIANCE", 400, NOW);
    assert.equal(bars.value.length, 4, "20–24 Nov has a weekend: 3 weekday bars + 26 Nov");
    assert.equal(bars.provenance.freshness, "eod");
    assert.equal(bars.provenance.exchangeTime, "2026-11-26");
    assert.equal(bars.provenance.source, "nse-equity-bhavcopy");
    const stale = await dailyBars(sql, "NSE:RELIANCE", 400, new Date("2026-12-01T14:00:00Z"));
    assert.equal(stale.provenance.freshness, "stale", "a later evaluation date makes the same data stale");
    const none = await dailyBars(sql, "NSE:NOPE", 10, NOW);
    assert.deepEqual(none.provenance.missing, ["daily bars"]);

    const chain = await eodChain(sql, "RELIANCE", null, NOW);
    assert.equal(chain.value[0].oi, 100000);
    assert.ok(chain.provenance.missing.includes("bid"), "EOD chain declares what it lacks");
    assert.equal((await latestSnapshot(sql, ["RELIANCE"], NOW)).value[0].close, 103);

    const eq = await resolveInstrument(sql, "NSE:RELIANCE");
    assert.equal(eq!.isin, "INE002A01018");
    assert.equal(eq!.industry, "Oil Gas & Consumable Fuels");
    assert.deepEqual(eq!.indexMembership, ["NIFTY 50"]);
    const ce = await resolveInstrument(sql, "NFO:OPT:RELIANCE:2099-12-31:1300:CE");
    assert.equal(ce!.lotSize, 500);
    assert.equal(ce!.settlement, "physical");
    assert.equal(await resolveInstrument(sql, "NFO:OPT:RELIANCE:2099-12-31:1350:CE"), null, "nonexistent contract");
    assert.equal(await resolveInstrument(sql, "garbage"), null);
    assert.equal((await contractsOf(sql, "RELIANCE", { kind: "option" })).length, 2);

    const u = await resolveUniverse(sql, ["NIFTY 50", "NIFTY IT", "NIFTY PHARMA", "ALL_FO_UNDERLYINGS"]);
    assert.deepEqual(u.symbols, ["INFY", "RELIANCE", "TCS"]);
    assert.equal(u.duplicates, 2);
    assert.deepEqual(u.unavailable, ["NIFTY PHARMA"], "an index without constituent data is reported, not silently skipped");

    // Analyses: immutable, user-scoped.
    const a = await makeUser(sql, "a@example.test"), b = await makeUser(sql, "b@example.test");
    const id = await recordAnalysis(sql, { userId: a, kind: "equity", target: "NSE:RELIANCE", versions: { engine: "equity", engineVersion: "1", dataVersion: "2026-11-26" }, input: { close: 103 }, output: { status: "WATCHLIST" } });
    assert.ok(id);
    await assert.rejects(sql`UPDATE ai_analyses SET output = '{"status":"ENTER IF CONFIRMED"}' WHERE id = ${id}`, /immutable/);
    assert.equal((await listAnalyses(sql, a)).length, 1);
    assert.equal((await listAnalyses(sql, b)).length, 0, "another user's analyses are invisible");
    await recordUsage(sql, { at: NOW.toISOString(), userId: a, provider: "anthropic", model: "claude-opus-5-5", promptId: "p", promptVersion: "1", inputTokens: 1000, outputTokens: 200, costUsd: 0.008, latencyMs: 1200, outcome: "ok" });
    const sum = await usageSummary(sql, 3650);
    assert.equal(sum![0].requests, 1);
  } finally {
    await sql.end();
  }
});
