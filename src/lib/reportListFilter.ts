// ONE filter for both admin build-report lists (admin 2026-09-14: "filter bhi all build report wala
// chahiye dono me!!").
//
// The two lists had two different filter bars. All-builds had status chips with live counts, a date
// range, a per-user picker and a search box. The user-submitted inbox had a search box, a tier select,
// a status select and a sort — no date range at all, so "is this still happening?" could not be asked
// of the very list where a user has complained.
//
// Rather than copy one bar into the other file, the DECISION lives here and both render from it. The
// controls stay where they belong (JSX), but what "Failed" or "Last 7 days" MEANS is one answer.
//
// ⚠️ WHY THE USER-SUBMITTED LIST FILTERS IN THE BROWSER AND ALL-BUILDS ON THE SERVER, and why that is
// not an inconsistency to "fix": the inbox is a bounded list the panel already holds in full, so a
// round trip per keystroke would be slower and no more correct. All-builds is a 500-row window over
// every build ever made, where a date bound MUST go into the query or "last 30 days" silently means
// "the newest 500 rows, some of which are recent". Same meanings, applied where each list can afford
// them — which is exactly why the meanings are shared and the plumbing is not.
//
// Pure and unit-tested.

export type ListStatusFilter = 'all' | 'failed' | 'succeeded' | 'unknown';
/**
 * PAID / FREE (admin 2026-09-14: "jis user ne real ₹ se token purchase kiye hai, woh paid user hai").
 * A fact about the ACCOUNT, decided once in server/lib/accountTier.ts — never about how one build was
 * routed, which a user changes simply by choosing the Weak engine.
 */
export type ListTierFilter = 'all' | 'paid' | 'free' | 'admin' | 'unknown';
export type ListDateFilter = 'all' | 'today' | '7d' | '30d';

/** The controls both bars render, so neither list can quietly grow a filter the other lacks. */
export interface ListFilterState {
  query: string;
  status: ListStatusFilter;
  date: ListDateFilter;
  /** A user id, or '' for every user. */
  uid: string;
  /** Paid / free / admin / unknown — see ListTierFilter. */
  tier: ListTierFilter;
}

export const EMPTY_FILTERS: ListFilterState = { query: '', status: 'all', date: 'all', uid: '', tier: 'all' };

/** True when anything is narrowing the list — i.e. when a "Clear" button is worth showing. Pure. */
export function hasActiveFilters(f: ListFilterState | null | undefined): boolean {
  if (!f) return false;
  return Boolean(f.query.trim()) || f.status !== 'all' || f.date !== 'all' || Boolean(f.uid) || (f.tier ?? 'all') !== 'all';
}

/** The epoch-ms floor a date filter means, or null for "any time". Pure. */
export function sinceMsFor(date: ListDateFilter, now: number = Date.now()): number | null {
  switch (date) {
    case 'today': return now - 24 * 60 * 60 * 1000;
    case '7d': return now - 7 * 24 * 60 * 60 * 1000;
    case '30d': return now - 30 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

/** The label each date option carries. Kept here so the two bars cannot word them differently. */
/** The tier options both bars render, so neither can word them differently. */
export const TIER_OPTIONS: ReadonlyArray<{ value: ListTierFilter; label: string }> = [
  { value: 'all', label: 'All users' },
  { value: 'paid', label: 'Paid' },
  { value: 'free', label: 'Free' },
  { value: 'admin', label: 'Admin/Tester' },
  // Shown because an UNKNOWN is never folded into "free": an anonymous build and a real user who has
  // never purchased are different things, and hiding the first inside the second would inflate the
  // very number ("how many have never paid?") this filter exists to answer.
  { value: 'unknown', label: 'Unknown' },
];

export const DATE_OPTIONS: ReadonlyArray<{ value: ListDateFilter; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: 'today', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

/**
 * Does one row's outcome match a status filter? Pure.
 *
 * `unknown` is its own answer, never folded into "failed". A build that stopped without recording an
 * outcome has NOT been shown to have failed, and counting it as failed would inflate the very number
 * the admin judges the engine by.
 */
export function matchesStatus(ok: boolean | null | undefined, status: ListStatusFilter): boolean {
  switch (status) {
    case 'succeeded': return ok === true;
    case 'failed': return ok === false;
    case 'unknown': return ok !== true && ok !== false;
    default: return true;
  }
}

/** Does a timestamp fall inside a date filter? Pure. A missing time is only shown under "Any time". */
export function matchesDate(ms: number | null | undefined, date: ListDateFilter, now: number = Date.now()): boolean {
  const since = sinceMsFor(date, now);
  if (since === null) return true;
  // An undated row cannot be shown to be recent. Including it in "Last 24 hours" would be a guess in
  // the direction that makes a stale problem look current.
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return false;
  return ms >= since;
}

/** Case- and space-insensitive substring match across a row's searchable text. Pure. */
export function matchesQuery(haystack: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return (haystack ?? []).filter(Boolean).join(' ').toLowerCase().includes(q);
}

/** What one row must expose to be filtered. Both list row types are mapped onto this. */
export interface FilterableRow {
  ok?: boolean | null;
  /** The time this row is dated by — reported-at for the inbox, saved-at for all-builds. */
  at?: number | null;
  uid?: string | null;
  /** The ACCOUNT's tier — see accountTier.ts. Absent/null is treated as 'unknown'. */
  tier?: ListTierFilter | null;
  /** Everything the search box should look through. */
  search: ReadonlyArray<string | null | undefined>;
}

/** Apply every filter to one row. Pure. */
export function rowMatches(row: FilterableRow, f: ListFilterState, now: number = Date.now()): boolean {
  if (!matchesStatus(row.ok, f.status)) return false;
  if (!matchesDate(row.at, f.date, now)) return false;
  if (f.uid && String(row.uid ?? '') !== f.uid) return false;
  // An absent tier means UNKNOWN, so a row we could not classify is reachable by the Unknown chip
  // rather than being invisible to every choice but "All users".
  if (f.tier && f.tier !== 'all' && (row.tier ?? 'unknown') !== f.tier) return false;
  if (!matchesQuery(row.search, f.query)) return false;
  return true;
}

/** The live counts the status chips show — computed BEFORE status narrowing, so a chip can say how
 *  much choosing it would hide. The other filters DO apply, or the chips would describe a set the
 *  admin is not looking at. Pure. */
export function statusCountsFor(
  rows: ReadonlyArray<FilterableRow>,
  f: ListFilterState,
  now: number = Date.now(),
): { all: number; failed: number; succeeded: number; unknown: number } {
  const base = (rows ?? []).filter((r) => rowMatches(r, { ...f, status: 'all' }, now));
  return {
    all: base.length,
    failed: base.filter((r) => r.ok === false).length,
    succeeded: base.filter((r) => r.ok === true).length,
    unknown: base.filter((r) => r.ok !== true && r.ok !== false).length,
  };
}
