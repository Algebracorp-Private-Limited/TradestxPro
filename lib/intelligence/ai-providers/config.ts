/**
 * AI provider configuration from the server environment.
 *
 *   AI_PROVIDERS        comma-separated order, e.g. "anthropic" or "anthropic,openai" (default: "anthropic")
 *   ANTHROPIC_API_KEY   + AI_MODEL_ANTHROPIC (default claude-opus-5-5, the model already used in production)
 *   OPENAI_API_KEY      + AI_MODEL_OPENAI    (required: no default model is assumed)
 *   GEMINI_API_KEY      + AI_MODEL_GEMINI    (required: no default model is assumed)
 *   AI_PRICING          JSON {"model": {"input": usd_per_mtok, "output": usd_per_mtok}} (overrides defaults)
 *   AI_USER_PER_MINUTE, AI_GLOBAL_PER_MINUTE, AI_TIMEOUT_MS
 *   AI_DISABLED=1       turns every AI call into its deterministic fallback
 *
 * A provider without its key (and model, where required) is simply not configured: nothing paid is
 * activated implicitly. Anthropic is the only provider used by the existing production feature.
 */
import { AIClient, type ClientOptions } from "./client.ts";
import { AnthropicProvider, GeminiProvider, OpenAIProvider } from "./providers.ts";
import type { AIProvider, Pricing, ProviderId } from "./types.ts";

/** List prices (USD / 1M tokens) for models we default to; extend or override with AI_PRICING. */
export const DEFAULT_PRICING: Pricing = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export type ProviderStatus = { id: ProviderId; configured: boolean; model: string | null; reason?: string };

export function providerStatus(env: Record<string, string | undefined> = process.env): ProviderStatus[] {
  const order = (env.AI_PROVIDERS ?? "anthropic").split(",").map((s) => s.trim()).filter(Boolean) as ProviderId[];
  return order.map((id) => {
    if (env.AI_DISABLED === "1") return { id, configured: false, model: null, reason: "AI_DISABLED=1" };
    if (id === "anthropic") return env.ANTHROPIC_API_KEY ? { id, configured: true, model: env.AI_MODEL_ANTHROPIC || "claude-opus-5-5" } : { id, configured: false, model: null, reason: "ANTHROPIC_API_KEY not set" };
    if (id === "openai") return env.OPENAI_API_KEY && env.AI_MODEL_OPENAI ? { id, configured: true, model: env.AI_MODEL_OPENAI } : { id, configured: false, model: null, reason: "OPENAI_API_KEY and AI_MODEL_OPENAI required" };
    if (id === "gemini") return env.GEMINI_API_KEY && env.AI_MODEL_GEMINI ? { id, configured: true, model: env.AI_MODEL_GEMINI } : { id, configured: false, model: null, reason: "GEMINI_API_KEY and AI_MODEL_GEMINI required" };
    return { id, configured: false, model: null, reason: "unknown provider" };
  });
}

export function buildProviders(env: Record<string, string | undefined> = process.env): AIProvider[] {
  return providerStatus(env).filter((s) => s.configured).map((s) => {
    if (s.id === "anthropic") return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY!, model: s.model! });
    if (s.id === "openai") return new OpenAIProvider({ apiKey: env.OPENAI_API_KEY!, model: s.model! });
    return new GeminiProvider({ apiKey: env.GEMINI_API_KEY!, model: s.model! });
  });
}

export function pricingFrom(env: Record<string, string | undefined> = process.env): Pricing {
  let extra: Pricing = {};
  try {
    const p = JSON.parse(env.AI_PRICING ?? "{}");
    if (p && typeof p === "object") extra = p as Pricing;
  } catch {
    // invalid JSON: ignore overrides (costs of unknown models are reported as null)
  }
  return { ...DEFAULT_PRICING, ...extra };
}

const g = globalThis as unknown as { __aiClient?: AIClient };

/** Process-wide client (rate limits and cache are shared per server instance). */
export function aiClient(onUsage?: ClientOptions["onUsage"]): AIClient {
  if (!g.__aiClient) {
    const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
    g.__aiClient = new AIClient({
      providers: buildProviders(),
      pricing: pricingFrom(),
      timeoutMs: num(process.env.AI_TIMEOUT_MS, 45_000),
      userPerMinute: num(process.env.AI_USER_PER_MINUTE, 10),
      globalPerMinute: num(process.env.AI_GLOBAL_PER_MINUTE, 120),
      onUsage,
    });
  }
  return g.__aiClient;
}
