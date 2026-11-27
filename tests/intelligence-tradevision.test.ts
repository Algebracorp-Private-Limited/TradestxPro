import { test } from "node:test";
import assert from "node:assert/strict";
import { validateChartSpec, type ChartSpec } from "../lib/intelligence/tradevision/spec.ts";
import { buildEquitySpec, clusterLevels, pivots, type Bar } from "../lib/intelligence/tradevision/zones.ts";
import { acceptAnnotation, annotateChart, annotationFacts, deterministicAnnotation } from "../lib/intelligence/tradevision/annotate.ts";
import { netGreeks, payoffCurves, pnl, riskIntelligence, scenarioGrid, stressTests, type PosLeg } from "../lib/intelligence/tradevision/scenarios.ts";
import { AIClient } from "../lib/intelligence/ai-providers/client.ts";
import { MockProvider } from "../lib/intelligence/ai-providers/providers.ts";
import { bsPrice } from "../lib/options/bs.ts";
import { listIndicators } from "../lib/xchart-sdk/indicators/index.ts";

const IDS = listIndicators().map((d) => d.id);
const DAY = 86400;
const T0 = Date.parse("2026-01-01T00:00:00Z") / 1000;

/** Synthetic oscillating series with a clear range (100–120) and one impulse (not market data). */
function bars(n = 200): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const c = 110 + 9 * Math.sin(i / 6) + (i === n - 30 ? 0 : 0);
    out.push({ t: T0 + i * DAY, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1e5 });
  }
  // Impulse up at n-30 from a tight base at n-31.
  const k = n - 30;
  out[k - 1] = { ...out[k - 1], o: 104, h: 104.6, l: 103.6, c: 104.2 };
  out[k] = { ...out[k], o: 104.3, h: 112, l: 104.1, c: 111.5 };
  for (let i = k + 1; i < n; i++) out[i] = { ...out[i], l: Math.max(out[i].l, 105), c: Math.max(out[i].c, 106), o: Math.max(out[i].o, 105.5), h: Math.max(out[i].h, 106.5) };
  return out;
}
const window = { from: T0, to: T0 + 199 * DAY, low: 100, high: 120 };

// ---------------- Spec validation ----------------
test("spec: valid elements pass; unknown kinds/fields, code-like text, bad prices and times are rejected", () => {
  const good = [
    { id: "a", kind: "level", source: "engine", role: "support", price: 105, label: "Support 105", evidence: "3 touches" },
    { id: "b", kind: "zone", source: "ai", role: "demand", from: T0 + 10 * DAY, to: null, low: 101, high: 103, label: "Demand", evidence: "base" },
    { id: "c", kind: "marker", source: "engine", time: T0 + 5 * DAY, position: "belowBar", shape: "arrowUp", label: "B", evidence: "x" },
    { id: "d", kind: "indicator", source: "engine", indicator: IDS[0], params: { length: 20 }, label: "MA", evidence: "x" },
  ];
  const bad = [
    { id: "e", kind: "script", source: "ai", label: "x", evidence: "x" },
    { id: "f", kind: "level", source: "ai", role: "support", price: 105, label: "x", evidence: "x", onClick: "alert(1)" },
    { id: "g", kind: "level", source: "ai", role: "support", price: 105, label: "<img src=x onerror=alert(1)>", evidence: "x" },
    { id: "h", kind: "level", source: "ai", role: "support", price: 9999, label: "far", evidence: "x" },
    { id: "i", kind: "level", source: "ai", role: "support", price: Number.NaN, label: "nan", evidence: "x" },
    { id: "j", kind: "zone", source: "ai", role: "demand", from: T0 - 400 * DAY, to: null, low: 101, high: 103, label: "old", evidence: "x" },
    { id: "k", kind: "zone", source: "ai", role: "demand", from: T0 + DAY, to: null, low: 104, high: 103, label: "inverted", evidence: "x" },
    { id: "l", kind: "indicator", source: "ai", indicator: "evil", params: {}, label: "x", evidence: "x" },
    { id: "a", kind: "level", source: "ai", role: "support", price: 106, label: "dup id", evidence: "x" },
    { id: "m", kind: "level", source: "ai", role: "buy-now", price: 106, label: "bad role", evidence: "x" },
    { id: "n", kind: "level", source: "ai", role: "support", price: 106, label: "x", evidence: "() => fetch('/x')" },
  ];
  const { spec, issues } = validateChartSpec({ instrument: "X", elements: [...good, ...bad] }, { window, indicatorIds: IDS });
  assert.deepEqual(spec.elements.map((e) => e.id), ["a", "b", "c", "d"]);
  assert.ok(issues.length >= bad.length);
  assert.ok(issues.some((i) => /unknown fields: onClick/.test(i.message)));
  assert.ok(issues.some((i) => /markup or code/.test(i.message)));
  assert.ok(issues.some((i) => /outside the plausible range/.test(i.message)));
});

