import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { factsFromBars, technicalRead, type Read, type TechFacts } from "./analysis-rules.ts";
import { getConstituents } from "./constituents";
import { getQuotes } from "./brokers/quotes";
import { isVaultConfigured } from "./brokers/vault";
import { UNDERLYING_INDEX } from "./options/chain";

export type Scope = "market" | "index" | "stock" | "options";
export type Analysis = {
  scope: Scope;
  target: string;
  title: string;
  asOf: string | null;
  live: boolean;
  read: Read;
  narrative: string | null;
  engine: "claude" | "rules";
};

const MODEL = "claude-opus-5-5";
const g = globalThis as unknown as { __aiCache?: Map<string, { at: number; a: Analysis }>; __aiRate?: Map<number, number[]> };
const cache = (g.__aiCache ??= new Map());
const rate = (g.__aiRate ??= new Map());
const TTL = 15 * 60_000;

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

async function indexFacts(key: string): Promise<TechFacts | null> {
  const sql = await db();
  const rows = await sql<{ d: Date; h: number; l: number; c: number }[]>`
    SELECT d, h, l, c FROM candles WHERE series = ${"NSEIDX:" + key} ORDER BY d DESC LIMIT 300`;
  rows.reverse();
  return factsFromBars(key, rows.length ? rows[rows.length - 1].d.toISOString().slice(0, 10) : null, rows.map((r) => r.h), rows.map((r) => r.l), rows.map((r) => r.c));
}

async function stockFacts(symbol: string): Promise<TechFacts | null> {
  const sql = await db();
  const [s] = await sql<Record<string, number | null | string | Date>[]>`SELECT * FROM screener_snapshot WHERE symbol = ${symbol}`;
  if (!s) return null;
  const n = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : null);
  return {
    name: String(s.name ?? symbol), date: s.d instanceof Date ? s.d.toISOString().slice(0, 10) : null, close: n("close") ?? 0, changePct: n("change_pct"),
    ema20: n("ema20"), ema50: n("ema50"), ema200: n("ema200"), rsi14: n("rsi14"), macdHist: n("macd_hist"), macdHistPrev: n("macd_hist_prev"),
    adx14: n("adx14"), supertrendDir: n("supertrend_dir"), high52: n("high52"), low52: n("low52"), ret5: n("ret5"), ret20: n("ret20"), ret60: n("ret60"),
    relVol: n("rel_vol"), beta: n("beta"),
  };
}

async function breadth(symbols: string[] | null): Promise<string[]> {
  const sql = await db();
  const [b] = symbols
    ? await sql<{ up: number; down: number; above200: number; total: number; hi: number; lo: number }[]>`
        SELECT count(*) FILTER (WHERE change_pct > 0)::int AS up, count(*) FILTER (WHERE change_pct < 0)::int AS down,
               count(*) FILTER (WHERE close > ema200)::int AS above200, count(*)::int AS total,
               count(*) FILTER (WHERE close >= high52 * 0.995)::int AS hi, count(*) FILTER (WHERE close <= low52 * 1.005)::int AS lo
          FROM screener_snapshot WHERE symbol IN ${sql(symbols)}`
    : await sql<{ up: number; down: number; above200: number; total: number; hi: number; lo: number }[]>`
        SELECT count(*) FILTER (WHERE change_pct > 0)::int AS up, count(*) FILTER (WHERE change_pct < 0)::int AS down,
               count(*) FILTER (WHERE close > ema200)::int AS above200, count(*)::int AS total,
               count(*) FILTER (WHERE close >= high52 * 0.995)::int AS hi, count(*) FILTER (WHERE close <= low52 * 1.005)::int AS lo
          FROM screener_snapshot`;
  if (!b?.total) return [];
  return [
    `Breadth last session: ${b.up} advancing vs ${b.down} declining (${symbols ? "members" : "all NSE stocks"}).`,
    `${((b.above200 / b.total) * 100).toFixed(0)}% of ${symbols ? "members" : "stocks"} trade above their 200-day EMA${b.above200 / b.total > 0.6 ? " — broad participation" : b.above200 / b.total < 0.4 ? " — weak participation" : ""}.`,
    `${b.hi} near 52-week highs, ${b.lo} near 52-week lows.`,
  ];
}

