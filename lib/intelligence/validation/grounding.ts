/**
 * Numerical grounding: every number an AI explanation states must appear in the verified facts
 * (within a tolerance), so the model cannot invent prices, levels, ratios or probabilities.
 */

/** All finite numbers inside a facts object (recursively). */
export function factNumbers(facts: unknown, out: number[] = []): number[] {
  if (typeof facts === "number" && Number.isFinite(facts)) out.push(facts);
  else if (Array.isArray(facts)) facts.forEach((f) => factNumbers(f, out));
  else if (facts && typeof facts === "object") Object.values(facts).forEach((f) => factNumbers(f, out));
  else if (typeof facts === "string") for (const m of facts.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) out.push(Number(m[0].replace(/,/g, "")));
  return out;
}

/** Numbers written in text: "1,234.5", "₹2.5 crore" (read as 2.5 or 25000000), "62%", "1.5R". */
export function textNumbers(text: string): { raw: string; values: number[] }[] {
  const out: { raw: string; values: number[] }[] = [];
  for (const m of text.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(crore|lakh|cr\b)?/gi)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    const unit = m[2]?.toLowerCase();
    out.push({ raw: m[0].trim(), values: unit === "crore" || unit === "cr" ? [v, v * 1e7] : unit === "lakh" ? [v, v * 1e5] : [v] });
  }
  return out;
}

/** Small integers (counts, periods like 14/20/50/200, dates' parts) are allowed without a match. */
const trivial = (v: number) => Number.isInteger(v) && Math.abs(v) <= 252;

/**
 * Returns the numbers in `text` that match no fact within `relTol` (relative) or ±0.05 absolute,
 * also allowing a fact rounded to 0–2 decimals. Empty = grounded.
 */
export function ungroundedNumbers(text: string, facts: unknown, relTol = 0.005): string[] {
  const known = factNumbers(facts);
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const { raw, values } of textNumbers(text)) {
    if ((values.length === 1 && trivial(values[0])) || seen.has(raw)) continue;
    seen.add(raw);
    const ok = values.some((value) => known.some((k) => Math.abs(k - value) <= Math.max(0.05, Math.abs(k) * relTol) || [0, 1, 2].some((d) => Math.abs(Number(k.toFixed(d)) - value) < 1e-9)));
    if (!ok) bad.push(raw);
  }
  return bad;
}

/** Phrases that present scores or setups as certainties/probabilities. */
const FORBIDDEN = [/\bguarantee[sd]?\b/i, /\brisk[- ]free\b/i, /\bsure[- ]shot\b/i, /\bcertain(ly)? (to|profit)/i, /\b\d{1,3}\s*%\s*(probability|chance|likely)/i, /\bprobability of (profit|success) (is|of)\b/i];
export function forbiddenClaims(text: string): string[] {
  return FORBIDDEN.filter((re) => re.test(text)).map((re) => re.source);
}

/** Combined check for an explanation object (all string fields). */
export function checkExplanation(value: unknown, facts: unknown): string[] {
  const texts: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === "string") texts.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(value);
  const all = texts.join("\n");
  const problems: string[] = [];
  const u = ungroundedNumbers(all, facts);
  if (u.length) problems.push(`numbers not in the verified facts: ${u.slice(0, 8).join(", ")}`);
  const f = forbiddenClaims(all);
  if (f.length) problems.push(`forbidden certainty/probability claims: ${f.join(", ")}`);
  return problems;
}
