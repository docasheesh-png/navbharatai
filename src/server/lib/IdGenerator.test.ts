import { describe, it, expect } from 'vitest';
import { generateIdIntegration } from './IdGenerator';

describe('generateIdIntegration', () => {
  const c = generateIdIntegration();
  const server = c.files['server/lib/ids.ts'];

  it('emits newId + shortId + secureToken + hashToken built on node:crypto', () => {
    expect(server).toContain("import crypto from 'node:crypto'");
    expect(server).toContain('export function newId(');
    expect(server).toContain('export function shortId(');
    expect(server).toContain('export function secureToken(');
    expect(server).toContain('export function hashToken(');
    expect(c.files['src/lib/ids.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('uses the crypto CSPRNG, never Math.random (predictable → guessable tokens)', () => {
    expect(server).toContain('crypto.randomUUID()');
    expect(server).toContain('crypto.randomBytes(');
    expect(server).not.toContain('Math.random('); // no actual Math.random() CALL (the comment warns against it)
  });

  it('shortId avoids modulo bias (rejection sampling) and is URL-safe base62', () => {
    expect(server).toContain('< 252'); // rejection threshold = floor(256/62)*62
    expect(server).toContain('% 62');
  });

  it('secureToken is URL-safe and tokens are stored hashed at rest', () => {
    expect(server).toContain("toString('base64url')");
    expect(server).toContain("createHash('sha256')");
  });

  it('never writes .env.example and only the server file', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/ids.ts']);
    expect(c.instructions.toLowerCase()).toContain('token');
  });
});
