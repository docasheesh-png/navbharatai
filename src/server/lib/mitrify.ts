import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

/** Server-only transport. No upstream provider catalogue, pricing or capability assumptions. */
type Env = Record<string, string | undefined>;
type Log = (metadata: Record<string, unknown>) => void;
const defaultLog: Log = metadata => console.info('[MITRIFY]', JSON.stringify(metadata));
const headerNames = ['X-Mitrify-Request-Id', 'X-Mitrify-Provider', 'X-Mitrify-Model', 'X-Mitrify-Attempts', 'X-Mitrify-Trail'] as const;
const standardFields = new Set(['model', 'messages', 'stream', 'stream_options', 'temperature', 'max_tokens', 'max_completion_tokens', 'top_p', 'n', 'stop', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'seed']);

// AI_BACKEND is canonical. Its explicit value always wins, including rollback to
// direct. AI_PROVIDER is a compatibility alias only when AI_BACKEND is unset/blank.
function backend(env: Env): string { return env.AI_BACKEND?.trim() || env.AI_PROVIDER?.trim() || 'direct'; }

/** Stop waiting on non-cooperative dependencies without retaining a capacity permit. */
async function untilCancelled<T>(work: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new MitrifyError('MITRIFY_CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export function mitrifyConfig(env: Env = process.env) {
  const maxInflight = env.MITRIFY_MAX_INFLIGHT?.trim() ? Number(env.MITRIFY_MAX_INFLIGHT) : 200;
  if (!Number.isInteger(maxInflight) || maxInflight < 1 || maxInflight > 1000) throw new MitrifyError('MITRIFY_CONFIGURATION');
  return {
    enabled: backend(env) === 'mitrify', maxInflight,
    baseURL: env.MITRIFY_BASE_URL?.trim() || 'https://mitrify.com/v1',
    apiKey: env.MITRIFY_API_KEY?.trim() || '',
    model: env.MITRIFY_MODEL?.trim() || 'mitrify/auto-cheap',
  };
}

/**
 * General chat is health/clinical, including when profile/history are empty.
 * Third-party free-model providers and Surplus sellers receive the whole prompt:
 * never route health records, personal identifiers, payments or sensitive data here.
 * No browser flag or keyword test can authorize disclosure to public-only models.
 * Keep the existing callback intact until a reviewed server-owned boundary exists.
 */
export function withMitrifyChatPrivacyBoundary<T>(direct: () => Promise<T>, env: Env = process.env, log: Log = defaultLog): Promise<T> {
  if (env.AI_BACKEND?.trim() && env.AI_PROVIDER?.trim() && env.AI_BACKEND.trim() !== env.AI_PROVIDER.trim()) log({ code: 'MITRIFY_LEGACY_SWITCH_IGNORED' });
  if (backend(env) === 'mitrify') log({ code: 'MITRIFY_PRIVACY_BLOCKED', selected: 'direct', dataClass: 'health' });
  return direct();
}

// One FIFO for every client in this process: never one pool per key/model/client.
// Limits retained serialized request bytes, not total heap or Cloud Run fleet concurrency.
const activeCalls = new Set<{ limit: number }>();
const pendingCalls: QueueEntry[] = [];
let retainedBytes = 0;
type QueueEntry = { limit: number; bytes: number; signal: AbortSignal; settled: boolean;
  resolve: (release: () => void) => void; reject: (error: Error) => void; cleanup: () => void };
function dropQueued(entry: QueueEntry, error: Error) {
  if (entry.settled) return;
  entry.settled = true; entry.cleanup();
  pendingCalls.splice(pendingCalls.indexOf(entry), 1); retainedBytes -= entry.bytes;
  entry.reject(error);
}
function drainQueue() {
  while (pendingCalls.length) {
    const entry = pendingCalls[0];
    if (entry.signal.aborted) { dropQueued(entry, new MitrifyError('MITRIFY_CANCELLED')); continue; }
    let limit = entry.limit;
    for (const active of activeCalls) limit = Math.min(limit, active.limit);
    if (activeCalls.size >= limit) return;
    pendingCalls.shift(); entry.settled = true; entry.cleanup();
    const active = { limit: entry.limit }; activeCalls.add(active);
    entry.resolve(() => {
      if (!activeCalls.delete(active)) return;
      retainedBytes -= entry.bytes; drainQueue();
    });
  }
}
function acquireCapacity(limit: number, bytes: number, signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw new MitrifyError('MITRIFY_CANCELLED');
  // Throw before yielding, so a rejected burst does not retain serialized bodies
  // in thousands of suspended async frames waiting for a rejected promise.
  if (pendingCalls.length >= 1000 || retainedBytes + bytes > 64 * 1024 * 1024) throw new MitrifyError('MITRIFY_QUEUE_FULL', 503);
  retainedBytes += bytes;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => { dropQueued(entry, new MitrifyError('MITRIFY_CANCELLED')); drainQueue(); };
    const entry: QueueEntry = { limit, bytes, signal, settled: false, resolve, reject,
      cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); } };
    pendingCalls.push(entry);
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { dropQueued(entry, new MitrifyError('MITRIFY_QUEUE_TIMEOUT', 503)); drainQueue(); }, 30_000);
    drainQueue();
  });
}

