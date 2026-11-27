import type { JsonSchema } from "../core/schema.ts";

export type ProviderId = "anthropic" | "openai" | "gemini" | "mock";

export type ProviderRequest = {
  system: string;
  user: string;
  /** Schema for the provider's structured-output mode (constraints stripped; see core/schema.wireSchema). */
  schema: JsonSchema;
  schemaName: string;
  maxTokens: number;
  signal: AbortSignal;
};

export type ProviderResponse = {
  text: string;
  /** Model that actually served the request (may differ after a server-side fallback). */
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface AIProvider {
  readonly id: ProviderId;
  readonly model: string;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}

/** Provider failure. `retryable` errors (429, 5xx, timeouts, network) are retried with backoff. */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(message: string, retryable: boolean, status: number | null = null) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

/** USD per million tokens. */
export type Pricing = Record<string, { input: number; output: number }>;

export type UsageRecord = {
  at: string;
  userId: number | null;
  provider: ProviderId | "cache" | "fallback";
  model: string | null;
  promptId: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number;
  outcome: "ok" | "cache" | "invalid-output" | "error" | "rate-limited" | "fallback" | "disabled";
  error?: string;
};