test("spec: element count capped; notes cleaned", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, kind: "level", source: "engine", role: "support", price: 105, label: "s", evidence: "e" }));
  const { spec, issues } = validateChartSpec({ elements: many, notes: ["ok note", "<script>"] }, { window, indicatorIds: IDS });
  assert.equal(spec.elements.length, 80);
  assert.deepEqual(spec.notes, ["ok note"]);
  assert.ok(issues.some((i) => /more than 80/.test(i.message)));
});

// ---------------- Zones ----------------
test("pivots and clustering", () => {
  const b = bars();
  const p = pivots(b, 3);
  assert.ok(p.highs.length > 3 && p.lows.length > 3);
  const cl = clusterLevels([{ i: 1, p: 100 }, { i: 5, p: 100.4 }, { i: 9, p: 110 }], 1);
  assert.deepEqual(cl.map((c) => c.touches), [2, 1]);
  assert.equal(cl[0].last, 5);
});

test("buildEquitySpec: levels with evidence, unbroken demand zone, range band; validates cleanly", () => {
  const b = bars();
  const spec = buildEquitySpec("SYN", b, null);
  const { issues } = validateChartSpec(spec, { window: spec.window, indicatorIds: IDS });
  assert.deepEqual(issues, []);
  const last = b.at(-1)!.c;
  const sr = spec.elements.filter((e) => e.kind === "level" && (e.role === "support" || e.role === "resistance"));
  assert.ok(sr.length > 0);
  for (const e of sr) if (e.kind === "level") assert.equal(e.role, e.price < last ? "support" : "resistance");
  assert.ok(sr.every((e) => /touches/.test(e.label) && /swing points/.test(e.evidence)));
  const dz = spec.elements.find((e) => e.kind === "zone" && e.role === "demand");
  assert.ok(dz && dz.kind === "zone" && dz.low <= 103.6 && dz.high >= 104.2, "demand zone at the base candle");
  assert.ok(spec.elements.some((e) => e.id === "range-band"));
  assert.equal(buildEquitySpec("SYN", b.slice(0, 10), null).elements.length, 0);
});

test("buildEquitySpec: trade-plan levels from an equity setup", () => {
  const b = bars();
  const setup = { entry: { low: 110, high: 111 }, stop: 105, targets: [{ price: 116, label: "T1" }], status: "WAIT FOR CONFIRMATION", confirmation: "close above 111", invalidation: "close below 105" } as never;
  const spec = buildEquitySpec("SYN", b, setup);
  assert.ok(spec.elements.some((e) => e.id === "plan-entry"));
  assert.ok(spec.elements.some((e) => e.id === "plan-stop" && e.kind === "level" && e.price === 105));
  assert.ok(spec.elements.some((e) => e.id === "plan-t1"));
});

// ---------------- Annotation ----------------
test("annotation: grounded proposals accepted, ungrounded and invalid rejected, unknown notes dropped", () => {
  const spec: ChartSpec = buildEquitySpec("SYN", bars(), null);
  const f = annotationFacts(spec);
  const someLevel = spec.elements.find((e) => e.kind === "level")!;
  const price = someLevel.kind === "level" ? someLevel.price : 0;
  const acc = acceptAnnotation({
    summary: "s", notes: [{ elementId: someLevel.id, text: "ok" }, { elementId: "ghost", text: "x" }],
    proposals: [{ role: "support", price, label: "Echo", evidence: "from facts" }, { role: "target", price: 133.33, label: "Made up", evidence: "?" }, { role: "support", price, label: "<b>x</b>", evidence: "x" }],
  }, spec, f, IDS);
  assert.equal(acc.notes.length, 1);
  assert.equal(acc.levels.length, 1);
  assert.equal(acc.levels[0].source, "ai");
  assert.ok(acc.rejected.some((r) => /133.33/.test(r)));
  assert.ok(acc.rejected.some((r) => /unknown element ghost/.test(r)));
  assert.ok(acc.rejected.some((r) => /markup/.test(r)));
});

