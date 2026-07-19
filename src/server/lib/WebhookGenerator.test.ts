import { describe, it, expect } from 'vitest';
import { generateWebhookIntegration } from './WebhookGenerator';

describe('generateWebhookIntegration', () => {
  const c = generateWebhookIntegration();
  const server = c.files['server/lib/webhook.ts'];

  it('emits verifyWebhookSignature + signWebhook built on node:crypto', () => {
    expect(server).toContain("import crypto from 'node:crypto'");
    expect(server).toContain('export function verifyWebhookSignature(');
    expect(server).toContain('export function signWebhook(');
    expect(c.files['src/lib/webhook.ts']).toBeUndefined(); // server-side
  });

  it('compares in constant time and never with === (no timing leak)', () => {
    expect(server).toContain('crypto.timingSafeEqual(');
    expect(server).not.toContain('provided === expected');
    // guards the length mismatch that would otherwise throw
    expect(server).toContain('a.length !== b.length');
  });

  it('hashes the RAW body with HMAC and tolerates the sha256= header prefix', () => {
    expect(server).toContain("crypto.createHmac(algorithm, secret)");
    expect(server).toContain(".update(body).digest('hex')");
    expect(server).toContain("signatureHeader.includes('=')");
  });

  it('is dependency-free and never writes .env.example (secret is app-supplied)', () => {
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/webhook.ts']);
    expect(c.instructions.toLowerCase()).toContain('webhook');
  });
});
