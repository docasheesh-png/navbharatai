import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { KNOWN_ADDRESS_TTL_MS, createSharedAdminGuard, globalCeiling, GLOBAL_WINDOW_MS, type SharedAttempt, type SharedGuardStore } from '../src/server/lib/adminLoginShared';
import { adminMfaWarning } from '../src/lib/adminMfaWarning';

// ADMIN 2026-10-17 — the admin login's throttle lived in each Cloud Run instance's memory and was keyed only by the
// attacker's address. These tests encode the CLASS: state is shared, and a many-address attack meets a ceiling the real
// admin never meets.
function memoryStore(opts: { failing?: boolean } = {}): SharedGuardStore & { calls: number } {
  const attempts = new Map<string, SharedAttempt>(), global = new Map<number, number>(), known = new Map<string, number>();
  const s = {
    calls: 0,
    async readAttempt(k: string) { s.calls++; if (opts.failing) throw new Error('store down'); return attempts.get(k) ?? null; },
    async writeAttempt(k: string, a: SharedAttempt) { if (opts.failing) throw new Error('store down'); attempts.set(k, a); },
    async clearAttempt(k: string) { attempts.delete(k); },
    async addGlobalFail(i: number) { global.set(i, (global.get(i) ?? 0) + 1); return global.get(i)!; },
    async readGlobalFails(i: number) { if (opts.failing) throw new Error('store down'); return global.get(i) ?? 0; },
    async isKnownAddress(k: string, now: number) { return (known.get(k) ?? 0) > now; },
    async markKnownAddress(k: string, now: number) { known.set(k, now + 1e12); },
  };
  return s;
}
const T0 = 1_800_000_000_000;

describe('the lockout is shared between instances', () => {
  it('five failures counted on instance A lock the address on instance B too', async () => {
    const store = memoryStore();
    const a = createSharedAdminGuard(store, 'secret'), b = createSharedAdminGuard(store, 'secret');
    for (let i = 0; i < 5; i++) await a.recordFail('203.0.113.9', T0 + i);
    const v = await b.check('203.0.113.9', T0 + 10);
    expect(v).toMatchObject({ locked: true, reason: 'address' });
    expect(v.retryAfterMs).toBeGreaterThan(50_000); // the first escalation step is one minute
  });
  it('a correct login clears the address, and the lock escalates like the in-memory one (5→1m, 10→2m)', async () => {
    const store = memoryStore(); const g = createSharedAdminGuard(store, 's');
    for (let i = 0; i < 10; i++) await g.recordFail('198.51.100.1', T0 + i);
    expect((await g.check('198.51.100.1', T0 + 20)).retryAfterMs).toBeGreaterThan(100_000);
    await g.recordSuccess('198.51.100.1', T0 + 30);
    expect((await g.check('198.51.100.1', T0 + 31)).locked).toBe(false);
  });
});

describe('a many-address attack meets a global ceiling — and the real admin does not', () => {
  it('30 failures from 30 DIFFERENT addresses refuse a 31st new address', async () => {
    const store = memoryStore(); const g = createSharedAdminGuard(store, 's');
    for (let i = 0; i < 30; i++) await g.recordFail(`10.0.0.${i}`, T0 + i);
    const v = await g.check('10.9.9.9', T0 + 100);
    expect(v).toMatchObject({ locked: true, reason: 'global' });
    expect(v.retryAfterMs).toBeLessThanOrEqual(GLOBAL_WINDOW_MS);
  });
  it('⚠️ an address the admin has logged in from is EXEMPT, so flooding failures never locks the real admin out', async () => {
    const store = memoryStore(); const g = createSharedAdminGuard(store, 's');
    await g.recordSuccess('192.0.2.77', T0); // the admin's usual address
    for (let i = 0; i < 60; i++) await g.recordFail(`10.0.1.${i}`, T0 + 10 + i); // the attack
    expect((await g.check('192.0.2.77', T0 + 200)).locked).toBe(false);
    expect((await g.check('10.0.2.2', T0 + 200)).locked).toBe(true);
  });
  it('the ceiling ends with its window', async () => {
    const store = memoryStore(); const g = createSharedAdminGuard(store, 's');
    for (let i = 0; i < 30; i++) await g.recordFail(`10.0.0.${i}`, T0);
    expect((await g.check('10.9.9.9', T0)).locked).toBe(true);
    expect((await g.check('10.9.9.9', T0 + 2 * GLOBAL_WINDOW_MS)).locked).toBe(false);
  });
  it('ADMIN_LOGIN_GLOBAL_CEILING=off disables only the ceiling; a bad value falls back to the default', async () => {
    const env = { ADMIN_LOGIN_GLOBAL_CEILING: 'off' } as unknown as NodeJS.ProcessEnv;
    expect(globalCeiling(env)).toBe(0); expect(globalCeiling({ ADMIN_LOGIN_GLOBAL_CEILING: 'abc' } as never)).toBe(30);
    const store = memoryStore(); const g = createSharedAdminGuard(store, 's', env);
    for (let i = 0; i < 40; i++) await g.recordFail(`10.0.0.${i}`, T0);
    expect((await g.check('10.9.9.9', T0)).locked).toBe(false);
  });
});

