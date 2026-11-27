/**
 * Staged processing pipeline (Phase 4 section 12). Each stage receives the context, may narrow or
 * enrich it, and reports counts. Cancellation is checked between stages and between items;
 * a failed item never aborts the run (partial results are kept and the failure is recorded).
 */
export type StageReport = { stage: string; startedAt: string; finishedAt: string | null; ms: number; inCount: number; outCount: number; errors: { item: string; error: string }[]; notes: string[] };

export class CancelledScan extends Error {
  constructor() {
    super("cancelled");
  }
}

export type PipelineControl = {
  /** True when the run must stop (user cancelled, deadline passed). */
  cancelled: () => boolean;
  /** Progress callback: stage name and fraction 0–1 within the whole pipeline. */
  progress?: (stage: string, fraction: number) => void;
  now?: () => number;
};

export type Stage<C> = { name: string; run: (ctx: C, h: StageHelpers) => Promise<C> | C };
export type StageHelpers = {
  /** Maps items with bounded concurrency; failures are recorded and skipped. */
  each: <T, R>(items: T[], key: (t: T) => string, fn: (t: T) => Promise<R> | R, concurrency?: number) => Promise<R[]>;
  note: (s: string) => void;
  check: () => void;
};

export async function runPipeline<C>(stages: Stage<C>[], ctx: C, control: PipelineControl, count: (ctx: C) => number = () => 0): Promise<{ ctx: C; reports: StageReport[]; cancelled: boolean }> {
  const reports: StageReport[] = [];
  const now = control.now ?? (() => Date.now());
  let cur = ctx;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (control.cancelled()) return { ctx: cur, reports, cancelled: true };
    const t0 = now();
    const rep: StageReport = { stage: s.name, startedAt: new Date(t0).toISOString(), finishedAt: null, ms: 0, inCount: count(cur), outCount: 0, errors: [], notes: [] };
    reports.push(rep);
    control.progress?.(s.name, i / stages.length);
    const helpers: StageHelpers = {
      check: () => {
        if (control.cancelled()) throw new CancelledScan();
      },
      note: (n) => rep.notes.push(n),
      each: async (items, key, fn, concurrency = 8) => {
        const out: Awaited<ReturnType<typeof fn>>[] = [];
        let next = 0;
        const worker = async () => {
          while (next < items.length) {
            if (control.cancelled()) throw new CancelledScan();
            const idx = next++;
            try {
              out[idx] = await fn(items[idx]);
            } catch (e) {
              if (e instanceof CancelledScan) throw e;
              rep.errors.push({ item: key(items[idx]), error: e instanceof Error ? e.message : String(e) });
            }
            control.progress?.(s.name, (i + (idx + 1) / Math.max(1, items.length)) / stages.length);
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
        return out.filter((x) => x !== undefined);
      },
    };
    try {
      cur = await s.run(cur, helpers);
    } catch (e) {
      rep.finishedAt = new Date(now()).toISOString();
      rep.ms = now() - t0;
      if (e instanceof CancelledScan) return { ctx: cur, reports, cancelled: true };
      throw e;
    }
    rep.finishedAt = new Date(now()).toISOString();
    rep.ms = now() - t0;
    rep.outCount = count(cur);
  }
  control.progress?.("done", 1);
  return { ctx: cur, reports, cancelled: false };
}
