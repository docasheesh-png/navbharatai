/**
 * Q-767 — A STORE PUT ON A CLOCK MUST BE VISIBLE TO THE ONE SCREEN THAT WATCHES STORAGE.
 *
 * 🔴 WHAT THIS LOCKS, AND WHY IT IS NOT HOUSEKEEPING. Eleven collections grew with nothing deleting
 * them, and that was not eleven separate oversights — it was one blind spot. The Load board's storage
 * warning is `collectionsNeedingRetention(GROWING_COLLECTIONS)`, and `GROWING_COLLECTIONS` is a
 * hand-typed array in `routes/admin.ts` carrying the comment "verified by reading each store on
 * 2026-09-07". A hand-typed inventory cannot warn about the store nobody typed into it, so every one of
 * those eleven was invisible to the only number that asks the question — from the day it shipped.
 *
 * That is also exactly how `site_analytics` published *"these counts … are kept for 30 days"* while
 * nothing on earth deleted them: the promise was in the policy, the mechanism was nowhere, and the board
 * that would have noticed had never heard of the collection.
 *
 * 🔒 THE INVARIANT. A collection with a `RETENTION_POLICIES` entry GROWS — that is why somebody gave it
 * a clock. So the policy list is a lower bound on the inventory, mechanically, and the two lists can
 * never drift apart again without CI saying so. This is the 50/50 law's other half for Q-767: the first
 * half gave eleven stores a window, this half removes the condition that let them be forgotten.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  RETENTION_POLICIES, RETAINED_INDEFINITELY, USER_SCOPED_COLLECTIONS,
  collectionsNeedingRetention, isRetainedIndefinitely,
} from '../src/server/lib/DataRetentionManager';

/** The inventory as the admin route really declares it — read from source, never re-typed here. */
function growingInventory(): string[] {
  const src = readFileSync(resolve(__dirname, '../src/server/routes/admin.ts'), 'utf8');
  const start = src.indexOf('const GROWING_COLLECTIONS');
  expect(start, 'GROWING_COLLECTIONS has been renamed — this guard must follow it').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('];', start));
  return [...body.matchAll(/'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);
}

describe('Q-767 — the Load board can see every store that is on a clock', () => {
  it('🔒 every collection with a retention policy appears in GROWING_COLLECTIONS', () => {
    const inventory = new Set(growingInventory());
    const missing = RETENTION_POLICIES.map((p) => p.collection).filter((c) => !inventory.has(c));
    expect(
      missing,
      'these collections are purged on a clock — so they GROW — but the Load board has never heard of '
      + 'them. A hand-kept inventory is how eleven stores stayed invisible (Q-767):\n' + missing.join('\n'),
    ).toEqual([]);
  });

  it('🔒 and so does every collection we deliberately keep for ever', () => {
    // The other half of the same question. A store kept for ever is the one the board most needs to
    // show, because nothing will ever shrink it — `workspace_files_v3` is the user's source code.
    const inventory = new Set(growingInventory());
    const missing = RETAINED_INDEFINITELY.map((r) => r.collection).filter((c) => !inventory.has(c));
    expect(missing, `kept for ever but absent from the storage inventory: ${missing.join(', ')}`).toEqual([]);
  });

  it('the inventory names only real, classified collections — not a typo nothing writes', () => {
    const known = new Set([
      ...RETENTION_POLICIES.map((p) => p.collection),
      ...RETAINED_INDEFINITELY.map((r) => r.collection),
      ...USER_SCOPED_COLLECTIONS.map((c) => c.collection),
    ]);
    const unknown = growingInventory().filter((c) => !known.has(c));
    expect(unknown, `in GROWING_COLLECTIONS but in no registry — a warning nobody can clear: ${unknown.join(', ')}`)
      .toEqual([]);
  });

  it('so the board now reports ZERO undecided stores, and would report any new one', () => {
    // The number the screen actually shows. It must be 0 — every growing store is now decided — and the
    // check is written so that a NEW collection added to the inventory without a decision makes it 1.
    expect(collectionsNeedingRetention(growingInventory())).toEqual([]);
    expect(collectionsNeedingRetention([...growingInventory(), 'some_new_store_v9'])).toEqual(['some_new_store_v9']);
  });
});

describe('Q-767 — the windows are the ones the Privacy Policy publishes, not numbers we picked', () => {
  const POLICY = readFileSync(resolve(__dirname, '../src/content/legal/privacyPolicy.ts'), 'utf8');
  const policyFor = (c: string) => RETENTION_POLICIES.find((p) => p.collection === c);

  it("🔴 guest_daily_usage: the policy says the count is 'deleted after a few days' — now something does", () => {
    // The second published promise with no mechanism, after site_analytics. The module even wrote an
    // `expireAt` field for a Firestore TTL policy that was never configured ("harmless without one").
    expect(POLICY).toMatch(/that count is deleted after a few days/);
    const p = policyFor('guest_daily_usage');
    expect(p, 'nothing deletes the signed-out visitor counters').toBeDefined();
    expect(p!.ttlDays).toBe(3);
    // 'a few days' must stay a few: a window that crept to a month would make the sentence false again.
    expect(p!.ttlDays).toBeLessThanOrEqual(7);
    // `day` is the doc id AND a field, 'YYYY-MM-DD', which sorts lexicographically ⇒ iso.
    expect(p!.timestampField).toBe('day');
    expect(p!.timestampKind).toBe('iso');
  });

  it("🔴 and the field it deletes by is one the writer really sets, on every document", () => {
    // The TimestampKind defect in miniature: a bound of the wrong TYPE matches nothing, silently, for
    // ever. So the field name is read out of the writer rather than trusted.
    const writer = readFileSync(resolve(__dirname, '../src/server/lib/guestDailyQuota.ts'), 'utf8');
    expect(writer).toMatch(/tx\.set\(ipRef, \{ count: ipUsed \+ 1, day, expireAt \}/);
    expect(writer).toMatch(/tx\.set\(devRef, \{ count: \(deviceUsed \?\? 0\) \+ 1, day, expireAt \}/);
  });

  it('the build reports keep the 180 days the policy publishes for them', () => {
    expect(POLICY).toMatch(/reports of your past builds[\s\S]{0,160}180 days/);
    for (const c of ['admin_build_reports', 'admin_apk_reports', 'admin_build_triage']) {
      expect(policyFor(c)?.ttlDays, `${c} must keep the published build-report window`).toBe(180);
    }
  });

  it('admin_build_reports purges by the field every WRITE sets, not the one the list sorts by', () => {
    // `meta.reportedAt` is what the admin list orders by and was the tempting choice. Only `saveReport`
    // creates a document, and it always writes a top-level `savedAt`; a field that is merely usually
    // present is how a purge quietly stops deleting.
    const store = readFileSync(resolve(__dirname, '../src/server/AgentV3/AdminBuildReportStore.ts'), 'utf8');
    expect(store).toMatch(/savedAt: Date\.now\(\)/);
    expect(policyFor('admin_build_reports')?.timestampField).toBe('savedAt');
    expect(policyFor('admin_build_reports')?.timestampKind).toBe('epochMs');
  });

  it('build_events keeps the technical-log ceiling the policy publishes (90 days)', () => {
    expect(POLICY).toMatch(/technical logs are retained for up to \*\*90 days\*\*/);
    expect(policyFor('build_events')?.ttlDays).toBe(90);
    expect(policyFor('build_events')?.timestampKind).toBe('epochMs');
  });

  it('the abuse ledger keeps the safety window, and keeps it as an ISO string', () => {
    // Privacy §9 publishes the pair: safety records kept 180 days AND surviving account deletion.
    expect(POLICY).toMatch(/kept for \*\*180 days\*\*/);
    const p = policyFor('abuseLedger');
    expect(p?.ttlDays).toBe(180);
    // `updatedAt: nowIso` — the one policy in this batch whose kind is iso by write path. A `date` bound
    // against a string field matches nothing in Firestore, with no error.
    expect(p?.timestampKind).toBe('iso');
    const writer = readFileSync(resolve(__dirname, '../src/server/AgentV3/AbuseDetector.ts'), 'utf8');
    expect(writer).toMatch(/updatedAt: nowIso/);
  });

  it('🔒 and the abuse ledger is NOT erased by closing the account', () => {
    // The sharper half of the safety precedent, stated by the policy itself: a record of abuse that the
    // abuser can erase by deleting their account is not a record.
    expect(USER_SCOPED_COLLECTIONS.some((c) => c.collection === 'abuseLedger')).toBe(false);
    expect(POLICY).toMatch(/They survive account deletion for that period/);
  });

  it('the analytics pair splits the way site_analytics does: counts kept long, rows kept short', () => {
    // The day rollup holds counts and no person, so it is kept for the trend. The raw stream names a
    // person, so it gets the shorter window — and the shorter one is not an accident, it is the point.
    expect(policyFor('analytics_daily')?.ttlDays).toBe(400);
    expect(policyFor('analytics_events')?.ttlDays).toBe(30);
    expect(policyFor('analytics_events')!.ttlDays).toBeLessThan(policyFor('analytics_daily')!.ttlDays);
  });

  it('…and nothing the funnel can ASK for is inside the window it deletes', () => {
    // getFunnel caps its own query at 365 days, so 400 cannot delete a number anybody is shown. If that
    // cap were ever raised past the window, this fails instead of the screen quietly losing days.
    const pipeline = readFileSync(resolve(__dirname, '../src/server/lib/AnalyticsPipeline.ts'), 'utf8');
    const cap = /Math\.min\(365, days\)/.test(pipeline) ? 365 : NaN;
    expect(cap, 'the funnel query cap has moved — re-check it against the 400-day window').toBe(365);
    expect(policyFor('analytics_daily')!.ttlDays).toBeGreaterThan(cap);
  });

  it('🔒 the number the deletion page tells the user is the number the registry enforces', () => {
    // The page now says these rows "are deleted after 30 days anyway". That is a NEW promise to a user,
    // and the repo's rule for a published number is that it is tied to the code enforcing it — the way
    // site_analytics' "kept for 30 days" is. Changing either alone fails here.
    const page = readFileSync(resolve(__dirname, '../src/content/legal/accountDeletion.ts'), 'utf8');
    const promised = page.match(/record of which screens and actions you used[\s\S]{0,220}?deleted after (\d+) days/);
    expect(promised, 'the page must state the window it claims for these rows').not.toBeNull();
    expect(Number(promised![1])).toBe(policyFor('analytics_events')!.ttlDays);
  });

  it('🔒 the raw analytics rows die with the account as well as with the clock', () => {
    const entry = USER_SCOPED_COLLECTIONS.find((c) => c.collection === 'analytics_events');
    expect(entry, 'per-event rows carry a real uid and must be erased with the account').toBeDefined();
    expect(entry!.key).toEqual({ field: 'userId' });
  });

  it('the hosting money stores are kept for ever, and are NOT erased with the account', () => {
    // A billing record a timer deletes cannot be reconciled; one that closing the account deletes cannot
    // be disputed by either side. And `hosting_billing`'s document IS the double-charge guard.
    for (const c of ['hosting_billing', 'hosting_period_usage']) {
      expect(isRetainedIndefinitely(c), `${c} must be kept deliberately, not on a clock`).toBe(true);
      expect(policyFor(c), `${c} must have no TTL — the document is a billing proof`).toBeUndefined();
      expect(USER_SCOPED_COLLECTIONS.some((u) => u.collection === c)).toBe(false);
    }
  });

  it('🔴 and the reason records the guard, because that is what a timer would have broken', () => {
    // `create`, never `set`: the document existing is the proof the wallet was already debited for that
    // (owner, day). Delete it on a timer and a later run charges the same day again.
    const reason = RETAINED_INDEFINITELY.find((r) => r.collection === 'hosting_billing')!.reason;
    expect(reason).toMatch(/create/);
    expect(reason).toMatch(/twice/);
    const store = readFileSync(resolve(__dirname, '../src/server/AgentV3/HostingBillingStore.ts'), 'utf8');
    expect(store).toMatch(/\.create\(\{/);
  });
});
