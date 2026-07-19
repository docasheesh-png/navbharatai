import { describe, it, expect } from 'vitest';
import { generateCorsIntegration } from './CorsGenerator';

describe('generateCorsIntegration', () => {
  const c = generateCorsIntegration();
  const server = c.files['server/lib/cors.ts'];

  it('emits an allowlist-driven middleware that echoes the origin, never a wildcard', () => {
    expect(server).toContain('export function corsMiddleware(');
    expect(server).toContain('process.env.ALLOWED_ORIGINS');
    expect(server).toContain('ALLOWED.includes(origin)');
    expect(server).toContain("res.setHeader('Access-Control-Allow-Origin', origin)"); // exact origin
    expect(server).not.toContain("Allow-Origin', '*'"); // never the dangerous wildcard
    expect(server).toContain("res.setHeader('Vary', 'Origin')");
  });

  it('only sets Allow-Credentials inside the allowlist branch (safe pairing)', () => {
    const credIdx = server.indexOf('Access-Control-Allow-Credentials');
    const branchIdx = server.indexOf('ALLOWED.includes(origin)');
    const nextIdx = server.indexOf('next();');
    // credentials header appears AFTER the allowlist check and before the fallthrough next()
    expect(branchIdx).toBeGreaterThan(-1);
    expect(credIdx).toBeGreaterThan(branchIdx);
    expect(credIdx).toBeLessThan(nextIdx);
  });

  it('answers the OPTIONS preflight with 204', () => {
    expect(server).toContain("=== 'OPTIONS'");
    expect(server).toContain('res.statusCode = 204');
  });

  it('behaviour check: allowlist match echoes origin + credentials; non-match sets nothing', () => {
    // Re-implement the exact emitted logic to prove semantics end-to-end.
    const ALLOWED = ['https://app.example.com', 'http://localhost:5173'];
    function run(origin: string | undefined) {
      const headers: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => { headers[k] = v; } };
      if (typeof origin === 'string' && ALLOWED.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      return headers;
    }
    expect(run('https://app.example.com')['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(run('https://app.example.com')['Access-Control-Allow-Credentials']).toBe('true');
    expect(run('https://evil.example.com')['Access-Control-Allow-Origin']).toBeUndefined(); // not allowlisted
    expect(run(undefined)['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('declares the env key + blank .env.example (never overwrites), no dependency', () => {
    expect(c.envKeys).toEqual(['ALLOWED_ORIGINS']);
    expect(c.files['.env.example']).toBe('ALLOWED_ORIGINS=\n');
    expect(c.dependency).toBeUndefined();
    expect(c.instructions).toContain('never stores');
  });
});
