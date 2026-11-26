/// <reference lib="webworker" />
/**
 * Indicator worker entry. Runs built-in indicators and derived-chart transformations off the main
 * thread. It only accepts validated DATA messages (see protocol.ts) and never evaluates code.
 * Note: a worker is NOT a security sandbox for untrusted code; none is executed here.
 */
import { computeDerivedPoints, computeIndicators } from "./compute.ts";
import { PROTOCOL_VERSION, validateRequest, type Response } from "./protocol.ts";

const cancelled = new Set<number>();
const scope = self as unknown as { postMessage(m: Response, t?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

scope.onmessage = (e: MessageEvent) => {
  let jobId = -1;
  try {
    const req = validateRequest(e.data);
    jobId = req.jobId;
    if (req.type === "cancel") {
      cancelled.add(req.jobId);
      return;
    }
    // Yield once so a cancel that is already queued is seen before heavy work starts.
    setTimeout(() => {
      try {
        if (cancelled.delete(req.jobId)) return scope.postMessage({ v: PROTOCOL_VERSION, type: "cancelled", jobId: req.jobId });
        const t0 = performance.now();
        if (req.type === "indicators") {
          const results = computeIndicators(req.columns, req.indicators, req.intraday, () => cancelled.has(req.jobId));
          if (!results || cancelled.delete(req.jobId)) return scope.postMessage({ v: PROTOCOL_VERSION, type: "cancelled", jobId: req.jobId });
          const transfer: Transferable[] = [];
          for (const r of results) if (r.outputs) for (const a of Object.values(r.outputs)) transfer.push(a.buffer);
          scope.postMessage({ v: PROTOCOL_VERSION, type: "indicators", jobId: req.jobId, datasetVersion: req.datasetVersion, results, ms: performance.now() - t0 }, transfer);
        } else {
          const points = computeDerivedPoints(req.columns, req.kind, req.settings);
          scope.postMessage({ v: PROTOCOL_VERSION, type: "derived", jobId: req.jobId, datasetVersion: req.datasetVersion, points, ms: performance.now() - t0 });
        }
      } catch (err) {
        scope.postMessage({ v: PROTOCOL_VERSION, type: "error", jobId: req.jobId, error: (err as Error)?.message ?? String(err) });
      }
    }, 0);
  } catch (err) {
    scope.postMessage({ v: PROTOCOL_VERSION, type: "error", jobId: jobId < 0 ? 0 : jobId, error: (err as Error)?.message ?? String(err) });
  }
};
