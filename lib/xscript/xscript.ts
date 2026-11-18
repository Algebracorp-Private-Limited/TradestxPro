// XScript — TradestXPro's scripting language for custom indicators, signals and scans.
// Interpreted safely: user code is tokenised, parsed and evaluated over whole series at once.
// There is no access to JavaScript, the network or the page, and no loops, so run time is
// bounded by script length × number of bars.
import * as ta from "../ta/indicators.ts";

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
type Series = number[];
type Value = Series | number | string;

export class XScriptError extends Error {
  line: number;
  col: number;
  constructor(message: string, line: number, col: number) {
    super(`Line ${line}:${col} — ${message}`);
    this.line = line;
    this.col = col;
  }
}

// ---------------- Lexer ----------------
type Tok = { k: "num" | "str" | "id" | "op" | "nl" | "eof"; v: string; line: number; col: number };

const OPS = ["==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "(", ")", "[", "]", ",", "=", "<", ">", "?", ":", ";"];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const push = (k: Tok["k"], v: string, l = line, c = col) => out.push({ k, v, line: l, col: c });
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") {
      push("nl", "\n");
      i++;
      line++;
      col = 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      col++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    const sl = line;
    const sc = col;
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      if ((src[j] === "e" || src[j] === "E") && /[0-9+-]/.test(src[j + 1] ?? "")) {
        j += 2;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      push("num", src.slice(i, j).replaceAll("_", ""), sl, sc);
      col += j - i;
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== "\n") j++;
      if (src[j] !== ch) throw new XScriptError("Unclosed string", sl, sc);
      push("str", src.slice(i + 1, j), sl, sc);
      col += j - i + 1;
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      push("id", src.slice(i, j), sl, sc);
      col += j - i;
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new XScriptError(`Unexpected character "${ch}"`, sl, sc);
    push("op", op, sl, sc);
    i += op.length;
    col += op.length;
  }
  push("eof", "");
  return out;
}

// ---------------- Parser ----------------
type Node =
  | { t: "num"; v: number; at: Tok }
  | { t: "str"; v: string; at: Tok }
  | { t: "id"; name: string; at: Tok }
  | { t: "un"; op: string; e: Node; at: Tok }
  | { t: "bin"; op: string; a: Node; b: Node; at: Tok }
  | { t: "tern"; c: Node; a: Node; b: Node; at: Tok }
  | { t: "call"; name: string; args: Node[]; named: Record<string, Node>; at: Tok }
  | { t: "hist"; e: Node; n: Node; at: Tok };
type Stmt = { t: "assign"; name: string; e: Node; at: Tok } | { t: "expr"; e: Node; at: Tok };

const RESERVED = new Set(["and", "or", "not", "true", "false", "na"]);

class Parser {
  private p = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  private peek(o = 0) {
    return this.toks[this.p + o];
  }
  private next() {
    return this.toks[this.p++];
  }
  private isOp(v: string) {
    const t = this.peek();
    return t.k === "op" && t.v === v;
  }
  private isWord(v: string) {
    const t = this.peek();
    return t.k === "id" && t.v === v;
  }
  private expect(v: string) {
    const t = this.next();
    if (t.k !== "op" || t.v !== v) throw new XScriptError(`Expected "${v}"`, t.line, t.col);
    return t;
  }

  program(): Stmt[] {
    const out: Stmt[] = [];
    while (this.peek().k !== "eof") {
      if (this.peek().k === "nl" || this.isOp(";")) {
        this.next();
        continue;
      }
      out.push(this.statement());
      const t = this.peek();
      if (t.k !== "nl" && t.k !== "eof" && !this.isOp(";")) throw new XScriptError(`Unexpected "${t.v}"`, t.line, t.col);
      if (out.length > 500) throw new XScriptError("Script is too long (max 500 statements)", t.line, t.col);
    }
    return out;
  }

