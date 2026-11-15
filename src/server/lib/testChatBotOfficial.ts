/** Admin Test Chat Bot only. One official HTTP attempt, no retry, no user-chat routing. */
import Anthropic from '@anthropic-ai/sdk';
import type { TestChatMessage } from '../../lib/testChatBot';
import { TEST_CHAT_MAX_OUTPUT_TOKENS } from '../../lib/testChatBot';
import { anthropicTotalInput } from './anthropicUsage';

/**
 * The official OpenAI-compatible hosts this admin page may call, and nothing else (admin 2026-11-15: every
 * provider NavBharatAI uses must be testable here). A HOST list, not an exact-URL list, because several
 * providers legitimately serve chat under more than one official path (Kimi's /v1 and /coding/v1, Z.ai's
 * paas/v4 and coding/paas/v4). The URL must still be https, carry no port or credentials, and end in
 * /chat/completions; a look-alike host (api.router.one.evil.example) is refused.
 */
export const OFFICIAL_CHAT_HOSTS: ReadonlySet<string> = new Set([
  'api.moonshot.ai', 'api.moonshot.cn', 'api.kimi.com',
  'api.x.ai',
  'openrouter.ai',
  'api.router.one',
  'api.z.ai',
  'integrate.api.nvidia.com',
  'api.surplusintelligence.ai',
]);
const BEDROCK_RUNTIME_HOST = /^bedrock-runtime\.[a-z]{2}(?:-gov)?-[a-z]+-\d\.amazonaws\.com$/;
export function isOfficialChatUrl(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  if (!OFFICIAL_CHAT_HOSTS.has(parsed.hostname) && !BEDROCK_RUNTIME_HOST.test(parsed.hostname)) return false;
  return parsed.pathname.endsWith('/chat/completions');
}
const OPENROUTER_FREE_GUARD = {
  provider: { allow_fallbacks: false, require_parameters: true, data_collection: 'deny', max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
};

export class OfficialTestChatError extends Error {
  constructor(
    readonly classificationHint: 'timeout' | 'network' | 'auth' | 'quota' | 'rate-limit' | 'http' | 'empty' | 'cancelled' | 'unknown',
    readonly httpStatus: number | null,
    readonly providerCode: string | null,
    readonly providerType: string | null,
    readonly providerRequestId: string | null,
    readonly providerMessage: string | null,
    readonly rawErrorBody: string | null,
  ) {
    super('Official provider test request failed.');
    this.name = 'OfficialTestChatError';
  }
}

function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function textField(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.slice(0, 4000) : null;
}

export async function runOfficialOpenAiCompatTest(input: {
  url: string;
  apiKey: string;
  model: string;
  messages: readonly TestChatMessage[];
  signal: AbortSignal;
  /**
   * OpenRouter is called with a zero-price, no-fallback guard unless the caller says the model is a PAID one
   * it has already reserved for (the Nemotron builder rung). Default false, so the verified-free path can
   * never lose its guard by omission.
   */
  allowPaid?: boolean;
  /** Provider-specific request fields from server code only (never from the client), e.g. Surplus routing. */
  extraBody?: Readonly<Record<string, unknown>>;
}): Promise<{ content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!isOfficialChatUrl(input.url)) throw new OfficialTestChatError('unknown', null, 'url-not-allowlisted', null, null, null, null);
  const openRouterFreeGuard = new URL(input.url).hostname === 'openrouter.ai' && input.allowPaid !== true;
  if (!input.apiKey || input.apiKey.length > 4096 || /[\s,]/.test(input.apiKey)) throw new OfficialTestChatError('auth', null, 'configuration', null, null, null, null);
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: 'POST', redirect: 'error', signal: input.signal,
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...(input.extraBody ?? {}),
        model: input.model, messages: input.messages, max_tokens: TEST_CHAT_MAX_OUTPUT_TOKENS, stream: false,
        ...(openRouterFreeGuard ? OPENROUTER_FREE_GUARD : {}),
      }),
    });
  } catch (error) {
    if (input.signal.aborted) throw new OfficialTestChatError('cancelled', null, 'aborted', null, null, null, null);
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
    throw new OfficialTestChatError(name.includes('Timeout') ? 'timeout' : 'network', null, name || 'network', null, null, null, null);
  }
  const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('cf-ray');
  let raw = '';
  try { raw = await response.text(); } catch { raw = ''; }
  if (raw.includes(input.apiKey)) raw = raw.split(input.apiKey).join('[redacted-secret]');
  if (!response.ok) {
    let code: string | null = null, type: string | null = null, message: string | null = null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const err = record(parsed) ? (record(parsed.error) ? parsed.error : parsed) : null;
      if (err) {
        code = textField(err.code);
        type = textField(err.type);
        message = textField(err.message);
      }
    } catch { /* Keep the raw body. */ }
    const classification = response.status === 401 || response.status === 403 ? 'auth'
      : response.status === 402 ? 'quota' : response.status === 429 ? 'rate-limit'
      : response.status === 408 || response.status === 504 ? 'timeout' : 'http';
    throw new OfficialTestChatError(classification, response.status, code, type, textField(requestId), message, raw.slice(0, 4000));
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new OfficialTestChatError('unknown', response.status, 'invalid-json', null, textField(requestId), null, raw.slice(0, 4000)); }
  if (!record(parsed) || !Array.isArray(parsed.choices)) {
    throw new OfficialTestChatError('unknown', response.status, 'invalid-response', null, textField(requestId), null, raw.slice(0, 4000));
  }
  const content = textField((record(parsed.choices[0]) && record(parsed.choices[0].message)) ? parsed.choices[0].message.content : null);
  if (!content?.trim()) throw new OfficialTestChatError('empty', response.status, 'empty', null, textField(requestId), null, raw.slice(0, 4000));
  const usage = record(parsed.usage) && Number.isSafeInteger(parsed.usage.prompt_tokens) && Number.isSafeInteger(parsed.usage.completion_tokens)
    ? { inputTokens: parsed.usage.prompt_tokens as number, outputTokens: parsed.usage.completion_tokens as number } : undefined;
  const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : input.model;
  return { content, model, ...(usage ? { usage } : {}) };
}