/**
 * Server-owned admission only, never supplied by a request or an environment flag.
 * An implementation must verify a gateway-enforced total INR cap, including all
 * retries/upstream failover, and atomically consume this test once across instances.
 * The UID is a local admission key only; it must never be transmitted to Mitrify.
 * A local ledger/token estimate is not a gateway charge ceiling. No live adapter
 * exists yet; production must remain unavailable until that proof is implemented.
 */
export interface MitrifyPublicTestAdmission {
  readonly maxTotalInr: number;
  runOnce<T>(claim: { uid: string; testId: 'public-arithmetic-v1'; maxTotalInr: number; includesAllAttempts: true;
    gateway: { baseURL: string; model: string; credentialFingerprint: string }; signal: AbortSignal }, execute: () => Promise<T>): Promise<T>;
}

/** Separate synthetic test, never a rewrite or downgrade of an ordinary chat request. */
export async function runMitrifyPublicTest(options: {
  body: unknown;
  identify: () => Promise<{ uid: string; email: string | null; emailVerified: boolean } | null>;
  signal: AbortSignal;
  admission?: MitrifyPublicTestAdmission;
}, env: Env = process.env, log: Log = defaultLog) {
  const target = env.MITRIFY_CHAT_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (backend(env) !== 'mitrify' || !target) throw new MitrifyError('MITRIFY_TEST_DISABLED', 503);
  // Accept no caller-controlled content, history, profile, messages or parameters.
  if (!options.body || typeof options.body !== 'object' || Array.isArray(options.body)
    || Object.keys(options.body).length) throw new MitrifyError('MITRIFY_TEST_EMPTY_BODY_REQUIRED', 400);
  options.signal.throwIfAborted();
  const identity = await untilCancelled(options.identify, options.signal);
  options.signal.throwIfAborted();
  if (!identity?.uid || !identity.emailVerified || identity.email?.trim().toLowerCase() !== target) {
    throw new MitrifyError('MITRIFY_TEST_FORBIDDEN', 403);
  }
  const admission = options.admission;
  const maxTotalInr = admission?.maxTotalInr;
  if (!admission || typeof maxTotalInr !== 'number' || !Number.isFinite(maxTotalInr) || maxTotalInr < 0) {
    throw new MitrifyError('MITRIFY_TEST_BUDGET_UNVERIFIED', 503);
  }
  const config = mitrifyConfig(env);
  if (!config.apiKey) throw new MitrifyError('MITRIFY_CONFIGURATION', 401);
  // Bind admission to the exact credential/endpoint/model snapshot used for dispatch.
  // Never log the credential or fingerprint. No env read after admission may replace it.
  const requestEnv = { MITRIFY_BASE_URL: config.baseURL, MITRIFY_MODEL: config.model, MITRIFY_API_KEY: config.apiKey, MITRIFY_MAX_INFLIGHT: String(config.maxInflight) };
  let dispatched = false;
  return untilCancelled(() => admission.runOnce({ uid: identity.uid, testId: 'public-arithmetic-v1', maxTotalInr,
    includesAllAttempts: true, gateway: { baseURL: config.baseURL, model: config.model,
      credentialFingerprint: createHash('sha256').update(config.apiKey).digest('hex') }, signal: options.signal }, async () => {
    options.signal.throwIfAborted();
    if (dispatched) throw new MitrifyError('MITRIFY_TEST_ALREADY_USED', 409);
    dispatched = true;
    const result = await createMitrifyClient(requestEnv, log).chat({
      messages: [{ role: 'user', content: 'What is 2 + 2? Reply with only the number.' }],
      max_tokens: 16, temperature: 0, stream: false,
    }, { signal: options.signal });
    return result;
  }), options.signal);
}

