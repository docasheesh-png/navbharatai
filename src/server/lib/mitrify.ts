import { setTimeout as delay } from 'node:timers/promises';

/** Server-only transport. No upstream provider catalogue, pricing or capability assumptions. */
type Env = Record<string, string | undefined>;
type Log = (metadata: Record<string, unknown>) => void;
const defaultLog: Log = metadata => console.info('[MITRIFY]', JSON.stringify(metadata));
const headerNames = ['X-Mitrify-Request-Id', 'X-Mitrify-Provider', 'X-Mitrify-Model', 'X-Mitrify-Trail'] as const;
const standardFields = new Set(['model', 'messages', 'stream', 'stream_options', 'temperature', 'max_tokens', 'max_completion_tokens', 'top_p', 'n', 'stop', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'seed']);

export function mitrifyConfig(env: Env = process.env) {
  return {
    enabled: env.AI_PROVIDER === 'mitrify',
    baseURL: env.MITRIFY_BASE_URL?.trim() || 'https://mitrify.com/v1',
    apiKey: env.MITRIFY_API_KEY?.trim() || '',
    model: env.MITRIFY_MODEL?.trim() || 'mitrify/auto-cheap',
  };
}

/**
 * General chat is health/clinical, including when profile/history are empty.
 * No browser flag or keyword test can authorize disclosure to public-only models.
 * Keep the existing callback intact until a reviewed server-owned boundary exists.
 */
export function withMitrifyChatPrivacyBoundary<T>(direct: () => Promise<T>, env: Env = process.env, log: Log = defaultLog): Promise<T> {
  if (env.AI_PROVIDER === 'mitrify') log({ code: 'MITRIFY_PRIVACY_BLOCKED', selected: 'direct', dataClass: 'health' });
  return direct();
}

export class MitrifyError extends Error {
  readonly status: number;
  readonly code: string;
  readonly partial: boolean;
  constructor(code: string, status = 0, partial = false) {
    super(code === 'MITRIFY_CONFIGURATION' ? 'Mitrify configuration error: check server credentials and URL.'
      : partial ? 'The AI reply was interrupted and is incomplete.' : 'Mitrify request failed; see status and error code in server metadata.');
    this.name = 'MitrifyError'; this.code = code; this.status = status; this.partial = partial;
  }
}

function safeHeaders(response: Response, key: string): Record<string, string | null> {
  return Object.fromEntries(headerNames.map(name => {
    const value = response.headers.get(name);
    return [name, value === null ? null : value.split(key).join('[REDACTED]').replace(/[\r\n]/g, ' ').slice(0, 2048)];
  }));
}

/** Raw gateway error messages can echo credentials or prompts. Never log/return them. */
function statusCode(status: number): string {
  return status === 401 ? 'MITRIFY_CONFIGURATION' : status === 400 ? 'MITRIFY_BAD_REQUEST' : `MITRIFY_HTTP_${status}`;
}

