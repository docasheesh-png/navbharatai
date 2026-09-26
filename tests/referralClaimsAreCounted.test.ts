import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * "ABHI BHI TOKEN NAHI MIL RAHE" (admin 2026-09-26) — and nothing in the platform could say why.
 *
 * The referral records store only what was PAID, so a user who never tried and a user the device check
 * refused five times left the same trace: nothing. These cases lock the counter that tells them apart,
 * and the one guarantee it must keep above all: counting a claim can never change a claim.
 */

const writes: Array<{ col: string; id: string; op: 'create' | 'set'; data: any }> = [];
const existing = new Set<string>();

vi.mock('../src/server/lib/serverDb', () => ({
  getServerDb: () => ({
    collection: (col: string) => ({
      doc: (id: string) => ({
        create: async (data: any) => {
          const key = `${col}/${id}`;
          if (existing.has(key)) throw new Error('ALREADY_EXISTS');
          existing.add(key);
          writes.push({ col, id, op: 'create', data });
        },
        set: async (data: any) => { writes.push({ col, id, op: 'set', data }); },
      }),
    }),
  }),
}));

import {
  deviceRefusalCategory, recordClaimOutcome, summariseClaimOutcomes, claimHeadline, personMarkerId,
  REFERRAL_CLAIM_OUTCOME_COLLECTION, REFERRAL_CLAIM_PERSON_COLLECTION, type DailyClaimOutcomes,
} from '../src/server/lib/referralClaimOutcomes';
import { RETENTION_POLICIES } from '../src/server/lib/DataRetentionManager';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('every device refusal the integrity check can produce is filed under a real class', () => {
  /** Read out of the real module, so a new refusal sentence cannot quietly land in `other`. */
  const details = (): string[] => {
    const src = codeOnly(read('src/server/lib/deviceIntegrity.ts'));
    const found = [
      ...[...src.matchAll(/nope\('[a-z-]+',\s*[`']([^`']+)[`']/g)].map((m) => m[1]),
      ...[...src.matchAll(/ok: false, detail: [`']([^`']+)[`']/g)].map((m) => m[1]),
    ];
    return [...new Set(found.map((d) => d.replace(/\$\{[^}]*\}/g, 'X')))];
  };

  it('the scan really finds them — an empty scan would pass vacuously', () => {
    expect(details().length).toBeGreaterThanOrEqual(10);
  });

  it('🔒 none of them falls through to "other"', () => {
    const unfiled = details().filter((d) => deviceRefusalCategory(d) === 'other');
    expect(unfiled, `add a category for: ${unfiled.join(' | ')}`).toEqual([]);
  });

  it('the classes that decide the fix are told apart', () => {
    expect(deviceRefusalCategory('app verdict UNRECOGNIZED_VERSION')).toBe('app-not-play-recognized');
    expect(deviceRefusalCategory('device verdict []')).toBe('device-integrity');
    expect(deviceRefusalCategory('play integrity HTTP 400')).toBe('token-rejected-4xx');
    expect(deviceRefusalCategory('play integrity HTTP 503')).toBe('google-5xx');
    expect(deviceRefusalCategory('device check not configured')).toBe('not-configured');
    expect(deviceRefusalCategory('')).toBe('other');
  });
});

describe('recordClaimOutcome', () => {
  beforeEach(() => { writes.length = 0; existing.clear(); });
  const at = Date.parse('2026-09-26T10:00:00Z');

  it('counts a person once per day however many times they claim', async () => {
    await recordClaimOutcome('u1', 'android', 'device-refused', { reason: 'app-not-play-recognized', atMs: at });
    await recordClaimOutcome('u1', 'android', 'device-refused', { reason: 'app-not-play-recognized', atMs: at });
    const people = writes.filter((w) => w.col === REFERRAL_CLAIM_OUTCOME_COLLECTION && w.data.people);
    expect(people).toHaveLength(1);
    const markers = writes.filter((w) => w.col === REFERRAL_CLAIM_PERSON_COLLECTION);
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe(personMarkerId('2026-09-26', 'u1'));
  });

  it('names nobody: the marker id is a digest and the day document holds counts', async () => {
    await recordClaimOutcome('uid-secret-123', 'web', 'paid', { tokens: 20000, atMs: at });
    for (const w of writes) {
      expect(w.id).not.toContain('uid-secret-123');
      expect(JSON.stringify(w.data)).not.toContain('uid-secret-123');
    }
    const day = writes.find((w) => w.col === REFERRAL_CLAIM_OUTCOME_COLLECTION)!;
    expect(day.id).toBe('2026-09-26');
    expect(day.data.paidTokens).toBeDefined();
  });

  it('a reason can never split a Firestore field path', async () => {
    await recordClaimOutcome('u2', 'android', 'nothing-new', { reason: 'a.b c/d', atMs: at });
    const day = writes.find((w) => w.col === REFERRAL_CLAIM_OUTCOME_COLLECTION)!;
    const keys = Object.keys(day.data.reasons.android);
    expect(keys).toEqual(['nothing-new:a-b-c-d']);
  });

  it('never throws when the store is unavailable', async () => {
    await expect(recordClaimOutcome('', 'web', 'error')).resolves.toBe(false);
  });
});

