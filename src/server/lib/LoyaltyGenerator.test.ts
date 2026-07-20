import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateLoyaltyIntegration, LOYALTY_SERVICE_SOURCE } from './LoyaltyGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateLoyaltyIntegration (wiring)', () => {
  it('emits the loyalty service, routes and README', () => {
    const out = generateLoyaltyIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/loyalty/loyaltyService.ts');
    expect(paths).toContain('server/loyalty/routes.ts');
    expect(paths).toContain('server/loyalty/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/loyalty/routes.ts']).toContain('export const loyaltyRouter');
    expect(out.files['server/loyalty/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the ledger-integrity + no-overdraft + expiry rules are
// real business rules, verified against the actual emitted code.
describe('emitted LoyaltyService — ledger integrity + no overdraft (real logic)', () => {
  const artifact = join(here, `._loyalty_emitted_${process.pid}.ts`);
  writeFileSync(artifact, LOYALTY_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Entry { id: string; kind: string; points: number }
  interface Service {
    earn(member: string, points: number, reason?: string, expiresAt?: string | null, now?: Date): Entry;
    redeem(member: string, points: number, reason?: string, now?: Date): Entry;
    balance(member: string, now?: Date): number;
    expireDue(member: string, now?: Date): number;
    history(member: string): Entry[];
  }
  interface Emitted { LoyaltyService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('balance is exactly sum(earned) − sum(redeemed)', async () => {
    const { LoyaltyService } = await load();
    const svc = new LoyaltyService();
    svc.earn('u1', 100, 'signup');
    svc.earn('u1', 50, 'purchase');
    svc.redeem('u1', 30, 'discount');
    expect(svc.balance('u1')).toBe(120); // 100 + 50 - 30
    // a second member's ledger is independent
    expect(svc.balance('u2')).toBe(0);
  });

  it('rejects a redeem beyond the balance — the balance never goes negative', async () => {
    const { LoyaltyService } = await load();
    const svc = new LoyaltyService();
    svc.earn('u1', 40);
    expect(() => svc.redeem('u1', 41)).toThrow(/insufficient points/);
    // the failed redeem left the balance untouched
    expect(svc.balance('u1')).toBe(40);
    // redeeming the exact balance is allowed → 0, and no further redemption is possible
    svc.redeem('u1', 40);
    expect(svc.balance('u1')).toBe(0);
    expect(() => svc.redeem('u1', 1)).toThrow(/insufficient points/);
  });

  it('rejects non-positive / non-integer point amounts', async () => {
    const { LoyaltyService } = await load();
    const svc = new LoyaltyService();
    expect(() => svc.earn('u1', 0)).toThrow(/positive integer/);
    expect(() => svc.earn('u1', -5)).toThrow(/positive integer/);
    expect(() => svc.earn('u1', 2.5)).toThrow(/positive integer/);
    expect(() => svc.redeem('u1', 0)).toThrow(/positive integer/);
    expect(() => svc.earn('', 10)).toThrow(/member is required/);
  });

  it('expired earns drop out of the balance, and expireDue records an audit entry', async () => {
    const { LoyaltyService } = await load();
    const svc = new LoyaltyService();
    const T0 = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date('2026-03-01T00:00:00.000Z');
    svc.earn('u1', 100, 'promo', '2026-02-01T00:00:00.000Z', T0); // expires Feb 1
    svc.earn('u1', 20, 'permanent', null, T0);
    // Before expiry, both count.
    expect(svc.balance('u1', T0)).toBe(120);
    // After Feb 1, the promo points are gone from the balance.
    expect(svc.balance('u1', later)).toBe(20);
    // expireDue records the 100 as an explicit expire entry; balance stays 20; history gains the record.
    expect(svc.expireDue('u1', later)).toBe(100);
    expect(svc.balance('u1', later)).toBe(20);
    expect(svc.history('u1').some((e) => e.kind === 'expire' && e.points === 100)).toBe(true);
    // running it again is idempotent (nothing left to expire)
    expect(svc.expireDue('u1', later)).toBe(0);
  });

  it('history is append-only and newest-first', async () => {
    const { LoyaltyService } = await load();
    const svc = new LoyaltyService();
    svc.earn('u1', 10, 'a', null, new Date('2026-01-01T00:00:00.000Z'));
    svc.earn('u1', 10, 'b', null, new Date('2026-01-02T00:00:00.000Z'));
    svc.redeem('u1', 5, 'c', new Date('2026-01-03T00:00:00.000Z'));
    const h = svc.history('u1');
    expect(h.length).toBe(3);
    expect(h[0].kind).toBe('redeem'); // newest first
  });
});
