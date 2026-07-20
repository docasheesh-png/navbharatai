import { describe, it, expect } from 'vitest';
import { generateCsrfIntegration } from './CsrfGenerator';

describe('generateCsrfIntegration', () => {
  const c = generateCsrfIntegration();
  const server = c.files['server/lib/csrf.ts'];

  it('emits a dependency-free CSRF middleware built on node:crypto (no cookie-parser)', () => {
    expect(server).toContain("import crypto from 'node:crypto'");
    expect(server).toContain('export function csrfProtection(');
    expect(server).toContain('export function issueCsrfToken(');
    expect(server).not.toContain("from 'csurf'");
    expect(server).not.toContain("from 'cookie-parser'");
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('uses the double-submit pattern with a constant-time compare', () => {
    expect(server).toContain('crypto.timingSafeEqual');
    expect(server).toContain("crypto.randomBytes(32).toString('hex')");
    expect(server).toContain("new Set(['POST', 'PUT', 'PATCH', 'DELETE'])");
  });

  it('issues a readable SameSite cookie so the frontend can echo it — no HttpOnly attribute', () => {
    expect(server).toContain('SameSite=Lax');
    // The Set-Cookie must NOT carry the HttpOnly ATTRIBUTE (capital-H spelling), else JS can't read it to
    // echo the token. The explanatory comment mentions lowercase "httpOnly" — that's fine, only the attribute
    // is forbidden.
    expect(server).not.toContain('HttpOnly');
    expect(server).toContain("process.env.NODE_ENV === 'production'"); // Secure in prod
  });

  it('ships a runnable test alongside and writes only the two server files', () => {
    expect(c.files['server/lib/csrf.test.ts']).toBeTruthy();
    expect(Object.keys(c.files).sort()).toEqual(['server/lib/csrf.test.ts', 'server/lib/csrf.ts']);
    expect(c.instructions.toLowerCase()).toContain('csrf');
  });
});