  private statement(): Stmt {
    const t = this.peek();
    if (t.k === "id" && this.peek(1).k === "op" && this.peek(1).v === "=") {
      if (RESERVED.has(t.v) || SOURCES.has(t.v)) throw new XScriptError(`"${t.v}" is reserved`, t.line, t.col);
      this.next();
      this.next();
      return { t: "assign", name: t.v, e: this.expr(), at: t };
    }
    return { t: "expr", e: this.expr(), at: t };
  }

  private expr(): Node {
    const c = this.or();
    if (this.isOp("?")) {
      const at = this.next();
      const a = this.expr();
      this.expect(":");
      const b = this.expr();
      return { t: "tern", c, a, b, at };
    }
    return c;
  }
  private or(): Node {
    let a = this.and();
    while (this.isWord("or")) {
      const at = this.next();
      a = { t: "bin", op: "or", a, b: this.and(), at };
    }
    return a;
  }
  private and(): Node {
    let a = this.not();
    while (this.isWord("and")) {
      const at = this.next();
      a = { t: "bin", op: "and", a, b: this.not(), at };
    }
    return a;
  }
  private not(): Node {
    if (this.isWord("not")) {
      const at = this.next();
      return { t: "un", op: "not", e: this.not(), at };
    }
    return this.cmp();
  }
  private cmp(): Node {
    let a = this.add();
    while (["==", "!=", "<", "<=", ">", ">="].some((o) => this.isOp(o))) {
      const at = this.next();
      a = { t: "bin", op: at.v, a, b: this.add(), at };
    }
    return a;
  }
  private add(): Node {
    let a = this.mul();
    while (this.isOp("+") || this.isOp("-")) {
      const at = this.next();
      a = { t: "bin", op: at.v, a, b: this.mul(), at };
    }
    return a;
  }
  private mul(): Node {
    let a = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const at = this.next();
      a = { t: "bin", op: at.v, a, b: this.unary(), at };
    }
    return a;
  }
  private unary(): Node {
    if (this.isOp("-") || this.isOp("+")) {
      const at = this.next();
      return { t: "un", op: at.v, e: this.unary(), at };
    }
    return this.postfix();
  }
  private postfix(): Node {
    let e = this.primary();
    while (this.isOp("[")) {
      const at = this.next();
      const n = this.expr();
      this.expect("]");
      e = { t: "hist", e, n, at };
    }
    return e;
  }
  private primary(): Node {
    const t = this.next();
    if (t.k === "num") return { t: "num", v: Number(t.v), at: t };
    if (t.k === "str") return { t: "str", v: t.v, at: t };
    if (t.k === "op" && t.v === "(") {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (t.k === "id") {
      if (this.isOp("(")) {
        this.next();
        const args: Node[] = [];
        const named: Record<string, Node> = {};
        while (!this.isOp(")")) {
          if (this.peek().k === "id" && this.peek(1).k === "op" && this.peek(1).v === "=") {
            const k = this.next().v;
            this.next();
            named[k] = this.expr();
          } else {
            if (Object.keys(named).length) {
              const bad = this.peek();
              throw new XScriptError("Positional arguments must come before named ones", bad.line, bad.col);
            }
            args.push(this.expr());
          }
          if (!this.isOp(",")) break;
          this.next();
        }
        this.expect(")");
        return { t: "call", name: t.v, args, named, at: t };
      }
      return { t: "id", name: t.v, at: t };
    }
    throw new XScriptError(t.k === "eof" ? "Unexpected end of script" : `Unexpected "${t.v}"`, t.line, t.col);
  }
}

// ---------------- Evaluator ----------------
const SOURCES = new Set(["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4", "bar_index", "time"]);

const COLORS: Record<string, string> = {
  red: "#f43f5e", green: "#22c55e", blue: "#3b82f6", aqua: "#38bdf8", teal: "#14b8a6", orange: "#fb923c",
  yellow: "#f5c451", purple: "#a78bfa", fuchsia: "#e879f9", pink: "#f472b6", white: "#e5e9f0", gray: "#8b95a7", lime: "#a3e635",
};
const DEFAULT_COLORS = ["#38bdf8", "#f5c451", "#a78bfa", "#f472b6", "#34d399", "#fb923c"];

