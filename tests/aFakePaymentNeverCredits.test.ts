// Q-615 (admin 2026-10-05: "agar need nahi hai, to band karo. asli kaam karne wala payment rakho. sabhi
// fake hatao!") — no payment that moved no money ever credits a wallet.
//
// Four fake paths existed: a Cashfree "simulator" (missing keys opened a simulated gateway whose PASS
// button credited a real wallet), Cashfree TEST keys on the production server, Apple's sandbox (a
// TestFlight purchase credited production), and Google license-tester purchases. Store verification is
// covered in storeBilling.test.ts; this file locks the Cashfree side and the census.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cashfreePaymentsAvailability } from '../src/server/lib/cashfreeCredentials';

const store = new Map<string, Record<string, unknown>>();
vi.mock('../src/server/lib/serverDb', () => ({
  getServerDb: () => ({}),
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  getDoc: async (ref: { col: string; id: string }) => {
    const d = store.get(`${ref.col}/${ref.id}`);
    return { exists: () => d !== undefined, data: () => d };
  },
  updateDoc: async () => undefined,
  runTransaction: async () => { throw new Error('nothing may be written for a fake payment'); },
}));
const axiosGet = vi.fn();
vi.mock('axios', () => ({ default: { get: (...a: unknown[]) => axiosGet(...a) } }));

import { verifyPaymentInternal } from '../src/server/lib/payments';

const env = (o: Record<string, string | undefined>) => o as unknown as NodeJS.ProcessEnv;

describe('one decision: can real payments be taken?', () => {
  it('missing or placeholder keys → payments are OFF (no simulator)', () => {
    expect(cashfreePaymentsAvailability(env({})).ok).toBe(false);
    const r = cashfreePaymentsAvailability(env({ CASHFREE_CLIENT_ID: 'placeholder', CASHFREE_CLIENT_SECRET: 'placeholder' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payments_unconfigured');
  });

  it('TEST-mode keys on the production server → refused, never test money into a live wallet', () => {
    const r = cashfreePaymentsAvailability(env({ NODE_ENV: 'production', CASHFREE_CLIENT_ID: 'TEST123', CASHFREE_CLIENT_SECRET: 'cfsk_ma_test_abc' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('payments_test_mode_in_production');
    expect(cashfreePaymentsAvailability(env({ NODE_ENV: 'production', CASHFREE_ENV: 'sandbox', CASHFREE_CLIENT_ID: 'a', CASHFREE_CLIENT_SECRET: 'b' })).ok).toBe(false);
  });

  it('live keys on production → payments are ON; Cashfree\'s own sandbox stays available to developers', () => {
    const live = cashfreePaymentsAvailability(env({ NODE_ENV: 'production', CASHFREE_CLIENT_ID: 'live_id', CASHFREE_CLIENT_SECRET: 'live_secret' }));
    expect(live.ok && live.mode).toBe('production');
    const dev = cashfreePaymentsAvailability(env({ NODE_ENV: 'development', CASHFREE_CLIENT_ID: 'TEST1', CASHFREE_CLIENT_SECRET: 'cfsk_ma_test_1' }));
    expect(dev.ok && dev.mode).toBe('sandbox');
  });
});

describe('verification credits only what Cashfree itself says was paid', () => {
  beforeEach(() => { store.clear(); axiosGet.mockReset(); });

  it('a "simulator" order (the old sim_ / isSimulator shape) is NOT paid and nothing is written', async () => {
    process.env.CASHFREE_CLIENT_ID = 'live_id'; process.env.CASHFREE_CLIENT_SECRET = 'live_secret'; process.env.CASHFREE_ENV = 'production';
    store.set('payment_transactions/sim_old', { userId: 'u', amountPaid: 100, paymentStatus: 'PENDING', isSimulator: true });
    axiosGet.mockResolvedValue({ data: { order_status: 'ACTIVE', order_amount: 100 } }); // Cashfree has no record of payment
    const r = await verifyPaymentInternal('sim_old');
    expect(r.success).toBe(false);
    expect(axiosGet).toHaveBeenCalledTimes(1); // it asked the real gateway instead of trusting the flag
  });

  it('with no keys at all, nothing is verified and the gateway is never asked', async () => {
    delete process.env.CASHFREE_CLIENT_ID; delete process.env.CASHFREE_CLIENT_SECRET; delete process.env.CASHFREE_APP_ID; delete process.env.CASHFREE_SECRET_KEY;
    store.set('payment_transactions/ord_x', { userId: 'u', amountPaid: 100, paymentStatus: 'PENDING' });
    const r = await verifyPaymentInternal('ord_x');
    expect(r.success).toBe(false);
    expect(axiosGet).not.toHaveBeenCalled();
  });
});

describe('census: the fake payment paths are gone', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) files.push(p); } };
  walk('src');
  const code = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

  it('no simulated checkout, no simulator session, no simulator branch', () => {
    const offenders = files.filter((f) => /isSimulator|sim_session|Simulate PASS|SIMULATION\]/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('store verification never asks Apple\'s sandbox', () => {
    expect(code('src/server/lib/storeVerify.ts')).not.toMatch(/storekit-sandbox/);
  });
});