describe('it can never be the thing that blocks a real admin', () => {
  it('FAIL-OPEN: a store that errors yields "not locked", never an exception', async () => {
    const g = createSharedAdminGuard(memoryStore({ failing: true }), 's');
    await expect(g.recordFail('1.2.3.4', T0)).resolves.toBeUndefined();
    expect((await g.check('1.2.3.4', T0)).locked).toBe(false);
  });
  it('no store at all (a dev machine) does nothing', async () => {
    const g = createSharedAdminGuard(null, 's');
    await g.recordFail('1.2.3.4', T0);
    expect((await g.check('1.2.3.4', T0)).locked).toBe(false);
  });
  it('addresses are stored only as a keyed hash, never raw, and the key depends on the secret', async () => {
    const seen: string[] = [];
    const store = { ...memoryStore(), async readAttempt(k: string) { seen.push(k); return null; } };
    await createSharedAdminGuard(store, 'secret-one').check('203.0.113.9', T0);
    await createSharedAdminGuard(store, 'secret-two').check('203.0.113.9', T0);
    expect(seen[0]).not.toContain('203'); expect(seen[0]).toMatch(/^[0-9a-f]{32}$/); expect(seen[0]).not.toBe(seen[1]);
  });
});

describe('the login route actually uses it (source guard)', () => {
  const route = readFileSync('src/server/routes/admin.ts', 'utf8');
  const login = route.slice(route.indexOf("app.post('/api/admin/login'"), route.indexOf('// Admin token verification middleware'));
  it('checks the shared lock and the durable per-minute count BEFORE the password is looked at', () => {
    expect(login.indexOf('sharedGuard.check(')).toBeGreaterThan(0);
    expect(login.indexOf("consumeDurableRate('admin-login'")).toBeGreaterThan(login.indexOf('sharedGuard.check('));
    expect(login.indexOf("consumeDurableRate('admin-login'")).toBeLessThan(login.indexOf('const passHash'));
  });
  it('records a failure in ALL THREE failure paths (wrong password, wrong code) and a success on login', () => {
    expect((login.match(/sharedGuard\.recordFail\(/g) || []).length).toBe(2);
    expect((login.match(/sharedGuard\.recordSuccess\(/g) || []).length).toBe(1);
    expect((login.match(/recordAdminFail\(/g) || []).length).toBe((login.match(/sharedGuard\.recordFail\(/g) || []).length);
  });
});

describe('a login without a second factor is said out loud', () => {
  it('warns only when the status is KNOWN to be off — unknown says nothing, enabled says nothing', () => {
    expect(adminMfaWarning({ enabled: false })).toMatch(/no second factor/);
    expect(adminMfaWarning({ enabled: true })).toBeNull();
    expect(adminMfaWarning(null)).toBeNull();
    expect(adminMfaWarning(undefined)).toBeNull();
    expect(adminMfaWarning({} as never)).toBeNull();
  });
  it('source guard: the dashboard loads the status on mount (not only inside the Security tab) and shows the banner', () => {
    const ui = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    expect(ui).toMatch(/useEffect\(\(\) => \{ void fetchMfaStatus\(\); \}, \[fetchMfaStatus\]\)/);
    expect(ui).toContain('adminMfaWarning(mfaStatus)');
  });
});

describe('retention: nothing the guard stores outlives 30 days (admin 2026-10-21, "30 din baad mita do")', () => {
  const DAY = 24 * 60 * 60_000;
  it('the longest-lived record (a known admin address) expires after 30 days, and every other record sooner', () => {
    expect(KNOWN_ADDRESS_TTL_MS).toBeLessThanOrEqual(30 * DAY);
    expect(GLOBAL_WINDOW_MS * 2).toBeLessThan(KNOWN_ADDRESS_TTL_MS);
  });
  it('source guard: every document the Firestore store writes carries an expireAt', () => {
    const src = readFileSync('src/server/lib/adminLoginShared.ts', 'utf8');
    const writes = (src.match(/setDoc\(/g) || []).length;
    expect(writes).toBeGreaterThanOrEqual(4);
    expect((src.match(/expireAt: ts\(/g) || []).length).toBe(writes);
  });
});
