// SHOW TWELVE ROWS, THEN A BUTTON — the one place that decision is made.
//
// Admin, 2026-09-14: *"jahan bhi data list load ho rahi hai, wahan ek baar me puri list load hoti hai,
// is liye time lagta hai… pehle sirf 10-12 line hi load ho aur last me 'load more' aa jaye."*
//
// A scan of the whole app found **72 rendered lists with no paging at all**, across 36 files — the
// admin panel\'s user table, the App Store, the gallery, every tool\'s history, the log viewer, the
// project file tree. Every one of them builds a DOM row for every record it holds.
//
// 🔒 WHY A SHARED HOOK AND NOT `\u2026slice(0, 12)` AT EACH SITE. Seventy-two hand-written slices is
// seventy-two chances to get the SAME two details wrong, and this repo has already paid twice for
// exactly that shape of duplication (four drifted copies of `safeRelPath`; a model id hardcoded in
// five files). The two details are:
//
//   1. **THE RESET.** A list that is filtered or re-sorted must go back to page one. Miss it and the
//      admin searches for one user, and sees "Load more" under a list of one — or worse, keeps the
//      row count from the previous search and shows twelve rows of a three-row result.
//   2. **THE SHRINK.** When the list gets SHORTER than what is already shown, the count must clamp,
//      or `visible` silently becomes the whole (short) list while the button still offers more.
//
// ⚠️ WHAT THIS DOES AND DOES NOT FIX, stated plainly because it is half of an honest answer. It fixes
// the BROWSER: twelve rows of DOM instead of five thousand, which is what makes a screen feel instant.
// It does NOT reduce what the SERVER sent — if an endpoint still ships every row, the download and the
// database read are unchanged. That half is fixed endpoint by endpoint (see `/api/admin/users`), and
// the two are deliberately separate: this hook is safe everywhere and can ship today, while changing
// what a server returns has to be checked one route at a time.
//
// PURE React state — no fetching, no effects that touch the network, no assumptions about the data.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Twelve, because the admin asked for "10-12" and twelve divides evenly into a 2/3/4-column grid. */
export const DEFAULT_PAGE_SIZE = 12;

export interface PagedListOptions {
  /** How many to show at first. Default 12. */
  pageSize?: number;
  /** How many more per press. Defaults to `pageSize`. */
  step?: number;
  /**
   * Change this whenever the list means something DIFFERENT — a new search term, a new sort, a new
   * tab, a new workspace — and the view jumps back to page one.
   *
   * ⚠️ Strongly recommended wherever a filter exists. Without it the count survives a search, so a
   * user who pressed "Load more" five times and then searched would see 72 rows of the new result
   * instead of 12. The shrink-clamp below stops that being WRONG, not merely surprising, but only a
   * reset key makes it right.
   */
  resetKey?: string | number | null;
}

/**
 * THE WHOLE DECISION, AS ARITHMETIC — extracted so it can be tested without a DOM.
 *
 * Both bugs this hook exists to prevent live in these four lines, so this is the thing worth proving:
 * the clamp when the list shrank, and the floor that keeps at least one full page visible. React only
 * decides WHEN to call it.
 *
 * PURE.
 */
export function pageWindow(total: number, count: number, pageSize: number): {
  shown: number; hasMore: boolean; remaining: number;
} {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const n = Math.max(0, Math.floor(total) || 0);
  // THE SHRINK: never claim more rows than exist, and never fall below one page while rows remain.
  const wanted = Math.max(size, Math.floor(count) || size);
  const shown = Math.min(wanted, n);
  return { shown, hasMore: n > shown, remaining: Math.max(0, n - shown) };
}

export interface PagedList<T> {
  /** The rows to render. */
  visible: T[];
  /** True while rows remain unshown. */
  hasMore: boolean;
  /** How many are still hidden — show it on the button, so the press is an informed one. */
  remaining: number;
  /** The full length, for "Showing 12 of 4,331". */
  total: number;
  /** Reveal one more step. */
  loadMore: () => void;
  /** Reveal everything — for export, print, or a deliberate "show all". */
  showAll: () => void;
  /** Back to the first page. */
  reset: () => void;
}

/**
 * Reveal a long list a page at a time.
 *
 * ```tsx
 * const paged = usePagedList(users, { resetKey: `${search}|${sort}` });
 * {paged.visible.map(u => <Row key={u.id} user={u} />)}
 * <LoadMore list={paged} label="users" />
 * ```
 */
export function usePagedList<T>(items: readonly T[] | null | undefined, options: PagedListOptions = {}): PagedList<T> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE));
  const step = Math.max(1, Math.floor(options.step ?? pageSize));
  const list = useMemo(() => (Array.isArray(items) ? (items as T[]) : []), [items]);
  const total = list.length;

  const [count, setCount] = useState(pageSize);

  // (1) THE RESET. A different search, sort or tab is a different list, so it starts at page one.
  const key = options.resetKey ?? null;
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      setCount(pageSize);
    }
  }, [key, pageSize]);

  // (2) THE SHRINK. Without this, a filter that cuts 5,000 rows to 3 leaves a count of 5,000 — and
  // `hasMore` would be false while the button had never been pressed, which reads as a broken control.
  // Clamping is also what makes the hook correct for callers that pass no resetKey at all.
  useEffect(() => {
    setCount((c) => (total > 0 && c > total ? Math.max(pageSize, Math.min(c, total)) : c));
  }, [total, pageSize]);

  const win = pageWindow(total, count, pageSize);
  const effective = win.shown;
  const visible = useMemo(() => (total <= effective ? list : list.slice(0, effective)), [list, total, effective]);

  const loadMore = useCallback(() => setCount((c) => c + step), [step]);
  const showAll = useCallback(() => setCount(Number.MAX_SAFE_INTEGER), []);
  const reset = useCallback(() => setCount(pageSize), [pageSize]);

  return {
    visible,
    hasMore: win.hasMore,
    remaining: win.remaining,
    total,
    loadMore,
    showAll,
    reset,
  };
}
