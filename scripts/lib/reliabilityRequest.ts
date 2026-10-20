import { randomUUID } from 'node:crypto';

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
export function benchmarkRequest(prompt: string, token: string, userId?: string, email?: string) {
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
      body: JSON.stringify({ prompt, userId, email, requestId, sessionId, planFirst: false }),
    },
  };
}
