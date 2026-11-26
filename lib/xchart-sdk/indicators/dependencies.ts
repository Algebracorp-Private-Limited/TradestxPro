/**
 * StreamGraph: one per chart. Holds every streaming node of every active indicator, deduplicated
 * by canonical key (so MACD's ema(close,12) and an EMA 12 indicator share one calculation),
 * reference counted, topologically ordered (cycles rejected).
 *
 * State model
 * - committed: node states after bars 0 … n−2 (final).
 * - provisional: the last bar n−1 is evaluated on CLONES of the committed states, so replacing the
 *   live candle repeatedly never advances a recursive calculation more than once.
 * - checkpoints: snapshots of the committed state every CHECKPOINT_EVERY bars, used to replay from
 *   the nearest point after a historical correction instead of from the start.
 *
 * Adding a node marks the graph for a full rebuild (exact by construction); removing nodes only
 * prunes them (the remaining states are unaffected).
 */
import type { Kernel, NodeDef, Row } from "./incremental.ts";
import { Checkpoints } from "./checkpoints.ts";
import { XChartError } from "../validation.ts";

/** Columnar input (existing bars only). */
export type StreamInput = { time: ArrayLike<number>; open: ArrayLike<number>; high: ArrayLike<number>; low: ArrayLike<number>; close: ArrayLike<number>; volume: ArrayLike<number> };

type Entry = { def: NodeDef; state: Kernel; refs: number; slot: number; outputs: number; values: number[] | null };

export type GraphStats = { nodes: number; shared: number; committed: number; rebuilds: number; replays: number; lastSyncMs: number; incrementalAdds?: number };

