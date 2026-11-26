/**
 * IndicatorWorkerClient: asynchronous historical calculations in ONE Web Worker (not one per
 * indicator), with job ids, dataset versions, cancellation, stale-result rejection, error
 * handling, termination and a synchronous fallback when workers are unavailable.
 *
 * - Input columns are COPIED into new buffers before transfer: the caller's arrays stay usable.
 * - Results for a dataset version older than the newest one requested on the same channel are
 *   rejected (StaleResultError), so an old calculation can never overwrite a newer one.
 * - A newer request on the same channel cancels the older one (coalescing). Each request carries
 *   the complete dataset, so no market observation is lost by coalescing.
 * - The live chart pipeline does not need the worker: live updates are incremental (O(1)) on the
 *   main thread. Use the worker for large initial/historical calculations and transformations.
 */
import { computeDerivedPoints, computeIndicators } from "./compute.ts";
import { PROTOCOL_VERSION, toColumns, transferList, validateResponse, type IndicatorJob, type Request, type Response } from "./protocol.ts";
import type { DerivedKind } from "../derived/types.ts";

export class StaleResultError extends Error {
  constructor(m = "A newer dataset version was requested; this result was discarded") {
    super(m);
    this.name = "StaleResultError";
  }
}
export class CancelledError extends Error {
  constructor(m = "The calculation was cancelled") {
    super(m);
    this.name = "CancelledError";
  }
}

type Source = { time: ArrayLike<number>; open: ArrayLike<number>; high: ArrayLike<number>; low: ArrayLike<number>; close: ArrayLike<number>; volume: ArrayLike<number> };
type Pending = { resolve(v: Response): void; reject(e: Error): void; channel: string; datasetVersion: number; sentAt: number };
export type WorkerClientOptions = {
  /** Creates the worker (custom bundlers). Default: module worker from ./indicator-worker.ts. */
  createWorker?: () => Worker;
  /** Force the main-thread fallback (tests, environments without workers). */
  sync?: boolean;
};
export type IndicatorResultSet = { results: ({ outputs: Record<string, Float64Array> } | { error: string })[]; ms: number; transferMs: number; worker: boolean };