export type XPlot = { title: string; color: string; style: "line" | "histogram" | "dots" | "area"; values: number[]; pane: "overlay" | "separate" };
export type XMarker = { index: number; text: string; color: string; position: "above" | "below" };
export type XInput = { name: string; title: string; default: number; value: number };
export type XResult = {
  title: string;
  overlay: boolean;
  plots: XPlot[];
  hlines: { value: number; title: string; color: string }[];
  markers: XMarker[];
  inputs: XInput[];
  last: number;
  ms: number;
};

type Fn = (args: Value[], named: Record<string, Value>, at: Tok) => Value;

export function runXScript(code: string, bars: Bar[], inputOverrides: Record<string, number> = {}): XResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (code.length > 20_000) throw new XScriptError("Script is too long (max 20,000 characters)", 1, 1);
  const prog = new Parser(lex(code)).program();
  const n = bars.length;
  const result: XResult = { title: "My script", overlay: true, plots: [], hlines: [], markers: [], inputs: [], last: NaN, ms: 0 };
  let declaredOverlay: boolean | null = null;
  const vars = new Map<string, Value>();

  const col = (f: (b: Bar) => number): Series => bars.map(f);
  const sourceCache = new Map<string, Series>();
  const source = (name: string): Series => {
    let s = sourceCache.get(name);
    if (!s) {
      s =
        name === "open" ? col((b) => b.o) : name === "high" ? col((b) => b.h) : name === "low" ? col((b) => b.l)
        : name === "close" ? col((b) => b.c) : name === "volume" ? col((b) => b.v) : name === "hl2" ? col((b) => (b.h + b.l) / 2)
        : name === "hlc3" ? col((b) => (b.h + b.l + b.c) / 3) : name === "ohlc4" ? col((b) => (b.o + b.h + b.l + b.c) / 4)
        : name === "time" ? col((b) => b.t) : bars.map((_, i) => i);
      sourceCache.set(name, s);
    }
    return s;
  };

  const err = (msg: string, at: Tok): never => {
    throw new XScriptError(msg, at.line, at.col);
  };
  const asSeries = (v: Value, at: Tok): Series => {
    if (typeof v === "string") err("Expected a number or series, got text", at);
    return typeof v === "number" ? new Array(n).fill(v) : (v as Series);
  };
  const asNum = (v: Value | undefined, at: Tok, name: string): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) err(`${name} must be a fixed number`, at);
    return v as number;
  };
  const asLen = (v: Value | undefined, at: Tok, def?: number): number => {
    if (v === undefined && def !== undefined) return def;
    const x = asNum(v, at, "Length");
    if (x < 1 || x > 1000 || !Number.isInteger(x)) err("Length must be a whole number from 1 to 1000", at);
    return x;
  };
  const asStr = (v: Value | undefined, at: Tok, def: string): string => {
    if (v === undefined) return def;
    if (typeof v !== "string") err("Expected text in quotes", at);
    return v as string;
  };
  const colorOf = (v: Value | undefined, at: Tok, def: string): string => {
    const s = asStr(v, at, def);
    if (Object.hasOwn(COLORS, s)) return COLORS[s];
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
    return err(`Unknown color "${s}". Use a name like "red" or a hex code like "#38bdf8"`, at);
  };
  const map2 = (a: Value, b: Value, at: Tok, f: (x: number, y: number) => number): Value => {
    if (typeof a === "number" && typeof b === "number") return f(a, b);
    const sa = asSeries(a, at);
    const sb = asSeries(b, at);
    return sa.map((x, i) => f(x, sb[i]));
  };
  const map1 = (a: Value, at: Tok, f: (x: number) => number): Value => (typeof a === "number" ? f(a) : asSeries(a, at).map(f));
  const bool = (x: number | boolean) => (x ? 1 : 0);
  const truthy = (x: number) => Number.isFinite(x) && x !== 0;

  const src = (args: Value[], k: number, at: Tok) => asSeries(args[k] ?? source("close"), at);

  const FNS: Record<string, Fn> = {
    sma: (a, _, at) => ta.sma(src(a, 0, at), asLen(a[1], at)),
    ema: (a, _, at) => ta.ema(src(a, 0, at), asLen(a[1], at)),
    rma: (a, _, at) => ta.rma(src(a, 0, at), asLen(a[1], at)),
    wma: (a, _, at) => ta.wma(src(a, 0, at), asLen(a[1], at)),
    hma: (a, _, at) => ta.hma(src(a, 0, at), asLen(a[1], at)),
    rsi: (a, _, at) => ta.rsi(src(a, 0, at), asLen(a[1], at, 14)),
    stdev: (a, _, at) => ta.stdev(src(a, 0, at), asLen(a[1], at)),
    highest: (a, _, at) => ta.highest(src(a, 0, at), asLen(a[1], at)),
    lowest: (a, _, at) => ta.lowest(src(a, 0, at), asLen(a[1], at)),
    change: (a, _, at) => ta.change(src(a, 0, at), asLen(a[1], at, 1)),
    mom: (a, _, at) => ta.change(src(a, 0, at), asLen(a[1], at, 10)),
    roc: (a, _, at) => ta.roc(src(a, 0, at), asLen(a[1], at, 12)),
    macd: (a, _, at) => ta.macd(src(a, 0, at), asLen(a[1], at, 12), asLen(a[2], at, 26), asLen(a[3], at, 9)).macd,
    macd_signal: (a, _, at) => ta.macd(src(a, 0, at), asLen(a[1], at, 12), asLen(a[2], at, 26), asLen(a[3], at, 9)).signal,
    macd_hist: (a, _, at) => ta.macd(src(a, 0, at), asLen(a[1], at, 12), asLen(a[2], at, 26), asLen(a[3], at, 9)).hist,
    bb_upper: (a, _, at) => ta.bollinger(src(a, 0, at), asLen(a[1], at, 20), a[2] === undefined ? 2 : asNum(a[2], at, "Multiplier")).upper,
    bb_lower: (a, _, at) => ta.bollinger(src(a, 0, at), asLen(a[1], at, 20), a[2] === undefined ? 2 : asNum(a[2], at, "Multiplier")).lower,
    bb_mid: (a, _, at) => ta.sma(src(a, 0, at), asLen(a[1], at, 20)),
    atr: (a, _, at) => ta.atr(source("high"), source("low"), source("close"), asLen(a[0], at, 14)),
    adx: (a, _, at) => ta.adx(source("high"), source("low"), source("close"), asLen(a[0], at, 14)).adx,
    plus_di: (a, _, at) => ta.adx(source("high"), source("low"), source("close"), asLen(a[0], at, 14)).plusDI,
    minus_di: (a, _, at) => ta.adx(source("high"), source("low"), source("close"), asLen(a[0], at, 14)).minusDI,
    supertrend: (a, _, at) => ta.supertrend(source("high"), source("low"), source("close"), asLen(a[0], at, 10), a[1] === undefined ? 3 : asNum(a[1], at, "Multiplier")).line,
    supertrend_dir: (a, _, at) => ta.supertrend(source("high"), source("low"), source("close"), asLen(a[0], at, 10), a[1] === undefined ? 3 : asNum(a[1], at, "Multiplier")).dir,
    vwap: () => ta.vwap(source("high"), source("low"), source("close"), source("volume"), source("time")),
    obv: () => ta.obv(source("close"), source("volume")),
    stoch_k: (a, _, at) => ta.stochastic(source("high"), source("low"), source("close"), asLen(a[0], at, 14), asLen(a[1], at, 3), 3).k,
    stoch_d: (a, _, at) => ta.stochastic(source("high"), source("low"), source("close"), asLen(a[0], at, 14), asLen(a[1], at, 3), asLen(a[2], at, 3)).d,
    cci: (a, _, at) => ta.cci(source("high"), source("low"), source("close"), asLen(a[0], at, 20)),
    mfi: (a, _, at) => ta.mfi(source("high"), source("low"), source("close"), source("volume"), asLen(a[0], at, 14)),
    willr: (a, _, at) => ta.williamsR(source("high"), source("low"), source("close"), asLen(a[0], at, 14)),
    psar: (a, _, at) => ta.psar(source("high"), source("low"), a[0] === undefined ? 0.02 : asNum(a[0], at, "Step"), a[1] === undefined ? 0.2 : asNum(a[1], at, "Max")),
    crossover: (a, _, at) => ta.crossover(asSeries(a[0], at), asSeries(a[1], at)).map(bool),
    crossunder: (a, _, at) => ta.crossunder(asSeries(a[0], at), asSeries(a[1], at)).map(bool),
    abs: (a, _, at) => map1(a[0], at, Math.abs),
    sqrt: (a, _, at) => map1(a[0], at, Math.sqrt),
    log: (a, _, at) => map1(a[0], at, Math.log),
    exp: (a, _, at) => map1(a[0], at, Math.exp),
    round: (a, _, at) => map1(a[0], at, Math.round),
    floor: (a, _, at) => map1(a[0], at, Math.floor),
    ceil: (a, _, at) => map1(a[0], at, Math.ceil),
    sign: (a, _, at) => map1(a[0], at, Math.sign),
    pow: (a, _, at) => map2(a[0], a[1], at, Math.pow),
    max: (a, _, at) => map2(a[0], a[1], at, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.max(x, y))),
    min: (a, _, at) => map2(a[0], a[1], at, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.min(x, y))),
    nz: (a, _, at) => map2(a[0], a[1] ?? 0, at, (x, y) => (Number.isFinite(x) ? x : y)),
    na: (a, _, at) => map1(a[0], at, (x) => bool(!Number.isFinite(x))),
  };
  const ARITY: Record<string, [number, number]> = {
    sma: [2, 2], ema: [2, 2], rma: [2, 2], wma: [2, 2], hma: [2, 2], rsi: [1, 2], stdev: [2, 2], highest: [2, 2], lowest: [2, 2],
    change: [1, 2], mom: [1, 2], roc: [1, 2], macd: [1, 4], macd_signal: [1, 4], macd_hist: [1, 4], bb_upper: [1, 3], bb_lower: [1, 3],
    bb_mid: [1, 2], atr: [0, 1], adx: [0, 1], plus_di: [0, 1], minus_di: [0, 1], supertrend: [0, 2], supertrend_dir: [0, 2], vwap: [0, 0],
    obv: [0, 0], stoch_k: [0, 2], stoch_d: [0, 3], cci: [0, 1], mfi: [0, 1], willr: [0, 1], psar: [0, 2], crossover: [2, 2], crossunder: [2, 2],
    abs: [1, 1], sqrt: [1, 1], log: [1, 1], exp: [1, 1], round: [1, 1], floor: [1, 1], ceil: [1, 1], sign: [1, 1], pow: [2, 2], max: [2, 2],
    min: [2, 2], nz: [1, 2], na: [1, 1],
  };

  const evalNode = (node: Node): Value => {
    switch (node.t) {
      case "num":
        return node.v;
      case "str":
        return node.v;
      case "id": {
        if (node.name === "true") return 1;
        if (node.name === "false") return 0;
        if (node.name === "na") return NaN;
        if (SOURCES.has(node.name)) return source(node.name);
        const v = vars.get(node.name);
        if (v === undefined) err(`Unknown name "${node.name}"`, node.at);
        return v as Value;
      }
      case "un": {
        const v = evalNode(node.e);
        if (node.op === "-") return map1(v, node.at, (x) => -x);
        if (node.op === "+") return v;
        return map1(v, node.at, (x) => bool(!truthy(x)));
      }
      case "bin": {
        const a = evalNode(node.a);
        const b = evalNode(node.b);
        const f: Record<string, (x: number, y: number) => number> = {
          "+": (x, y) => x + y, "-": (x, y) => x - y, "*": (x, y) => x * y, "/": (x, y) => (y === 0 ? NaN : x / y),
          "%": (x, y) => (y === 0 ? NaN : x % y), "==": (x, y) => bool(x === y), "!=": (x, y) => bool(x !== y),
          "<": (x, y) => bool(x < y), "<=": (x, y) => bool(x <= y), ">": (x, y) => bool(x > y), ">=": (x, y) => bool(x >= y),
          and: (x, y) => bool(truthy(x) && truthy(y)), or: (x, y) => bool(truthy(x) || truthy(y)),
        };
        return map2(a, b, node.at, f[node.op]);
      }
      case "tern": {
        const c = evalNode(node.c);
        const a = evalNode(node.a);
        const b = evalNode(node.b);
        if (typeof c === "number") return truthy(c) ? a : b;
        const sa = asSeries(a, node.at);
        const sb = asSeries(b, node.at);
        return (c as Series).map((x, i) => (truthy(x) ? sa[i] : sb[i]));
      }
      case "hist": {
        const v = evalNode(node.e);
        const k = asNum(evalNode(node.n), node.at, "History offset");
        if (!Number.isInteger(k) || k < 0 || k > 5000) err("History offset must be a whole number ≥ 0", node.at);
        if (typeof v === "number") return v;
        const s = asSeries(v, node.at);
        return s.map((_, i) => (i >= k ? s[i - k] : NaN));
      }
      case "call":
        return call(node);
    }
  };

  const call = (node: Extract<Node, { t: "call" }>): Value => {
    const at = node.at;
    const named = Object.fromEntries(Object.entries(node.named).map(([k, v]) => [k, evalNode(v)]));
    const args = node.args.map(evalNode);
    switch (node.name) {
      case "indicator": {
        result.title = asStr(args[0], at, "My script").slice(0, 60);
        const ov = named.overlay ?? args[1];
        if (ov !== undefined) declaredOverlay = truthy(asNum(ov, at, "overlay"));
        return NaN;
      }
      case "input": {
        const def = asNum(args[0], at, "Input default");
        const title = asStr(args[1] ?? named.title, at, `Input ${result.inputs.length + 1}`).slice(0, 40);
        const key = title;
        const value = Number.isFinite(inputOverrides[key]) ? inputOverrides[key] : def;
        result.inputs.push({ name: key, title, default: def, value });
        return value;
      }
      case "plot": {
        if (result.plots.length >= 20) err("At most 20 plots per script", at);
        const values = asSeries(args[0], at);
        const style = asStr(named.style ?? args[3], at, "line");
        if (!["line", "histogram", "dots", "area"].includes(style)) err(`style must be "line", "histogram", "dots" or "area"`, at);
        result.plots.push({
          title: asStr(args[1] ?? named.title, at, `Plot ${result.plots.length + 1}`).slice(0, 40),
          color: colorOf(args[2] ?? named.color, at, DEFAULT_COLORS[result.plots.length % DEFAULT_COLORS.length]),
          style: style as XPlot["style"],
          values: values.map((x) => (Number.isFinite(x) ? x : NaN)),
          pane: "overlay",
        });
        return NaN;
      }
      case "hline": {
        result.hlines.push({
          value: asNum(args[0], at, "hline value"),
          title: asStr(args[1] ?? named.title, at, ""),
          color: colorOf(args[2] ?? named.color, at, "gray"),
        });
        return NaN;
      }
      case "signal": {
        const cond = asSeries(args[0], at);
        const text = asStr(args[1] ?? named.text, at, "").slice(0, 12);
        const color = colorOf(args[2] ?? named.color, at, "green");
        const position = asStr(named.position ?? args[3], at, "below");
        if (position !== "above" && position !== "below") err(`position must be "above" or "below"`, at);
        cond.forEach((x, i) => {
          if (truthy(x) && result.markers.length < 2000) result.markers.push({ index: i, text, color, position: position as "above" | "below" });
        });
        return NaN;
      }
    }
    // Own-property lookups only: names like "toString" or "constructor" must never resolve.
    if (!Object.hasOwn(FNS, node.name) || !Object.hasOwn(ARITY, node.name)) err(`Unknown function "${node.name}"`, at);
    const fn = FNS[node.name];
    const [lo, hi] = ARITY[node.name];
    if (args.length < lo || args.length > hi)
      err(`${node.name}() takes ${lo === hi ? lo : `${lo}–${hi}`} argument${hi === 1 ? "" : "s"}, got ${args.length}`, at);
    return fn(args, named, at);
  };

  let lastValue: Value = NaN;
  for (const st of prog) {
    const v = evalNode(st.e);
    if (st.t === "assign") vars.set(st.name, v);
    lastValue = v;
  }

  // Overlay unless declared otherwise, or when plots are clearly oscillators (hlines present).
  const overlay = declaredOverlay ?? result.hlines.length === 0;
  result.overlay = overlay;
  for (const p of result.plots) p.pane = overlay ? "overlay" : "separate";
  result.last = typeof lastValue === "number" ? lastValue : typeof lastValue === "string" ? NaN : (lastValue[n - 1] ?? NaN);
  result.ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  return result;
}

