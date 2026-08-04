import { describe, it, expect } from 'vitest';
import { generateNotifyIntegration, isNotifyProvider } from './NotifyGenerator';

describe('generateNotifyIntegration — Slack', () => {
  const c = generateNotifyIntegration('slack');

  it('emits a server-only notify() that posts { text } and never throws', () => {
    const server = c.files['server/lib/notify.ts'];
    expect(server).toContain('export async function notify(message: string)');
    expect(server).toContain("JSON.stringify({ text: message })"); // Slack payload
    expect(server).toContain('return false'); // never throws → notification failure can't break the request
    expect(server).toContain('SLACK_WEBHOOK_URL');
    expect(c.files['src/lib/notify.ts']).toBeUndefined(); // server-side, no client file
  });

  it('needs no npm dependency, declares the webhook + blank .env.example', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['SLACK_WEBHOOK_URL']);
    expect(c.files['.env.example']).toBe('SLACK_WEBHOOK_URL=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('generateNotifyIntegration — Discord', () => {
  const c = generateNotifyIntegration('discord');

  it('emits notify() that posts { content } to the Discord webhook', () => {
    const server = c.files['server/lib/notify.ts'];
    expect(server).toContain("JSON.stringify({ content: message })"); // Discord payload
    expect(server).toContain('DISCORD_WEBHOOK_URL');
    expect(c.envKeys).toEqual(['DISCORD_WEBHOOK_URL']);
    expect(c.dependency).toBeUndefined();
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real webhook values (blank RHS only) for both providers', () => {
    for (const p of ['slack', 'discord'] as const) {
      const env = generateNotifyIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isNotifyProvider accepts the two supported providers, rejects everything else', () => {
    expect(isNotifyProvider('slack')).toBe(true);
    expect(isNotifyProvider('discord')).toBe(true);
    expect(isNotifyProvider('teams')).toBe(false);
    expect(isNotifyProvider(undefined)).toBe(false);
  });
});
