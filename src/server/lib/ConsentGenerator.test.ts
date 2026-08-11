import { describe, it, expect, afterAll } from 'vitest';

import { generateConsentIntegration, CONSENT_SERVICE_SOURCE } from './ConsentGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateConsentIntegration (wiring)', () => {
  it('emits the consent service, routes and README', () => {
    const out = generateConsentIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/consent/consentService.ts');
    expect(paths).toContain('server/consent/routes.ts');
    expect(paths).toContain('server/consent/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/consent/routes.ts']).toContain('export const consentRouter');
  });
});

// Materialize + execute the emitted domain logic — the latest-wins + append-only-history rules are real
// business rules, verified against the actual emitted code.
describe('emitted ConsentService — latest-wins + append-only history (real logic)', () => {
  const emitted = emitModule('consent', CONSENT_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type ConsentAction = 'grant' | 'withdraw';
  interface ConsentEvent { id: string; user: string; purpose: string; action: ConsentAction; at: string }
  interface Service {
    record(i: { user: string; purpose: string; action: ConsentAction; policyVersion?: string; source?: string }, now?: Date): ConsentEvent;
    grant(user: string, purpose: string, meta?: { policyVersion?: string; source?: string }, now?: Date): ConsentEvent;
    withdraw(user: string, purpose: string, meta?: { policyVersion?: string; source?: string }, now?: Date): ConsentEvent;
    hasConsent(user: string, purpose: string): boolean;
    stateOf(user: string): Record<string, ConsentAction>;
    history(user: string, purpose?: string): ConsentEvent[];
    grantedUsers(purpose: string): string[];
  }
  interface Emitted { ConsentService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  const T = (n: number) => new Date(2_000_000_000_000 + n * 1000);

  it('current consent is the MOST-RECENT event (latest wins)', async () => {
    const { ConsentService } = await load();
    const svc = new ConsentService();
    expect(svc.hasConsent('u1', 'marketing')).toBe(false); // never recorded
    svc.grant('u1', 'marketing', {}, T(1));
    expect(svc.hasConsent('u1', 'marketing')).toBe(true);
    svc.withdraw('u1', 'marketing', {}, T(2));
    expect(svc.hasConsent('u1', 'marketing')).toBe(false); // withdrawal wins
    svc.grant('u1', 'marketing', {}, T(3));
    expect(svc.hasConsent('u1', 'marketing')).toBe(true); // re-granted
  });

  it('tracks independent state per purpose', async () => {
    const { ConsentService } = await load();
    const svc = new ConsentService();
    svc.grant('u1', 'analytics', {}, T(1));
    svc.grant('u1', 'marketing', {}, T(2));
    svc.withdraw('u1', 'marketing', {}, T(3));
    expect(svc.stateOf('u1')).toEqual({ analytics: 'grant', marketing: 'withdraw' });
    expect(svc.hasConsent('u1', 'analytics')).toBe(true);
    expect(svc.hasConsent('u1', 'marketing')).toBe(false);
  });

  it('history is append-only — every event is retained in order (nothing overwritten)', async () => {
    const { ConsentService } = await load();
    const svc = new ConsentService();
    svc.grant('u1', 'marketing', { policyVersion: 'v1', source: 'signup' }, T(1));
    svc.withdraw('u1', 'marketing', { source: 'settings' }, T(2));
    svc.grant('u1', 'marketing', { policyVersion: 'v2' }, T(3));
    const h = svc.history('u1', 'marketing');
    expect(h.map((e) => e.action)).toEqual(['grant', 'withdraw', 'grant']); // all 3 retained, in order
    expect(h[0]).toMatchObject({ policyVersion: 'v1', source: 'signup' });
    expect(svc.history('u1').length).toBe(3);
  });

  it('grantedUsers lists only currently-opted-in users for a purpose', async () => {
    const { ConsentService } = await load();
    const svc = new ConsentService();
    svc.grant('alice', 'marketing', {}, T(1));
    svc.grant('bob', 'marketing', {}, T(2));
    svc.withdraw('bob', 'marketing', {}, T(3)); // bob opted out
    svc.grant('carol', 'analytics', {}, T(4));  // different purpose
    expect(svc.grantedUsers('marketing')).toEqual(['alice']); // bob withdrew, carol is analytics-only
  });

  it('validates the event', async () => {
    const { ConsentService } = await load();
    const svc = new ConsentService();
    expect(() => svc.record({ user: '', purpose: 'x', action: 'grant' })).toThrow(/user is required/);
    expect(() => svc.record({ user: 'u', purpose: '', action: 'grant' })).toThrow(/purpose is required/);
    // @ts-expect-error bad action
    expect(() => svc.record({ user: 'u', purpose: 'x', action: 'maybe' })).toThrow(/grant.*withdraw/);
  });
});
