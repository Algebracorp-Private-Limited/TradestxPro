/** Committed-state snapshots every `every` bars (bounded), used to replay after historical corrections. */
export class Checkpoints<S> {
  private list: { at: number; state: S }[] = [];
  readonly every: number;
  readonly max: number;
  constructor(every: number, max = 64) {
    this.every = every;
    this.max = max;
  }
  due(committed: number) {
    return committed % this.every === 0;
  }
  put(at: number, state: S) {
    this.list.push({ at, state });
    // Keep memory bounded: thin out older checkpoints (keep every other one).
    if (this.list.length > this.max) this.list = this.list.filter((_, i) => i % 2 === 1 || i === this.list.length - 1);
  }
  /** Latest checkpoint taken at or before bar `i` (state after bars 0 … at−1). */
  before(i: number): { at: number; state: S } | null {
    for (let k = this.list.length - 1; k >= 0; k--) if (this.list[k].at <= i) return this.list[k];
    return null;
  }
  dropAfter(at: number) {
    this.list = this.list.filter((c) => c.at <= at);
  }
  clear() {
    this.list = [];
  }
  size() {
    return this.list.length;
  }
}