export const XSCRIPT_FUNCTIONS = [
  { group: "Price", items: ["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4", "bar_index"] },
  { group: "Moving averages", items: ["sma(src, len)", "ema(src, len)", "wma(src, len)", "hma(src, len)", "rma(src, len)"] },
  { group: "Momentum", items: ["rsi(src, 14)", "macd(src, 12, 26, 9)", "macd_signal(…)", "macd_hist(…)", "stoch_k(14, 3)", "stoch_d(14, 3, 3)", "cci(20)", "mfi(14)", "willr(14)", "roc(src, 12)", "mom(src, 10)"] },
  { group: "Trend & volatility", items: ["atr(14)", "adx(14)", "plus_di(14)", "minus_di(14)", "supertrend(10, 3)", "supertrend_dir(10, 3)", "psar(0.02, 0.2)", "bb_upper(src, 20, 2)", "bb_lower(src, 20, 2)", "stdev(src, len)", "vwap()", "obv()"] },
  { group: "Utilities", items: ["highest(src, len)", "lowest(src, len)", "change(src, 1)", "crossover(a, b)", "crossunder(a, b)", "x[1]  // previous bar", "cond ? a : b", "abs max min sqrt log pow round nz na"] },
  { group: "Output", items: ['indicator("Name", overlay=true)', 'input(14, "Length")', 'plot(series, "Title", "aqua")', 'plot(x, style="histogram")', 'hline(70, "Overbought", "red")', 'signal(cond, "Buy", "green", position="below")'] },
];