test("annotateChart: AI output with invented numbers falls back to the deterministic summary", async () => {
  const spec = buildEquitySpec("SYN", bars(), null);
  const ok = (o: unknown) => ({ text: JSON.stringify(o), model: "mock-1", inputTokens: 10, outputTokens: 10 });
  const bad = { summary: "Price will reach 987.65 soon.", notes: [], proposals: [] };
  const c = new AIClient({ providers: [new MockProvider([ok(bad), ok(bad), ok(bad)])], pricing: {}, sleep: async () => {}, retries: 0 });
  const r = await annotateChart(c, spec, null);
  assert.equal(r.source, "fallback");
  assert.equal(r.value.summary, deterministicAnnotation(spec).summary);
  const good = { summary: `${spec.instrument} shows clustered swing levels.`, notes: [], proposals: [] };
  const c2 = new AIClient({ providers: [new MockProvider([ok(good)])], pricing: {}, sleep: async () => {}, retries: 0 });
  assert.equal((await annotateChart(c2, spec, null)).source, "ai");
});

// ---------------- Scenarios ----------------
const NOW = new Date("2026-11-18T05:30:00Z");
const EXP = "2026-12-16";
const S = 24000;
const T = (Date.parse(`${EXP}T10:00:00Z`) - NOW.getTime()) / (365 * 86400e3);
const prem = (K: number, right: "CE" | "PE") => bsPrice({ S, K, T, r: 0.065, sigma: 0.15, right });
const leg = (side: "BUY" | "SELL", right: "CE" | "PE", K: number, qty = 75): PosLeg => ({ side, right, strike: K, expiry: EXP, qty, entry: prem(K, right), iv: 0.15 });

test("scenarios: entered at model prices → zero P&L today at no move; expiry curve equals intrinsic payoff", () => {
  const inp = { legs: [leg("BUY", "CE", 24000), leg("SELL", "CE", 24500)], spot: S, now: NOW, atmIv: 0.15 };
  assert.ok(Math.abs(pnl(inp, S, NOW)) < 1e-6);
  const c = payoffCurves(inp);
  assert.equal(c.dates.length, 3);
  const atExp = c.dates[2].points;
  for (const p of atExp.filter((_, i) => i % 10 === 0)) {
    const intr = (Math.max(0, p.s - 24000) - prem(24000, "CE") - Math.max(0, p.s - 24500) + prem(24500, "CE")) * 75;
    assert.ok(Math.abs(p.pnl - intr) < 0.05, `${p.s}: ${p.pnl} vs ${intr}`);
  }
});

test("scenarios: synthetic forward is linear (delta ≈ qty); grid shape; IV shift sign for long vega", () => {
  const syn = { legs: [leg("BUY", "CE", 24000), leg("SELL", "PE", 24000)], spot: S, now: NOW, atmIv: 0.15 };
  const g = netGreeks(syn);
  assert.ok(Math.abs(g.delta - 75) < 1, `delta ${g.delta}`);
  const straddle = { legs: [leg("BUY", "CE", 24000), leg("BUY", "PE", 24000)], spot: S, now: NOW, atmIv: 0.15 };
  const grid = scenarioGrid(straddle);
  assert.equal(grid.values.length, grid.moves.length);
  assert.equal(grid.values[0].length, grid.ivShifts.length);
  const mid = grid.moves.indexOf(0);
  assert.ok(grid.values[mid][grid.ivShifts.indexOf(10)] > 0 && grid.values[mid][grid.ivShifts.indexOf(-10)] < 0, "long vega gains when IV rises");
  assert.ok(netGreeks(straddle).theta < 0);
});

test("stress tests and risk flags for a short strangle", () => {
  const ss = { legs: [leg("SELL", "CE", 25000), leg("SELL", "PE", 23000)], spot: S, now: NOW, atmIv: 0.15 };
  const st = stressTests(ss);
  assert.ok(st.rows.some((r) => /3σ/.test(r.name)));
  assert.ok(st.worst && st.worst.pnl < 0);
  const ri = riskIntelligence(ss);
  assert.ok(ri.flags.some((f) => /unlimited/.test(f)));
  assert.ok(ri.flags.some((f) => /Short volatility/.test(f)));
  assert.equal(ri.margin, null);
  const noIv = stressTests({ ...ss, atmIv: null });
  assert.ok(noIv.notes.some((n) => /skipped/.test(n)));
});

test("scenarios: futures leg moves one-for-one with spot plus basis; options unaffected by the basis", () => {
  const fut: PosLeg = { side: "BUY", right: "FUT", strike: null, expiry: null, qty: 75, entry: S + 100, iv: null };
  const inp = { legs: [fut, leg("BUY", "PE", 24000)], spot: S, now: NOW, atmIv: 0.15, forwardBasis: 100 };
  assert.ok(Math.abs(pnl(inp, S, NOW)) < 1e-6, "zero P&L at entry prices");
  const up = pnl({ ...inp, legs: [fut] }, S + 200, NOW);
  assert.equal(up, 200 * 75);
});
