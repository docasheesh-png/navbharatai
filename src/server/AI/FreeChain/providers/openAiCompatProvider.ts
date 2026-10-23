import OpenAI from 'openai';
import { assertLegacyInferenceAllowed, StrictFreeCapabilityError } from '../../inferencePolicy';
import type { AIProvider, AIProviderResponse, ProviderUsage } from '../../Router/ProviderTypes';

export type AdapterConfig = {
  provider: 'GLM' | 'GEMINI' | 'GROQ' | 'CLOUDFLARE' | 'DEEPSEEK';
  model: string;
  key: string;
  baseURL: string;
  priority: number;
  maxOutputTokens: number;
  timeoutMs: number;
  streamUsage: boolean;
  /** The variable's name, never its value. Used only for safe operator diagnostics. */
  envName?: string;
  extraBody?: Readonly<Record<string, unknown>>;
};

export type FreeChainErrorCode =
  | 'AUTH' | 'RATE_LIMIT' | 'QUOTA_EXHAUSTED' | 'INVALID_REQUEST' | 'MODEL_UNAVAILABLE'
  | 'SERVER' | 'NETWORK' | 'TIMEOUT' | 'ABORTED' | 'SAFETY_REFUSAL' | 'EMPTY_RESPONSE'
  | 'CONFIGURATION' | 'POLICY_BLOCKED';
export type FreeChainFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call';

export interface FreeChainProviderResponse extends AIProviderResponse {
  /** Only true when BOTH token counts were actually reported, never inferred from the text. */
  completeUsage: boolean;
  cachedInputTokens?: number;
  rateLimitHeaders: Record<string, string>;
  finishReason?: FreeChainFinishReason;
}

export interface FreeChainTurnInput {
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  /** Presence selects a streaming request. Usage is still returned after its final chunk. */
  onChunk?: (text: string) => void;
}

type SafeErrorDetails = {
  status?: number;
  rateLimitHeaders?: Record<string, string>;
  retryAfterMs?: number;
  credentialEnv?: string;
};

/** Never retains the original SDK error, response, request, headers, cause or credential. */
export class FreeChainProviderError extends Error {
  readonly code: FreeChainErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly rateLimitHeaders: Record<string, string>;
  readonly credentialEnv?: string;
  readonly retryable: boolean;

  constructor(code: FreeChainErrorCode, details: SafeErrorDetails = {}) {
    const safeCode = ERROR_CODES.has(code) ? code : 'NETWORK';
    super(`Free chat provider request failed (${safeCode}).`);
    this.name = safeCode === 'ABORTED' ? 'AbortError' : 'FreeChainProviderError';
    this.code = safeCode;
    this.status = typeof details.status === 'number' && Number.isInteger(details.status) && details.status >= 400 && details.status <= 599 ? details.status : undefined;
    this.retryAfterMs = typeof details.retryAfterMs === 'number' && Number.isFinite(details.retryAfterMs) && details.retryAfterMs >= 0 ? Math.min(MAX_RETRY_AFTER_MS, Math.ceil(details.retryAfterMs)) : undefined;
    this.rateLimitHeaders = Object.freeze(safeRateLimitHeaders(details.rateLimitHeaders));
    this.credentialEnv = safeCode === 'AUTH' && typeof details.credentialEnv === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(details.credentialEnv) ? details.credentialEnv : undefined;
    this.retryable = ['RATE_LIMIT', 'SERVER', 'NETWORK', 'TIMEOUT', 'EMPTY_RESPONSE'].includes(safeCode);
    Object.freeze(this);
  }
}

