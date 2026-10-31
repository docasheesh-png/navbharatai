import { assertCanaryLegacyAllowed } from '../../AgentV3/reliability/canarySpendGuard';
import { PublicBuildEngineError } from '../../lib/buildEngineError';
import { parseEnvFlag } from '../../lib/envFlag';
import { BuildStoppedError } from '../../AgentV3/stopSignal';
import { Agent } from 'undici';

const URL = 'https://api.surplusintelligence.ai/min90/v1/chat/completions';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
/** Hard ceiling (all attempts combined) so hung Surplus HTTP cannot pin the Pro builder forever. */
// Owner 2026-10-31 (stay-alive): long game-file turns legitimately exceed 60s; do not cut a working reply.
export const SURPLUS_TRANSPORT_TIMEOUT_MS = (() => { const n = Number(process.env.SURPLUS_TRANSPORT_TIMEOUT_MS); return Number.isFinite(n) && n >= 30_000 && n <= 600_000 ? Math.floor(n) : 180_000; })();
/** First try + bounded retries for transient marketplace / network failures. */
export const SURPLUS_TRANSPORT_MAX_ATTEMPTS = 5;
export const SURPLUS_TRANSPORT_RETRY_BASE_MS = 250;
export const SURPLUS_TRANSPORT_RETRY_MAX_MS = 5_000;

/**
 * Owner 2026-10-31 ("Surplus disconnect kam se kam"): one sticky, process-wide keep-alive pool to
 * Surplus. Reuses warm TLS sockets (no fresh handshake per turn), enables TCP keepalive probes so
 * idle NAT/LB paths are not silently dropped mid-game, and gives long game-file turns a generous
 * body/headers window (overall deadline above still bounds it). Lazily created; never on import.
 */
