import { randomUUID } from 'node:crypto';
import type { PowerLevel } from '../../src/server/AgentV3/powerLevel';

/** Never infer a paid benchmark tier from account defaults or a misspelled label. */
export function benchmarkTier(value: unknown): PowerLevel {
  if (value === 'weak' || value === 'off' || value === 'mini') return value;
  throw new Error('Set BENCH_POWER_LEVEL explicitly to weak, off (Normal), or mini (Strong).');
}

/** Validate before a paid run. Never send a bearer token to a plaintext remote server. */
export function benchmarkEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('BENCH_BASE_URL must be an HTTP(S) origin without credentials, query or fragment.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Remote benchmark servers require HTTPS.');
  }
  if (url.pathname !== '/') throw new Error('BENCH_BASE_URL must be an origin without a path.');
  return `${url.origin}/api/agentv3/chat`;
}

export function benchmarkToken(value: string | undefined): string {
  const token = value?.trim();
  if (!token || /\s/.test(token)) throw new Error('Set BENCH_AUTH_TOKEN to a current test-account ID token before a live run.');
  return token;
}

/** A fresh independent repetition, with stable identity if the server sees a duplicate delivery. */
export function benchmarkRequest(prompt: string, token: string, userId?: string, email?: string, requestedTier?: unknown) {
  const powerLevel = benchmarkTier(requestedTier);
  const requestId = randomUUID();
  const sessionId = `relbench-${randomUUID()}`;
  return {
    requestId,
    sessionId,
    init: {
      method: 'POST',
      // A redirect is never authority to forward a paid request to another route/origin.
      redirect: 'error' as const,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${benchmarkToken(token)}` },
      body: JSON.stringify({ prompt, userId, email, requestId, sessionId, planFirst: false, powerLevel }),
    },
  };
}

/**
 * Where a live run gets its bearer token. A Firebase ID token expires after about an hour, and a smoke
 * run can last longer than that, so a scheduled run (.github/workflows/game-bench-weekly.yml) cannot be
 * handed one fixed token: every build after the first hour would be refused. It is given the test
 * account's REFRESH token instead, and a fresh ID token is minted before EACH build. A local run may
 * still pass BENCH_AUTH_TOKEN directly. Errors never echo a token or the token service's body.
 */
export type TokenSource = () => Promise<string>;
export type TokenFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: 'error' }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function benchmarkTokenSource(
  opts: { authToken?: string; refreshToken?: string; apiKey?: string },
  fetchImpl: TokenFetch = fetch as unknown as TokenFetch,
): TokenSource {
  const refreshToken = opts.refreshToken?.trim();
  if (!refreshToken) {
    const fixed = benchmarkToken(opts.authToken);
    return async () => fixed;
  }
  const apiKey = opts.apiKey?.trim();
  if (!apiKey || /\s/.test(apiKey) || /\s/.test(refreshToken)) {
    throw new Error('A refresh-token run needs the Firebase web API key and a refresh token without whitespace.');
  }
  return async () => {
    const res = await fetchImpl(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
    if (!res.ok) throw new Error(`token-refresh-failed: HTTP ${res.status}`);
    const body = (await res.json()) as { id_token?: unknown } | null;
    const idToken = typeof body?.id_token === 'string' ? body.id_token : '';
    if (!idToken) throw new Error('token-refresh-failed: no id_token in the response');
    return benchmarkToken(idToken);
  };
}