export async function runOfficialAnthropicTest(input: {
  apiKey: string;
  model: string;
  messages: readonly TestChatMessage[];
  signal: AbortSignal;
}): Promise<{ content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!input.apiKey || input.apiKey.length > 4096 || /[\s,]/.test(input.apiKey)) throw new OfficialTestChatError('auth', null, 'configuration', null, null, null, null);
  try {
    const client = new Anthropic({ apiKey: input.apiKey, maxRetries: 0 });
    const response = await client.messages.create({
      model: input.model,
      max_tokens: TEST_CHAT_MAX_OUTPUT_TOKENS,
      messages: input.messages.map(m => ({ role: m.role, content: m.content })),
    }, input.signal ? { signal: input.signal } : undefined);
    const text = Array.isArray(response.content)
      ? response.content.map(block => block.type === 'text' ? block.text : '').join('')
      : '';
    if (!text.trim()) {
      throw new OfficialTestChatError('empty', 200, 'empty', null, response.id ?? null, null, null);
    }
    const outputTokens = response.usage && Number.isSafeInteger(response.usage.output_tokens) ? response.usage.output_tokens : null;
    const usage = outputTokens !== null
      ? { inputTokens: anthropicTotalInput(response.usage), outputTokens } : undefined;
    return { content: text, model: response.model || input.model, ...(usage ? { usage } : {}) };
  } catch (error) {
    if (error instanceof OfficialTestChatError) throw error;
    if (input.signal.aborted) throw new OfficialTestChatError('cancelled', null, 'aborted', null, null, null, null);
    const src = record(error) ? error : {};
    const nested = record(src.error) ? src.error : {};
    const status = typeof src.status === 'number' ? src.status : null;
    const classification = status === 401 || status === 403 ? 'auth' : status === 402 ? 'quota' : status === 429 ? 'rate-limit'
      : status === 408 || status === 504 ? 'timeout' : src.name === 'APIConnectionTimeoutError' ? 'timeout' : status ? 'http' : 'unknown';
    throw new OfficialTestChatError(
      classification,
      status,
      textField(nested.type) ?? textField(src.type),
      textField(nested.type),
      textField(src.request_id) ?? textField(src.requestId),
      textField(nested.message) ?? textField(src.message),
      textField(JSON.stringify(nested)) ?? textField(src.message),
    );
  }
}

/**
 * Google Vertex AI (Gemini) through the server's own Google identity — the same shared client
 * (`vertexGenAI`) Engineer AI's Vertex fallback and the vision chain use. One call, no retry.
 * There is no API key: the project comes from GOOGLE_CLOUD_PROJECT and the region from GOOGLE_CLOUD_REGION.
 */
export async function runOfficialVertexTest(input: {
  client: { models: { generateContent: (request: Record<string, unknown>) => Promise<unknown> } } | null;
  model: string;
  messages: readonly TestChatMessage[];
  signal: AbortSignal;
}): Promise<{ content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!input.client) throw new OfficialTestChatError('auth', null, 'configuration', null, null, null, null);
  let response: unknown;
  try {
    response = await input.client.models.generateContent({
      model: input.model,
      contents: input.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      config: { maxOutputTokens: TEST_CHAT_MAX_OUTPUT_TOKENS, abortSignal: input.signal },
    });
  } catch (error) {
    if (input.signal.aborted) throw new OfficialTestChatError('cancelled', null, 'aborted', null, null, null, null);
    const src = record(error) ? error : {};
    const status = typeof src.status === 'number' ? src.status : typeof src.code === 'number' ? src.code : null;
    const classification = status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate-limit'
      : status === 408 || status === 504 ? 'timeout' : status ? 'http' : 'unknown';
    throw new OfficialTestChatError(classification, status, textField(src.name), null, null, textField(src.message), textField(src.message));
  }
  const body = record(response) ? response : {};
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) throw new OfficialTestChatError('empty', 200, 'empty', null, textField(body.responseId), null, null);
  const meta = record(body.usageMetadata) ? body.usageMetadata : {};
  const usage = Number.isSafeInteger(meta.promptTokenCount) && Number.isSafeInteger(meta.candidatesTokenCount)
    ? { inputTokens: meta.promptTokenCount as number, outputTokens: meta.candidatesTokenCount as number } : undefined;
  const model = typeof body.modelVersion === 'string' && body.modelVersion.trim() ? body.modelVersion : input.model;
  return { content: text.slice(0, 32_000), model, ...(usage ? { usage } : {}) };
}
