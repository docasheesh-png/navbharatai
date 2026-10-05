// App Mart → Review (admin 2026-10-05): "instant app aur apk app, dono aise bahar hi hai, ek kaam karo! pahle 2 button
// banao, 'manage app, manage apk' aur uske andar apps dikhe, aise bahar pura page bekar dikh raha hai".
//
// The Review tab stacked four lists on one scroll — reported comments, viewer reports, instant apps, Android apps.
// It now opens on three buttons (Manage apps, Manage APKs, Reports), each with its counts, and a button opens ONE
// list, filtered to Waiting or On the store. The rules are pure (storeReviewQueue.ts); the wiring is pinned at the
// source, because NavAppStore is network-backed and a static render never gets past loading.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewSectionCount, filterReviewList, defaultReviewFilter } from '../src/components/ide/storeReviewQueue';

const src = readFileSync(join(__dirname, '..', 'src/components/ide/NavAppStore.tsx'), 'utf8');

describe('the numbers on each button', () => {
  const list = [
    { id: 'a', status: 'pending' }, { id: 'b', status: 'listed' }, { id: 'c', status: 'approved' },
    { id: 'd', status: undefined }, { id: 'e', status: 'rejected' },
  ];
  it('counts waiting and live the way the cards label them', () => {
    expect(reviewSectionCount(list)).toEqual({ waiting: 3, live: 2 });
    expect(reviewSectionCount([])).toEqual({ waiting: 0, live: 0 });
    expect(reviewSectionCount(null)).toEqual({ waiting: 0, live: 0 });
  });
  it('a filter shows exactly its half, in the order given', () => {
    expect(filterReviewList(list, 'waiting').map((a) => a.id)).toEqual(['a', 'd', 'e']);
    expect(filterReviewList(list, 'live').map((a) => a.id)).toEqual(['b', 'c']);
    expect(filterReviewList(undefined, 'live')).toEqual([]);
  });
  it('a list opens on the work: Waiting when anything waits, else On the store — never an empty Waiting over a full shelf', () => {
    expect(defaultReviewFilter({ waiting: 2, live: 5 })).toBe('waiting');
    expect(defaultReviewFilter({ waiting: 0, live: 5 })).toBe('live');
    expect(defaultReviewFilter({ waiting: 0, live: 0 })).toBe('waiting');
  });
});

describe('the Review tab opens on buttons, and each list lives inside its button', () => {
  it('the hub shows Manage apps, Manage APKs and Reports, only when no list is open', () => {
    expect(src).toContain("reviewSection === null && (");
    for (const label of ["title: 'Manage apps'", "title: 'Manage APKs'", '>Reports</span>']) expect(src).toContain(label);
    expect(src).toContain('onClick={() => openReviewSection(b.id)}');
  });

  it('every review list is gated on its own section — none is rendered "outside" any more', () => {
    const reviewBlocks = src.match(/\{tab === 'review' && status\?\.isAdmin && [^\n]*/g) ?? [];
    expect(reviewBlocks.length).toBeGreaterThan(5);
    for (const line of reviewBlocks) {
      // The error line is shared by every section; every other block names the section it belongs to.
      if (line.includes('reviewError')) continue;
      expect(line, line).toMatch(/reviewSection (?:===|!==) (?:null|'apps'|'apks'|'reports')/);
    }
    expect(src).toMatch(/reviewSection === 'apps' && shownWebQueue\.length > 0/);
    expect(src).toMatch(/reviewSection === 'apks' && \(/);
    expect(src).toMatch(/reviewSection === 'reports' && <CommentReportsAdmin/);
  });

  it('inside a list: a Back button, the list name, and Waiting / On the store with counts', () => {
    expect(src).toContain('onClick={() => setReviewSection(null)}');
    expect(src).toMatch(/`Waiting \(\$\{/);
    expect(src).toMatch(/`On the store \(\$\{/);
    // The lists page what the filter shows, and a filter change starts from the first page.
    expect(src).toContain('usePagedList(shownWebQueue, { resetKey: reviewFilter })');
    expect(src).toContain('usePagedList(shownApkQueue, { resetKey: reviewFilter })');
  });

  it('leaving the tab brings Review back to its buttons', () => {
    expect(src).toContain("useEffect(() => { if (tab !== 'review') setReviewSection(null); }, [tab]);");
  });

  it('the old one-scroll heading is gone', () => {
    expect(src).not.toContain('Instant apps — listing requests and apps on the store');
  });
});
