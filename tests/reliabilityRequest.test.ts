import { describe, expect, it } from 'vitest';
import { benchmarkEndpoint, benchmarkRequest, benchmarkToken } from '../scripts/lib/reliabilityRequest';

describe('authenticated reliability requests', () => {
  it('attaches the verified token separately from claimed identity and creates replay-safe request IDs', () => {
    const a = benchmarkRequest('build a todo app', 'test-token', 'test-user');
    const b = benchmarkRequest('build a todo app', 'test-token', 'test-user');
    expect(a.init.headers.Authorization).toBe('Bearer test-token');
    expect(a.init.redirect).toBe('error');
    expect(JSON.parse(a.init.body)).toMatchObject({ userId: 'test-user', requestId: a.requestId, sessionId: a.sessionId, planFirst: false });
    expect(a.init.body).not.toContain('test-token');
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.sessionId).not.toBe(b.sessionId);
  });
  it.each([undefined, '', 'Bearer token', 'token\r\nheader'])('refuses a missing or malformed token without echoing it', (token) => {
    expect(() => benchmarkToken(token)).toThrow('Set BENCH_AUTH_TOKEN');
  });
  it.each(['http://example.com', 'https://user:password@example.com', 'https://example.com/?token=x', 'https://example.com/#x', 'file:///tmp/x', 'https://example.com/path'])('refuses unsafe target %s', (url) => {
    expect(() => benchmarkEndpoint(url)).toThrow();
  });
  it.each(['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080', 'https://example.com'])('permits a secure target or local development: %s', (url) => {
    expect(benchmarkEndpoint(url)).toBe(`${url}/api/agentv3/chat`);
  });
});
