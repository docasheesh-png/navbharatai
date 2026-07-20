import { describe, it, expect } from 'vitest';
import { generateWebhookSenderIntegration } from './WebhookSenderGenerator';

describe('generateWebhookSenderIntegration', () => {
  const c = generateWebhookSenderIntegration();
  const server = c.files['server/lib/webhookSender.ts'];

  it('emits sendWebhook built on node:crypto, dependency-free and server-side', () => {
    expect(server).toContain("import crypto from 'node:crypto'");
    expect(server).toContain('export async function sendWebhook(');
    expect(server).not.toContain("from 'axios'");
    expect(c.files['src/lib/webhookSender.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('signs the body with HMAC-SHA256 in the same "sha256=<hex>" header the incoming recipe verifies', () => {
    expect(server).toContain("'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')");
    expect(server).toContain("'X-Webhook-Signature': signature");
  });

  it('enforces a timeout so a slow subscriber cannot hang the sender', () => {
    expect(server).toContain('new AbortController()');
    expect(server).toContain('setTimeout(() => controller.abort(), opts?.timeoutMs ?? 10000)');
    expect(server).toContain('clearTimeout(timer)');
  });

  it('never throws — returns { ok, status } and maps a timeout to an honest error', () => {
    expect(server).toContain('return { ok: res.ok, status: res.status }');
    expect(server).toContain("err.name === 'AbortError'");
    expect(server).toContain("timedOut ? 'timeout'");
  });

  it('never writes .env.example and only the server file', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/webhookSender.ts']);
    expect(c.instructions.toLowerCase()).toContain('signature');
  });
});
