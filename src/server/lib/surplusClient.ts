import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export const SURPLUS_BASE_URL = 'https://api.surplusintelligence.ai/v1';
export const SURPLUS_MIN30_BASE_URL = 'https://api.surplusintelligence.ai/min30/v1';
export const SURPLUS_MIN90_BASE_URL = 'https://api.surplusintelligence.ai/min90/v1';
export const SURPLUS_DEFAULT_MODEL = 'deepseek-v4.1-flash';
export const SURPLUS_TIMEOUT_MS = 60_000;

type ErrorCode = 'configuration' | 'invalid_request' | 'authentication' | 'rate_limit' | 'timeout' | 'connection' | 'provider' | 'empty_response';
const messages: Record<ErrorCode, string> = {
  invalid_request: 'Use 1–8192 output tokens and a nonempty request of at most 128 messages and 64 KiB.',
  configuration: 'Set SURPLUS_API_KEY and use a supported HTTPS SURPLUS_BASE_URL.',
  authentication: 'Surplus authentication failed. Check the server API key and account permissions.',
  rate_limit: 'Surplus rate limit reached. Try again later.',
  timeout: 'Surplus request timed out. No automatic retry was made.',
  connection: 'Unable to connect to Surplus. No automatic retry was made.',
  provider: 'Surplus could not complete the request. Check account access and model availability.',
  empty_response: 'Surplus returned no usable text response.',
};

/** Safe to log: never retains raw provider errors, request bodies, headers, or credentials. */
export class SurplusError extends Error {
  constructor(readonly code: ErrorCode, readonly usage?: SurplusUsage) {
    super(messages[code]);
    this.name = 'SurplusError';
  }
}

export interface SurplusUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Provider-reported micro-USD, not an invoice or a permission to charge a wallet. */
  buyer_cost_micro?: number | string;
}
export interface SurplusChatResult { text: string; usage?: SurplusUsage }

function safeUsage(value: unknown): SurplusUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const usage: SurplusUsage = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
    const count = raw[key];
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) usage[key] = count;
  }
  const cost = raw.buyer_cost_micro;
  if ((typeof cost === 'string' && /^\d+(?:\.\d+)?$/.test(cost)) ||
      (typeof cost === 'number' && Number.isSafeInteger(cost) && cost >= 0)) {
    usage.buyer_cost_micro = cost;
  }
  return Object.keys(usage).length ? usage : undefined;
}

export interface SurplusChatOptions {
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Server-only, lazy factory. Importing this module does not read secrets or make requests. */
export function createSurplusChat(
  env: NodeJS.ProcessEnv = process.env,
  transport: typeof fetch = globalThis.fetch,
  limits: { maxOutputTokens: number; providerDefaults?: boolean } = { maxOutputTokens: 8192 },
) {
  if (!Number.isSafeInteger(limits.maxOutputTokens) || limits.maxOutputTokens < 1) throw new SurplusError('configuration');
  if (typeof window !== 'undefined') throw new SurplusError('configuration');
  const apiKey = env.SURPLUS_API_KEY?.trim();
  const baseURL = (env.SURPLUS_BASE_URL?.trim() || SURPLUS_BASE_URL).replace(/\/$/, '');
  // Exact allowlist rejects Markdown links, credentials, query strings and lookalike hosts.
  if (!apiKey || apiKey === 'replace_with_your_surplus_api_key' ||
      ![SURPLUS_BASE_URL, SURPLUS_MIN30_BASE_URL, SURPLUS_MIN90_BASE_URL].includes(baseURL)) {
    throw new SurplusError('configuration');
  }
  const defaultModel = env.SURPLUS_MODEL?.trim() || SURPLUS_DEFAULT_MODEL;
  const client = new OpenAI({
    apiKey,
    baseURL,
    organization: null,
    project: null,
    ...(limits.providerDefaults ? {} : { timeout: SURPLUS_TIMEOUT_MS }),
    maxRetries: 0, // Avoid hidden extra inference charges, including after an uncertain timeout.
    logLevel: 'off', // Override OPENAI_LOG; never emit requests or raw error bodies.
    fetch: (input, init) => {
      // SDKs can inherit OPENAI_CUSTOM_HEADERS. Never forward unrelated credentials,
      // organization/project identifiers, or an environment-overridden Authorization.
      if (String(input) !== `${baseURL}/chat/completions`) throw new SurplusError('configuration');
      return transport(input, { ...init, redirect: 'error', headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      } });
    },
  });

  return async function chat(
    input: string | ChatCompletionMessageParam[],
    options: SurplusChatOptions = {},
  ): Promise<SurplusChatResult> {
    const maxTokens = options.maxTokens ?? 2048;
    const requestMessages = typeof input === 'string' ? [{ role: 'user' as const, content: input }] : input;
    let requestBytes: number;
    try { requestBytes = Buffer.byteLength(JSON.stringify(requestMessages), 'utf8'); }
    catch { throw new SurplusError('invalid_request'); }
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || (!limits.providerDefaults && maxTokens > limits.maxOutputTokens) ||
        !Array.isArray(requestMessages) || requestMessages.length < 1 || requestMessages.length > 128 ||
        (typeof input === 'string' && !input.trim()) ||
        (!limits.providerDefaults && requestBytes > 65_536)) {
      throw new SurplusError('invalid_request');
    }
    try {
      const response = await client.chat.completions.create({
        model: options.model?.trim() || defaultModel,
        messages: requestMessages,
        ...(limits.providerDefaults && options.maxTokens === undefined ? {} : { max_tokens: maxTokens }),
        stream: false,
      }, { signal: options.signal });
      // Surplus can report long-running failures inside HTTP 200 bodies. HTTP success is
      // NOT inference success. Never retry these, or infer that a failed turn was unbilled.
      const usage = safeUsage(response?.usage);
      if (!response || 'error' in response) throw new SurplusError('provider', usage);
      const content = response.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new SurplusError('empty_response', usage);
      return { text: content, usage };
    } catch (error) {
      if (error instanceof SurplusError) throw error;
      if (error instanceof OpenAI.APIConnectionTimeoutError) throw new SurplusError('timeout');
      if (error instanceof OpenAI.APIConnectionError) throw new SurplusError('connection');
      if (error instanceof OpenAI.APIError) {
        if (error.status === 401 || error.status === 403) throw new SurplusError('authentication');
        if (error.status === 429) throw new SurplusError('rate_limit');
      }
      throw new SurplusError('provider');
    }
  };
}

/** Convenient one-off helper; reuse createSurplusChat() for multiple server calls. */
export async function surplusChat(input: string | ChatCompletionMessageParam[], options?: SurplusChatOptions) {
  return createSurplusChat()(input, options);
}

/** Text-only convenience; use surplusChat() when provider usage metadata is needed. */
export async function chatSurplus(input: string | ChatCompletionMessageParam[], options?: SurplusChatOptions): Promise<string> {
  return (await surplusChat(input, options)).text;
}