const ERROR_CODES = new Set<FreeChainErrorCode>([
  'AUTH', 'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'INVALID_REQUEST', 'MODEL_UNAVAILABLE', 'SERVER',
  'NETWORK', 'TIMEOUT', 'ABORTED', 'SAFETY_REFUSAL', 'EMPTY_RESPONSE', 'CONFIGURATION', 'POLICY_BLOCKED',
]);
const SAFETY_FINISH_REASONS = new Set(['content_filter', 'safety', 'blocklist', 'prohibited_content', 'spii', 'recitation', 'sensitive']);
const ENDPOINTS: Record<AdapterConfig['provider'], RegExp> = {
  GLM: /^https:\/\/api\.z\.ai\/api\/paas\/v4\/?$/,
  GEMINI: /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai\/?$/,
  GROQ: /^https:\/\/api\.groq\.com\/openai\/v1\/?$/,
  CLOUDFLARE: /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[a-fA-F0-9]{32}\/ai\/v1\/?$/,
  DEEPSEEK: /^https:\/\/api\.deepseek\.com\/v1\/?$/,
};
const DEFAULT_ENV: Record<AdapterConfig['provider'], string> = {
  GLM: 'GLM_API_KEY', GEMINI: 'GEMINI_API_KEY', GROQ: 'GROQ_API_KEY',
  CLOUDFLARE: 'CLOUDFLARE_API_TOKEN', DEEPSEEK: 'DEEPSEEK_API_KEY',
};
const FINISH_REASONS = new Set<FreeChainFinishReason>(['stop', 'length', 'content_filter', 'tool_calls', 'function_call']);
const COUNTER_HEADERS = [
  'x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens',
  'x-ratelimit-limit-input-tokens', 'x-ratelimit-limit-output-tokens',
  'x-ratelimit-remaining-input-tokens', 'x-ratelimit-remaining-output-tokens',
] as const;
const RESET_HEADERS = ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens'] as const;
const HTTP_DATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const DURATION = /^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/;
const MAX_RETRY_AFTER_MS = 31 * 24 * 60 * 60 * 1000;

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}
function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function headerValue(raw: unknown, name: string): string | undefined {
  if (raw instanceof Headers) return raw.get(name)?.trim();
  const headers = record(raw);
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return typeof value === 'string' ? value.trim() : undefined;
}
function safeDate(value: string | undefined): string | undefined {
  if (!value || !HTTP_DATE.test(value) || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toUTCString();
}
/** Allowlist both header NAMES and VALUE GRAMMARS: a quota header is not a log escape hatch. */
function safeRateLimitHeaders(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of COUNTER_HEADERS) {
    const value = headerValue(raw, name);
    if (value && /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value))) result[name] = value;
  }
  for (const name of RESET_HEADERS) {
    const value = headerValue(raw, name);
    if (value && value.length <= 80 && (/^\d{1,16}(?:\.\d{1,6})?$/.test(value) || DURATION.test(value))) result[name] = value;
    else {
      const date = safeDate(value);
      if (date) result[name] = date;
    }
  }
  const retry = headerValue(raw, 'retry-after');
  if (retry && /^\d{1,12}(?:\.\d{1,6})?$/.test(retry)) result['retry-after'] = retry;
  else {
    const date = safeDate(retry);
    if (date) result['retry-after'] = date;
  }
  const date = safeDate(headerValue(raw, 'date'));
  if (date) result.date = date;
  return result;
}
function retryAfterMs(headers: Record<string, string>): number | undefined {
  const retry = headers['retry-after'];
  if (!retry) return undefined;
  const seconds = Number(retry);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - (headers.date ? Date.parse(headers.date) : Date.now());
  return Number.isFinite(ms) ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.ceil(ms))) : undefined;
}
function finishReason(value: unknown): FreeChainFinishReason | undefined {
  return typeof value === 'string' && FINISH_REASONS.has(value as FreeChainFinishReason) ? value as FreeChainFinishReason : undefined;
}
function safetyFinish(value: unknown): boolean {
  return typeof value === 'string' && SAFETY_FINISH_REASONS.has(value.toLowerCase());
}
function assertFinishAllowed(value: unknown, refusal: unknown): void {
  if (safetyFinish(value) || refusal) throw new FreeChainProviderError('SAFETY_REFUSAL');
  if (value === 'model_context_window_exceeded') throw new FreeChainProviderError('INVALID_REQUEST');
  if (value === 'network_error' || (value !== undefined && value !== null && !finishReason(value))) throw new FreeChainProviderError('NETWORK');
}
function reportedUsage(raw: unknown): Pick<FreeChainProviderResponse, 'usage' | 'completeUsage' | 'cachedInputTokens'> {
  const usage = record(raw);
  const inputTokens = tokenCount(usage?.prompt_tokens);
  const outputTokens = tokenCount(usage?.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return { completeUsage: false };
  const cached = tokenCount(usage?.prompt_cache_hit_tokens) ?? tokenCount(record(usage?.prompt_tokens_details)?.cached_tokens) ?? tokenCount(usage?.cached_tokens);
  return {
    usage: { inputTokens, outputTokens }, completeUsage: true,
    ...(cached !== undefined && cached <= inputTokens ? { cachedInputTokens: cached } : {}),
  };
}

function sanitizeError(error: unknown, signal: AbortSignal | undefined, credentialEnv: string, provider: AdapterConfig['provider']): FreeChainProviderError {
  if (signal?.aborted) return new FreeChainProviderError('ABORTED');
  if (error instanceof FreeChainProviderError) return error;
  if (error instanceof StrictFreeCapabilityError) return new FreeChainProviderError('POLICY_BLOCKED', { status: 503 });
  const source = record(error);
  const rawStatus = source?.status;
  const status = typeof rawStatus === 'number' && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : undefined;
  const headers = safeRateLimitHeaders(source?.headers);
  const nested = record(source?.error);
  // Match exact KNOWN enums only. Never parse or repeat provider messages, bodies or auth material.
  const rawCode = [source?.code, source?.type, nested?.code, nested?.type, nested?.status]
    .flatMap((value) => typeof value === 'string' ? [value.toLowerCase()] : typeof value === 'number' && Number.isSafeInteger(value) ? [String(value)] : []);
  const has = (...codes: string[]) => rawCode.some((value) => codes.includes(value));
  const glmCode = (...codes: string[]) => provider === 'GLM' && has(...codes);
  let code: FreeChainErrorCode;
  if (source?.name === 'AbortError' || source?.name === 'APIUserAbortError') code = 'ABORTED';
  else if (has('content_filter', 'content_policy_violation', 'safety', 'safety_refusal', 'prohibited_content') || glmCode('1301') || source?.name === 'ContentFilterFinishReasonError') code = 'SAFETY_REFUSAL';
  else if (has('insufficient_quota', 'quota_exceeded', 'quota_exhausted', 'billing_hard_limit_reached') || glmCode('1113', '1308', '1310', '1313') || (provider === 'DEEPSEEK' && status === 402)) code = 'QUOTA_EXHAUSTED';
  else if (glmCode('1305')) code = 'SERVER';
  else if (status === 401 || status === 403 || has('invalid_api_key', 'authentication_error', 'permission_denied')) code = 'AUTH';
  else if (status === 429 || has('rate_limit_exceeded', 'resource_exhausted') || glmCode('1302')) code = 'RATE_LIMIT';
  else if (status === 404 || has('model_not_found', 'model_not_available')) code = 'MODEL_UNAVAILABLE';
  else if (source?.name === 'APIConnectionTimeoutError' || source?.name === 'TimeoutError' || status === 408 || status === 504) code = 'TIMEOUT';
  else if (status !== undefined && status >= 500) code = 'SERVER';
  else if (status !== undefined) code = 'INVALID_REQUEST';
  else code = 'NETWORK';
  return new FreeChainProviderError(code, {
    status, rateLimitHeaders: headers, retryAfterMs: retryAfterMs(headers),
    ...(code === 'AUTH' ? { credentialEnv } : {}),
  });
}

/** Only text-generation tuning is accepted. Extra body fields cannot change spend or credentials. */
function validatedExtraBody(extra: AdapterConfig['extraBody']): Record<string, unknown> {
  if (extra === undefined) return {};
  const input = record(extra);
  if (!input) throw new FreeChainProviderError('CONFIGURATION');
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    if (['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'].includes(name)
      && typeof value === 'number' && Number.isFinite(value)
      && (name === 'temperature' ? value >= 0 && value <= 2 : name === 'top_p' ? value >= 0 && value <= 1 : value >= -2 && value <= 2)) {
      result[name] = value;
    } else if (name === 'seed' && typeof value === 'number' && Number.isSafeInteger(value)) {
      result.seed = value;
    } else if (name === 'reasoning_effort' && value === 'none') {
      result.reasoning_effort = value;
    } else if (name === 'thinking' && record(value)?.type === 'disabled' && Object.keys(record(value)!).length === 1) {
      result.thinking = { type: 'disabled' };
    } else {
      throw new FreeChainProviderError('CONFIGURATION');
    }
  }
  return result;
}

