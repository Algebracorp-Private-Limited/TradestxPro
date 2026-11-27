/**
 * Strategy registry. Strategies are data: each one is a list of leg specifications relative to the ATM
 * strike (in strike steps) and to the expiry ladder (near / next). They are generated from parametric
 * families (width, anchor, wing) and can be extended at runtime with registerStrategy(), which validates
 * every definition. The 12 templates of the existing strategy builder (lib/options/strategy.ts) are
 * canonical members of the registry under the same ids, with the same legs.
 *
 * Classification:
 *   BUY_ONLY  — every leg is bought (risk limited to the premium paid / futures stop);
 *   SELL_ONLY — every leg is sold;
 *   MIXED     — both.
 * Risk: "defined" when the expiry payoff is bounded below, "undefined" otherwise (computed, not declared).
 */

export type LegRight = "CE" | "PE" | "FUT";
export type LegSpec = { side: "BUY" | "SELL"; right: LegRight; offset: number; ratio: number; expiry: "near" | "next" };
export type View = "Bullish" | "Bearish" | "Neutral" | "Volatile" | "Mildly bullish" | "Mildly bearish";
export type StrategyDef = {
  id: string; name: string; family: string; view: View; summary: string; legs: LegSpec[];
  /** Derived fields (filled by registerStrategy). */
  classification: "BUY_ONLY" | "SELL_ONLY" | "MIXED"; risk: "defined" | "undefined"; multiExpiry: boolean; usesFutures: boolean; legCount: number;
};
type Input = Omit<StrategyDef, "classification" | "risk" | "multiExpiry" | "usesFutures" | "legCount">;

const L = (side: "BUY" | "SELL", right: LegRight, offset = 0, ratio = 1, expiry: "near" | "next" = "near"): LegSpec => ({ side, right, offset, ratio, expiry });
const sgn = (s: "BUY" | "SELL") => (s === "BUY" ? 1 : -1);

/**
 * Downside/upside boundedness at the near expiry. Net slope of the payoff as S → ∞ is the sum of signed
 * call and futures quantities; as S → 0 the payoff is finite for any combination, so a position has
 * undefined risk when the upside slope is negative, or when puts are net short beyond a bounded amount
 * (treated as "undefined": losses run to strike × quantity, large for practical purposes).
 * Next-expiry legs are long-dated options valued with time value, so a short near leg covered by a long
 * next leg of the same right is treated as covered.
 */
export function riskOf(legs: LegSpec[]): "defined" | "undefined" {
  const up = legs.reduce((a, l) => a + (l.right === "CE" || l.right === "FUT" ? sgn(l.side) * l.ratio : 0), 0);
  const putsNet = legs.reduce((a, l) => a + (l.right === "PE" ? sgn(l.side) * l.ratio : 0), 0);
  const futNet = legs.reduce((a, l) => a + (l.right === "FUT" ? sgn(l.side) * l.ratio : 0), 0);
  // Downside slope (as S → 0): -(long puts) + futures; loss as S → 0 is bounded but large unless covered.
  const down = -putsNet + futNet; // payoff slope w.r.t. S on the far left
  return up < 0 || down > 0 ? "undefined" : "defined";
}

export function validateDef(d: Input): string[] {
  const e: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(d.id)) e.push(`invalid id ${d.id}`);
  if (!d.name || d.name.length > 80) e.push("name required (≤ 80 chars)");
  if (!d.legs.length || d.legs.length > 6) e.push("1–6 legs");
  for (const l of d.legs) {
    if (!["BUY", "SELL"].includes(l.side) || !["CE", "PE", "FUT"].includes(l.right)) e.push("invalid leg side/right");
    if (!Number.isInteger(l.offset) || Math.abs(l.offset) > 20) e.push("offset must be an integer within ±20 steps");
    if (!Number.isInteger(l.ratio) || l.ratio < 1 || l.ratio > 4) e.push("ratio must be 1–4");
    if (l.right === "FUT" && l.offset !== 0) e.push("futures legs have no strike offset");
  }
  return e;
}

const REGISTRY = new Map<string, StrategyDef>();