export const EXAMPLE_SCRIPTS: { name: string; code: string }[] = [
  {
    name: "EMA crossover signals",
    code: `indicator("EMA Cross", overlay=true)
fastLen = input(9, "Fast")
slowLen = input(21, "Slow")
fast = ema(close, fastLen)
slow = ema(close, slowLen)
plot(fast, "Fast EMA", "aqua")
plot(slow, "Slow EMA", "orange")
signal(crossover(fast, slow), "Buy", "green", position="below")
signal(crossunder(fast, slow), "Sell", "red", position="above")`,
  },
  {
    name: "RSI with smoothing",
    code: `indicator("RSI Smoothed", overlay=false)
len = input(14, "RSI length")
r = rsi(close, len)
plot(r, "RSI", "purple")
plot(ema(r, 9), "Signal", "yellow")
hline(70, "Overbought", "red")
hline(30, "Oversold", "green")`,
  },
  {
    name: "Volume breakout",
    code: `indicator("Volume Breakout", overlay=true)
avgVol = sma(volume, 20)
breakout = close > highest(high, 20)[1] and volume > 1.5 * avgVol
plot(highest(high, 20)[1], "20-bar high", "gray")
signal(breakout, "BO", "aqua", position="below")`,
  },
  {
    name: "Custom momentum oscillator",
    code: `indicator("Momentum Score", overlay=false)
score = (rsi(close, 14) - 50) / 10 + (close - ema(close, 50)) / atr(14)
plot(score, "Score", "aqua")
plot(score - score[1], "Change", style="histogram")
hline(0)`,
  },
];
