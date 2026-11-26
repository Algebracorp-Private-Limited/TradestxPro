/**
 * Frame scheduler for indicator work: coalesces any number of data changes into one flush per
 * animation frame (or microtask outside browsers). The chart already flushes indicators at the
 * start of each frame; this helper exposes the same policy to applications that drive
 * calculations themselves (e.g. a worker-backed dashboard).
 */
export class FrameScheduler {
  private queued = false;
  private handle: number | null = null;
  private fn: () => void;
  private cancelled = false;
  constructor(fn: () => void) {
    this.fn = fn;
  }
  request() {
    if (this.queued || this.cancelled) return;
    this.queued = true;
    const run = () => {
      this.queued = false;
      this.handle = null;
      if (!this.cancelled) this.fn();
    };
    if (typeof requestAnimationFrame === "function") this.handle = requestAnimationFrame(run);
    else queueMicrotask(run);
  }
  cancel() {
    this.cancelled = true;
    if (this.handle !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.handle);
  }
}
