import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateReferralsIntegration, REFERRAL_SERVICE_SOURCE } from './ReferralsGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateReferralsIntegration (wiring)', () => {
  it('emits the referral service, routes and README', () => {
    const out = generateReferralsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/referrals/referralService.ts');
    expect(paths).toContain('server/referrals/routes.ts');
    expect(paths).toContain('server/referrals/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/referrals/routes.ts']).toContain('export const referralRouter');
    expect(out.files['server/referrals/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the attribution + credit-once rules are real business
// rules, verified against the actual emitted code.
describe('emitted ReferralService — attribution integrity + credit-once (real logic)', () => {
  const artifact = join(here, `._referral_emitted_${process.pid}.ts`);
  writeFileSync(artifact, REFERRAL_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Referral { code: string; referrer: string; referred: string; status: string; completedAt: string | null }
  interface Service {
    codeFor(user: string): string;
    ownerOf(code: string): string | undefined;
    attribute(code: string, newUser: string, now?: Date): Referral;
    referralOf(referredUser: string): Referral | undefined;
    complete(referredUser: string, now?: Date): Referral | null;
    statsFor(referrer: string): { total: number; pending: number; completed: number };
    listFor(referrer: string): Referral[];
  }
  interface Emitted { ReferralService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('gives each user one stable, unique code resolvable back to the owner', async () => {
    const { ReferralService } = await load();
    const svc = new ReferralService();
    const a1 = svc.codeFor('alice');
    const a2 = svc.codeFor('alice');
    const b = svc.codeFor('bob');
    expect(a1).toBe(a2); // stable
    expect(a1).not.toBe(b); // unique per user
    expect(svc.ownerOf(a1)).toBe('alice');
    expect(svc.ownerOf('NOSUCH')).toBeUndefined();
  });

  it('rejects self-referral, unknown code, and double-attribution', async () => {
    const { ReferralService } = await load();
    const svc = new ReferralService();
    const code = svc.codeFor('alice');
    // self-referral
    expect(() => svc.attribute(code, 'alice')).toThrow(/cannot refer yourself/);
    // unknown code
    expect(() => svc.attribute('ZZZZZZ', 'carol')).toThrow(/unknown referral code/);
    // valid attribution
    const ref = svc.attribute(code, 'carol');
    expect(ref).toMatchObject({ referrer: 'alice', referred: 'carol', status: 'pending' });
    // a referred user cannot be re-attributed (even to a different referrer)
    const bobCode = svc.codeFor('bob');
    expect(() => svc.attribute(bobCode, 'carol')).toThrow(/already referred/);
    expect(svc.referralOf('carol')?.referrer).toBe('alice'); // original attribution stands
  });

  it('credits the referrer EXACTLY ONCE — complete is idempotent', async () => {
    const { ReferralService } = await load();
    const svc = new ReferralService();
    const code = svc.codeFor('alice');
    svc.attribute(code, 'carol');
    expect(svc.statsFor('alice')).toEqual({ total: 1, pending: 1, completed: 0 });
    const T = new Date('2026-05-01T00:00:00.000Z');
    const done = svc.complete('carol', T);
    expect(done?.status).toBe('completed');
    expect(done?.completedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(svc.statsFor('alice')).toEqual({ total: 1, pending: 0, completed: 1 });
    // a retried completion does not double-credit and keeps the first completedAt
    const again = svc.complete('carol', new Date('2026-06-01T00:00:00.000Z'));
    expect(again?.completedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(svc.statsFor('alice')).toEqual({ total: 1, pending: 0, completed: 1 });
  });

  it('completing a non-referred user is a null no-op; stats aggregate across referrals', async () => {
    const { ReferralService } = await load();
    const svc = new ReferralService();
    const code = svc.codeFor('alice');
    expect(svc.complete('nobody')).toBeNull();
    svc.attribute(code, 'carol');
    svc.attribute(code, 'dave');
    svc.complete('dave');
    expect(svc.statsFor('alice')).toEqual({ total: 2, pending: 1, completed: 1 });
    expect(svc.listFor('alice').length).toBe(2);
  });

  it('validates required input', async () => {
    const { ReferralService } = await load();
    const svc = new ReferralService();
    expect(() => svc.codeFor('')).toThrow(/user is required/);
    const code = svc.codeFor('alice');
    expect(() => svc.attribute(code, '')).toThrow(/newUser is required/);
  });
});
