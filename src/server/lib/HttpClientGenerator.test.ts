import { describe, it, expect } from 'vitest';
import { generateHttpClientIntegration } from './HttpClientGenerator';

describe('generateHttpClientIntegration', () => {
  const c = generateHttpClientIntegration();
  const server = c.files['server/lib/http.ts'];

  it('emits fetchJson + HttpError, dependency-free and server-side', () => {
    expect(server).toContain('export async function fetchJson<T = unknown>(');
    expect(server).toContain('export class HttpError extends Error');
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/http.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('adds a real timeout via AbortController (bare fetch would hang forever)', () => {
    expect(server).toContain('new AbortController()');
    expect(server).toContain('setTimeout(() => controller.abort(), timeoutMs)');
    expect(server).toContain('signal: controller.signal');
    expect(server).toContain('timeoutMs = 10000');
    expect(server).toContain('clearTimeout(timer)'); // always cleared
  });

  it('throws on a non-2xx status (native fetch silently resolves) and maps abort → TimeoutError', () => {
    expect(server).toContain('if (!res.ok)');
    expect(server).toContain('throw new HttpError(res.status, url, body)');
    expect(server).toContain("err.name === 'AbortError'");
    expect(server).toContain("e.name = 'TimeoutError'");
  });

  it('returns parsed JSON and never writes .env.example', () => {
    expect(server).toContain('await res.json()');
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/http.ts']);
    expect(c.instructions.toLowerCase()).toContain('timeout');
  });
});
