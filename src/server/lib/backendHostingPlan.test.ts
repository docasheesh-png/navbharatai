import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeBackendPlanPurchase, computeBackendLazyRenewal, backendPlanActive, backendPlanServes,
  backendPlanPriceInr, BACKEND_PLAN_DAYS, BACKEND_PLAN_GRACE_DAYS,
} from './backendHostingPlan';
import { inrToDebitTokens } from './payments';

const DAY = 24 * 60 * 60 * 1000;
const NOW = '2026-08-13T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

let savedFlag: string | undefined;
let savedPrice: string | undefined;
beforeEach(() => {
  savedFlag = process.env.AGENTV3_MANAGED_BACKEND;
  savedPrice = process.env.BACKEND_HOSTING_PLAN_PRICE_INR;
  process.env.AGENTV3_MANAGED_BACKEND = 'on';
  delete process.env.BACKEND_HOSTING_PLAN_PRICE_INR;
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env.AGENTV3_MANAGED_BACKEND; else process.env.AGENTV3_MANAGED_BACKEND = savedFlag;
  if (savedPrice === undefined) delete process.env.BACKEND_HOSTING_PLAN_PRICE_INR; else process.env.BACKEND_HOSTING_PLAN_PRICE_INR = savedPrice;
});

const richWallet = () => ({ tokenBalance: 1_000_000, walletLedger: [] as any[] });

describe('computeBackendPlanPurchase', () => {
  it('is disabled when the feature flag is off', () => {
    process.env.AGENTV3_MANAGED_BACKEND = 'off';
    expect(computeBackendPlanPurchase(richWallet(), NOW)).toEqual({ ok: false, reason: 'disabled' });
  });

  it('refuses an underfunded wallet, naming the shortfall — no overdraft for a plan', () => {
    const r = computeBackendPlanPurchase({ tokenBalance: 0 }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('insufficient');
      expect(r.shortfallTokens).toBeGreaterThan(0);
    }
  });

  it('debits the wallet and grants 30 days from now on a fresh purchase', () => {
    const r = computeBackendPlanPurchase(richWallet(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.charged).toBe(true);
      expect(r.plan.expiresAt).toBe(new Date(NOW_MS + BACKEND_PLAN_DAYS * DAY).toISOString());
      const debited = 1_000_000 - r.wallet.tokenBalance;
      expect(debited).toBe(Math.floor(inrToDebitTokens(backendPlanPriceInr())));
    }
  });

  it('EXTENDS an active plan from its current expiry — paying early never loses days', () => {
    const first = computeBackendPlanPurchase(richWallet(), NOW);
    if (!first.ok) throw new Error('setup');
    const second = computeBackendPlanPurchase(first.wallet, new Date(NOW_MS + 5 * DAY).toISOString());
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.plan.expiresAt).toBe(new Date(NOW_MS + 2 * BACKEND_PLAN_DAYS * DAY).toISOString());
    }
  });

  it('replaying the same period is idempotent: same expiry, nothing charged twice', () => {
    const first = computeBackendPlanPurchase(richWallet(), NOW);
    if (!first.ok) throw new Error('setup');
    // Simulate the plan record surviving but the SAME period being purchased again (double-tap):
    // strip the plan grant, keep the ledger — the buildRef dedupe must catch it.
    const replayWallet = { ...first.wallet };
    const replay = computeBackendPlanPurchase({ ...replayWallet, backendHostingPlan: undefined }, NOW);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.charged).toBe(false);
      expect(replay.wallet.tokenBalance).toBe(first.wallet.tokenBalance);
      expect(replay.plan.expiresAt).toBe(first.plan.expiresAt);
    }
  });
});

describe('computeBackendLazyRenewal', () => {
  const walletWithPlan = (expiresAt: string, autoRenew = true) => ({
    tokenBalance: 1_000_000,
    walletLedger: [] as any[],
    backendHostingPlan: { id: 'managed_backend', purchasedAt: NOW, expiresAt, autoRenew },
  });

  it('does nothing while the plan is still active', () => {
    const r = computeBackendLazyRenewal(walletWithPlan(new Date(NOW_MS + DAY).toISOString()), NOW);
    expect(r.renewed).toBe(false);
    expect(r.applied).toBe(false);
  });

  it('renews an expired auto-renew plan for 30 days from NOW — never back-dated', () => {
    const r = computeBackendLazyRenewal(walletWithPlan(new Date(NOW_MS - 2 * DAY).toISOString()), NOW);
    expect(r.renewed).toBe(true);
    expect((r.wallet.backendHostingPlan as any).expiresAt).toBe(new Date(NOW_MS + BACKEND_PLAN_DAYS * DAY).toISOString());
  });

  it('leaves the plan honestly expired when autoRenew is off or the balance is short', () => {
    const off = computeBackendLazyRenewal(walletWithPlan(new Date(NOW_MS - DAY).toISOString(), false), NOW);
    expect(off.renewed).toBe(false);
    const broke = computeBackendLazyRenewal(
      { ...walletWithPlan(new Date(NOW_MS - DAY).toISOString()), tokenBalance: 0 }, NOW,
    );
    expect(broke.renewed).toBe(false);
  });
});

describe('active vs serving (grace window)', () => {
  const wallet = (expiresAt: string) => ({
    backendHostingPlan: { id: 'managed_backend', purchasedAt: NOW, expiresAt, autoRenew: true },
  });

  it('active plans are active AND serving; expired-in-grace serves but is not active', () => {
    const active = wallet(new Date(NOW_MS + DAY).toISOString());
    expect(backendPlanActive(active, NOW_MS)).toBe(true);
    expect(backendPlanServes(active, NOW_MS)).toBe(true);

    const inGrace = wallet(new Date(NOW_MS - (BACKEND_PLAN_GRACE_DAYS * DAY - 1)).toISOString());
    expect(backendPlanActive(inGrace, NOW_MS)).toBe(false);
    expect(backendPlanServes(inGrace, NOW_MS)).toBe(true);

    const lapsed = wallet(new Date(NOW_MS - (BACKEND_PLAN_GRACE_DAYS + 1) * DAY).toISOString());
    expect(backendPlanServes(lapsed, NOW_MS)).toBe(false);
  });

  it('no plan / wrong plan id = neither active nor serving', () => {
    expect(backendPlanActive({}, NOW_MS)).toBe(false);
    expect(backendPlanServes({ backendHostingPlan: { id: 'other', expiresAt: NOW } }, NOW_MS)).toBe(false);
  });
});
