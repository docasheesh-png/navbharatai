import { describe, it, expect } from 'vitest';
import { generateSecurityHeadersIntegration } from './SecurityHeadersGenerator';

describe('generateSecurityHeadersIntegration', () => {
  const c = generateSecurityHeadersIntegration();
  const server = c.files['server/lib/securityHeaders.ts'];

  it('emits a middleware setting the safe hardening headers', () => {
    expect(server).toContain('export function securityHeaders(');
    expect(server).toContain("res.setHeader('X-Content-Type-Options', 'nosniff')");
    expect(server).toContain("res.setHeader('X-Frame-Options', 'SAMEORIGIN')"); // SAMEORIGIN, not DENY (won't break embeds)
    expect(server).toContain("res.setHeader('Referrer-Policy'");
    expect(server).toContain("res.setHeader('Strict-Transport-Security'");
    expect(server).toContain("res.setHeader('Permissions-Policy'");
    expect(server).toContain('next();');
  });

  it('does NOT force a Content-Security-Policy (rule 1 — a wrong CSP breaks the app); ships it commented', () => {
    // The active code must not setHeader a CSP; it must appear only as a commented opt-in line.
    expect(server).not.toMatch(/^\s*res\.setHeader\('Content-Security-Policy'/m);
    expect(server).toContain("// res.setHeader('Content-Security-Policy'");
    expect(server).toContain('a wrong one BREAKS your app'); // the generated comment warns why CSP is opt-in
    expect(c.instructions).toContain('a wrong CSP breaks your app'); // and the instructions do too
  });

  it('is dependency-free, server-only, adds no env key and no .env.example', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual([]);
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/securityHeaders.ts']);
  });
});