let surplusPool: Agent | undefined;
export function surplusKeepAliveDispatcher(): Agent | undefined {
  try {
    surplusPool ??= new Agent({
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 300_000,
      connections: 32,
      pipelining: 1,
      headersTimeout: SURPLUS_TRANSPORT_TIMEOUT_MS,
      bodyTimeout: SURPLUS_TRANSPORT_TIMEOUT_MS,
      connect: { keepAlive: true, keepAliveInitialDelay: 15_000, timeout: 15_000 },
    });
    return surplusPool;
  } catch { return undefined; }
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const REQUEST_KEYS = new Set(['model', 'provider', 'si_route', 'messages', 'tools', 'tool_choice', 'max_tokens', 'stream', 'reasoning_effort']);
const RESPONSE_HEADERS = ['x-si-provider-family', 'x-si-served-by', 'x-si-truncated', 'x-si-adapted-params', 'x-si-route-objective'] as const;
/** Marketplace error codes that are worth one more HTTP attempt (never auth / billing). */
const TRANSIENT_ERROR_CODES = new Set([
  'rate_limit', 'rate_limit_exceeded', 'timeout', 'overloaded', 'provider_error',
  'no_healthy_sellers', 'no_sellers_for_model', 'model_unavailable', 'temporarily_unavailable',
  'service_unavailable', 'upstream_error', 'server_error',
]);

export interface SurplusBuildTransportResponse {
  body: unknown;
  headers: Record<string, string>;
  status: number;
  receivedAt: number;
  /** Some upstream metadata was omitted from the bounded allow-list. Never infer no-attempt from its absence. */
  metadataIncomplete?: true;
}

/** How the transport should treat an HTTP status before interpreting the body. */
export type SurplusHttpStatusClass =
  | 'success_2xx'
  | 'retry_transient'
  | 'auth_terminal'
  | 'return_for_accounting'
  | 'throw_response';

/**
 * Map Surplus HTTP statuses to internal outcomes.
 * - 408 / 429 / 5xx → bounded retry (then return last body for accounting)
 * - 401 / 402 / 403 → never retry (credential / billing)
 * - other 4xx → return body once for receipt / unattempted evidence
 * - 3xx / <200 / ≥600 → throw sanitized response error
 */
export function classifySurplusHttpStatus(status: number): SurplusHttpStatusClass {
  if (!Number.isSafeInteger(status) || status < 200 || status >= 600) return 'throw_response';
  if (status >= 300 && status < 400) return 'throw_response';
  if (status === 401 || status === 402 || status === 403) return 'auth_terminal';
  if (status === 408 || status === 429 || status >= 500) return 'retry_transient';
  if (status >= 200 && status < 300) return 'success_2xx';
  return 'return_for_accounting';
}

function stoppedError(): BuildStoppedError {
  const error = new BuildStoppedError();
  error.name = 'Error';
  error.stack = `Error: ${error.message}`;
  return error;
}
type TransportErrorCode = 'configuration' | 'request' | 'network' | 'response';
const localErrorCodes = new WeakMap<object, TransportErrorCode>();
export class SurplusBuildTransportError extends PublicBuildEngineError {
  constructor(readonly code: TransportErrorCode) {
    super();
    Object.defineProperty(this, 'code', { value: code, enumerable: false, writable: false });
    localErrorCodes.set(this, code);
  }
}
function transportCode(error: unknown): TransportErrorCode | undefined {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? localErrorCodes.get(error) : undefined;
}
function encodeRequest(request: Record<string, unknown>): string {
  const route = request?.si_route;
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some(key => !REQUEST_KEYS.has(key)) ||
      typeof request.model !== 'string' || !ID.test(request.model) ||
      typeof request.provider !== 'string' || !ID.test(request.provider) ||
      !route || typeof route !== 'object' || Array.isArray(route) ||
      Object.keys(route).length !== 1 || (route as Record<string, unknown>).objective !== 'price' ||
      request.stream !== false || !Number.isSafeInteger(request.max_tokens) || (request.max_tokens as number) <= 0 ||
      !Array.isArray(request.messages) || request.messages.length === 0 ||
      (request.tools !== undefined && !Array.isArray(request.tools)) ||
      (request.tool_choice !== undefined && request.tool_choice !== 'auto') ||
      (request.reasoning_effort !== undefined && !['none', 'minimal', 'low'].includes(request.reasoning_effort as string))) {
    throw new SurplusBuildTransportError('request');
  }
  try {
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new Error('oversized');
    return body;
  } catch { throw new SurplusBuildTransportError('request'); }
}
async function readBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    try { await response.body?.cancel(); } catch { /* best effort */ }
    throw new SurplusBuildTransportError('response');
  }
  if (!response.body) throw new SurplusBuildTransportError('response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw stoppedError();
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw stoppedError();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SurplusBuildTransportError('response');
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks, bytes).toString('utf8');
    // Whitespace keepalive prefixes are valid for long-running non-streaming responses.
    // A truly empty stream (no JSON) is a transient empty response — caller may retry once.
    if (!text.trim()) throw new SurplusBuildTransportError('response');
    try { return JSON.parse(text); } catch { throw new SurplusBuildTransportError('response'); }
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

function allowlistedHeaders(response: Response): { headers: Record<string, string>; metadataIncomplete: boolean } {
  const headers: Record<string, string> = {};
  let metadataIncomplete = false;
  response.headers.forEach((_value, name) => {
    if (name.startsWith('x-si-') && !(RESPONSE_HEADERS as readonly string[]).includes(name)) metadataIncomplete = true;
  });
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null && value.length <= 1024 && !/[\r\n]/.test(value)) headers[name] = value;
    else if (value !== null) metadataIncomplete = true;
  }
  return { headers, metadataIncomplete };
}

/** 200 with missing/empty choices and no error object — empty stream, not a successful model turn. */
export function isSurplusEmptyStreamBody(parsed: unknown): boolean {
  if (parsed == null) return true;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return true;
  const body = parsed as Record<string, unknown>;
  if (body.error !== undefined && body.error !== null) return false;
  if (!Array.isArray(body.choices)) return true;
  return body.choices.length === 0;
}

