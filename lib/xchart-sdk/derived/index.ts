/**
 * DerivedSeriesEngine: keeps a derived (price-based) series in sync with the candlestick series.
 *
 * - The builder state is COMMITTED through the second-to-last candle. The last candle may still be
 *   replaced by a live update, so its points are rebuilt from a clone of the committed state
 *   (O(points of one candle)); ten updates of the same candle give exactly the result of one.
 * - A new candle commits the previous one into the state (in place).
 * - Any other change (setData, correction) rebuilds from the start.
 * - `points` and `bars` are mutated in place so the renderer's tick path can reuse them.
 */
import type { AxisBar } from "../store.ts";
import { MAX_DERIVED_POINTS, MAX_PER_CANDLE, createBuilder, methodology, resolveSettings, type Builder } from "./builders.ts";
import { XChartError } from "../validation.ts";
import type { DerivedKind, DerivedPoint, DerivedSeries, DerivedSettings, SourceCandle } from "./types.ts";

export * from "./types.ts";
export { PATH_ASSUMPTION, resolveSettings } from "./builders.ts";
export const DERIVED_KINDS: DerivedKind[] = ["renko", "kagi", "point-and-figure", "line-break", "range-bars"];

type Emitted = ReturnType<Builder["process"]>[number];

export class DerivedSeriesEngine {
  readonly kind: DerivedKind;
  readonly settings: Record<string, unknown>;
  private builder: Builder;
  private committed = 0; // candles folded into `builder`
  private confirmedCount = 0; // points produced by committed candles
  private source: readonly SourceCandle[] | null = null;
  readonly points: DerivedPoint[] = [];
  readonly bars: AxisBar[] = [];
  revision = 0;
  sourceRevision = 0;

  constructor(kind: DerivedKind, settings: DerivedSettings | undefined) {
    this.kind = kind;
    this.settings = resolveSettings(kind, settings) as Record<string, unknown>;
    this.builder = createBuilder(kind, this.settings as never);
  }

  /** Brings the series up to date. Returns how many points were appended (for the renderer), or -1 after a rebuild. */
  sync(candles: readonly SourceCandle[], storeVersion: number): number {
    const n = candles.length;
    const before = this.points.length;
    let rebuilt = false;
    if (candles !== this.source || n < this.committed + 1 || n > this.committed + 2) {
      this.rebuild(candles);
      rebuilt = true;
    } else if (n === this.committed + 2) {
      // The previous last candle is final now: commit it (its points become confirmed).
      this.points.length = this.bars.length = this.confirmedCount;
      this.push(this.builder.process(candles[n - 2], n - 2), candles[n - 2], n - 2, "confirmed");
      this.committed = n - 1;
      this.confirmedCount = this.points.length;
    }
    this.source = candles;
    this.tail(candles);
    this.sourceRevision = storeVersion;
    this.revision++;
    return rebuilt ? -1 : this.points.length - before;
  }

  private rebuild(candles: readonly SourceCandle[]) {
    this.builder = createBuilder(this.kind, this.settings as never);
    this.points.length = this.bars.length = 0;
    const n = candles.length;
    for (let i = 0; i < n - 1; i++) this.push(this.builder.process(candles[i], i), candles[i], i, "confirmed");
    this.committed = Math.max(0, n - 1);
    this.confirmedCount = this.points.length;
  }

  /** Points of the last (replaceable) candle plus the open line/column: all provisional. */
  private tail(candles: readonly SourceCandle[]) {
    this.points.length = this.bars.length = this.confirmedCount;
    const n = candles.length;
    if (!n) return;
    const b = this.builder.clone();
    const last = candles[n - 1];
    const show = this.settings.showProvisional !== false;
    const made = b.process(last, n - 1);
    const open = b.open();
    if (!show) return;
    this.push(made, last, n - 1, "provisional");
    this.push(open, last, n - 1, "provisional", true);
  }

  private push(list: Emitted[], c: SourceCandle, sourceIndex: number, status: "confirmed" | "provisional", isOpen = false) {
    if (list.length >= MAX_PER_CANDLE || this.points.length + list.length > MAX_DERIVED_POINTS) {
      throw new XChartError("DERIVED_LIMIT", `The ${this.kind} settings produce too many points (${list.length >= MAX_PER_CANDLE ? `≥ ${MAX_PER_CANDLE} from one candle` : `> ${MAX_DERIVED_POINTS} in total`}); use a larger size`);
    }
    list.forEach((e, seq) => {
      const logical = this.points.length;
      const p: DerivedPoint = {
        ...e,
        id: isOpen ? `${this.kind}:open:${logical}` : `${this.kind}:${sourceIndex}:${seq}`,
        logical, seq, status, sourceTime: c.time, sourceIndex, sourceClose: c.close,
      };
      this.points.push(p);
      this.bars.push({ t: c.time, o: p.open, h: p.high, l: p.low, c: p.close, v: 0 });
    });
  }

  provisionalCount(): number {
    return this.points.length - this.confirmedCount;
  }

  snapshot(): DerivedSeries {
    const b = this.builder as unknown as { level?: (k: number) => number; ready?: () => boolean };
    return {
      kind: this.kind,
      settings: { ...this.settings } as DerivedSeries["settings"],
      points: this.points.map((p) => ({ ...p })),
      revision: this.revision,
      sourceRevision: this.sourceRevision,
      methodology: methodology(this.kind, this.settings),
      ...(this.kind === "point-and-figure" && b.level ? { boxLevel: (k: number) => b.level!.call(this.builder, k) } : {}),
    };
  }

  /** Point & Figure box level function of the committed state (stable box grid). */
  boxLevel(): ((k: number) => number) | undefined {
    const b = this.builder as unknown as { level?: (k: number) => number; ready?: () => boolean };
    if (this.kind !== "point-and-figure" || !b.level) return undefined;
    // The grid is fixed once ready; a clone shares the same parameters.
    return (k: number) => b.level!.call(this.builder, k);
  }
}

/** One-shot calculation (no live state): every candle is treated as final. */
export function computeDerived(kind: DerivedKind, candles: readonly SourceCandle[], settings?: DerivedSettings): DerivedPoint[] {
  const e = new DerivedSeriesEngine(kind, { ...(settings ?? {}), showProvisional: true } as DerivedSettings);
  e.sync(candles, 0);
  return e.points.map((p) => ({ ...p }));
}
