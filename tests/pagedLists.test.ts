// TWELVE ROWS, THEN A BUTTON — and the two details that make it correct rather than merely shorter.
//
// Admin, 2026-09-14: *"NavBharatAI me (+ admin panel) jahan bhi data list load ho rahi hai, wahan ek
// baar me puri list load hoti hai, is liye time lagta hai… pehle sirf 10-12 line hi load ho aur last
// me 'Load more' aa jaye."*
//
// A scan of the whole app found **72 rendered lists with no paging at all, across 36 files** — the
// admin panel's user table, the App Store, the gallery, every tool's history, the log viewer. Doing
// it seventy-two times by hand is seventy-two chances to get the SAME two details wrong, which is the
// duplication this repo has already paid for twice (four drifted copies of `safeRelPath`; one model
// id hardcoded in five files). So it is ONE hook, and these are the tests for those two details.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageWindow, DEFAULT_PAGE_SIZE } from '../src/hooks/usePagedList';

describe('the promise: 12 rows, then a button', () => {
  it('shows 12 of 5,000 and says how many are left', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(12);               // the admin asked for "10-12"
    const w = pageWindow(5000, 12, 12);
    expect(w).toEqual({ shown: 12, hasMore: true, remaining: 4988 });
  });

  it('each press reveals one more page, and the last one ends the button', () => {
    expect(pageWindow(30, 24, 12)).toEqual({ shown: 24, hasMore: true, remaining: 6 });
    expect(pageWindow(30, 36, 12)).toEqual({ shown: 30, hasMore: false, remaining: 0 });
  });

  it('a short list is shown whole, with no button at all', () => {
    // A greyed-out "Load more" under a complete list is what makes a finished list look broken.
    expect(pageWindow(5, 12, 12)).toEqual({ shown: 5, hasMore: false, remaining: 0 });
    expect(pageWindow(0, 12, 12)).toEqual({ shown: 0, hasMore: false, remaining: 0 });
  });
});

describe('🔴 DETAIL 1 — THE SHRINK. A list that got shorter must clamp', () => {
  it('5,000 rows filtered to 3 shows 3, not "12 of 3"', () => {
    // Without the clamp the count stays where the user left it, so `shown` silently exceeds the list
    // and the remaining count goes negative — a control that was never pressed and cannot be.
    expect(pageWindow(3, 5000, 12)).toEqual({ shown: 3, hasMore: false, remaining: 0 });
  });

  it('and a filter down to 400 still shows a full page with more to come', () => {
    expect(pageWindow(400, 12, 12)).toEqual({ shown: 12, hasMore: true, remaining: 388 });
  });

  it('never shows less than one page while rows remain', () => {
    // The floor matters: a caller that passes a stale count of 0 or 1 must still get a usable page,
    // or the first paint is a one-row list under a "Load more" button.
    expect(pageWindow(500, 0, 12).shown).toBe(12);
    expect(pageWindow(500, 1, 12).shown).toBe(12);
  });
});

describe('⚠️ it cannot be fed a bad number into a bad state', () => {
  it.each([
    [NaN, 12, 12], [5000, NaN, 12], [5000, 12, NaN],
    [-10, 12, 12], [5000, -5, 12], [5000, 12, 0], [5000, 12, -3],
  ])('total=%s count=%s size=%s stays sane', (t, c, s) => {
    const w = pageWindow(t as number, c as number, s as number);
    expect(w.shown).toBeGreaterThanOrEqual(0);
    expect(w.remaining).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(w.shown)).toBe(true);
    expect(w.hasMore).toBe(w.remaining > 0);
  });

  it('remaining and hasMore always agree — they are read by the same button', () => {
    for (const total of [0, 1, 11, 12, 13, 99, 5000]) {
      for (const count of [12, 24, 5000]) {
        const w = pageWindow(total, count, 12);
        expect(w.hasMore, `${total}/${count}`).toBe(w.remaining > 0);
        expect(w.shown + w.remaining, `${total}/${count}`).toBe(Math.max(0, total));
      }
    }
  });
});

describe('🔴 DETAIL 2 — THE RESET, wired at the call sites that have a filter', () => {
  const hook = readFileSync(join(process.cwd(), 'src/hooks/usePagedList.ts'), 'utf8');
  const admin = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');

  it('the hook resets when resetKey changes', () => {
    expect(hook).toContain('if (lastKey.current !== key)');
    expect(hook).toContain('setCount(pageSize)');
  });

  it('the admin lists that HAVE a filter pass one', () => {
    // The real failure: press "Load more" five times (72 rows), then search — and get 72 rows of the
    // new result with no sense of where you are.
    expect(admin).toContain('usePagedList(userReports, { resetKey: reportFilter })');
    expect(admin).toContain('usePagedList(allBuilds, { resetKey:');
  });
});

