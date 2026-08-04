import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateMessagingIntegration, MESSAGING_SERVICE_SOURCE } from './MessagingGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateMessagingIntegration (wiring)', () => {
  it('emits the messaging service, routes and README', () => {
    const out = generateMessagingIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/messaging/messagingService.ts');
    expect(paths).toContain('server/messaging/routes.ts');
    expect(paths).toContain('server/messaging/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/messaging/routes.ts']).toContain('export const messagingRouter');
  });
});

// Materialize + execute the emitted domain logic — the canonical-pairing, unread and monotonic-read-cursor
// rules are real business rules, verified against the actual emitted code.
describe('emitted MessagingService — conversation integrity + unread + monotonic read (real logic)', () => {
  const artifact = join(here, `._messaging_emitted_${process.pid}.ts`);
  writeFileSync(artifact, MESSAGING_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Message { id: string; sender: string; body: string }
  interface Convo { id: string; participants: [string, string]; unread?: number }
  interface Service {
    openConversation(a: string, b: string, now?: Date): Convo;
    send(sender: string, recipient: string, body: string, now?: Date): Message;
    history(a: string, b: string): Message[];
    unreadCount(participant: string, other: string): number;
    markRead(participant: string, other: string, now?: Date): number;
    inbox(participant: string): Array<Convo & { unread: number }>;
  }
  interface Emitted { MessagingService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('(a,b) and (b,a) resolve to the SAME conversation — never a duplicate', async () => {
    const { MessagingService } = await load();
    const svc = new MessagingService();
    const c1 = svc.openConversation('alice', 'bob');
    const c2 = svc.openConversation('bob', 'alice');
    expect(c1.id).toBe(c2.id);
    // messages sent in either direction land in the one shared history
    svc.send('alice', 'bob', 'hi');
    svc.send('bob', 'alice', 'hey');
    expect(svc.history('alice', 'bob').length).toBe(2);
    expect(svc.history('bob', 'alice').length).toBe(2); // same thread from either side
    expect(svc.inbox('alice').length).toBe(1);
  });

  it('rejects self-conversation and empty body', async () => {
    const { MessagingService } = await load();
    const svc = new MessagingService();
    expect(() => svc.openConversation('alice', 'alice')).toThrow(/with yourself/);
    expect(() => svc.send('alice', 'alice', 'x')).toThrow(/with yourself/);
    expect(() => svc.send('alice', 'bob', '   ')).toThrow(/body is required/);
    expect(() => svc.openConversation('alice', '')).toThrow(/two participants/);
  });

  it('unread count is exact and excludes a participant own messages', async () => {
    const { MessagingService } = await load();
    const svc = new MessagingService();
    svc.send('alice', 'bob', 'm1');
    svc.send('alice', 'bob', 'm2');
    // bob has 2 unread; alice (the sender) has 0 (own messages are implicitly read)
    expect(svc.unreadCount('bob', 'alice')).toBe(2);
    expect(svc.unreadCount('alice', 'bob')).toBe(0);
    svc.send('bob', 'alice', 'reply');
    expect(svc.unreadCount('alice', 'bob')).toBe(1); // alice now has bob's reply unread
  });

  it('markRead clears unread and is MONOTONIC — a stale re-read never resurfaces messages', async () => {
    const { MessagingService } = await load();
    const svc = new MessagingService();
    svc.send('alice', 'bob', 'm1');
    svc.send('alice', 'bob', 'm2');
    expect(svc.markRead('bob', 'alice')).toBe(2); // cleared 2
    expect(svc.unreadCount('bob', 'alice')).toBe(0);
    // a repeat mark clears nothing and the count stays 0
    expect(svc.markRead('bob', 'alice')).toBe(0);
    // a new message arrives → 1 unread; a fresh markRead clears exactly that 1
    svc.send('alice', 'bob', 'm3');
    expect(svc.unreadCount('bob', 'alice')).toBe(1);
    expect(svc.markRead('bob', 'alice')).toBe(1);
    expect(svc.unreadCount('bob', 'alice')).toBe(0);
  });

  it('inbox lists conversations most-recent first with per-conversation unread counts', async () => {
    const { MessagingService } = await load();
    const svc = new MessagingService();
    svc.send('alice', 'bob', 'hi bob', new Date('2026-01-01T00:00:00.000Z'));
    svc.send('alice', 'carol', 'hi carol', new Date('2026-01-02T00:00:00.000Z'));
    // bob's inbox: one conversation with alice, 1 unread
    const bobInbox = svc.inbox('bob');
    expect(bobInbox.length).toBe(1);
    expect(bobInbox[0].unread).toBe(1);
    // alice's inbox: two conversations, carol's most recent first, both 0 unread (she sent them)
    const aliceInbox = svc.inbox('alice');
    expect(aliceInbox.length).toBe(2);
    expect(aliceInbox[0].participants).toContain('carol');
    expect(aliceInbox.every((c) => c.unread === 0)).toBe(true);
  });
});