export class StreamGraph {
  private nodes = new Map<string, Entry>();
  private order: Entry[] = [];
  private vals = new Float64Array(0);
  private aux = new Float64Array(0);
  private committed = 0; // bars folded into the committed states
  private n = 0; // bars seen (committed + the provisional last bar)
  private dirty = true; // rebuild from scratch on the next sync
  /** Nodes added to an already-initialised graph: replayed alone over the committed history. */
  private pending = new Set<string>();
  private copy: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] } = { t: [], o: [], h: [], l: [], c: [], v: [] };
  private checkpoints = new Checkpoints<Kernel[]>(4096);
  private row: Row = { t: 0, o: 0, h: 0, l: 0, c: 0, v: 0 };
  /** First bar index whose outputs changed in the last sync (Infinity when nothing changed). */
  changedFrom = Infinity;
  readonly stats: GraphStats = { nodes: 0, shared: 0, committed: 0, rebuilds: 0, replays: 0, lastSyncMs: 0 };

  /** Registers nodes as outputs; returns a release function. Throws on cycles. */
  acquire(outputs: NodeDef[]): () => void {
    const added: string[] = [];
    const visit = (d: NodeDef, stack: Set<string>) => {
      if (stack.has(d.key)) throw new XChartError("INDICATOR_CYCLE", `Dependency cycle at "${d.key}"`);
      // Every acquisition counts the node's whole dependency closure, so releasing one owner can
      // never free a dependency another owner still uses.
      stack.add(d.key);
      for (const dep of d.deps) visit(dep, stack);
      stack.delete(d.key);
      const e = this.nodes.get(d.key);
      if (e) e.refs++;
      else {
        this.nodes.set(d.key, { def: d, state: d.create(), refs: 1, slot: -1, outputs: 0, values: null });
        this.markNew(d.key);
      }
      added.push(d.key);
    };
    try {
      for (const o of outputs) visit(o, new Set());
    } catch (e) {
      for (const k of added) this.unref(k);
      throw e;
    }
    for (const o of outputs) {
      const e = this.nodes.get(o.key)!;
      if (e.outputs++ === 0 && !e.values) this.markNew(o.key); // needs its history recorded
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const o of outputs) {
        const e = this.nodes.get(o.key);
        if (e && --e.outputs === 0) e.values = null;
      }
      for (const k of added) this.unref(k);
      this.reindex();
    };
  }

  private markNew(key: string) {
    if (this.committed === 0 || this.dirty) this.dirty = true;
    else this.pending.add(key);
  }

  /**
   * Initialises pending nodes without touching existing ones: their dependency closure is replayed
   * on temporary states over the committed history (existing nodes' temporary copies are discarded —
   * they are deterministic, so their real states already equal them).
   */
  private initPending() {
    const keys = new Set<string>();
    const add = (k: string) => {
      if (keys.has(k)) return;
      keys.add(k);
      for (const d of this.nodes.get(k)!.def.deps) add(d.key);
    };
    for (const k of this.pending) if (this.nodes.has(k)) add(k);
    const sub = this.order.filter((e) => keys.has(e.def.key));
    const temp = sub.map((e) => {
      const st = e.def.create();
      st.d = e.state.d;
      return st;
    });
    const rec: (number[] | null)[] = sub.map((e) => (this.pending.has(e.def.key) && e.outputs > 0 ? (e.values = []) : null));
    const vals = new Float64Array(this.order.length), aux = new Float64Array(this.order.length);
    const c = this.copy, r = this.row;
    for (let i = 0; i < this.committed; i++) {
      r.t = c.t[i]; r.o = c.o[i]; r.h = c.h[i]; r.l = c.l[i]; r.c = c.c[i]; r.v = c.v[i];
      for (let k = 0; k < sub.length; k++) {
        const x = temp[k].step(i, r, vals, aux, sub[k].slot);
        vals[sub[k].slot] = x;
        const out = rec[k];
        if (out) out[i] = x;
      }
    }
    sub.forEach((e, k) => {
      if (this.pending.has(e.def.key)) e.state = temp[k];
    });
    this.pending.clear();
  }

  private unref(key: string) {
    const e = this.nodes.get(key);
    if (e && --e.refs <= 0) this.nodes.delete(key);
  }

  /** Topological order (dependencies first) and value slots. */
  private reindex() {
    const order: Entry[] = [];
    const seen = new Set<string>();
    const visit = (key: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      const e = this.nodes.get(key);
      if (!e) return;
      for (const d of e.def.deps) visit(d.key);
      order.push(e);
    };
    for (const k of this.nodes.keys()) visit(k);
    order.forEach((e, i) => (e.slot = i));
    for (const e of order) e.state.d = e.def.deps.map((d) => this.nodes.get(d.key)!.slot);
    this.order = order;
    this.vals = new Float64Array(order.length);
    this.aux = new Float64Array(order.length);
    this.stats.nodes = order.length;
    this.stats.shared = order.filter((e) => e.refs > 1).length;
    // Checkpoints hold states of the old topology.
    this.checkpoints.clear();
  }

  /** True when nodes were added since the last sync (a rebuild is pending). */
  needsSync(): boolean {
    return this.dirty || this.pending.size > 0;
  }

  /** Output history of a node (+ the provisional last value). */
  values(key: string): number[] {
    return this.nodes.get(key)?.values ?? [];
  }

  private fresh() {
    for (const e of this.order) {
      e.state = e.def.create();
      e.state.d = e.def.deps.map((d) => this.nodes.get(d.key)!.slot);
      e.values = e.outputs > 0 ? [] : null;
    }
    this.committed = 0;
    this.n = 0;
    this.checkpoints.clear();
    for (const k of Object.keys(this.copy) as (keyof typeof this.copy)[]) this.copy[k].length = 0;
  }

  private load(inp: StreamInput, i: number) {
    const r = this.row;
    r.t = inp.time[i];
    r.o = inp.open[i];
    r.h = inp.high[i];
    r.l = inp.low[i];
    r.c = inp.close[i];
    r.v = inp.volume[i];
  }

  /** Folds bar i into the committed states (in place). */
  private commit(inp: StreamInput, i: number) {
    this.load(inp, i);
    const { vals, aux, row } = this;
    for (const e of this.order) {
      const x = e.state.step(i, row, vals, aux, e.slot);
      vals[e.slot] = x;
      if (e.values) e.values[i] = x;
    }
    const c = this.copy;
    c.t[i] = row.t; c.o[i] = row.o; c.h[i] = row.h; c.l[i] = row.l; c.c[i] = row.c; c.v[i] = row.v;
    this.committed = i + 1;
    if (this.checkpoints.due(this.committed)) this.checkpoints.put(this.committed, this.order.map((e) => e.state.clone()));
  }

  /** Evaluates the last bar on clones of the committed states. */
  private provisional(inp: StreamInput, i: number) {
    this.load(inp, i);
    const { vals, aux, row } = this;
    for (const e of this.order) {
      const st = e.state.clone();
      const x = st.step(i, row, vals, aux, e.slot);
      vals[e.slot] = x;
      if (e.values) e.values[i] = x;
    }
  }

  /** First bar index (< limit) where `inp` differs from the committed copy. */
  private firstDiff(inp: StreamInput, limit: number): number {
    const c = this.copy;
    for (let i = 0; i < limit; i++) {
      if (inp.time[i] !== c.t[i] || inp.open[i] !== c.o[i] || inp.high[i] !== c.h[i] || inp.low[i] !== c.l[i] || inp.close[i] !== c.c[i] || inp.volume[i] !== c.v[i]) {
        if (!(Number.isNaN(inp.volume[i]) && Number.isNaN(c.v[i]))) return i;
      }
    }
    return limit;
  }

  /**
   * Brings every node up to date with `inp`. `from` = first bar that may have changed since the
   * previous call (the chart knows this for live ticks); omit it to detect changes by comparison.
   */
  sync(inp: StreamInput, from?: number): void {
    const t0 = performance.now();
    const n = inp.time.length;
    this.changedFrom = Infinity;
    if (this.dirty) {
      this.reindex();
      this.fresh();
      this.dirty = false;
      this.pending.clear();
      this.stats.rebuilds++;
      from = 0;
    } else if (this.pending.size) {
      this.reindex();
      this.initPending();
      this.stats.incrementalAdds = (this.stats.incrementalAdds ?? 0) + 1;
    }
    let start = Math.min(from ?? this.firstDiff(inp, Math.min(this.committed, n)), n);
    if (start < this.committed) {
      // Historical correction: restore the nearest checkpoint at or before `start`.
      const cp = this.checkpoints.before(start);
      if (cp) {
        this.order.forEach((e, k) => (e.state = cp.state[k].clone()));
        this.committed = cp.at;
      } else {
        this.fresh();
      }
      this.checkpoints.dropAfter(this.committed);
      start = this.committed;
      this.stats.replays++;
    }
    this.changedFrom = Math.min(start, this.committed);
    for (let i = this.committed; i < n - 1; i++) this.commit(inp, i);
    for (const e of this.order) if (e.values) e.values.length = n;
    if (n > 0) this.provisional(inp, n - 1);
    if (n < this.n) this.changedFrom = Math.min(this.changedFrom, n);
    this.n = n;
    this.stats.committed = this.committed;
    this.stats.lastSyncMs = performance.now() - t0;
  }

  /** Releases everything (chart destruction). */
  destroy() {
    this.nodes.clear();
    this.order = [];
    this.checkpoints.clear();
    for (const k of Object.keys(this.copy) as (keyof typeof this.copy)[]) this.copy[k] = [];
  }

  size() {
    return this.nodes.size;
  }
}
