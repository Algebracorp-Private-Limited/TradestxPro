/**
 * Concrete AI providers. Credentials are read on the server from environment variables only and
 * are never sent to the browser. Nothing is activated unless configured (see `config.ts`).
 *
 * - Anthropic: official SDK, structured outputs (`output_config.format: json_schema`), server-side
 *   refusal fallback (`fallbacks: "default"`), SDK retries disabled (the AIClient retries).
 * - OpenAI / Gemini: their REST APIs (no SDK dependency). Implemented against the providers'
 *   documented request shapes; not exercised against live endpoints in CI (no keys there).
 */
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type AIProvider, type ProviderRequest, type ProviderResponse } from "./types.ts";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const retryableStatus = (s: number) => s === 408 || s === 409 || s === 429 || s >= 500;

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;
  constructor(opts: { apiKey: string; model: string; client?: Anthropic }) {
    this.model = opts.model;
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 });
  }
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    try {
      const r = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: { format: { type: "json_schema", schema: req.schema as Record<string, unknown> }, effort: "medium" },
          // Server-side refusal fallback: routed by refusal category; tells us the serving model via response.model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: req.signal, timeout: 60_000 },
      );
      if (r.stop_reason === "refusal") throw new ProviderError("the model declined this request", false);
      if (r.stop_reason === "max_tokens") throw new ProviderError("response truncated (max_tokens)", true);
      const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { text, model: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens };
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof Anthropic.APIError) throw new ProviderError(`Anthropic ${e.status ?? ""}: ${e.message}`.trim(), e.status === undefined || retryableStatus(e.status), e.status ?? null);
      throw new ProviderError(e instanceof Error ? e.message : String(e), true);
    }
  }
}

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private apiKey: string;
  private fetch: FetchLike;
  constructor(opts: { apiKey: string; model: string; fetch?: FetchLike }) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.fetch = opts.fetch ?? (fetch as unknown as FetchLike);
  }
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const res = await this.fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
        response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: false } },
        max_completion_tokens: req.maxTokens,
      }),
      signal: req.signal,
    }).catch((e) => {
      throw new ProviderError(`OpenAI network error: ${(e as Error).message}`, true);
    });
    if (!res.ok) throw new ProviderError(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`, retryableStatus(res.status), res.status);
    const d = (await res.json()) as { model?: string; choices?: { message?: { content?: string; refusal?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const m = d.choices?.[0]?.message;
    if (m?.refusal) throw new ProviderError("the model declined this request", false);
    return { text: m?.content ?? "", model: d.model ?? this.model, inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0 };
  }
}

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly model: string;
  private apiKey: string;
  private fetch: FetchLike;
  constructor(opts: { apiKey: string; model: string; fetch?: FetchLike }) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.fetch = opts.fetch ?? (fetch as unknown as FetchLike);
  }
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const res = await this.fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${req.system}\n\nJSON schema of the required response:\n${JSON.stringify(req.schema)}` }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: req.maxTokens },
      }),
      signal: req.signal,
    }).catch((e) => {
      throw new ProviderError(`Gemini network error: ${(e as Error).message}`, true);
    });
    if (!res.ok) throw new ProviderError(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`, retryableStatus(res.status), res.status);
    const d = (await res.json()) as { modelVersion?: string; candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    const c = d.candidates?.[0];
    if (c?.finishReason === "SAFETY") throw new ProviderError("the model declined this request", false);
    return { text: (c?.content?.parts ?? []).map((p) => p.text ?? "").join(""), model: d.modelVersion ?? this.model, inputTokens: d.usageMetadata?.promptTokenCount ?? 0, outputTokens: d.usageMetadata?.candidatesTokenCount ?? 0 };
  }
}

/** Scripted provider for tests: returns queued responses or throws queued errors. */
export class MockProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly model: string;
  readonly calls: ProviderRequest[] = [];
  private script: (ProviderResponse | Error | ((req: ProviderRequest) => Promise<ProviderResponse>))[];
  constructor(script: MockProvider["script"], model = "mock-1") {
    this.script = script;
    this.model = model;
  }
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(req);
    const next = this.script.shift();
    if (!next) throw new ProviderError("mock: no scripted response", false);
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(req);
    return next;
  }
}