describe('the admin reading', () => {
  const row = (android: Record<string, number>, web: Record<string, number> = {}): DailyClaimOutcomes => ({
    day: '2026-09-26', attempts: { android, web }, people: { android: 3, web: 1 }, reasons: {}, paidTokens: {},
  });

  it('nobody tried ⇒ says so, and says where the claim lives', () => {
    const s = summariseClaimOutcomes([]);
    expect(s.bySurface).toEqual([]);
    expect(s.headline).toMatch(/Nobody has tried/);
  });

  it('every app claim refused by the device check ⇒ the headline says real phones are not being paid', () => {
    const s = summariseClaimOutcomes([row({ 'device-refused': 4, 'device-failed-on-phone': 2 })]);
    expect(s.headline).toMatch(/refusing every one/);
  });

  it('claims being paid ⇒ no alarm', () => {
    expect(claimHeadline(summariseClaimOutcomes([row({ paid: 5 })]).bySurface)).toMatch(/made and paid/);
  });
});

describe('the wiring — every way a claim can end is counted', () => {
  const route = codeOnly(read('src/server/routes/referral.ts'));

  it('the claim route counts the device refusal, the undone step, the result and the error', () => {
    expect(route).toMatch(/recordClaimOutcome\(userId, 'android',\s*device\.verdict === 'unavailable' \? 'device-unavailable' : 'device-refused'/);
    expect(route).toMatch(/recordClaimOutcome\(userId, 'android', 'step-not-done'/);
    expect(route).toMatch(/recordClaimOutcome\(userId, 'android', paid\.granted > 0 \? 'paid' : 'nothing-new'/);
    expect(route).toMatch(/'error'\);\s*return sendSafeError\(res, 500, 'Could not claim that bonus\.'/);
  });

  it('the website claim is counted, and a missing mobile is told apart from nothing-new', () => {
    expect(route).toMatch(/recordClaimOutcome\(userId, 'web',[\s\S]{0,120}'held-no-mobile'/);
  });

  it('🔒 counting is never awaited on the money path', () => {
    const calls = [...route.matchAll(/(\S+)\s+recordClaimOutcome\(/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const c of calls) expect(c).toBe('void');
  });

  it('a claim that never left the phone is reported to its own route, which pays nothing', () => {
    expect(route).toMatch(/app\.post\('\/api\/referral\/:userId\/claim-failed'/);
    const failed = route.slice(route.indexOf("'/api/referral/:userId/claim-failed'"));
    expect(failed.slice(0, failed.indexOf('\n}\n'))).not.toMatch(/runTransaction|mirroredCreditPatch|user_token_wallets/);
    expect(codeOnly(read('src/lib/referralClaim.ts'))).toMatch(/'\/claim-failed'/);
  });

  it('both collections are on a retention timer', () => {
    const byName = new Map(RETENTION_POLICIES.map((p) => [p.collection, p]));
    expect(byName.get(REFERRAL_CLAIM_OUTCOME_COLLECTION)).toMatchObject({ timestampField: 'day', timestampKind: 'iso' });
    expect(byName.get(REFERRAL_CLAIM_PERSON_COLLECTION)).toMatchObject({ timestampField: 'countedAt', timestampKind: 'epochMs' });
  });
});