export class IndicatorWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private latest = new Map<string, number>(); // channel → newest datasetVersion requested
  private active = new Map<string, number>(); // channel → jobId in flight
  private seq = 0;
  private opts: WorkerClientOptions;
  private dead = false;
  /** Why the client runs synchronously (null when a worker is used). */
  fallbackReason: string | null = null;

  constructor(opts: WorkerClientOptions = {}) {
    this.opts = opts;
    if (opts.sync) this.fallbackReason = "sync option";
    else if (typeof Worker === "undefined") this.fallbackReason = "Web Workers are not available in this environment";
  }

  get usesWorker() {
    return this.fallbackReason === null;
  }

  private ensure(): Worker | null {
    if (this.dead) throw new Error("This worker client was terminated");
    if (this.fallbackReason) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = this.opts.createWorker ? this.opts.createWorker() : new Worker(new URL("./indicator-worker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      this.fallbackReason = `Worker could not start: ${(e as Error).message}`;
      return null;
    }
    this.worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    this.worker.onerror = (e: ErrorEvent) => {
      // A crashed worker fails every pending job; the next request starts a new worker.
      const err = new Error(`Indicator worker failed: ${e.message || "unknown error"}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.active.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }

  private onMessage(data: unknown) {
    let m: Response;
    try {
      m = validateResponse(data);
    } catch {
      return; // ignore malformed messages
    }
    const p = this.pending.get(m.jobId);
    if (!p) return;
    this.pending.delete(m.jobId);
    if (this.active.get(p.channel) === m.jobId) this.active.delete(p.channel);
    if (m.type === "error") return p.reject(new Error(m.error));
    if (m.type === "cancelled") return p.reject(new CancelledError());
    if ((this.latest.get(p.channel) ?? -1) > p.datasetVersion) return p.reject(new StaleResultError());
    p.resolve(m);
  }

  private send(req: Request, channel: string, datasetVersion: number, transfer: Transferable[], coalesce = true): Promise<Response> {
    const w = this.ensure()!;
    const prev = this.active.get(channel);
    if (coalesce && prev !== undefined) this.cancel(prev); // coalesce: the newest request wins
    this.active.set(channel, req.jobId);
    return new Promise<Response>((resolve, reject) => {
      this.pending.set(req.jobId, { resolve, reject, channel, datasetVersion, sentAt: performance.now() });
      w.postMessage(req, transfer);
    });
  }

  /** Cancels a job (its promise rejects with CancelledError). */
  cancel(jobId: number) {
    const p = this.pending.get(jobId);
    if (!p) return;
    this.worker?.postMessage({ v: PROTOCOL_VERSION, type: "cancel", jobId } satisfies Request);
    this.pending.delete(jobId);
    if (this.active.get(p.channel) === jobId) this.active.delete(p.channel);
    p.reject(new CancelledError());
  }

  private bump(channel: string, datasetVersion: number) {
    if (!Number.isSafeInteger(datasetVersion) || datasetVersion < 0) throw new RangeError("datasetVersion must be a non-negative integer");
    this.latest.set(channel, Math.max(this.latest.get(channel) ?? -1, datasetVersion));
  }

  /** Calculates built-in indicators over the full history. */
  async computeIndicators(data: Source & { intraday?: boolean }, indicators: IndicatorJob[], opts: { datasetVersion?: number; channel?: string; signal?: AbortSignal; coalesce?: boolean } = {}): Promise<IndicatorResultSet> {
    const channel = opts.channel ?? "default";
    const datasetVersion = opts.datasetVersion ?? 0;
    this.bump(channel, datasetVersion);
    const t0 = performance.now();
    const cols = toColumns(data);
    if (!this.ensure()) {
      const results = computeIndicators(cols, indicators.map((j) => ({ id: j.id, params: { ...j.params } })), data.intraday ?? false);
      if ((this.latest.get(channel) ?? -1) > datasetVersion) throw new StaleResultError();
      return { results: results!.map((r) => ("outputs" in r && r.outputs ? { outputs: r.outputs } : { error: r.error! })), ms: performance.now() - t0, transferMs: 0, worker: false };
    }
    const jobId = ++this.seq;
    const req: Request = { v: PROTOCOL_VERSION, type: "indicators", jobId, datasetVersion, intraday: data.intraday ?? false, columns: cols, indicators: indicators.map((j) => ({ id: j.id, params: { ...j.params } })) };
    opts.signal?.addEventListener("abort", () => this.cancel(jobId), { once: true });
    const res = (await this.send(req, channel, datasetVersion, transferList(cols), opts.coalesce !== false)) as Extract<Response, { type: "indicators" }>;
    const total = performance.now() - t0;
    return { results: res.results.map((r) => (r.outputs ? { outputs: r.outputs } : { error: r.error! })), ms: res.ms, transferMs: Math.max(0, total - res.ms), worker: true };
  }

  /** Builds a price-based chart (Renko, Kagi, …) from candles. */
  async computeDerived(data: Source, kind: DerivedKind, settings: Record<string, unknown> = {}, opts: { datasetVersion?: number; channel?: string; signal?: AbortSignal } = {}) {
    const channel = opts.channel ?? `derived:${kind}`;
    const datasetVersion = opts.datasetVersion ?? 0;
    this.bump(channel, datasetVersion);
    const cols = toColumns(data);
    if (!this.ensure()) return { points: computeDerivedPoints(cols, kind, settings), worker: false };
    const jobId = ++this.seq;
    opts.signal?.addEventListener("abort", () => this.cancel(jobId), { once: true });
    const res = (await this.send({ v: PROTOCOL_VERSION, type: "derived", jobId, datasetVersion, kind, settings: { ...settings }, columns: cols }, channel, datasetVersion, transferList(cols))) as Extract<Response, { type: "derived" }>;
    return { points: res.points, worker: true };
  }

  /** Number of jobs in flight. */
  inFlight() {
    return this.pending.size;
  }

  /** Stops the worker; pending jobs reject. The client cannot be used afterwards. */
  terminate() {
    this.dead = true;
    for (const p of this.pending.values()) p.reject(new CancelledError("The worker client was terminated"));
    this.pending.clear();
    this.active.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
