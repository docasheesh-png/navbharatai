import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PASSWORD_ATTEMPTS, privateAppPasswordBudget, type ConsumeFn } from '../src/server/lib/privateAppPasswordBudget';
import { consumeWithStore } from '../src/server/lib/DurableRateLimit';

// A private published app's password was checked with no throttle (found alongside the admin login's, 2026-10-17).
function counter(): ConsumeFn {
  const used = new Map<string, number>();
  return async (name, key, limit) => {
    const k = `${name}|${key}`;
    return consumeWithStore({ async incrementAndRead() { used.set(k, (used.get(k) ?? 0) + 1); return used.get(k)!; } }, limit);
  };
}
describe('private app password attempts', () => {
  it('allows the budget, then refuses with a wait time', async () => {
    const c = counter();
    for (let i = 0; i < PASSWORD_ATTEMPTS; i++) expect((await privateAppPasswordBudget('app1', '1.2.3.4', 'guess', 1e12, c)).allowed).toBe(true);
    const over = await privateAppPasswordBudget('app1', '1.2.3.4', 'guess', 1e12, c);
    expect(over.allowed).toBe(false); expect(over.retryAfterSec).toBeGreaterThan(0);
  });
  it('the budget is per (app, address): another address, or another app, is untouched', async () => {
    const c = counter();
    for (let i = 0; i < PASSWORD_ATTEMPTS + 5; i++) await privateAppPasswordBudget('app1', '1.2.3.4', 'x', 1e12, c);
    expect((await privateAppPasswordBudget('app1', '5.6.7.8', 'x', 1e12, c)).allowed).toBe(true);
    expect((await privateAppPasswordBudget('app2', '1.2.3.4', 'x', 1e12, c)).allowed).toBe(true);
  });
  it('a request with no password (the "is it private?" first call) is free and never counted', async () => {
    const c = counter();
    for (let i = 0; i < 200; i++) expect((await privateAppPasswordBudget('app1', '1.2.3.4', '', 1e12, c)).allowed).toBe(true);
    expect((await privateAppPasswordBudget('app1', '1.2.3.4', undefined, 1e12, c)).allowed).toBe(true);
  });
  it('FAIL-OPEN: a store that throws never blocks a visitor', async () => {
    const boom: ConsumeFn = async () => { throw new Error('down'); };
    expect((await privateAppPasswordBudget('app1', '1.2.3.4', 'x', 1e12, boom)).allowed).toBe(true);
  });
  it('source guard: BOTH routes that verify the password (open and remix) take the budget first', () => {
    const src = readFileSync('src/server/routes/navStore.ts', 'utf8');
    const calls = src.split('verifyAppPassword(pw, found.passwordHash').length - 1;
    expect(calls).toBe(2);
    expect((src.match(/privateAppPasswordBudget\(found\.id/g) || []).length).toBe(calls);
    for (const m of src.matchAll(/privateAppPasswordBudget\(found\.id/g)) {
      expect(src.indexOf('verifyAppPassword(pw, found.passwordHash', m.index!)).toBeGreaterThan(m.index!);
    }
  });
});