async function sectorLine(): Promise<string | null> {
  const sql = await db();
  const rows = await sql<{ industry: string; chg: number; n: number }[]>`
    SELECT c.industry, avg(s.change_pct) AS chg, count(*)::int AS n
      FROM index_constituents c JOIN screener_snapshot s ON s.symbol = c.symbol
     WHERE c.index_key = 'NIFTY 500' AND c.industry IS NOT NULL GROUP BY 1 HAVING count(*) >= 5 ORDER BY 2 DESC`;
  if (rows.length < 4) return null;
  const f = (r: { industry: string; chg: number }) => `${r.industry} ${r.chg >= 0 ? "+" : ""}${r.chg.toFixed(1)}%`;
  return `Strongest sectors: ${rows.slice(0, 3).map(f).join(", ")}. Weakest: ${rows.slice(-3).reverse().map(f).join(", ")}.`;
}

async function optionsLines(u: string): Promise<string[]> {
  const sql = await db();
  const rows = await sql<{ d: Date; inst: string; contracts: number; ce_contracts: number; pe_contracts: number; ce_oi_qty: number; pe_oi_qty: number; oi_qty: number }[]>`
    SELECT d, inst, contracts, ce_contracts, pe_contracts, ce_oi_qty, pe_oi_qty, oi_qty FROM fo_activity
     WHERE underlying = ${u} AND d = (SELECT max(d) FROM fo_activity WHERE underlying = ${u})`;
  const out: string[] = [];
  for (const r of rows) for (const k of ["contracts", "ce_contracts", "pe_contracts", "ce_oi_qty", "pe_oi_qty", "oi_qty"] as const) r[k] = Number(r[k]);
  const opt = rows.find((r) => r.inst === "IDO" || r.inst === "STO");
  const fut = rows.find((r) => r.inst === "IDF" || r.inst === "STF");
  if (opt) {
    const pcr = opt.ce_oi_qty ? opt.pe_oi_qty / opt.ce_oi_qty : null;
    out.push(`Options (${opt.d.toISOString().slice(0, 10)}): ${opt.contracts.toLocaleString("en-IN")} contracts traded (calls ${opt.ce_contracts.toLocaleString("en-IN")}, puts ${opt.pe_contracts.toLocaleString("en-IN")}).`);
    if (pcr !== null) out.push(`Put-call ratio by open interest ${pcr.toFixed(2)}: ${pcr > 1.3 ? "heavy put writing, often read as support below" : pcr < 0.7 ? "call-heavy positioning, often read as resistance overhead" : "balanced positioning"}.`);
  }
  if (fut) out.push(`Futures: ${fut.contracts.toLocaleString("en-IN")} contracts traded; open interest ${fut.oi_qty.toLocaleString("en-IN")} units.`);
  return out;
}

async function overlayLive(userId: number, f: TechFacts, req: { kind: "index" | "stock"; symbol: string }): Promise<boolean> {
  if (!isVaultConfigured()) return false;
  const sql = await db();
  let token: string | null = null, breezeCode: string | null = null;
  if (req.kind === "stock") {
    const [i] = await sql<{ token: string; breeze_code: string }[]>`SELECT token, breeze_code FROM instruments WHERE exchange = 'NSE' AND symbol = ${req.symbol} AND active LIMIT 1`;
    if (!i) return false;
    token = i.token; breezeCode = i.breeze_code;
  }
  const q = await getQuotes(userId, [{ key: "x", kind: req.kind, symbol: req.symbol, token, breezeCode }]).catch(() => null);
  const lq = q?.quotes.x;
  if (!lq) return false;
  f.close = lq.ltp;
  f.changePct = lq.changePct;
  return true;
}

