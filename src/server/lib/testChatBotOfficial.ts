/** Admin Test Chat Bot only. One official HTTP attempt, no retry, no user-chat routing. */
import Anthropic from '@anthropic-ai/sdk';
import type { TestChatMessage } from '../../lib/testChatBot';
import { TEST_CHAT_MAX_OUTPUT_TOKENS } from '../../lib/testChatBot';
import { anthropicTotalInput } from './anthropicUsage';
import { isResellerGatewayHost } from './resellerGateways';

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
  // Reseller gateways (resellerGateways.ts): only each one's own registered domain or a subdomain of it.
  if (!OFFICIAL_CHAT_HOSTS.has(parsed.hostname) && !BEDROCK_RUNTIME_HOST.test(parsed.hostname) && !isResellerGatewayHost(parsed.hostname)) return false;
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
  /**
   * Ask for an SSE stream, the way the builder calls the provider. Router One holds a non-streamed reply
   * until the whole answer is ready, which ran past this page's 90-second bound (admin report 2026-11-15:
   * HTTP 200, 90003 ms, empty body). A stream is also parsed when a provider ignores `stream: false`.
   */
  stream?: boolean;
  /**
   * Output-token bound for this one call (default: the page's 1,024). A reasoning model spends tokens thinking
   * before it answers; at 1,024 Router One's deepseek-v4.1-flash returned only its reasoning and an empty
   * answer (admin report 2026-11-15). The caller reserves for whatever bound it passes.
   */
  maxTokens?: number;
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
        model: input.model, messages: input.messages, max_tokens: outputBound(input.maxTokens),
        ...(input.stream === true ? { stream: true, stream_options: { include_usage: true } } : { stream: false }),
        ...(openRouterFreeGuard ? OPENROUTER_FREE_GUARD : {}),
      }),
    });
  } catch (error) {
    if (input.signal.aborted) throw new OfficialTestChatError('cancelled', null, 'aborted', null, null, null, null);
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
    throw new OfficialTestChatError(name.includes('Timeout') ? 'timeout' : 'network', null, name || 'network', null, null, null, null);
  }
  const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('cf-ray');
  const isSse = /text\/event-stream/i.test(response.headers.get('content-type') ?? '');
  if (response.ok && isSse) return readSseReply(response, input, textField(requestId));
  let raw = '';
  try { raw = await response.text(); }
  catch {
    // The status line and headers arrived, the body did not. Say so — this used to surface as
    // "invalid-json" with an empty body, which named the wrong problem.
    throw bodyNotFinished(response.status, textField(requestId), input.signal, 0);
  }
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
  const choice = record(parsed.choices[0]) ? parsed.choices[0] : null;
  const message = choice && record(choice.message) ? choice.message : null;
  // Not textField(): that caps at 4,000 characters, which silently cut every longer answer short.
  const content = message && typeof message.content === 'string' ? message.content.slice(0, 32_000) : '';
  if (!content.trim()) {
    const reasoning = message ? reasoningText(message) : '';
    throw emptyReply(response.status, textField(requestId), reasoning.length, choice ? textField(choice.finish_reason) : null,
      outputBound(input.maxTokens), raw.slice(0, 4000));
  }
  const usage = record(parsed.usage) && Number.isSafeInteger(parsed.usage.prompt_tokens) && Number.isSafeInteger(parsed.usage.completion_tokens)
    ? { inputTokens: parsed.usage.prompt_tokens as number, outputTokens: parsed.usage.completion_tokens as number } : undefined;
  const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : input.model;
  return { content, model, ...(usage ? { usage } : {}) };
}

function outputBound(requested: number | undefined): number {
  return Number.isSafeInteger(requested) && requested! > 0 ? Math.min(requested!, 16_384) : TEST_CHAT_MAX_OUTPUT_TOKENS;
}
/** The thinking a reasoning model returns beside its answer (field names differ between providers). */
function reasoningText(message: Record<string, unknown>): string {
  for (const key of ['reasoning_content', 'reasoning']) if (typeof message[key] === 'string') return message[key] as string;
  return '';
}
/** An empty answer, said precisely: a reasoning-only reply names the token limit that ran out. */
function emptyReply(status: number, requestId: string | null, reasoningChars: number, finishReason: string | null, maxTokens: number, raw: string | null): OfficialTestChatError {
  if (reasoningChars > 0) {
    const cut = finishReason === 'length' ? ` It stopped at the ${maxTokens}-token limit while still thinking.` : '';
    return new OfficialTestChatError('empty', status, 'reasoning-only', null, requestId,
      `The model returned only its reasoning (${reasoningChars} characters) and no answer.${cut}${finishReason ? ` Finish reason: ${finishReason}.` : ''}`, raw);
  }
  return new OfficialTestChatError('empty', status, 'empty', null, requestId, finishReason ? `Finish reason: ${finishReason}.` : null, raw);
}