export function registerStrategy(d: Input): StrategyDef {
  const errs = validateDef(d);
  if (errs.length) throw new Error(`strategy ${d.id}: ${errs.join("; ")}`);
  if (REGISTRY.has(d.id)) throw new Error(`duplicate strategy id ${d.id}`);
  const buys = d.legs.every((l) => l.side === "BUY"), sells = d.legs.every((l) => l.side === "SELL");
  const def: StrategyDef = {
    ...d, classification: buys ? "BUY_ONLY" : sells ? "SELL_ONLY" : "MIXED", risk: riskOf(d.legs),
    multiExpiry: d.legs.some((l) => l.expiry === "next"), usesFutures: d.legs.some((l) => l.right === "FUT"), legCount: d.legs.length,
  };
  REGISTRY.set(def.id, def);
  return def;
}

const off = (n: number) => (n === 0 ? "ATM" : n > 0 ? `+${n}` : String(n));
const slug = (n: number) => (n === 0 ? "atm" : n > 0 ? `p${n}` : `m${-n}`);
const add = (id: string, name: string, family: string, view: View, summary: string, legs: LegSpec[]) => registerStrategy({ id, name, family, view, summary, legs });

// ---------- Canonical builder templates (same ids and legs as lib/options/strategy.ts) ----------
// The builder parameterises width at runtime; the registry's canonical members use width W.
const W = 2;
add("long-call", "Long Call", "Single leg", "Bullish", "Buy an ATM call. Limited loss (premium), unlimited upside.", [L("BUY", "CE")]);
add("bull-call-spread", "Bull Call Spread", "Vertical", "Bullish", "Buy ATM call, sell a higher call. Profit capped, risk limited.", [L("BUY", "CE"), L("SELL", "CE", W)]);
add("bull-put-spread", "Bull Put Spread", "Vertical", "Bullish", "Sell ATM put, buy a lower put. Credit; profit if price stays above the short strike.", [L("SELL", "PE"), L("BUY", "PE", -W)]);
add("long-put", "Long Put", "Single leg", "Bearish", "Buy an ATM put. Limited loss (premium).", [L("BUY", "PE")]);
add("bear-put-spread", "Bear Put Spread", "Vertical", "Bearish", "Buy ATM put, sell a lower put. Profit capped, risk limited.", [L("BUY", "PE"), L("SELL", "PE", -W)]);
add("bear-call-spread", "Bear Call Spread", "Vertical", "Bearish", "Sell ATM call, buy a higher call. Credit; profit if price stays below the short strike.", [L("SELL", "CE"), L("BUY", "CE", W)]);
add("short-straddle", "Short Straddle", "Straddle", "Neutral", "Sell ATM call and put. Losses unlimited on large moves.", [L("SELL", "CE"), L("SELL", "PE")]);
add("short-strangle", "Short Strangle", "Strangle", "Neutral", "Sell OTM call and put. Losses unlimited on large moves.", [L("SELL", "CE", W), L("SELL", "PE", -W)]);
add("iron-condor", "Iron Condor", "Iron condor", "Neutral", "Short strangle with protective wings. Limited risk.", [L("SELL", "CE", W), L("BUY", "CE", 2 * W), L("SELL", "PE", -W), L("BUY", "PE", -2 * W)]);
add("iron-butterfly", "Iron Butterfly", "Iron butterfly", "Neutral", "Short straddle with protective wings. Limited risk.", [L("SELL", "CE"), L("SELL", "PE"), L("BUY", "CE", W), L("BUY", "PE", -W)]);
add("long-straddle", "Long Straddle", "Straddle", "Volatile", "Buy ATM call and put. Needs a large move either way.", [L("BUY", "CE"), L("BUY", "PE")]);
add("long-strangle", "Long Strangle", "Strangle", "Volatile", "Buy OTM call and put. Needs a larger move.", [L("BUY", "CE", W), L("BUY", "PE", -W)]);

