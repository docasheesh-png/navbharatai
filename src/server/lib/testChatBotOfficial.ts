/** Admin Test Chat Bot only. One official HTTP attempt, no retry, no user-chat routing. */
import Anthropic from '@anthropic-ai/sdk';
import type { TestChatMessage } from '../../lib/testChatBot';
import { TEST_CHAT_MAX_OUTPUT_TOKENS } from '../../lib/testChatBot';
import { anthropicTotalInput } from './anthropicUsage';

const OPENAI_URLS = new Set([
  'https://api.moonshot.ai/v1/chat/completions',
  'https://api.moonshot.cn/v1/chat/completions',
  'https://api.x.ai/v1/chat/completions',
]);

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
}): Promise<{ content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!OPENAI_URLS.has(input.url)) throw new OfficialTestChatError('unknown', null, 'url-not-allowlisted', null, null, null, null);
  if (!input.apiKey || input.apiKey.length > 4096 || /[\s,]/.test(input.apiKey)) throw new OfficialTestChatError('auth', null, 'configuration', null, null, null, null);
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: 'POST', redirect: 'error', signal: input.signal,
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: input.model, messages: input.messages, max_tokens: TEST_CHAT_MAX_OUTPUT_TOKENS, stream: false }),
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