function bodyNotFinished(status: number, requestId: string | null, signal: AbortSignal, receivedChars: number): OfficialTestChatError {
  const received = receivedChars > 0 ? ` ${receivedChars} characters of the reply had arrived.` : ' No reply text had arrived.';
  return signal.aborted
    ? new OfficialTestChatError('timeout', status, 'body-timeout', null, requestId,
      `The provider answered HTTP ${status} but the reply did not finish within this page's time limit.${received}`, null)
    : new OfficialTestChatError('network', status, 'body-read-failed', null, requestId,
      `The provider answered HTTP ${status} but the connection closed before the reply finished.${received}`, null);
}

/** Read an OpenAI-compatible SSE chat stream into one reply. Bounded by the response size limit; no retry. */
async function readSseReply(response: Response, input: { apiKey: string; model: string; signal: AbortSignal; maxTokens?: number }, requestId: string | null)
  : Promise<{ content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const reader = response.body?.getReader();
  if (!reader) throw bodyNotFinished(response.status, requestId, input.signal, 0);
  const decoder = new TextDecoder();
  let buffer = '', content = '', model = '', done = false, streamError: string | null = null, reasoningChars = 0, finishReason: string | null = null;
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  const handle = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') { done = true; return; }
    let event: unknown;
    try { event = JSON.parse(data); } catch { return; }
    if (!record(event)) return;
    if (record(event.error)) { streamError = textField(event.error.message) ?? textField(event.error.code) ?? 'stream error'; return; }
    if (typeof event.model === 'string' && event.model.trim()) model = event.model;
    const choice = Array.isArray(event.choices) && record(event.choices[0]) ? event.choices[0] : null;
    const delta = choice && record(choice.delta) ? choice.delta : choice && record(choice.message) ? choice.message : null;
    if (delta && typeof delta.content === 'string') content += delta.content;
    if (delta) reasoningChars += reasoningText(delta).length;
    if (choice && typeof choice.finish_reason === 'string' && choice.finish_reason) finishReason = choice.finish_reason;
    if (record(event.usage) && Number.isSafeInteger(event.usage.prompt_tokens) && Number.isSafeInteger(event.usage.completion_tokens)) {
      usage = { inputTokens: event.usage.prompt_tokens as number, outputTokens: event.usage.completion_tokens as number };
    }
  };
  try {
    while (!done) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      if (buffer.length + content.length > 1_000_000) throw new OfficialTestChatError('unknown', response.status, 'response-too-large', null, requestId, null, null);
      let newline = buffer.indexOf('\n');
      while (newline !== -1) { handle(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); newline = buffer.indexOf('\n'); }
    }
    if (buffer) handle(buffer);
  } catch (error) {
    if (error instanceof OfficialTestChatError) throw error;
    throw bodyNotFinished(response.status, requestId, input.signal, content.length);
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (streamError) {
    const message = String(streamError).split(input.apiKey).join('[redacted-secret]');
    throw new OfficialTestChatError('http', response.status, 'stream-error', null, requestId, message, null);
  }
  if (!content.trim()) throw emptyReply(response.status, requestId, reasoningChars, finishReason, outputBound(input.maxTokens), null);
  return { content: content.slice(0, 32_000), model: model || input.model, ...(usage ? { usage } : {}) };
}

function isGatewayAnthropicBase(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.search && !url.hash && isResellerGatewayHost(url.hostname);
}

