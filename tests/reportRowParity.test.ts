import { describe, it, expect } from 'vitest';
import {
  submittedRowFacts, allBuildRowFacts, formatCharge, formatOutcome, formatWhen,
  formatDuration, personLabel, factsToText,
} from '../src/lib/reportRowFacts';
import {
  rowMatches, statusCountsFor, matchesStatus, matchesDate, matchesQuery,
  hasActiveFilters, sinceMsFor, EMPTY_FILTERS, type ListFilterState,
} from '../src/lib/reportListFilter';
import { applyReportMark, reportStatus } from '../src/server/AgentV3/reportTriage';

/**
 * ADMIN 2026-09-14 — two build-report lists that had grown apart.
 *
 * "dono build report ko ek jaisa bana do… sender, email, time, user, charge status etc — yeh dono me
 *  ek extra button bana do information, usme yeh sab dal do. bahar ka UI ek dam clean aur clear ho."
 * "filter bhi all build report wala chahiye dono me!!"
 *
 * The page capture that prompted it recorded the measurable half: on a 393 px phone the inbox's
 * nine-column table ran 513 px past the right edge.
 */

const NOW = Date.parse('2026-09-14T12:00:00Z');

describe('PARITY: the two lists show the same facts, in the same order, under the same labels', () => {
  const submitted = {
    name: 'Lok Up', email: 'lokup528@gmail.com', userId: 'uid-1', reportedAt: NOW - 3600_000,
    userTier: 'free', tier: 'free', accountTier: 'free', billedInr: 12.5, billedUsd: 0.14, ok: false, buildMs: 900_000,
    workspaceId: 'agentv3-abc-1',
  };
  const allBuild = {
    workspaceId: 'agentv3-abc-1', ownerUid: 'uid-1',
    owner: { label: 'Lok Up', email: 'lokup528@gmail.com', name: 'Lok Up', anonymous: false },
    savedAt: NOW - 3600_000, startedAt: NOW - 4500_000, endedAt: NOW - 3600_000,
    ok: false, userTier: 'free', tier: 'free', billedInr: 12.5, billedUsd: 0.14, zeroBillReason: null,
  };

  it('the label set is IDENTICAL apart from the one word that is genuinely different', () => {
    const a = submittedRowFacts(submitted, NOW).map((f) => f.label);
    const b = allBuildRowFacts(allBuild, NOW).map((f) => f.label);
    // "Reported" (a person pressed Report) vs "Built" (the build simply ran). Naming them the same
    // would claim somebody reported a row nobody reported.
    expect(a.filter((l) => l !== 'Reported')).toEqual(b.filter((l) => l !== 'Built'));
    expect(a).toContain('Reported');
    expect(b).toContain('Built');
  });

  it('every field the admin listed is present in BOTH', () => {
    for (const facts of [submittedRowFacts(submitted, NOW), allBuildRowFacts(allBuild, NOW)]) {
      const text = factsToText(facts);
      expect(text).toMatch(/Sender: Lok Up/);
      expect(text).toMatch(/Email: lokup528@gmail\.com/);
      // TWO facts now, not one (admin 2026-09-14): "User" is the ACCOUNT — has this person ever paid
      // us — and "This build" is how that one build was routed. Collapsing them made a ₹500 customer
      // who picked the Weak engine read as Free.
      expect(text).toMatch(/User: (Paid|Free|Admin \/ tester|Unknown)/);
      expect(text).toMatch(/This build: free/);
      expect(text).toMatch(/Charged: ₹12\.50/);
      expect(text).toMatch(/Status: Failed/);
      expect(text).toMatch(/Build time:/);
    }
  });
});

describe('an unknown is never a zero', () => {
  it('no billing recorded reads as "not recorded", never ₹0', () => {
    const f = formatCharge(null, null, null);
    expect(f.value).toBe('not recorded');
    expect(f.value).not.toMatch(/₹0/);
    expect(f.hint).toMatch(/not the same as a ₹0 charge/i);
  });

  it('a real ₹0 says WHY it was zero', () => {
    const f = formatCharge(0, 0, 'build did not succeed — "working app or free", so no charge');
    expect(f.value).toBe('₹0');
    expect(f.hint).toMatch(/working app or free/);
  });

  it('a missing time is "not recorded"', () => {
    expect(formatWhen(null)).toBe('not recorded');
    expect(formatWhen(0)).toBe('not recorded');
    expect(formatDuration(undefined)).toBe('not recorded');
  });

  it('no outcome is NOT reported as a failure', () => {
    expect(formatOutcome(undefined, false).value).toBe('No outcome recorded');
    expect(formatOutcome(undefined, false).tone).toBe('muted');
    expect(formatOutcome(undefined, true).value).toBe('Still running');
    expect(formatOutcome(false).value).toBe('Failed');
    expect(formatOutcome(true).value).toBe('Success');
  });

  it('a person with no name falls back through email, then id — never to a blank', () => {
    expect(personLabel('Asha', 'a@b.c', 'uid')).toBe('Asha');
    expect(personLabel(null, 'a@b.c', 'uid')).toBe('a@b.c');
    expect(personLabel(null, null, 'uid12345678')).toBe('id uid12345…');
    expect(personLabel(null, null, null)).toBe('Signed-out user');
  });

  it('survives junk without throwing', () => {
    expect(() => submittedRowFacts({} as never, NOW)).not.toThrow();
    expect(() => allBuildRowFacts({} as never, NOW)).not.toThrow();
    expect(() => factsToText(null as never)).not.toThrow();
  });
});

