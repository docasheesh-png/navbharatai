import { PublicBuildEngineError } from '../../lib/buildEngineError';
import { parseEnvFlag } from '../../lib/envFlag';
import { BuildStoppedError } from '../../AgentV3/stopSignal';

const URL = 'https://api.surplusintelligence.ai/min90/v1/chat/completions';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const REQUEST_KEYS = new Set(['model', 'provider', 'si_route', 'messages', 'tools', 'tool_choice', 'max_tokens', 'stream']);
const RESPONSE_HEADERS = ['x-si-provider-family', 'x-si-served-by', 'x-si-truncated', 'x-si-adapted-params', 'x-si-route-objective'] as const;
export interface SurplusBuildTransportResponse {
  body: unknown;
  headers: Record<string, string>;
  status: number;
  receivedAt: number;
  /** Some upstream metadata was omitted from the bounded allow-list. Never infer no-attempt from its absence. */
  metadataIncomplete?: true;
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
      (request.tool_choice !== undefined && request.tool_choice !== 'auto')) {
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
    try { return JSON.parse(text); } catch { throw new SurplusBuildTransportError('response'); }
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

/**
 * Fixed endpoint and one attempt. Not itself dispatch authority: the build session must validate
 * reviewed capability, current price generation, exact provider and response identity each turn.
 * Keys are read only after explicit enablement; importing this file performs no I/O.
 */
export function createSurplusBuildTransport(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = globalThis.fetch) {
  if (typeof window !== 'undefined' || parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) !== true) throw new SurplusBuildTransportError('configuration');
  const key = env.SURPLUS_API_KEY?.trim();
  if (!key || key.startsWith('inf_admin_') || key === 'replace_with_your_surplus_api_key' || /[\r\n]/.test(key)) throw new SurplusBuildTransportError('configuration');
  return async (request: Record<string, unknown>, signal: AbortSignal): Promise<SurplusBuildTransportResponse> => {
    try {
      if (signal.aborted) throw stoppedError();
      if (parseEnvFlag(env.AGENTV3_SURPLUS_BUILDER) !== true) throw new SurplusBuildTransportError('configuration');
      const body = encodeRequest(request);
      const response = await fetcher(URL, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      });
      if (signal.aborted) throw stoppedError();
      if (response.redirected || response.status < 200 || response.status >= 600 || (response.status >= 300 && response.status < 400)) {
        try { await response.body?.cancel(); } catch { /* best effort */ }
        throw new SurplusBuildTransportError('response');
      }
      const parsed = await readBounded(response, signal);
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
      // HTTP errors and HTTP-200 error bodies retain evidence for trusted receipt validation.
      // The session decides acceptance; transport success never means a successful model turn.
      return { body: parsed, headers, status: response.status, receivedAt: Date.now(), ...(metadataIncomplete ? { metadataIncomplete: true as const } : {}) };
    } catch (error) {
      if (signal.aborted) throw stoppedError();
      // Private branding avoids reading any attacker-controlled error property/getter.
      const code = error !== null && (typeof error === 'object' || typeof error === 'function')
        ? localErrorCodes.get(error) : undefined;
      throw new SurplusBuildTransportError(code ?? 'network');
    }
  };
}
