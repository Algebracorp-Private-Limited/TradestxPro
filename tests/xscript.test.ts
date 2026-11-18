import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_SCRIPTS, XScriptError, runXScript } from "../lib/xscript/xscript.ts";
import * as ta from "../lib/ta/indicators.ts";

const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + Math.sin(i / 10) * 10 + i * 0.05;
  return { t: 1_700_000_000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 7) * 100 };
});
const close = bars.map((b) => b.c);

test("plots built-in indicators identically to the engine", () => {
  const r = runXScript("plot(ema(close, 20))\nplot(rsi(close, 14))", bars);
  assert.equal(r.plots.length, 2);
  assert.deepEqual(r.plots[0].values.slice(19), ta.ema(close, 20).slice(19));
  assert.equal(r.plots[1].values[299], ta.rsi(close, 14)[299]);
});

test("arithmetic, variables, history and ternary", () => {
  const r = runXScript("x = close - close[1]\ny = x > 0 ? 1 : -1\nplot(y)", bars);
  const v = r.plots[0].values;
  assert.ok(Number.isNaN(v[0]) || v[0] === -1); // close[1] is NaN on first bar -> comparison false
  assert.equal(v[1], close[1] > close[0] ? 1 : -1);
});

test("operator precedence", () => {
  assert.equal(runXScript("2 + 3 * 4", bars).last, 14);
  assert.equal(runXScript("(2 + 3) * 4", bars).last, 20);
  assert.equal(runXScript("-2 * 3", bars).last, -6);
  assert.equal(runXScript("1 < 2 and 3 > 4 or 1", bars).last, 1);
  assert.equal(runXScript("not 1 < 2", bars).last, 0);
});

test("indicator(), input() overrides, hline, signal and overlay detection", () => {
  const code = `indicator("Test", overlay=false)\nlen = input(10, "Length")\nplot(sma(close, len))\nhline(50)\nsignal(crossover(close, sma(close, len)), "X")`;
  const r = runXScript(code, bars, { Length: 5 });
  assert.equal(r.title, "Test");
  assert.equal(r.overlay, false);
  assert.equal(r.plots[0].pane, "separate");
  assert.equal(r.inputs[0].value, 5);
  assert.deepEqual(r.plots[0].values.slice(4, 6), ta.sma(close, 5).slice(4, 6));
  assert.equal(r.hlines[0].value, 50);
  assert.ok(r.markers.length > 0);
});

test("screener-style condition returns last-bar truth", () => {
  const r = runXScript("rsi(close, 14) > 0 and close > 0", bars);
  assert.equal(r.last, 1);
});

test("helpful errors with line numbers", () => {
  const cases: [string, RegExp][] = [
    ["plot(foo)", /Line 1:6 — Unknown name "foo"/],
    ["x = 1\nplot(emaa(close, 3))", /Line 2:6 — Unknown function "emaa"/],
    ["sma(close)", /sma\(\) takes 2 arguments, got 1/],
    ["sma(close, 0)", /Length must be a whole number/],
    ["plot(close, color=\"nope\")", /Unknown color/],
    ["close = 1", /"close" is reserved/],
    ["plot(close", /Expected/],
    ["a = 'unterminated", /Unclosed string/],
    ["x = 1 $ 2", /Unexpected character/],
  ];
  for (const [code, re] of cases) {
    assert.throws(() => runXScript(code, bars), (e: unknown) => e instanceof XScriptError && re.test(e.message), code);
  }
});

test("cannot reach JavaScript", () => {
  for (const code of ["constructor", "globalThis", "process", "eval(1)", "Function(1)", "toString()"]) {
    assert.throws(() => runXScript(code, bars), XScriptError, code);
  }
});

test("all example scripts run", () => {
  for (const ex of EXAMPLE_SCRIPTS) {
    const r = runXScript(ex.code, bars);
    assert.ok(r.plots.length > 0, ex.name);
  }
});