describe('the shared filter means the same thing on both lists', () => {
  const rows = [
    { ok: true, at: NOW - 1000, uid: 'u1', search: ['alpha app', 'a@x.com'] },
    { ok: false, at: NOW - 2 * 24 * 3600_000, uid: 'u2', search: ['beta app', 'b@x.com'] },
    { ok: null, at: NOW - 20 * 24 * 3600_000, uid: 'u1', search: ['gamma app', 'c@x.com'] },
    { ok: false, at: null, uid: 'u3', search: ['undated app'] },
  ];
  const f = (o: Partial<ListFilterState> = {}): ListFilterState => ({ ...EMPTY_FILTERS, ...o });

  it('status: unknown is its OWN bucket and is never counted as failed', () => {
    expect(matchesStatus(null, 'unknown')).toBe(true);
    expect(matchesStatus(null, 'failed')).toBe(false);
    expect(matchesStatus(undefined, 'failed')).toBe(false);
    const counts = statusCountsFor(rows, f(), NOW);
    expect(counts).toEqual({ all: 4, failed: 2, succeeded: 1, unknown: 1 });
  });

  it('date narrows, and an UNDATED row is never claimed to be recent', () => {
    expect(matchesDate(null, 'today', NOW)).toBe(false);
    expect(matchesDate(null, 'all', NOW)).toBe(true);
    expect(rows.filter((r) => rowMatches(r, f({ date: 'today' }), NOW)).length).toBe(1);
    expect(rows.filter((r) => rowMatches(r, f({ date: '7d' }), NOW)).length).toBe(2);
    expect(rows.filter((r) => rowMatches(r, f({ date: '30d' }), NOW)).length).toBe(3);
  });

  it('search looks through every field it is given, case-insensitively', () => {
    expect(matchesQuery(['Alpha App', null], 'alpha')).toBe(true);
    expect(matchesQuery(['Alpha App'], 'ALPHA')).toBe(true);
    expect(matchesQuery([null, undefined], 'x')).toBe(false);
    expect(matchesQuery(['anything'], '   ')).toBe(true);
  });

  it('user narrows to one account', () => {
    expect(rows.filter((r) => rowMatches(r, f({ uid: 'u1' }), NOW)).length).toBe(2);
  });

  it('the chip counts reflect the OTHER filters, so a chip never describes a set nobody is viewing', () => {
    expect(statusCountsFor(rows, f({ uid: 'u1' }), NOW)).toEqual({ all: 2, failed: 0, succeeded: 1, unknown: 1 });
  });

  it('Clear shows only when something is narrowing', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(f({ query: '  ' }))).toBe(false);
    expect(hasActiveFilters(f({ query: 'x' }))).toBe(true);
    expect(hasActiveFilters(f({ date: '7d' }))).toBe(true);
    expect(hasActiveFilters(null)).toBe(false);
  });

  it('sinceMsFor is the one definition of each window', () => {
    expect(sinceMsFor('all', NOW)).toBeNull();
    expect(sinceMsFor('today', NOW)).toBe(NOW - 86_400_000);
    expect(sinceMsFor('30d', NOW)).toBe(NOW - 30 * 86_400_000);
  });
});

/**
 * THE INCIDENT: "abhi ek hi report 2 agent ko send kar di! dono ne fix ki, aur dono ki PR apas me
 * 2 hr tak conflict kari rahi!!" — build 1ef27cd7 reached two sessions (PRs #2929 and #2931).
 */
describe('the taken-mark, and the trap in making it reversible', () => {
  it('taking a row marks it, and re-taking never rewrites the first time', () => {
    const first = applyReportMark(null, { downloaded: true }, 1000);
    expect(first.downloadedAt).toBe(1000);
    expect(reportStatus(first)).toBe('sent');
    const again = applyReportMark(first, { downloaded: true }, 5000);
    expect(again.downloadedAt).toBe(1000);
  });

  it('a mis-tap can be undone — a mark that cannot be cleared HIDES a report that still needs work', () => {
    const taken = applyReportMark(null, { downloaded: true }, 1000);
    const cleared = applyReportMark(taken, { downloaded: false }, 2000);
    expect(cleared.downloadedAt).toBeNull();
    expect(reportStatus(cleared)).toBe('new');
  });

  it('🔴 THE TRAP: an ABSENT downloaded must not clear the mark', () => {
    // `body.downloaded === true` turns an absent field into `false`. With `false` now clearing the
    // mark, every "Mark fixed" call would have erased the download it implies.
    const taken = applyReportMark(null, { downloaded: true }, 1000);
    const fixed = applyReportMark(taken, { fixed: true }, 2000);
    expect(fixed.downloadedAt).toBe(1000);
    expect(reportStatus(fixed)).toBe('fixed');
  });

  it('clearing the taken-mark clears FIXED with it — a tick cannot outlive its own premise', () => {
    const fixed = applyReportMark(null, { fixed: true, note: 'PR #2928' }, 1000);
    expect(fixed.fixedNote).toBe('PR #2928');
    const cleared = applyReportMark(fixed, { downloaded: false }, 2000);
    expect(cleared.fixedAt).toBeNull();
    expect(cleared.fixedNote).toBeNull();
    expect(reportStatus(cleared)).toBe('new');
  });

  it('marking fixed still implies it was seen', () => {
    const fixed = applyReportMark(null, { fixed: true }, 1000);
    expect(fixed.downloadedAt).toBe(1000);
  });
});