async function buildFacts(userId: number, scope: Scope, target: string): Promise<{ title: string; facts: TechFacts; live: boolean } | null> {
  if (scope === "stock") {
    const f = await stockFacts(target);
    if (!f) return null;
    const live = await overlayLive(userId, f, { kind: "stock", symbol: target });
    return { title: `${target} · ${f.name}`, facts: f, live };
  }
  if (scope === "index" || scope === "market") {
    const key = scope === "market" ? "NIFTY 50" : target;
    const members = key === "SENSEX" || scope === "index" ? (await getConstituents(key).catch(() => [])).map((m) => m.symbol) : null;
    // SENSEX has no public end-of-day history here: read NIFTY 50's chart alongside SENSEX members' breadth.
    const f = (await indexFacts(key)) ?? (key === "SENSEX" ? await indexFacts("NIFTY 50") : null);
    if (!f) return null;
    f.name = key === "SENSEX" && f.name === "NIFTY 50" ? "SENSEX (chart read uses NIFTY 50 as proxy)" : key;
    const live = await overlayLive(userId, f, { kind: "index", symbol: key });
    f.extra = [...(await breadth(scope === "market" ? null : members?.length ? members : null))];
    if (scope === "market") {
      const s = await sectorLine();
      if (s) f.extra.push(s);
      f.extra.push(...(await optionsLines("NIFTY")));
    }
    return { title: scope === "market" ? "Market (NIFTY 50 and breadth)" : key, facts: f, live };
  }
  // options: the underlying's chart plus F&O positioning
  const idx = UNDERLYING_INDEX[target];
  const base = idx ? await buildFacts(userId, "index", idx) : await buildFacts(userId, "stock", target);
  if (!base) return null;
  base.facts.extra = [...(base.facts.extra ?? []), ...(await optionsLines(target))];
  return { ...base, title: `${target} options` };
}

const SYSTEM = `You are a markets analyst writing for Indian retail traders on a research website.
Write a short technical and positioning analysis from the data provided: no invented numbers, use only figures given.
Structure: one-sentence overall view; then 3-5 bullet points ("- ") covering trend, momentum, key levels (support/resistance), and positioning or breadth if given; then one line starting "Watch:" naming what would change the view.
Keep it under 170 words, plain text, Indian number formatting.
Never give buy/sell/hold recommendations, targets or position sizes; this is educational research, not investment advice.`;

async function narrate(title: string, f: TechFacts, read: Read, live: boolean): Promise<string | null> {
  if (!aiConfigured()) return null;
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Subject: ${title}\nPrice basis: ${live ? "live price from the user's broker" : `end of day ${f.date ?? ""}`}\nData (JSON):\n${JSON.stringify({ ...f, extra: undefined })}\nRule-based signals:\n${read.points.map((p) => "- " + p).join("\n")}\nSupport: ${read.levels.support ?? "n/a"}, Resistance: ${read.levels.resistance ?? "n/a"}, Score: ${read.score} (${read.bias})`,
    }],
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
  return text || null;
}

function allowAi(userId: number): boolean {
  const now = Date.now();
  const hits = (rate.get(userId) ?? []).filter((t: number) => now - t < 3600_000);
  if (hits.length >= 40) return false;
  hits.push(now);
  rate.set(userId, hits);
  return true;
}

export async function getAnalysis(userId: number, scope: Scope, target: string): Promise<Analysis | null> {
  const t = target.toUpperCase().slice(0, 80);
  const built = await buildFacts(userId, scope, t);
  if (!built) return null;
  const { title, facts, live } = built;
  const read = technicalRead(facts);
  const key = `${scope}:${t}:${facts.date}:${read.bias}:${Math.round(facts.close / Math.max(1, facts.close * 0.002))}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.a, live };
  let narrative: string | null = null;
  if (aiConfigured() && allowAi(userId)) {
    narrative = await narrate(title, facts, read, live).catch((e) => {
      console.error("ai analysis failed", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
      return null;
    });
  }
  const a: Analysis = { scope, target: t, title, asOf: facts.date, live, read, narrative, engine: narrative ? "claude" : "rules" };
  if (narrative) cache.set(key, { at: Date.now(), a });
  if (cache.size > 2000) cache.clear();
  return a;
}
