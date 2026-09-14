import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseStatusFilter, buildMatchesFilters, statusCounts } from '../src/server/lib/buildListFilter';

const DASH = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');

const b = (id: string, ok?: boolean) => ({ workspaceId: id, ok, savedAt: 1 });

describe('the All-builds filters actually re-fetch (admin screenshot 2026-09-13)', () => {
  // THE BUG: every control in the bar called only its setter. `fetchAllBuilds` was reachable ONLY
  // from the Load button and the search box's Enter key, so the chip highlighted and the list never
  // changed — four dead controls from one missing effect.
  it('an effect re-fetches when a discrete filter changes', () => {
    expect(DASH).toMatch(/useEffect\(\(\) => \{\s*if \(activeTab !== 'reports'\) return;[\s\S]{0,120}fetchAllBuildsRef\.current\(\)/);
    expect(DASH).toMatch(/\}, \[activeTab, allBuildsStatus, allBuildsDate, allBuildsUid\]\)/);
  });

  // Free text must NOT re-fetch per keystroke — it keeps the Enter/Load trigger, which is why the
  // effect needs a ref rather than the callback itself in its deps.
  it('the search box is deliberately out of those deps, via a ref that is never stale', () => {
    expect(DASH).toContain('const fetchAllBuildsRef = useRef(fetchAllBuilds);');
    expect(DASH).toContain('fetchAllBuildsRef.current = fetchAllBuilds;');
    expect(DASH).not.toMatch(/\}, \[activeTab, allBuildsSearch, allBuildsStatus/);
  });

  // React state is async, so a control that sets then fetches sends the PREVIOUS value and lags one
  // click behind — a subtler version of the same bug.
  it('Clear fetches with explicit overrides rather than trusting async state', () => {
    expect(DASH).toContain("void fetchAllBuilds({ q: '', status: 'all', date: 'all', uid: '' });");
  });
});

describe('no build is reachable by zero filters — the chips have to add up', () => {
  // "All 100 · Failed 25 · Worked 70" left five builds that no chip could ask for.
  const rows = [b('a', true), b('b', false), b('c'), b('d', undefined)];

  it('statusCounts and the filter agree on what "unknown" means', () => {
    const c = statusCounts(rows);
    expect(c.all).toBe(4);
    expect(c.failed + c.succeeded + c.unknown).toBe(c.all);
    const got = rows.filter((r) => buildMatchesFilters(r, { status: 'unknown' }));
    expect(got).toHaveLength(c.unknown);
    expect(got.map((r) => r.workspaceId).sort()).toEqual(['c', 'd']);
  });

  it('unknown is a real accepted value, not silently downgraded to all', () => {
    expect(parseStatusFilter('unknown')).toBe('unknown');
    expect(parseStatusFilter('nonsense')).toBe('all');
    expect(parseStatusFilter(undefined)).toBe('all');
  });

  it('the other two chips are unchanged — this added a bucket, it did not move one', () => {
    expect(rows.filter((r) => buildMatchesFilters(r, { status: 'failed' })).map((r) => r.workspaceId)).toEqual(['b']);
    expect(rows.filter((r) => buildMatchesFilters(r, { status: 'succeeded' })).map((r) => r.workspaceId)).toEqual(['a']);
    expect(rows.filter((r) => buildMatchesFilters(r, { status: 'all' }))).toHaveLength(4);
  });

  it('the chip only appears when there is something behind it', () => {
    expect(DASH).toContain("...(allBuildsCounts?.unknown ? [['unknown', 'No outcome', allBuildsCounts.unknown] as const] : [])");
  });
});
