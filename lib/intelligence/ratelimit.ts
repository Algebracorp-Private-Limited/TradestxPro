/**
 * Token buckets (shared by the AI client's rate limits and the per-user endpoint limits).
 * Endpoint limits are per server instance (in memory): they bound burst cost on one instance and are
 * not a global quota. Daily AI budgets are enforced separately by the AI client and usage records.
 */
export class TokenBucket {
  private tokens: number;
  private at: number;
  private readonly rate: number;
  constructor(perMinute: number, now: number) {
    this.rate = perMinute;
    this.tokens = perMinute;
    this.at = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.at) / 60_000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** Milliseconds until one token is available. */
  waitMs(now: number): number {
    const t = Math.min(this.rate, this.tokens + ((now - this.at) / 60_000) * this.rate);
    return t >= 1 ? 0 : Math.ceil(((1 - t) / this.rate) * 60_000);
  }
}

/** Per-key limiter with a bounded key table (oldest keys evicted). */
export class KeyedLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  readonly perMinute: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  constructor(perMinute: number, maxKeys = 10_000, now: () => number = Date.now) {
    this.perMinute = perMinute;
    this.maxKeys = maxKeys;
    this.now = now;
  }
  check(key: string): { ok: true } | { ok: false; retryAfterS: number } {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
      b = new TokenBucket(this.perMinute, t);
      this.buckets.set(key, b);
    }
    return b.take(t) ? { ok: true } : { ok: false, retryAfterS: Math.max(1, Math.ceil(b.waitMs(t) / 1000)) };
  }
}

/** Per-user limits for the costly intelligence endpoints (requests per minute per user). */
export const ENDPOINT_LIMITS = {
  backtest: 6,
  strategy: 20,
  scenario: 30,
  tradevision: 30,
  annotate: 10,
  contract: 60,
  equity: 60,
  futures: 60,
  chain: 60,
} as const;
const limiters = new Map<string, KeyedLimiter>();
export function limitFor(endpoint: keyof typeof ENDPOINT_LIMITS): KeyedLimiter {
  let l = limiters.get(endpoint);
  if (!l) limiters.set(endpoint, (l = new KeyedLimiter(ENDPOINT_LIMITS[endpoint])));
  return l;
}
