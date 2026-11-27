/**
 * Provider-independent AI client. The language model only writes explanations of numbers that
 * deterministic code has already computed; every call has a deterministic fallback.
 *
 * generate():
 *   1. per-user and global rate limits (token buckets)      → fallback when exceeded
 *   2. response cache (provider, model, prompt version, input) → no call on a hit
 *   3. providers in order; each with a timeout and up to `retries` retries with exponential backoff
 *      on retryable failures (429, 5xx, timeouts, network)
 *   4. JSON extraction + schema validation + caller's semantic validation (e.g. "numbers match the
 *      deterministic facts"); invalid output counts as a failed attempt
 *   5. all providers failed or none configured → the caller's deterministic fallback
 * Every attempt is reported to `onUsage` (tokens, cost, latency, outcome) for cost monitoring.
 */
import { createHash } from "node:crypto";
import { TokenBucket } from "../ratelimit.ts";
import { extractJson, validate, wireSchema } from "../core/schema.ts";
import { promptHash, type PromptTemplate } from "./prompts.ts";
import { ProviderError, type AIProvider, type Pricing, type ProviderId, type UsageRecord } from "./types.ts";

export type AIResult<T> = {
  value: T;
  source: "ai" | "cache" | "fallback";
  provider: ProviderId | null;
  model: string | null;
  promptId: string;
  promptVersion: string;
  promptHash: string;
  /** Why the fallback was used (when source = "fallback"). */
  fallbackReason?: string;
  attempts: { provider: ProviderId; error: string }[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type ClientOptions = {
  providers: AIProvider[];
  pricing?: Pricing;
  timeoutMs?: number;
  retries?: number;
  /** Per-user requests per minute and global requests per minute. */
  userPerMinute?: number;
  globalPerMinute?: number;
  cacheTtlMs?: number;
  cacheMax?: number;
  onUsage?: (u: UsageRecord) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};


export function costOf(pricing: Pricing | undefined, model: string, inTok: number, outTok: number): number | null {
  const p = pricing?.[model];
  return p ? (inTok * p.input + outTok * p.output) / 1e6 : null;
}

export class AIClient {
  private readonly o: Required<Omit<ClientOptions, "pricing" | "onUsage">> & Pick<ClientOptions, "pricing" | "onUsage">;
  private cache = new Map<string, { at: number; value: unknown; provider: ProviderId; model: string }>();
  private users = new Map<number, TokenBucket>();
  private global: TokenBucket;

  constructor(opts: ClientOptions) {
    this.o = {
      providers: opts.providers, pricing: opts.pricing, onUsage: opts.onUsage,
      timeoutMs: opts.timeoutMs ?? 45_000, retries: opts.retries ?? 2,
      userPerMinute: opts.userPerMinute ?? 10, globalPerMinute: opts.globalPerMinute ?? 120,
      cacheTtlMs: opts.cacheTtlMs ?? 15 * 60_000, cacheMax: opts.cacheMax ?? 500,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), now: opts.now ?? (() => Date.now()),
    };
    this.global = new TokenBucket(this.o.globalPerMinute, this.o.now());
  }

  get configured(): boolean {
    return this.o.providers.length > 0;
  }
  get providerIds(): ProviderId[] {
    return this.o.providers.map((p) => p.id);
  }

  async generate<T>(args: {
    prompt: PromptTemplate;
    vars: Record<string, unknown>;
    userId: number | null;
    fallback: (reason: string) => T;
    /** Semantic checks beyond the schema (e.g. numbers must match the facts); return problems. */
    check?: (value: T) => string[];
    /** Skip the cache (e.g. "regenerate"). */
    fresh?: boolean;
  }): Promise<AIResult<T>> {
    const { prompt } = args;
    const base = { promptId: prompt.id, promptVersion: prompt.version, promptHash: promptHash(prompt) };
    const now = this.o.now();
    const usage = (u: Omit<UsageRecord, "at" | "userId" | "promptId" | "promptVersion">) =>
      this.o.onUsage?.({ at: new Date(this.o.now()).toISOString(), userId: args.userId, promptId: prompt.id, promptVersion: prompt.version, ...u });
    const fallback = (reason: string, attempts: AIResult<T>["attempts"], outcome: UsageRecord["outcome"]): AIResult<T> => {
      usage({ provider: "fallback", model: null, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, outcome, error: reason });
      return { value: args.fallback(reason), source: "fallback", provider: null, model: null, ...base, fallbackReason: reason, attempts, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    };

    if (!this.o.providers.length) return fallback("no AI provider is configured", [], "disabled");
    const user = prompt.render(args.vars);
    const cacheKey = createHash("sha256").update(JSON.stringify([this.o.providers.map((p) => `${p.id}:${p.model}`), base.promptHash, user])).digest("hex");
    const hit = this.cache.get(cacheKey);
    if (!args.fresh && hit && now - hit.at < this.o.cacheTtlMs) {
      usage({ provider: "cache", model: hit.model, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, outcome: "cache" });
      return { value: hit.value as T, source: "cache", provider: hit.provider, model: hit.model, ...base, attempts: [], inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    if (args.userId !== null) {
      let b = this.users.get(args.userId);
      if (!b) this.users.set(args.userId, (b = new TokenBucket(this.o.userPerMinute, now)));
      if (!b.take(now)) return fallback("per-user AI rate limit reached", [], "rate-limited");
    }
    if (!this.global.take(now)) return fallback("global AI rate limit reached", [], "rate-limited");

    const attempts: AIResult<T>["attempts"] = [];
    const schema = wireSchema(prompt.schema);
    for (const p of this.o.providers) {
      for (let attempt = 0; attempt <= this.o.retries; attempt++) {
        const t0 = this.o.now();
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), this.o.timeoutMs);
        try {
          const r = await Promise.race([
            p.complete({ system: prompt.system, user, schema, schemaName: prompt.id.replace(/[^a-zA-Z0-9_-]/g, "_"), maxTokens: prompt.maxTokens, signal: ac.signal }),
            new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(new ProviderError(`timed out after ${this.o.timeoutMs} ms`, true)), { once: true })),
          ]);
          const cost = costOf(this.o.pricing, r.model, r.inputTokens, r.outputTokens);
          let value: T;
          try {
            value = extractJson(r.text) as T;
          } catch (e) {
            usage({ provider: p.id, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: cost, latencyMs: this.o.now() - t0, outcome: "invalid-output", error: (e as Error).message });
            attempts.push({ provider: p.id, error: `unparseable output: ${(e as Error).message}` });
            continue;
          }
          const problems = [...validate(prompt.schema, value), ...(args.check?.(value) ?? [])];
          if (problems.length) {
            usage({ provider: p.id, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: cost, latencyMs: this.o.now() - t0, outcome: "invalid-output", error: problems.slice(0, 5).join("; ") });
            attempts.push({ provider: p.id, error: `rejected output: ${problems.slice(0, 3).join("; ")}` });
            continue;
          }
          usage({ provider: p.id, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: cost, latencyMs: this.o.now() - t0, outcome: "ok" });
          if (this.cache.size >= this.o.cacheMax) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(cacheKey, { at: this.o.now(), value, provider: p.id, model: r.model });
          return { value, source: "ai", provider: p.id, model: r.model, ...base, attempts, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: cost };
        } catch (e) {
          const err = e instanceof ProviderError ? e : new ProviderError(e instanceof Error ? e.message : String(e), true);
          usage({ provider: p.id, model: p.model, inputTokens: 0, outputTokens: 0, costUsd: null, latencyMs: this.o.now() - t0, outcome: "error", error: err.message });
          attempts.push({ provider: p.id, error: err.message });
          if (!err.retryable) break;
          if (attempt < this.o.retries) await this.o.sleep(Math.min(8000, 500 * 2 ** attempt));
        } finally {
          clearTimeout(timer);
        }
      }
    }
    return fallback(`all AI providers failed (${attempts.length} attempts)`, attempts, "fallback");
  }
}
