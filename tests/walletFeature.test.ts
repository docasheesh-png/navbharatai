import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  WALLET_FEATURES, isWalletFeature, featureLabel, featureRollupRef, spendByFeature,
  TOKENS_PER_RUPEE,
} from '../src/server/lib/walletFeature';
import { foldFeatureCharge, spendDayKey, MAX_TRACKED_USERS } from '../src/server/lib/FeatureSpendStore';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * WHERE THE BALANCE WENT.
 *
 * Admin 2026-09-13, holding a real account with 0 apps built and ₹195 of gifted credit gone:
 * *"kaha khatam hua yeh to dikha hi nahi raha?"* Money left that wallet down one of nine paths and
 * not one of them recorded which. These tests are about the two things that makes true: every debit
 * names its feature, and an untagged rupee is never dressed up as a measured one.
 */

const row = (over: Record<string, unknown> = {}) => ({
  type: 'usage', amountCoinsOrTokens: -100, moneySpent: 0, timestamp: '2026-09-13T00:00:00.000Z', ...over,
});

describe('the vocabulary is closed, and closed on purpose', () => {
  it('every feature has a distinct id and a human label', () => {
    expect(new Set(WALLET_FEATURES.map((f) => f.id)).size).toBe(WALLET_FEATURES.length);
    for (const f of WALLET_FEATURES) expect(f.label.length).toBeGreaterThan(2);
  });

  it('an unknown tag is never shown as a raw id, and never guessed', () => {
    expect(featureLabel('doctor')).toBe('Doctor AI');
    expect(featureLabel('nonsense')).toBe('');
    expect(featureLabel(undefined)).toBe('');
    expect(isWalletFeature('doctor')).toBe(true);
    expect(isWalletFeature('Doctor')).toBe(false);
  });

  it('🔒 no label may name a vendor or a model — the ledger is USER-FACING', () => {
    // White-label law §2: a wallet-history line is a surface a real user reads.
    const forbidden = /claude|anthropic|gemini|vertex|gpt|openai|grok|glm|kimi|moonshot|sonnet|opus|haiku|bedrock|deepseek/i;
    for (const f of WALLET_FEATURES) expect(f.label).not.toMatch(forbidden);
  });

  it('🔴 the token rate is RE-EXPORTED, never restated', () => {
    // My first version declared `= 100` locally "mirroring" the real one — the exact copied-constant
    // drift this repo has already paid for twice. A breakdown on a stale rate would disagree with the
    // balance printed beside it.
    const src = read('src/server/lib/walletFeature.ts');
    expect(src).toContain("export { TOKENS_PER_RUPEE } from './payments'");
    expect(src).not.toMatch(/export const TOKENS_PER_RUPEE\s*=/);
    expect(TOKENS_PER_RUPEE).toBeGreaterThan(0);
  });
});

describe('the rollup key carries the feature — which is what restores attribution', () => {
  it('one bucket per feature per day', () => {
    const t = Date.parse('2026-09-13T11:00:00.000Z');
    expect(featureRollupRef('doctor', t)).toBe('ai_2026-09-13_doctor');
    expect(featureRollupRef('tools', t)).toBe('ai_2026-09-13_tools');
    // Different features must NOT share a bucket — that sharing is the original bug.
    expect(featureRollupRef('doctor', t)).not.toBe(featureRollupRef('tools', t));
  });

  it('the same feature on the same day is the same bucket, so the ledger cannot grow per turn', () => {
    const a = featureRollupRef('doctor', Date.parse('2026-09-13T01:00:00.000Z'));
    const b = featureRollupRef('doctor', Date.parse('2026-09-13T23:00:00.000Z'));
    expect(a).toBe(b);
  });
});

describe('spendByFeature — the number on the admin\'s screen', () => {
  it('adds up what each feature took, biggest first', () => {
    const out = spendByFeature([
      row({ feature: 'doctor', amountCoinsOrTokens: -500 }),
      row({ feature: 'tools', amountCoinsOrTokens: -1500 }),
      row({ feature: 'doctor', amountCoinsOrTokens: -200 }),
    ]);
    expect(out.rows.map((r) => r.feature)).toEqual(['tools', 'doctor']);
    expect(out.rows[0]).toMatchObject({ inr: 15, tokens: 1500, entries: 1, label: 'AI tools' });
    expect(out.rows[1]).toMatchObject({ inr: 7, tokens: 700, entries: 2 });
    expect(out.totalInr).toBe(22);
  });

  it('🔴 reads the TOKEN column, not moneySpent', () => {
    // A usage row carries `moneySpent: 0` — that field means money PAID IN. A reader that trusted it
    // would report every user as having spent nothing, which is exactly what the old screen did.
    const out = spendByFeature([row({ feature: 'build', amountCoinsOrTokens: -1000, moneySpent: 0 })]);
    expect(out.rows[0].inr).toBe(10);
  });

  it('a CREDIT is not spending', () => {
    const out = spendByFeature([
      row({ type: 'purchase', amountCoinsOrTokens: 25000, feature: undefined }),
      row({ feature: 'build', amountCoinsOrTokens: -300 }),
    ]);
    expect(out.totalInr).toBe(3);
    expect(out.unattributedInr).toBe(0);
  });

  it('🔒 untagged spend is reported SEPARATELY, never filed under a real feature', () => {
    // Every row written before this vocabulary existed has no tag. Putting those rupees under a
    // feature name would be an invented number on the very screen built to stop inventing them.
    const out = spendByFeature([row({ amountCoinsOrTokens: -19506 }), row({ feature: 'doctor', amountCoinsOrTokens: -100 })]);
    expect(out.unattributedInr).toBe(195.06);
    expect(out.unattributedEntries).toBe(1);
    expect(out.rows.map((r) => r.feature)).toEqual(['doctor']);
    // …and it is still part of the total, or the total would understate the real drain.
    expect(out.totalInr).toBe(196.06);
  });

  it('garbage rows are skipped, never counted and never fatal', () => {
    const out = spendByFeature([null as never, 'nope' as never, row({ amountCoinsOrTokens: 'x' }), row({ amountCoinsOrTokens: -0 })]);
    expect(out).toMatchObject({ rows: [], totalInr: 0, unattributedInr: 0 });
    expect(() => spendByFeature(null)).not.toThrow();
    expect(() => spendByFeature(undefined)).not.toThrow();
  });
});

