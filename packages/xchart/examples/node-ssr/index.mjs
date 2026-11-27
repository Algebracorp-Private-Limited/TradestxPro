// Server-side (no DOM): import the SDK, compute indicators and price-based charts. createChart needs a browser.
import { ALL_BUILTIN_INDICATORS, computeDerived, getIndicatorDefinition, XCHART_VERSION } from "@tradestxpro/xchart";

const closes = [100, 101, 103, 102, 106, 109, 108, 112, 115, 111, 114, 118];
const bars = closes.map((c, i) => ({ time: 1704067200 + i * 86400, open: c, high: c + 1, low: c - 1, close: c }));
const input = { time: bars.map((b) => b.time), open: bars.map((b) => b.open), high: bars.map((b) => b.high), low: bars.map((b) => b.low), close: closes, volume: closes.map(() => 1000), intraday: false };
const sma = getIndicatorDefinition("sma").calculate(input, { length: 3, source: "close" });
const renko = computeDerived("renko", bars, { method: "fixed", size: 2 });
console.log(JSON.stringify({ version: XCHART_VERSION, indicators: ALL_BUILTIN_INDICATORS.length, smaLast: sma.sma.at(-1), renko: renko.length }));
