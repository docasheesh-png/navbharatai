/**
 * Tokens a provider REPORTED for one call. Absent when the provider did not report any.
 *
 * It is deliberately optional and never estimated. Every AI outside the v5 builder — the 70+
 * professionals, Doctor AI, and the Other-AI tools — ran through this response shape, which carried
 * no usage at all, so what those features cost NavBharatAI was simply not observable: the wallet only
 * ever moved for builds. A guessed token count would have been worse than none, because it would have
 * looked like a measurement. When a provider gives us nothing, callers must say "not measured" rather
 * than price a made-up number (see chatSpend.ts).
 */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIProviderResponse {
  content: string;
  latencyMs: number;
  provider: 'VERTEX' | 'GEMINI' | 'ANTHROPIC' | 'GROK' | 'PRO' | 'GLM';
  model: string;
  /** What this call really cost in tokens, as reported by the provider. Absent = unreported. */
  usage?: ProviderUsage;
}

/**
 * Read a usage pair off a provider payload, accepting the field names the different APIs use
 * (OpenAI-compatible `prompt_tokens`/`completion_tokens`, Anthropic `input_tokens`/`output_tokens`,
 * Google `promptTokenCount`/`candidatesTokenCount`). Returns undefined unless at least one side is a
 * real non-negative number, so a provider that reports nothing stays honestly unmeasured.
 */
export function readProviderUsage(raw: unknown): ProviderUsage | undefined {
  const u = raw as Record<string, unknown> | null | undefined;
  if (!u || typeof u !== 'object') return undefined;
  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = Number(u[k]);
      if (Number.isFinite(v) && v >= 0) return Math.round(v);
    }
    return undefined;
  };
  const inputTokens = num('prompt_tokens', 'input_tokens', 'promptTokenCount', 'inputTokens');
  const outputTokens = num('completion_tokens', 'output_tokens', 'candidatesTokenCount', 'outputTokens');
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
}

export interface ProviderTelemetry {
  provider: string;
  retries: number;
  latency: number;
  fallbackReason?: string;
  success: boolean;
}

export interface AIProvider {
  name: 'VERTEX' | 'GEMINI' | 'ANTHROPIC' | 'GROK' | 'PRO' | 'GLM';
  priority: number;
  /**
   * When true, this provider is a LAST-RESORT fallback: in a raced router
   * (see AIRouter.routeRaced) it is tried sequentially ONLY after every
   * non-last-resort provider has failed. Used by the PROFESSIONAL universe so
   * Claude is reached only if the Grok/Gemini/Vertex race fails.
   */
  lastResort?: boolean;
  execute(prompt: string, schema?: any, modelOverride?: string, systemPrompt?: string, images?: string[]): Promise<AIProviderResponse>;
  healthCheck(): Promise<boolean>;
  executeStream?(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void): Promise<string>;
}
