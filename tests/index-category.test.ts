import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByCategory, indexCategory } from "../lib/index-catalog.ts";

test("NSE index families", () => {
  const cases: [string, string][] = [
    ["NIFTY 50", "Broad market"], ["NIFTY MIDCAP 150", "Broad market"], ["NIFTY BANK", "Sectoral"], ["NIFTY IT", "Sectoral"],
    ["NIFTY INDIA DEFENCE", "Thematic"], ["NIFTY CPSE", "Thematic"], ["NIFTY100 ESG", "Thematic"],
    ["NIFTY200 MOMENTUM 30", "Strategy"], ["NIFTY ALPHA 50", "Strategy"], ["NIFTY50 EQUAL WEIGHT", "Strategy"], ["NIFTY MIDCAP150 QUALITY 50", "Strategy"],
    ["NIFTY 10 YR BENCHMARK G-SEC", "Fixed income"], ["NIFTY BHARAT BOND INDEX - APRIL 2030", "Fixed income"], ["NIFTY 1D RATE INDEX", "Fixed income"],
    ["INDIA VIX", "Volatility & derivatives"], ["NIFTY50 TR 2X LEVERAGE", "Volatility & derivatives"], ["NIFTY 50 FUTURES INDEX", "Volatility & derivatives"],
  ];
  for (const [k, c] of cases) assert.equal(indexCategory(k), c, k);
});

test("grouping keeps order and drops empty families", () => {
  const g = groupByCategory([{ key: "NIFTY IT" }, { key: "NIFTY 50" }, { key: "NIFTY BANK" }]);
  assert.deepEqual(g.map((x) => [x.category, x.items.map((i) => i.key)]), [["Broad market", ["NIFTY 50"]], ["Sectoral", ["NIFTY IT", "NIFTY BANK"]]]);
});