/** Never treat an error body as success; some marketplace error codes are still worth retrying. */
export function isSurplusTransientErrorBody(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const error = (parsed as Record<string, unknown>).error;
  if (error == null) return false;
  const code = typeof error === 'string' ? error
    : typeof error === 'object' && !Array.isArray(error) && typeof (error as Record<string, unknown>).code === 'string'
      ? (error as Record<string, unknown>).code as string
      : typeof error === 'object' && !Array.isArray(error) && typeof (error as Record<string, unknown>).type === 'string'
        ? (error as Record<string, unknown>).type as string
        : '';
  return TRANSIENT_ERROR_CODES.has(code.trim().toLowerCase());
}

function combineSignals(signal: AbortSignal, deadline: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, deadline]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  deadline.addEventListener('abort', abort, { once: true });
  if (signal.aborted || deadline.aborted) controller.abort();
  return controller.signal;
}

function backoffMs(attempt: number): number {
  const cap = Math.min(SURPLUS_TRANSPORT_RETRY_BASE_MS * 2 ** (attempt - 1), SURPLUS_TRANSPORT_RETRY_MAX_MS);
  return Math.floor(Math.random() * (cap + 1));
}

async function sleepBackoff(ms: number, signal: AbortSignal, deadline: AbortSignal): Promise<void> {
  if (signal.aborted) throw stoppedError();
  if (deadline.aborted) throw new SurplusBuildTransportError('network');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      deadline.removeEventListener('abort', onDeadline);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(timer); reject(stoppedError()); };
    const onDeadline = () => { clearTimeout(timer); reject(new SurplusBuildTransportError('network')); };
    signal.addEventListener('abort', onAbort, { once: true });
    deadline.addEventListener('abort', onDeadline, { once: true });
    if (signal.aborted) { clearTimeout(timer); reject(stoppedError()); }
    else if (deadline.aborted) { clearTimeout(timer); reject(new SurplusBuildTransportError('network')); }
  });
}

/**
 * Fixed min90 endpoint with bounded retries on transient HTTP / network / empty-stream failures.
 * Not itself dispatch authority: the build session must still validate reviewed capability,
 * price generation, provider and response identity each turn.
 * Keys are read only after explicit enablement; importing this file performs no I/O.
 *
 * Retry policy (same reserved call, same request body):
 * - Retry: network failures, HTTP 408/429/5xx, empty/unparseable 2xx stream, transient error bodies
 * - Never retry: 401/402/403, request/configuration errors, caller Stop, exhausted overall deadline
 * - After retries exhaust: return last HTTP body for accounting (never invent success); throw on pure network
 */