// ---------- Generated families ----------
// Single legs at strike offsets −4…+4 (ATM already canonical for the long call/put).
for (let o = -4; o <= 4; o++) {
  if (o !== 0) {
    add(`long-call-${slug(o)}`, `Long Call (${off(o)})`, "Single leg", "Bullish", `Buy the call ${off(o)} strikes from ATM.`, [L("BUY", "CE", o)]);
    add(`long-put-${slug(o)}`, `Long Put (${off(o)})`, "Single leg", "Bearish", `Buy the put ${off(o)} strikes from ATM.`, [L("BUY", "PE", o)]);
  }
  add(`short-call-${slug(o)}`, `Short Call (${off(o)})`, "Single leg", "Mildly bearish", `Sell the call ${off(o)} strikes from ATM. Losses unlimited.`, [L("SELL", "CE", o)]);
  add(`short-put-${slug(o)}`, `Short Put (${off(o)})`, "Single leg", "Mildly bullish", `Sell the put ${off(o)} strikes from ATM. Large losses if the underlying falls.`, [L("SELL", "PE", o)]);
}
// Verticals: 4 types × width 1…5 × anchor −2, 0, +2 (canonical ATM width-2 members already exist).
const verticals: [string, string, View, (a: number, w: number) => LegSpec[]][] = [
  ["bull-call-spread", "Bull Call Spread", "Bullish", (a, w) => [L("BUY", "CE", a), L("SELL", "CE", a + w)]],
  ["bull-put-spread", "Bull Put Spread", "Bullish", (a, w) => [L("SELL", "PE", a), L("BUY", "PE", a - w)]],
  ["bear-put-spread", "Bear Put Spread", "Bearish", (a, w) => [L("BUY", "PE", a), L("SELL", "PE", a - w)]],
  ["bear-call-spread", "Bear Call Spread", "Bearish", (a, w) => [L("SELL", "CE", a), L("BUY", "CE", a + w)]],
];
for (const [id, name, view, f] of verticals) for (const a of [-2, 0, 2]) for (let w = 1; w <= 5; w++) {
  if (a === 0 && w === W) continue;
  add(`${id}-a${slug(a)}-w${w}`, `${name} (${off(a)}, ${w} wide)`, "Vertical", view, `${name} anchored ${off(a)} strikes from ATM, ${w} strikes wide.`, f(a, w));
}
// Straddles/strangles by width.
for (let w = 1; w <= 6; w++) if (w !== W) {
  add(`long-strangle-w${w}`, `Long Strangle (±${w})`, "Strangle", "Volatile", `Buy the call +${w} and the put −${w} strikes from ATM.`, [L("BUY", "CE", w), L("BUY", "PE", -w)]);
  add(`short-strangle-w${w}`, `Short Strangle (±${w})`, "Strangle", "Neutral", `Sell the call +${w} and the put −${w}. Losses unlimited.`, [L("SELL", "CE", w), L("SELL", "PE", -w)]);
}
// Guts (ITM strangle).
for (let w = 1; w <= 3; w++) {
  add(`long-guts-w${w}`, `Long Guts (±${w})`, "Strangle", "Volatile", "Buy an ITM call and an ITM put.", [L("BUY", "CE", -w), L("BUY", "PE", w)]);
  add(`short-guts-w${w}`, `Short Guts (±${w})`, "Strangle", "Neutral", "Sell an ITM call and an ITM put. Losses unlimited.", [L("SELL", "CE", -w), L("SELL", "PE", w)]);
}
// Strip and strap.
add("strip", "Strip", "Straddle", "Volatile", "Buy one ATM call and two ATM puts (bearish volatility).", [L("BUY", "CE"), L("BUY", "PE", 0, 2)]);
add("strap", "Strap", "Straddle", "Volatile", "Buy two ATM calls and one ATM put (bullish volatility).", [L("BUY", "CE", 0, 2), L("BUY", "PE")]);
// Iron condors: inner 1…4 × wing 1…3; reverse condors.
for (let i = 1; i <= 4; i++) for (let w = 1; w <= 3; w++) {
  if (i === W && w === W) continue;
  add(`iron-condor-i${i}-w${w}`, `Iron Condor (±${i}, wings ${w})`, "Iron condor", "Neutral", `Short strangle ±${i} with wings ${w} strikes further out.`, [L("SELL", "CE", i), L("BUY", "CE", i + w), L("SELL", "PE", -i), L("BUY", "PE", -i - w)]);
}
for (let i = 1; i <= 4; i++) for (let w = 1; w <= 3; w++) add(`reverse-iron-condor-i${i}-w${w}`, `Reverse Iron Condor (±${i}, wings ${w})`, "Iron condor", "Volatile", "Long strangle financed by selling further-out wings.", [L("BUY", "CE", i), L("SELL", "CE", i + w), L("BUY", "PE", -i), L("SELL", "PE", -i - w)]);
// Iron butterflies and reverse.
for (let w = 1; w <= 6; w++) {
  if (w !== W) add(`iron-butterfly-w${w}`, `Iron Butterfly (wings ${w})`, "Iron butterfly", "Neutral", `Short ATM straddle with wings ±${w}.`, [L("SELL", "CE"), L("SELL", "PE"), L("BUY", "CE", w), L("BUY", "PE", -w)]);
  add(`reverse-iron-butterfly-w${w}`, `Reverse Iron Butterfly (wings ${w})`, "Iron butterfly", "Volatile", `Long ATM straddle with short wings ±${w}.`, [L("BUY", "CE"), L("BUY", "PE"), L("SELL", "CE", w), L("SELL", "PE", -w)]);
}
// Long and short butterflies (calls and puts) by width × anchor.
for (const r of ["CE", "PE"] as const) for (const a of [-2, 0, 2]) for (let w = 1; w <= 4; w++) {
  const nm = r === "CE" ? "Call" : "Put", ak = slug(a);
  add(`long-${nm.toLowerCase()}-butterfly-a${ak}-w${w}`, `Long ${nm} Butterfly (${off(a)}, ${w} wide)`, "Butterfly", a === 0 ? "Neutral" : r === "CE" ? (a > 0 ? "Mildly bullish" : "Mildly bearish") : a < 0 ? "Mildly bearish" : "Mildly bullish",
    `Buy ${a - w}/${a + w}, sell 2× ${off(a)}: profits most near the body strike.`, [L("BUY", r, a - w), L("SELL", r, a, 2), L("BUY", r, a + w)]);
  if (a === 0) add(`short-${nm.toLowerCase()}-butterfly-w${w}`, `Short ${nm} Butterfly (${w} wide)`, "Butterfly", "Volatile", "Sell the wings, buy 2× the body: profits from a move away from ATM.", [L("SELL", r, -w), L("BUY", r, 0, 2), L("SELL", r, w)]);
}
// Broken-wing butterflies.
for (const r of ["CE", "PE"] as const) for (let w = 1; w <= 3; w++) {
  const nm = r === "CE" ? "Call" : "Put", dir = r === "CE" ? 1 : -1;
  add(`broken-wing-${nm.toLowerCase()}-butterfly-w${w}`, `Broken-Wing ${nm} Butterfly (${w}/${w + 1})`, "Butterfly", r === "CE" ? "Mildly bullish" : "Mildly bearish", "Butterfly with a wider far wing; often a small credit.",
    [L("BUY", r, -dir * w), L("SELL", r, 0, 2), L("BUY", r, dir * (w + 1))]);
}
// Condors (all calls / all puts).
for (const r of ["CE", "PE"] as const) for (let w = 1; w <= 3; w++) {
  const nm = r === "CE" ? "Call" : "Put";
  add(`long-${nm.toLowerCase()}-condor-w${w}`, `Long ${nm} Condor (${w} wide)`, "Condor", "Neutral", "Range-bound profit, limited risk.", [L("BUY", r, -2 * w), L("SELL", r, -w), L("SELL", r, w), L("BUY", r, 2 * w)]);
}
// Ratio spreads and backspreads.
for (let w = 1; w <= 4; w++) {
  add(`call-ratio-spread-w${w}`, `Call Ratio Spread 1×2 (${w} wide)`, "Ratio", "Mildly bullish", "Buy ATM call, sell 2 higher calls. Upside losses unlimited.", [L("BUY", "CE"), L("SELL", "CE", w, 2)]);
  add(`put-ratio-spread-w${w}`, `Put Ratio Spread 1×2 (${w} wide)`, "Ratio", "Mildly bearish", "Buy ATM put, sell 2 lower puts. Large downside losses.", [L("BUY", "PE"), L("SELL", "PE", -w, 2)]);
  add(`call-backspread-w${w}`, `Call Ratio Backspread 1×2 (${w} wide)`, "Ratio", "Bullish", "Sell ATM call, buy 2 higher calls.", [L("SELL", "CE"), L("BUY", "CE", w, 2)]);
  add(`put-backspread-w${w}`, `Put Ratio Backspread 1×2 (${w} wide)`, "Ratio", "Bearish", "Sell ATM put, buy 2 lower puts.", [L("SELL", "PE"), L("BUY", "PE", -w, 2)]);
}
// Jade lizard and twisted sister.
for (let w = 1; w <= 3; w++) {
  add(`jade-lizard-w${w}`, `Jade Lizard (${w})`, "Combination", "Mildly bullish", "Short OTM put plus a short call spread.", [L("SELL", "PE", -w), L("SELL", "CE", w), L("BUY", "CE", w + 1)]);
  add(`twisted-sister-w${w}`, `Twisted Sister (${w})`, "Combination", "Mildly bearish", "Short OTM call plus a short put spread.", [L("SELL", "CE", w), L("SELL", "PE", -w), L("BUY", "PE", -w - 1)]);
}
// Calendars and diagonals (two expiries).
for (const r of ["CE", "PE"] as const) for (const a of [-2, -1, 0, 1, 2]) {
  const nm = r === "CE" ? "Call" : "Put";
  add(`long-${nm.toLowerCase()}-calendar-a${slug(a)}`, `Long ${nm} Calendar (${off(a)})`, "Calendar", "Neutral", "Sell the near expiry, buy the next expiry at the same strike.", [L("SELL", r, a), L("BUY", r, a, 1, "next")]);
}
for (const r of ["CE", "PE"] as const) for (let w = 1; w <= 3; w++) {
  const nm = r === "CE" ? "Call" : "Put", dir = r === "CE" ? 1 : -1;
  add(`${nm.toLowerCase()}-diagonal-w${w}`, `${nm} Diagonal (${w})`, "Calendar", r === "CE" ? "Mildly bullish" : "Mildly bearish", "Buy the next-expiry option near ATM, sell a near-expiry option further out.", [L("BUY", r, 0, 1, "next"), L("SELL", r, dir * w)]);
}
// Futures and futures combinations.
add("long-futures", "Long Futures", "Futures", "Bullish", "Buy the near-month future. Losses are not limited without a stop.", [L("BUY", "FUT")]);
add("short-futures", "Short Futures", "Futures", "Bearish", "Sell the near-month future. Losses unlimited without a stop.", [L("SELL", "FUT")]);
add("synthetic-long", "Synthetic Long Futures", "Futures", "Bullish", "Buy ATM call, sell ATM put.", [L("BUY", "CE"), L("SELL", "PE")]);
add("synthetic-short", "Synthetic Short Futures", "Futures", "Bearish", "Sell ATM call, buy ATM put.", [L("SELL", "CE"), L("BUY", "PE")]);
for (let w = 1; w <= 4; w++) {
  add(`covered-call-futures-w${w}`, `Covered Call with Futures (+${w})`, "Futures", "Mildly bullish", "Long future plus a short OTM call.", [L("BUY", "FUT"), L("SELL", "CE", w)]);
  add(`protective-put-futures-w${w}`, `Protective Put with Futures (−${w})`, "Futures", "Bullish", "Long future plus a long OTM put.", [L("BUY", "FUT"), L("BUY", "PE", -w)]);
  add(`collar-futures-w${w}`, `Collar with Futures (±${w})`, "Futures", "Mildly bullish", "Long future, long OTM put, short OTM call.", [L("BUY", "FUT"), L("BUY", "PE", -w), L("SELL", "CE", w)]);
  add(`covered-put-futures-w${w}`, `Covered Put with Futures (−${w})`, "Futures", "Mildly bearish", "Short future plus a short OTM put.", [L("SELL", "FUT"), L("SELL", "PE", -w)]);
  add(`protective-call-futures-w${w}`, `Protective Call with Short Futures (+${w})`, "Futures", "Bearish", "Short future plus a long OTM call.", [L("SELL", "FUT"), L("BUY", "CE", w)]);
}

export function allStrategies(): StrategyDef[] {
  return [...REGISTRY.values()];
}
export function getStrategy(id: string): StrategyDef | undefined {
  return REGISTRY.get(id);
}
export type RegistryFilter = { mode?: "ALL" | "BUY_ONLY" | "SELL_ONLY"; definedRiskOnly?: boolean; singleLegOnly?: boolean; multiLeg?: boolean; allowFutures?: boolean; allowMultiExpiry?: boolean; family?: string | null; view?: View | null };
export function filterStrategies(f: RegistryFilter = {}): StrategyDef[] {
  return allStrategies().filter((d) =>
    (!f.mode || f.mode === "ALL" || d.classification === f.mode) &&
    (!f.definedRiskOnly || d.risk === "defined") &&
    (!f.singleLegOnly || d.legCount === 1) &&
    (f.multiLeg !== false || d.legCount === 1) &&
    (f.allowFutures !== false || !d.usesFutures) &&
    (f.allowMultiExpiry !== false || !d.multiExpiry) &&
    (!f.family || d.family === f.family) && (!f.view || d.view === f.view));
}