/**
 * A single pinned text rung. Being compatible with an API does NOT prove the account is free.
 * The orchestrator owns free-account admission, quota reservations, cooldowns and its watchdog.
 * This layer makes one dispatch, disables SDK retries and forwards its caller's abort signal.
 */
export class OpenAiCompatProvider implements AIProvider {
  readonly name: AdapterConfig['provider'];
  readonly priority: number;
  readonly pinnedModel: string;
  readonly #config: Omit<AdapterConfig, 'key' | 'extraBody'> & { extraBody: Readonly<Record<string, unknown>>; envName: string };
  readonly #key: string;
  #client?: OpenAI;

  constructor(config: AdapterConfig) {
    if (!config || !Object.prototype.hasOwnProperty.call(ENDPOINTS, config.provider)
      || typeof config.baseURL !== 'string' || !ENDPOINTS[config.provider].test(config.baseURL)
      || typeof config.key !== 'string' || config.key.length === 0 || config.key.length > 4096 || /[\s,]/.test(config.key)
      || typeof config.model !== 'string' || !/^[a-zA-Z0-9@][a-zA-Z0-9_./:@-]{0,255}$/.test(config.model)
      || !Number.isSafeInteger(config.priority) || config.priority < 0
      || !Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens <= 0 || config.maxOutputTokens > 131072
      || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > 600000
      || typeof config.streamUsage !== 'boolean'
      || (config.envName !== undefined && !/^[A-Z][A-Z0-9_]{0,79}$/.test(config.envName))) {
      throw new FreeChainProviderError('CONFIGURATION');
    }
    const extraBody = validatedExtraBody(config.extraBody);
    this.name = config.provider;
    this.priority = config.priority;
    this.pinnedModel = config.model;
    this.#key = config.key;
    // Deliberately enumerate: retaining/spreading the input object would retain the secret key.
    this.#config = Object.freeze({
      provider: config.provider, model: config.model, baseURL: config.baseURL.replace(/\/$/, ''),
      priority: config.priority, maxOutputTokens: config.maxOutputTokens, timeoutMs: config.timeoutMs,
      streamUsage: config.streamUsage, envName: config.envName ?? DEFAULT_ENV[config.provider],
      extraBody: Object.freeze(extraBody),
    });
    Object.freeze(this);
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, priority: this.priority, pinnedModel: this.pinnedModel };
  }

  async healthCheck(): Promise<boolean> { return true; }

  #getClient(): OpenAI {
    return this.#client ??= new OpenAI({
      apiKey: this.#key, baseURL: this.#config.baseURL, timeout: this.#config.timeoutMs,
      organization: null, project: null, adminAPIKey: null, webhookSecret: null,
      maxRetries: 0, logLevel: 'off', fetchOptions: { redirect: 'error' },
      // The SDK inherits OPENAI_CUSTOM_HEADERS even for non-OpenAI base URLs. Never forward
      // another account's auth, org/project identifiers, cookies or custom headers to this rung.
      fetch: async (url, init) => {
        if (String(url) !== `${this.#config.baseURL}/chat/completions` || init?.method !== 'POST') {
          throw new FreeChainProviderError('CONFIGURATION');
        }
        return globalThis.fetch(url, {
          ...init, redirect: 'error',
          headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        });
      },
    });
  }

  async execute(prompt: string, schema?: unknown, modelOverride?: string, systemPrompt?: string, images?: string[], signal?: AbortSignal): Promise<FreeChainProviderResponse> {
    if (schema !== undefined || images?.length || (modelOverride !== undefined && modelOverride !== this.pinnedModel)) {
      throw new FreeChainProviderError('INVALID_REQUEST');
    }
    return this.executeTurn({ prompt, systemPrompt, signal });
  }

  async executeStream(prompt: string, systemPrompt: string | undefined, onChunk: (text: string) => void, model?: string, signal?: AbortSignal): Promise<string> {
    if (model !== undefined && model !== this.pinnedModel) throw new FreeChainProviderError('INVALID_REQUEST');
    return (await this.executeTurn({ prompt, systemPrompt, onChunk, signal })).content;
  }

  async executeTurn({ prompt, systemPrompt, signal, onChunk }: FreeChainTurnInput): Promise<FreeChainProviderResponse> {
    const started = Date.now();
    try {
      if (signal?.aborted) throw new FreeChainProviderError('ABORTED');
      if (typeof prompt !== 'string' || !prompt.trim() || (systemPrompt !== undefined && typeof systemPrompt !== 'string')
        || (onChunk !== undefined && typeof onChunk !== 'function')) throw new FreeChainProviderError('INVALID_REQUEST');
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });
      const body = {
        ...this.#config.extraBody,
        ...(['DEEPSEEK', 'GLM'].includes(this.name) ? { thinking: { type: 'disabled' } } : {}),
        model: this.#config.model, messages,
        ...(this.name === 'GROQ' ? { max_completion_tokens: this.#config.maxOutputTokens } : { max_tokens: this.#config.maxOutputTokens }),
      };
      const options = { signal, maxRetries: 0, timeout: this.#config.timeoutMs };
      let content = '';
      let usage: ProviderUsage | undefined;
      let cachedInputTokens: number | undefined;
      let completeUsage = false;
      let reason: FreeChainFinishReason | undefined;
      let headers: Record<string, string>;
      const rememberUsage = (raw: unknown) => {
        if (raw === undefined || raw === null) return false;
        const next = reportedUsage(raw);
        usage = next.usage; completeUsage = next.completeUsage; cachedInputTokens = next.cachedInputTokens;
        return next.completeUsage;
      };
      const extensionError = (raw: unknown) => {
        const error = sanitizeError(raw, signal, this.#config.envName, this.name);
        return error.code === 'NETWORK' ? new FreeChainProviderError('SERVER') : error;
      };
      if (onChunk) {
        assertLegacyInferenceAllowed('direct-text-provider');
        const { data: stream, response } = await this.#getClient().chat.completions.create({
          ...body, stream: true,
          ...(this.#config.streamUsage ? { stream_options: { include_usage: true } } : {}),
        }, options).withResponse();
        headers = safeRateLimitHeaders(response.headers);
        let finished = false;
        let textCommitted = false;
        try {
          for await (const chunk of stream) {
            if (signal?.aborted) throw new FreeChainProviderError('ABORTED');
            const extension = record(record(chunk)?.x_groq);
            if (extension?.error) throw extensionError(extension.error);
            const measured = rememberUsage(chunk.usage);
            const extensionMeasured = rememberUsage(extension?.usage);
            const choice = chunk.choices?.[0];
            reason = finishReason(choice?.finish_reason) ?? reason;
            assertFinishAllowed(choice?.finish_reason, choice?.delta?.refusal);
            const text = choice?.delta?.content;
            if (typeof text === 'string' && text) {
              // Earlier usage is stale if more text arrives without updated totals. Never release
              // a reservation on an intermediate count from a partially measured stream.
              if (!measured && !extensionMeasured) { usage = undefined; completeUsage = false; cachedInputTokens = undefined; }
              content += text;
              // Whitespace is not an answer or a first token: do not lock the orchestrator into an
              // empty rung. Preserve the prefix exactly once when actual text arrives.
              if (textCommitted || text.trim()) { onChunk(textCommitted ? text : content); textCommitted = true; }
            }
            if (signal?.aborted) throw new FreeChainProviderError('ABORTED');
          }
          // Clean transport EOF is not proof of a completed answer. Without a terminal reason,
          // earlier usage may only be an interim sample; never cache it or settle its reservation.
          if (content.trim() && !reason) throw new FreeChainProviderError('NETWORK');
          finished = true;
        } finally {
          // The SDK normally aborts on early iterator return. Explicitly close it for callback errors too.
          if (!finished) stream.controller.abort();
        }
      } else {
        assertLegacyInferenceAllowed('direct-text-provider');
        const { data: completion, response } = await this.#getClient().chat.completions.create({ ...body, stream: false }, options).withResponse();
        headers = safeRateLimitHeaders(response.headers);
        const extension = record(record(completion)?.x_groq);
        if (extension?.error) throw extensionError(extension.error);
        rememberUsage(completion.usage);
        rememberUsage(extension?.usage);
        const choice = completion.choices?.[0];
        reason = finishReason(choice?.finish_reason);
        assertFinishAllowed(choice?.finish_reason, choice?.message?.refusal);
        content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
      }
      if (signal?.aborted) throw new FreeChainProviderError('ABORTED');
      if (!content.trim()) throw new FreeChainProviderError('EMPTY_RESPONSE');
      return {
        content, latencyMs: Date.now() - started, provider: this.name, model: this.pinnedModel,
        usage, completeUsage, cachedInputTokens, rateLimitHeaders: headers, finishReason: reason,
      };
    } catch (error) {
      throw sanitizeError(error, signal, this.#config.envName, this.name);
    }
  }
}