export function createSurplusBuildTransport(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = globalThis.fetch) {
  if (typeof window !== 'undefined' || parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) !== true) throw new SurplusBuildTransportError('configuration');
  const key = env.SURPLUS_API_KEY?.trim();
  if (!key || key.startsWith('inf_admin_') || key === 'replace_with_your_surplus_api_key' || /[\r\n]/.test(key)) throw new SurplusBuildTransportError('configuration');
  return async (request: Record<string, unknown>, signal: AbortSignal): Promise<SurplusBuildTransportResponse> => {
    assertCanaryLegacyAllowed('surplus-builder');
    if (signal.aborted) throw stoppedError();
    if (parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) !== true) throw new SurplusBuildTransportError('configuration');
    let body: string;
    try { body = encodeRequest(request); }
    catch (error) {
      const code = transportCode(error);
      throw new SurplusBuildTransportError(code === 'request' || code === 'configuration' ? code : 'request');
    }
    // One overall ceiling across all attempts — never 3×60s of hung Surplus.
    const deadline = AbortSignal.timeout(SURPLUS_TRANSPORT_TIMEOUT_MS);
    let lastWire: SurplusBuildTransportResponse | undefined;
    let lastRetryableError: SurplusBuildTransportError | undefined;

    for (let attempt = 1; attempt <= SURPLUS_TRANSPORT_MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw stoppedError();
      if (deadline.aborted) throw lastRetryableError ?? new SurplusBuildTransportError('network');
      const combined = combineSignals(signal, deadline);
      try {
        const dispatcher = fetcher === globalThis.fetch ? surplusKeepAliveDispatcher() : undefined;
        const response = await fetcher(URL, {
          method: 'POST', redirect: 'error', signal: combined,
          ...(dispatcher ? { dispatcher } as Record<string, unknown> : {}),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
        });
        if (signal.aborted) throw stoppedError();
        if (deadline.aborted) throw new SurplusBuildTransportError('network');
        if (response.redirected) {
          try { await response.body?.cancel(); } catch { /* best effort */ }
          throw new SurplusBuildTransportError('response');
        }
        const statusClass = classifySurplusHttpStatus(response.status);
        if (statusClass === 'throw_response') {
          try { await response.body?.cancel(); } catch { /* best effort */ }
          throw new SurplusBuildTransportError('response');
        }

        let parsed: unknown;
        try {
          parsed = await readBounded(response, combined);
        } catch (error) {
          if (signal.aborted) throw stoppedError();
          if (error instanceof BuildStoppedError) throw error;
          const code = transportCode(error) ?? 'network';
          // Empty / unparseable 2xx stream: retry before scrubbing the turn as permanently unavailable.
          if (statusClass === 'success_2xx' && code === 'response' && attempt < SURPLUS_TRANSPORT_MAX_ATTEMPTS && !deadline.aborted) {
            lastRetryableError = new SurplusBuildTransportError('response');
            await sleepBackoff(backoffMs(attempt), signal, deadline);
            continue;
          }
          throw new SurplusBuildTransportError(code);
        }

        const { headers, metadataIncomplete } = allowlistedHeaders(response);
        const wire: SurplusBuildTransportResponse = {
          body: parsed, headers, status: response.status, receivedAt: Date.now(),
          ...(metadataIncomplete ? { metadataIncomplete: true as const } : {}),
        };

        if (statusClass === 'auth_terminal' || statusClass === 'return_for_accounting') {
          // 401/402/403 and other non-retry 4xx: one shot, preserve body for accounting.
          return wire;
        }

        if (statusClass === 'retry_transient') {
          lastWire = wire;
          if (attempt < SURPLUS_TRANSPORT_MAX_ATTEMPTS && !deadline.aborted && !signal.aborted) {
            await sleepBackoff(backoffMs(attempt), signal, deadline);
            continue;
          }
          return wire;
        }

        // success_2xx — never claim success on an error body; empty stream gets one more try.
        if (isSurplusEmptyStreamBody(parsed) || isSurplusTransientErrorBody(parsed)) {
          lastWire = wire;
          if (attempt < SURPLUS_TRANSPORT_MAX_ATTEMPTS && !deadline.aborted && !signal.aborted) {
            await sleepBackoff(backoffMs(attempt), signal, deadline);
            continue;
          }
          // Exhausted: return evidence; session must NOT treat error/empty as a successful turn.
          return wire;
        }
        return wire;
      } catch (error) {
        if (signal.aborted) throw stoppedError();
        if (error instanceof BuildStoppedError) throw error;
        const code = transportCode(error);
        if (code === 'configuration' || code === 'request') throw new SurplusBuildTransportError(code);
        if (code === 'response') throw new SurplusBuildTransportError('response');
        // Network / unknown: retry while budget remains.
        lastRetryableError = new SurplusBuildTransportError(code ?? 'network');
        if (attempt < SURPLUS_TRANSPORT_MAX_ATTEMPTS && !deadline.aborted && !signal.aborted) {
          try {
            await sleepBackoff(backoffMs(attempt), signal, deadline);
            continue;
          } catch (sleepError) {
            if (signal.aborted || sleepError instanceof BuildStoppedError) throw stoppedError();
            throw lastRetryableError;
          }
        }
        throw lastRetryableError;
      }
    }
    if (lastWire) return lastWire;
    throw lastRetryableError ?? new SurplusBuildTransportError('network');
  };
}