describe('the button itself', () => {
  const btn = readFileSync(join(process.cwd(), 'src/components/common/LoadMore.tsx'), 'utf8');

  it('always says how many are left — "Load more" alone is a mystery button', () => {
    expect(btn).toContain('Showing {grouped(list.total - list.remaining)} of {grouped(list.total)}');
    expect(btn).toContain("toLocaleString('en-IN')");     // 4,31,900 reads right to this app's users
  });

  it('renders NOTHING when the list is complete', () => {
    expect(btn).toContain('if (!list.hasMore) return null;');
  });

  it('🔴 is table-aware — a <div> inside <tbody> is invalid HTML, and the first draft shipped one', () => {
    // Caught before merge on the promo-codes table: the browser hoists a div out of a table, so the
    // control renders in the wrong place and React logs validateDOMNesting.
    expect(btn).toContain('colSpan?: number');
    expect(btn).toContain('return colSpan ? <tr><td colSpan={colSpan}>{body}</td></tr> : body;');
    const admin = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
    expect(admin).toContain('list={pagedPromos} label="codes" colSpan=');
  });
});

describe('⚠️ WHERE IT MUST NOT GO — a picker is not a list you read', () => {
  const admin = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');

  it('the all-builds user <select> is deliberately NOT paged', () => {
    // Paging a native <select> makes the filter WORSE than the problem: a user outside the first
    // twelve becomes unreachable, so the control silently stops doing its job. It also cannot be
    // valid HTML — a <div> is not allowed inside <select>.
    // The picker moved into the shared ReportFilterBar (admin 2026-09-14) — both lists render it —
    // so this rule is asserted where it now lives. It applies to BOTH lists by construction now.
    const bar = readFileSync(join(process.cwd(), 'src/components/admin/ReportFilterBar.tsx'), 'utf8');
    expect(bar).toContain('{users.map((u) => <option');
    expect(bar).not.toContain('pagedUsers');
    expect(bar).toContain('DELIBERATELY NOT PAGED');
    expect(admin).not.toContain('pagedAllBuildsUsers');
  });
});

describe('🔴 THE SERVER HALF — the one a button cannot fix', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
  const admin = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');

  it('/api/admin/users looks up Firebase Auth only for the rows it is about to send', () => {
    // This is the actual slowness: fetchAuthMetadata batches at Firebase's 100-identifier limit, so
    // 5,000 users is fifty sequential round-trips before the first row can be drawn. Hiding rows in
    // the browser afterwards changes nothing the admin can feel.
    expect(route).toContain('const page = paged ? users.slice(offset, offset + pageLimit) : users;');
    expect(route).toContain('fetchAuthMetadata(page.map(');
    expect(route).not.toContain('fetchAuthMetadata(users.map(');
  });

  it('🔒 the SCAN stays, so search and sort still cover every user', () => {
    // Limiting the READ would quietly turn "search all users" into "search the first page" — the fix
    // trading one problem for a worse one. Firestore cannot do substring search, so the scan is the
    // only way, and what gets limited is the expensive part.
    expect(route).toContain("getDocs(walletsRef)");
    const i = route.indexOf('const paged = String(req.query.paged');
    const before = route.slice(Math.max(0, i - 6000), i);
    expect(before).toContain("if (sort === 'alpha')");        // sorting happens BEFORE the slice
    expect(before).toContain('users = users.filter(');        // and so does searching
  });

  it('🔒 OPT-IN — an older bundled app still gets the array it expects', () => {
    // The Android app is BUNDLED, so a phone can run last month's panel against today's server. That
    // panel does users.map(...) on the response and would crash on an object.
    expect(route).toContain("const paged = String(req.query.paged || '') === '1';");
    expect(route).toContain('res.json(paged ? { users: rows, total, offset, limit: pageLimit } : rows);');
  });

  it('and the panel reads BOTH shapes, asks for a page, and resets on a new search', () => {
    expect(admin).toContain('paged=1&limit=${userLimit}');
    expect(admin).toContain('Array.isArray(d) ? d : Array.isArray(d?.users) ? d.users : null');
    expect(admin).toContain('useEffect(() => { setUserLimit(USER_PAGE); setUserTotal(null); }, [userSearch, userSort]);');
  });
});
