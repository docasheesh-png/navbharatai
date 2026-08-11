import { describe, it, expect, afterAll } from 'vitest';

import { join } from 'node:path';
import { generateWaitlistIntegration, WAITLIST_SERVICE_SOURCE } from './WaitlistGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateWaitlistIntegration (wiring)', () => {
  it('emits the waitlist service, routes and README', () => {
    const out = generateWaitlistIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/waitlist/waitlistService.ts');
    expect(paths).toContain('server/waitlist/routes.ts');
    expect(paths).toContain('server/waitlist/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/waitlist/routes.ts']).toContain('export const waitlistRouter');
  });
});

// Materialize + execute the emitted domain logic — the dedup + FIFO-position + invite-in-order rules are real
// business rules, verified against the actual emitted code.
describe('emitted Waitlist — dedup + FIFO position + invite-in-order (real logic)', () => {
  const emitted = emitModule('waitlist', WAITLIST_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type WaitStatus = 'waiting' | 'invited' | 'removed';
  interface WaitEntry { id: string; email: string; seq: number; status: WaitStatus; invitedAt: string | null }
  interface Service {
    join(email: string, input?: { name?: string; referredBy?: string }, now?: Date): WaitEntry;
    get(email: string): WaitEntry | undefined;
    position(email: string): number;
    waitingCount(): number;
    invite(n: number, now?: Date): WaitEntry[];
    remove(email: string): boolean;
    list(status?: WaitStatus): WaitEntry[];
  }
  interface Emitted { Waitlist: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('assigns contiguous FIFO positions in join order', async () => {
    const { Waitlist } = await load();
    const svc = new Waitlist();
    svc.join('a@x.com');
    svc.join('b@x.com');
    svc.join('c@x.com');
    expect(svc.position('a@x.com')).toBe(1);
    expect(svc.position('b@x.com')).toBe(2);
    expect(svc.position('c@x.com')).toBe(3);
    expect(svc.waitingCount()).toBe(3);
  });

  it('dedups by email (case-insensitive) — a repeat join keeps the same stable position', async () => {
    const { Waitlist } = await load();
    const svc = new Waitlist();
    const first = svc.join('Alice@X.com');
    svc.join('b@x.com');
    const again = svc.join('alice@x.com'); // same email, different case
    expect(again.id).toBe(first.id);
    expect(again.email).toBe('alice@x.com'); // normalized
    expect(svc.waitingCount()).toBe(2); // not 3 — no duplicate
    expect(svc.position('alice@x.com')).toBe(1); // still first
    // an invalid email is rejected
    expect(() => svc.join('not-an-email')).toThrow(/valid email/);
  });

  it('invite(n) moves the front n in order; the remaining queue re-numbers', async () => {
    const { Waitlist } = await load();
    const svc = new Waitlist();
    ['a', 'b', 'c', 'd'].forEach((p) => svc.join(p + '@x.com'));
    const invited = svc.invite(2);
    expect(invited.map((e) => e.email)).toEqual(['a@x.com', 'b@x.com']);
    expect(invited.every((e) => e.status === 'invited' && e.invitedAt !== null)).toBe(true);
    // c and d are now the front of the waiting queue, re-numbered 1 and 2
    expect(svc.position('c@x.com')).toBe(1);
    expect(svc.position('d@x.com')).toBe(2);
    expect(svc.waitingCount()).toBe(2);
    // invited people are no longer "waiting" (position 0)
    expect(svc.position('a@x.com')).toBe(0);
    expect(svc.list('invited').map((e) => e.email)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('remove takes an email out of the waiting queue and re-numbers', async () => {
    const { Waitlist } = await load();
    const svc = new Waitlist();
    ['a', 'b', 'c'].forEach((p) => svc.join(p + '@x.com'));
    expect(svc.remove('b@x.com')).toBe(true);
    expect(svc.remove('b@x.com')).toBe(false); // already removed
    expect(svc.position('a@x.com')).toBe(1);
    expect(svc.position('c@x.com')).toBe(2); // b's slot is gone, c moves up
    expect(svc.waitingCount()).toBe(2);
  });

  it('captures referredBy and lists by status in join order', async () => {
    const { Waitlist } = await load();
    const svc = new Waitlist();
    const e = svc.join('a@x.com', { name: 'Asha', referredBy: 'Ref@X.com' });
    expect(e.name).toBe('Asha');
    expect((e as unknown as { referredBy: string }).referredBy).toBe('ref@x.com'); // normalized
    svc.join('b@x.com');
    svc.invite(1);
    expect(svc.list('waiting').map((x) => x.email)).toEqual(['b@x.com']);
    expect(svc.list().length).toBe(2); // all statuses
  });
});
