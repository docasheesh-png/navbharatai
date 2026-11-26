// "IS LIST ME APP AA RAHI HAI, BE TARTEEB HAI, SORT KARNE KA SYSTEM BANAO — OLD NEW, FREE FAILED, FAIL PASS" (admin
// 2026-11-26, Apps → Built apps).
//
// The list only ever came newest-first, with no way to see the oldest, only the failed builds, or only paid users'
// apps. Locked here: the order and filters the admin can pick, that a filtered page is found by a BOUNDED scan that
// resumes exactly where it stopped looking (never skipping an app it did not examine), and that an unknown result or an
// unknown account is never counted as "failed" or "free".
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppsView, rowMatchesView, takeMatches, viewFilters, SCAN_BATCH, SCAN_BATCHES } from '../src/server/AgentV3/adminBuiltApps';
import { appsListParams, isRegistryStatus, outcomeChip, APP_PUBLISH_OPTIONS } from '../src/lib/adminAppModeration';

type R = { workspaceId: string; outcome: 'passed' | 'failed' | 'unknown'; tier: 'paid' | 'free' | 'admin' | 'unknown'; publish: string };
const row = (id: string, outcome: R['outcome'], tier: R['tier'], publish = 'never'): R => ({ workspaceId: id, outcome, tier, publish });

describe('the view the admin picks', () => {
  it('defaults to newest first, everything, and junk input falls back to the default', () => {
    expect(parseAppsView({})).toEqual({ sort: 'newest', outcome: 'all', tier: 'all', publish: 'all' });
    expect(parseAppsView({ sort: 'sideways', outcome: 'maybe', publish: 'x' })).toEqual({ sort: 'newest', outcome: 'all', tier: 'all', publish: 'all' });
    expect(viewFilters(parseAppsView({ sort: 'oldest' }))).toBe(false); // order alone is a plain read, not a scan
  });

  it('oldest, failed, paid, live are each understood', () => {
    const v = parseAppsView({ sort: 'oldest', outcome: 'failed', tier: 'paid', publish: 'live' });
    expect(v).toEqual({ sort: 'oldest', outcome: 'failed', tier: 'paid', publish: 'live' });
    expect(viewFilters(v)).toBe(true);
  });

  it('🔴 a build with no result is never counted as failed, and an unknown account is never counted as free', () => {
    expect(rowMatchesView(row('a', 'unknown', 'free'), parseAppsView({ outcome: 'failed' }))).toBe(false);
    expect(rowMatchesView(row('a', 'failed', 'unknown'), parseAppsView({ tier: 'free' }))).toBe(false);
    expect(rowMatchesView(row('a', 'failed', 'free'), parseAppsView({ outcome: 'failed', tier: 'free' }))).toBe(true);
  });

  it('"not live" is every app that is not live right now', () => {
    const v = parseAppsView({ publish: 'not-live' });
    expect(rowMatchesView(row('a', 'passed', 'paid', 'live'), v)).toBe(false);
    expect(rowMatchesView(row('a', 'passed', 'paid', 'never'), v)).toBe(true);
    expect(rowMatchesView(row('a', 'passed', 'paid', 'banned'), v)).toBe(true);
  });
});

describe('a filtered page is found by a bounded look that resumes exactly where it stopped', () => {
  it('🔴 stops on the 12th match and reports the LAST APP IT EXAMINED, so the next page starts right after it', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`w${i}`, i % 2 ? 'failed' : 'passed', 'free'));
    const got = takeMatches(rows, parseAppsView({ outcome: 'failed' }), 12);
    expect(got.kept.map(r => r.workspaceId)).toEqual(['w1', 'w3', 'w5', 'w7', 'w9', 'w11', 'w13', 'w15', 'w17', 'w19', 'w21', 'w23']);
    expect(got.lastExamined).toBe('w23');
    expect(got.examined).toBe(24); // w24..w29 were never looked at — the cursor must not skip them
  });

  it('a batch with too few matches is examined to the end', () => {
    const rows = [row('a', 'passed', 'free'), row('b', 'failed', 'free'), row('c', 'passed', 'free')];
    expect(takeMatches(rows, parseAppsView({ outcome: 'failed' }), 12)).toEqual({ kept: [rows[1]], lastExamined: 'c', examined: 3 });
  });

  it('the look is bounded — a rare filter can never become load-everything', () => {
    expect(SCAN_BATCH * SCAN_BATCHES).toBeLessThanOrEqual(400);
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/admin.ts'), 'utf8');
    expect(route).toContain('got.examined < rows.length ? got.lastExamined : pageRes.nextAfterDocId');
    expect(route).toContain('scanned');
  });
});

describe('what the screen sends and shows', () => {
  it('only what differs from the default goes on the wire', () => {
    expect(appsListParams({ limit: 12, publish: '', sort: 'newest', outcome: 'all', tier: 'all' }).toString()).toBe('limit=12');
    expect(appsListParams({ limit: 12, cursor: 'c1', publish: 'not-live', sort: 'oldest', outcome: 'failed', tier: 'free' }).toString())
      .toBe('limit=12&cursor=c1&publish=not-live&sort=oldest&outcome=failed&tier=free');
  });

  it('a registry status (banned, held…) keeps its own list and drops the other filters, which it cannot honour', () => {
    expect(isRegistryStatus('taken_down')).toBe(true);
    expect(isRegistryStatus('live')).toBe(false);
    expect(appsListParams({ limit: 12, publish: 'taken_down', sort: 'oldest', outcome: 'failed', tier: 'paid' }).toString()).toBe('limit=12&status=taken_down');
    expect(APP_PUBLISH_OPTIONS.map(o => o.label)).toContain('Banned');
  });

  it('every build result reads as real words, never blank', () => {
    expect(outcomeChip('passed')).toEqual({ label: 'Build passed', tone: 'pass' });
    expect(outcomeChip('failed')).toEqual({ label: 'Build failed', tone: 'fail' });
    expect(outcomeChip('unknown')).toEqual({ label: 'No build result', tone: 'none' });
    expect(outcomeChip(undefined as never).label).toBe('No build result');
  });
});