export function createMitrifyClient(env: Env = process.env, log: Log = defaultLog) {
  const config = mitrifyConfig(env);
  function endpoint(path: string): string {
    let url: URL;
    try { url = new URL(config.baseURL); } catch { throw new MitrifyError('MITRIFY_CONFIGURATION'); }
    // Loopback HTTP is exclusively for offline mock tests. Never follow redirects with a key.
    if (!config.apiKey || url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new MitrifyError('MITRIFY_CONFIGURATION');
    }
    return `${url.href.replace(/\/$/, '')}/${path}`;
  }

  async function request(path: string, body: string | undefined, signal: AbortSignal): Promise<Response> {
    const url = endpoint(path);
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const started = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
          headers: { Authorization: `Bearer ${config.apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body,
        });
      } catch {
        throw new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_NETWORK');
      }
      log({ ...safeHeaders(response, config.apiKey), status: response.status, latencyMs: Date.now() - started, attempt });
      if (response.ok) return response;
      const retryAfter = response.headers.get('retry-after');
      await response.body?.cancel();
      if (![429, 503].includes(response.status) || attempt >= 3) {
        const code = statusCode(response.status);
        log({ code, status: response.status });
        throw new MitrifyError(code, response.status);
      }
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const serverDelay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
        : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
      let waitMs = Math.max(1000 * 2 ** attempt + Math.random() * 250, Number.isFinite(serverDelay) ? serverDelay : 0);
      log({ code: 'MITRIFY_RETRY', status: response.status, delayMs: waitMs });
      // Avoid setTimeout's 32-bit overflow for a distant Retry-After date.
      while (waitMs > 0) {
        const part = Math.min(waitMs, 2_147_483_647);
        await delay(part, undefined, { signal });
        waitMs -= part;
      }
    }
  }

  return {
    /** Manual diagnostics only. Never used to construct a UI model list. */
    async models(signal: AbortSignal): Promise<{ status: number; headers: Record<string, string | null> }> {
      try {
        const response = await request('models', undefined, signal);
        if (!response.headers.get('content-type')?.includes('application/json')) {
          await response.body?.cancel(); throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        }
        const data = await response.json();
        signal.throwIfAborted();
        if (!data || !Array.isArray(data.data)) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        return { status: response.status, headers: safeHeaders(response, config.apiKey) };
      } catch (error) { throw error instanceof MitrifyError ? error : new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_INVALID_RESPONSE'); }
    },
    /** Low-level transport only: production general-chat ingress cannot authorize this call. */
    async chat(input: Record<string, unknown>, options: { signal: AbortSignal; onChunk?: (chunk: Uint8Array) => void | Promise<void> }) {
      let partial = false;
      const controller = new AbortController();
      const signal = AbortSignal.any([options.signal, controller.signal]);
      const started = Date.now();
      try {
        if (Object.keys(input).some(key => !standardFields.has(key)) || !Array.isArray(input.messages) || !input.messages.length
          || input.messages.some(m => !m || typeof m !== 'object' || !['system', 'developer', 'user', 'assistant'].includes(m.role)
            || typeof m.content !== 'string' || Object.keys(m).some(k => !['role', 'content'].includes(k)))
          || (input.stream !== undefined && typeof input.stream !== 'boolean')
          || (input.stream === true && !options.onChunk)) throw new MitrifyError('MITRIFY_UNSUPPORTED_REQUEST');
        const streamOptions = input.stream_options;
        if (streamOptions !== undefined && (!streamOptions || typeof streamOptions !== 'object' || Array.isArray(streamOptions))) throw new MitrifyError('MITRIFY_UNSUPPORTED_REQUEST');
        const body = JSON.stringify({ ...input, model: config.model,
          ...(input.stream === true ? { stream_options: { ...streamOptions as object, include_usage: true } } : {}),
        });
        if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new MitrifyError('MITRIFY_BODY_TOO_LARGE', 413);
        const response = await request('chat/completions', body, signal);
        const headers = safeHeaders(response, config.apiKey);
        if (input.stream !== true) {
          if (!response.headers.get('content-type')?.includes('application/json')) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
          const data = await response.json();
          signal.throwIfAborted();
          if (data?.error || !Array.isArray(data?.choices) || !data.choices.some((c: any) => typeof c?.message?.content === 'string' && c.message.content.trim())) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
          return { status: response.status, headers, data };
        }
        if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = ''; let done = false;
        try {
          for (;;) {
            signal.throwIfAborted();
            const item = await reader.read();
            signal.throwIfAborted();
            if (item.done) break;
            // Inspect one bounded SSE event at a time; forward valid events immediately.
            pending += decoder.decode(item.value, { stream: true });
            pending = pending.replace(/\r\n/g, '\n');
            let boundary: number;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
              signal.throwIfAborted();
              const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
              if (event.length > 1024 * 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
              const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (payload && payload !== '[DONE]') {
                const data = JSON.parse(payload);
                if (data.error) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
              }
              if (payload === '[DONE]') done = true;
              // Mark before invoking the consumer: it may write and then throw.
              partial = true;
              await options.onChunk!(new TextEncoder().encode(`${event}\n\n`));
              signal.throwIfAborted();
              if (done) break;
            }
            if (done) break;
            if (pending.length > 1024 * 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
          }
          if (!done) throw new MitrifyError('MITRIFY_INCOMPLETE_STREAM', response.status, partial);
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        signal.throwIfAborted();
        return { status: response.status, headers, data: undefined };
      } catch (error) {
        const safe = error instanceof MitrifyError ? error : new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_INVALID_RESPONSE', 0, partial);
        log({ code: safe.code, status: safe.status, partial: safe.partial });
        throw safe;
      } finally { controller.abort(); log({ code: 'MITRIFY_FINISHED', latencyMs: Date.now() - started, partial }); }
    },
  };
}