export async function runOfficialAnthropicTest(input: {
  apiKey: string;
  model: string;
  messages: readonly TestChatMessage[];
  signal: AbortSignal;
  /**
   * A reseller gateway's Anthropic-format endpoint (resellerGateways.ts). Omitted ⇒ Anthropic itself. Accepted only
   * over https on a registered gateway domain, so the key cannot be sent anywhere else.
   */
  baseURL?: string;
}): Promise<{ content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!input.apiKey || input.apiKey.length > 4096 || /[\s,]/.test(input.apiKey)) throw new OfficialTestChatError('auth', null, 'configuration', null, null, null, null);
  try {
    if (input.baseURL !== undefined && !isGatewayAnthropicBase(input.baseURL)) throw new OfficialTestChatError('unknown', null, 'url-not-allowlisted', null, null, null, null);
    const client = new Anthropic({ apiKey: input.apiKey, maxRetries: 0, ...(input.baseURL ? { baseURL: input.baseURL } : {}) });
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

/**
 * Admin report 2026-11-16: BluesMinds timed out at 60 s from Cloud Run, while the same host answered a phone
 * browser at once ("Invalid token"). A bare "Request timed out" cannot tell "our server cannot reach the host" from
 * "the host took the request and never answered". So when a test call fails on network or timeout, this one
 * unauthenticated GET to the provider's own /models (no key, no body, no redirects, 8 s) says which. The URL comes
 * from server configuration only. It reports the HTTP status and timing — never a body.
 */
export async function probeChatHostReachability(baseURL: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let url: URL;
  try { url = new URL(`${baseURL.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`); } catch { return 'Reachability check skipped (no valid endpoint).'; }
  if (url.protocol !== 'https:') return 'Reachability check skipped (not https).';
  const started = Date.now();
  try {
    const response = await fetchImpl(url.toString(), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8_000), headers: { Accept: 'application/json' } });
    try { await response.body?.cancel(); } catch { /* status is enough */ }
    return `Reachability check: ${url.host} answered GET /models with HTTP ${response.status} in ${Date.now() - started} ms, so this server can reach the host; the chat request itself got no answer in time (the provider held it).`;
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
    const cause = error && typeof error === 'object' && 'cause' in error ? (error as { cause?: { code?: unknown } }).cause : undefined;
    const code = cause && typeof cause.code === 'string' ? cause.code : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return `Reachability check: ${url.host} did not answer GET /models within 8 s, so this server cannot reach the host (network, DNS or a firewall between this server and the provider), not a slow model.`;
    }
    return `Reachability check: GET /models to ${url.host} failed before any answer (${code || name || 'network error'}), so this server cannot reach the host.`;
  }
}

/**
 * Admin report 2026-11-16: BluesMinds answered "No available channel for model z-ai/glm4.7 under group default"
 * (model_not_found, HTTP 503). The admin cannot see which models the server's key may use, so when a test call fails
 * with a model-not-found answer this reads the provider's own GET /models WITH that key and lists the model ids.
 * The key goes only to the provider's configured https endpoint (no redirects, 8 s); only ids are returned.
 */
export function isModelNotFound(code: string | null | undefined, text: string | null | undefined): boolean {
  return /model[_ ]?not[_ ]?found|no available channel for model|model .*(does not exist|not (found|available|supported))|unknown model|invalid model/i
    .test(`${code ?? ''} ${text ?? ''}`);
}
/** The model ids a provider's own GET /models lists for this key (https, no redirects, 8 s; ids only, sanitized). */
export async function fetchProviderModelIds(baseURL: string, apiKey: string, fetchImpl: typeof fetch = fetch)
  : Promise<{ ok: true; host: string; ids: string[] } | { ok: false; host: string; reason: string }> {
  let url: URL;
  try { url = new URL(`${baseURL.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`); } catch { return { ok: false, host: '', reason: 'no valid endpoint' }; }
  if (url.protocol !== 'https:' || !apiKey || /[\s,]/.test(apiKey)) return { ok: false, host: url.host, reason: 'not https or no key' };
  try {
    const response = await fetchImpl(url.toString(), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) return { ok: false, host: url.host, reason: `HTTP ${response.status}` };
    const raw = await response.text();
    if (raw.length > 2_000_000) return { ok: false, host: url.host, reason: 'answer too large' };
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : record(parsed) && Array.isArray(parsed.data) ? parsed.data : [];
    const ids = [...new Set(rows.map(row => record(row) ? row.id : null).filter((id): id is string => typeof id === 'string' && /^[\w.:/@+-]{1,120}$/.test(id)))];
    return { ok: true, host: url.host, ids };
  } catch {
    return { ok: false, host: url.host, reason: 'could not be read' };
  }
}
export async function listProviderModels(baseURL: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const listed = await fetchProviderModelIds(baseURL, apiKey, fetchImpl);
  if (!listed.host) return '';
  if (!listed.ok) return listed.reason === 'not https or no key' ? '' : `Model list: GET /models on ${listed.host} ${listed.reason.startsWith('HTTP') ? `answered with ${listed.reason}` : listed.reason}.`;
  if (!listed.ids.length) return `Model list: ${listed.host} listed no models for this key.`;
  const shown = listed.ids.slice(0, 40);
  return `Models this key can use on ${listed.host} (${listed.ids.length}): ${shown.join(', ')}${listed.ids.length > shown.length ? ', …' : ''}. Type one of these in "Model (optional)".`;
}