export class MitrifyError extends Error {
  readonly status: number;
  readonly code: string;
  readonly partial: boolean;
  constructor(code: string, status = 0, partial = false) {
    const messages: Record<string, string> = {
      MITRIFY_TEST_DISABLED: 'The public test is disabled.',
      MITRIFY_TEST_FORBIDDEN: 'This test requires the configured verified account.',
      MITRIFY_TEST_EMPTY_BODY_REQUIRED: 'The public test accepts only an empty JSON object, without chat content.',
      MITRIFY_TEST_BUDGET_UNVERIFIED: 'The public test is unavailable until a single-use total spending cap is verified.',
      MITRIFY_TEST_ALREADY_USED: 'The single-use public test authorization has already been consumed.',
      MITRIFY_QUEUE_FULL: 'Mitrify capacity is full; no new request was dispatched.',
      MITRIFY_QUEUE_TIMEOUT: 'The request timed out waiting for Mitrify capacity; it was not dispatched.',
    };
    super(messages[code] || (code === 'MITRIFY_CONFIGURATION' ? 'Mitrify configuration error: check server credentials and URL.'
      : partial ? 'The AI reply was interrupted and is incomplete.' : 'Mitrify request failed; see status and error code in server metadata.'));
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
      let release: (() => void) | undefined;
      try {
        release = await acquireCapacity(config.maxInflight, 0, signal);
        const response = await request('models', undefined, signal);
        if (!response.headers.get('content-type')?.includes('application/json')) {
          await response.body?.cancel(); throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        }
        const data = await response.json();
        signal.throwIfAborted();
        if (!data || !Array.isArray(data.data)) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        return { status: response.status, headers: safeHeaders(response, config.apiKey) };
      } catch (error) { throw error instanceof MitrifyError ? error : new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_INVALID_RESPONSE'); }
      finally { release?.(); }
    },
    /** Low-level transport only: production general-chat ingress cannot authorize this call. */
    async chat(input: Record<string, unknown>, options: { signal: AbortSignal; onChunk?: (chunk: Uint8Array) => void | Promise<void> }) {
      let partial = false;
      let release: (() => void) | undefined;
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
        const bytes = Buffer.byteLength(body);
        if (bytes > 8 * 1024 * 1024) throw new MitrifyError('MITRIFY_BODY_TOO_LARGE', 413);
        release = await acquireCapacity(config.maxInflight, bytes, signal);
        const response = await request('chat/completions', body, signal);
        const headers = safeHeaders(response, config.apiKey);
        if (input.stream !== true) {
          if (!response.headers.get('content-type')?.includes('application/json')) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
          const data = await response.json();
          signal.throwIfAborted();
          if (JSON.stringify(data).includes(config.apiKey) || data?.error || !Array.isArray(data?.choices) || !data.choices.some((c: any) => typeof c?.message?.content === 'string' && c.message.content.trim())) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
          return { status: response.status, headers, data };
        }
        if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = ''; let done = false;
        let sequence = 0;
        let retainedEventBytes = 0;
        const withheld: { sequence: number; wire: string; bytes: number }[] = [];
        const prefixes = new Map<string, { text: string; since: number }>();
        // Track every forwarded string, including extension fields and field names.
        // Keep only a possible credential prefix, never accumulated answer content.
        const inspectStrings = (value: unknown, path: string[]): void => {
          if (typeof value === 'string') {
            const channel = JSON.stringify(path); const previous = prefixes.get(channel);
            const text = (previous?.text ?? '') + value;
            if (text.includes(config.apiKey)) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
            let length = Math.min(text.length, config.apiKey.length - 1);
            while (length && !text.endsWith(config.apiKey.slice(0, length))) length--;
            if (length) prefixes.set(channel, { text: text.slice(-length), since: length > value.length ? previous!.since : sequence });
            else prefixes.delete(channel);
          } else if (Array.isArray(value)) {
            value.forEach((item, index) => inspectStrings(item, [...path,
              path.at(-1) === 'field:choices' ? `choice:${item?.index ?? index}` : 'array']));
          } else if (value && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) {
              inspectStrings(key, [...path, 'keys']); inspectStrings(item, [...path, `field:${key}`]);
            }
          }
          if (prefixes.size > 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
        };
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
              if (event.includes(config.apiKey)) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
              // SSE comments/control fields are not answer data and must not expose
              // arbitrary upstream strings to the client.
              const dataLines = event.split('\n').filter(line => line.startsWith('data:'));
              const payload = dataLines.map(line => line.slice(5).trimStart()).join('\n');
              if (payload && payload !== '[DONE]') {
                const data = JSON.parse(payload);
                if (JSON.stringify(data).includes(config.apiKey) || data.error) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
                inspectStrings(data, []);
              }
              if (payload === '[DONE]') { done = true; prefixes.clear(); }
              if (dataLines.length) {
                const wire = `${dataLines.join('\n')}\n\n`; const bytes = Buffer.byteLength(wire);
                withheld.push({ sequence, wire, bytes }); retainedEventBytes += bytes;
              }
              if (retainedEventBytes > 1024 * 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
              let firstUncertain = Infinity;
              for (const prefix of prefixes.values()) firstUncertain = Math.min(firstUncertain, prefix.since);
              // A repeated metadata prefix can delay one event, never the whole answer.
              // Release earlier events as soon as every possible match has moved on.
              while (withheld.length && withheld[0].sequence < firstUncertain) {
                const safeEvent = withheld.shift()!; retainedEventBytes -= safeEvent.bytes;
                partial = true; // The consumer may write before throwing or stalling.
                await untilCancelled(() => options.onChunk!(new TextEncoder().encode(safeEvent.wire)), signal);
                signal.throwIfAborted();
              }
              sequence++;
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
        const safe = error instanceof MitrifyError ? new MitrifyError(error.code, error.status, partial || error.partial) : new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_INVALID_RESPONSE', 0, partial);
        log({ code: safe.code, status: safe.status, partial: safe.partial });
        throw safe;
      } finally { controller.abort(); release?.(); log({ code: 'MITRIFY_FINISHED', latencyMs: Date.now() - started, partial }); }
    },
  };
}