describe('the platform counter counts PEOPLE, not just rupees', () => {
  it('a repeat charge from one user is one user', () => {
    let doc: any = null;
    doc = foldFeatureCharge(doc, { inr: 2, userId: 'u1' });
    doc = foldFeatureCharge(doc, { inr: 3, userId: 'u1' });
    expect(doc).toMatchObject({ inr: 5, charges: 2, usersExact: true });
    expect(doc.userIds).toEqual(['u1']);
  });

  it('⚠️ distinct users is the signal the admin is deciding on', () => {
    // One heavy user and broad adoption produce the same rupees and mean opposite things.
    let doc: any = null;
    for (const u of ['a', 'b', 'c']) doc = foldFeatureCharge(doc, { inr: 1, userId: u });
    expect(doc.userIds).toHaveLength(3);
  });

  it('past the cap the count keeps rising but SAYS it is no longer exact', () => {
    let doc: any = null;
    for (let i = 0; i < MAX_TRACKED_USERS + 5; i += 1) doc = foldFeatureCharge(doc, { inr: 0.01, userId: `u${i}` });
    expect(doc.userIds).toHaveLength(MAX_TRACKED_USERS);
    expect(doc.usersOverflow).toBe(5);
    expect(doc.usersExact).toBe(false);
  });

  it('a zero or negative charge adds no rupees', () => {
    const doc = foldFeatureCharge(null, { inr: -5, userId: 'u1' });
    expect(doc.inr).toBe(0);
    expect(doc.charges).toBe(1);
  });

  it('the day key comes from the server clock', () => {
    expect(spendDayKey(Date.parse('2026-09-13T22:30:00.000Z'))).toBe('2026-09-13');
  });
});

describe('🔒 every path that takes money now names itself', () => {
  const walletDebit = read('src/server/lib/walletDebit.ts');

  it('both ledger row builders write the feature', () => {
    expect(walletDebit.split('...(tx.feature ? { feature: tx.feature } : {})').length - 1).toBe(2);
  });

  it('each of the nine spending paths passes one', () => {
    const expected: Array<[string, string]> = [
      ['src/server/routes/agentv3.ts', "feature: 'build'"],
      ['src/server/routes/mobileShip.ts', "feature: 'mobile-build'"],
      ['src/server/lib/navStoreRemixPurchase.ts', "feature: 'remix'"],
      ['src/server/lib/hostingPlan.ts', "feature: 'hosting-plan'"],
      ['src/server/AgentV3/hostingBillingSweep.ts', "feature: 'hosting'"],
      ['src/server/sonic/sonicWs.ts', "feature: 'voice'"],
      ['src/server/routes/sda.ts', "feature: 'doctor'"],
      ['src/server/routes/professionals.ts', "feature: 'professionals'"],
      ['src/server/routes/appAi.ts', "feature: 'app-assistant'"],
      ['src/server/tools/toolGate.ts', "feature: 'tools'"],
    ];
    for (const [file, tag] of expected) {
      expect(read(file), `${file} must tag its wallet charge`).toContain(tag);
    }
  });

  it('the four assistant surfaces no longer share one bucket', () => {
    const charge = read('src/server/lib/aiTurnCharge.ts');
    expect(charge).toContain('featureRollupRef(feature, nowMs)');
    // The old shared label may remain only as the fallback for a caller that named nothing.
    expect(charge).not.toContain('rollupRef: aiSpendRollupRef(nowMs)');
  });

  it('⚠️ the platform counter is written at the ONE choke point, not per call site', () => {
    // A counter wired call-by-call is one a tenth caller silently never joins — which is how the
    // attribution drifted away in the first place.
    expect(walletDebit).toContain('function recordFeatureSpend');
    expect(walletDebit.split('recordFeatureSpend(tx, userId)').length - 1).toBe(2);
  });

  it('the admin route stops discarding the ledger it already had', () => {
    const routes = read('src/server/routes/reports.ts');
    expect(routes).toContain('spendByFeature(');
    expect(routes).toContain("app.get('/api/admin/feature-spend'");
  });

  it('the admin screen shows the breakdown, and distinguishes untagged history', () => {
    const admin = read('src/components/AdminDashboard.tsx');
    expect(admin).toContain('Where the balance went');
    expect(admin).toContain('Before this was recorded');
    expect(admin).toContain('What people used today');
  });
});
