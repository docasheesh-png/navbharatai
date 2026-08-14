/**
 * NARROWING 76 BUILD REPORTS DOWN TO THE ONE THAT MATTERS.
 *
 * ADMIN REQUEST 2026-08-13: "short karne ke liye filter ka option do, user, date, etc etc" — with the
 * standing instruction not to follow a suggestion blindly.
 *
 * So this deliberately implements FOUR filters and stops. The list's job is to answer "which build
 * should I look at right now", and on that screen only four questions ever come up:
 *   • STATUS  — failed or succeeded. On a list showing 76 open reports this is the one that matters
 *               most, because a failure is the only row that needs work.
 *   • DATE    — today / 7 / 30 days. "Is this still happening?" is the second question, always.
 *   • USER    — one person's builds, for when the same account keeps hitting something.
 *   • SEARCH  — free text over the prompt, summary, workspace and now the user's name/email.
 *
 * What was deliberately NOT added, despite "etc etc": filters on tier, model, duration, error code.
 * Each is plausible in isolation and none survives the real question — an admin who wants those is
 * already opening the full report, where they exist. A filter bar with ten controls costs more
 * attention than it saves, and this screen is opened to move FAST.
 *
 * ⚠️ WHERE EACH FILTER RUNS, AND WHY IT IS SPLIT. `savedAt` is the Firestore sort key, so a date bound
 * is applied IN THE QUERY — otherwise a 30-day filter would silently only search the newest 500 rows
 * and quietly lie about older ones. `ok` lives inside the stored report object and cannot be queried,
 * so status and user are applied in memory after the fetch. That asymmetry is real and the UI says so
 * rather than implying the list is exhaustive.
 */

import { identityMatches, type UserIdentity } from './adminUserLookup';

export type BuildStatusFilter = 'all' | 'failed' | 'succeeded';
export type BuildDateFilter = 'all' | 'today' | '7d' | '30d';

/** The row shape this module filters — only the fields it actually reads. */
export interface FilterableBuild {
  workspaceId: string;
  savedAt?: number;
  ownerUid?: string | null;
  ok?: boolean;
  prompt?: string;
  summary?: string;
  rootCause?: string;
}

export function parseStatusFilter(v: unknown): BuildStatusFilter {
  return v === 'failed' || v === 'succeeded' ? v : 'all';
}

export function parseDateFilter(v: unknown): BuildDateFilter {
  return v === 'today' || v === '7d' || v === '30d' ? v : 'all';
}

/**
 * The oldest `savedAt` a filter admits, or null for "no bound".
 *
 * "Today" means the last 24 hours, NOT since midnight: an admin looking at a list at 1 a.m. means
 * "what just happened", and a midnight boundary would hide the evening's failures at exactly the hour
 * they are most likely to be investigating them.
 */
export function sinceMsFor(filter: BuildDateFilter, nowMs: number = Date.now()): number | null {
  const DAY = 24 * 60 * 60 * 1000;
  switch (filter) {
    case 'today': return nowMs - DAY;
    case '7d': return nowMs - 7 * DAY;
    case '30d': return nowMs - 30 * DAY;
    default: return null;
  }
}

/**
 * Does one build survive the filters?
 *
 * ⚠️ `ok === undefined` means the build never recorded an outcome (it was cut off, or is still
 * running). That is NOT the same as failed, and it is counted as neither — a "failed" filter that
 * swept up unknowns would inflate the failure count with builds nobody can act on, and a "succeeded"
 * filter that did the same would hide real problems.
 */
export function buildMatchesFilters(
  build: FilterableBuild,
  opts: {
    status?: BuildStatusFilter;
    sinceMs?: number | null;
    uid?: string | null;
    query?: string;
    identity?: UserIdentity | null;
  },
): boolean {
  const status = opts.status ?? 'all';
  if (status === 'failed' && build.ok !== false) return false;
  if (status === 'succeeded' && build.ok !== true) return false;

  if (typeof opts.sinceMs === 'number' && (build.savedAt ?? 0) < opts.sinceMs) return false;

  if (opts.uid) {
    const owner = String(build.ownerUid ?? '').trim();
    if (owner.toLowerCase() !== opts.uid.trim().toLowerCase()) return false;
  }

  const q = (opts.query ?? '').trim().toLowerCase();
  if (q) {
    const inBuild =
      build.workspaceId.toLowerCase().includes(q) ||
      String(build.ownerUid ?? '').toLowerCase().includes(q) ||
      String(build.prompt ?? '').toLowerCase().includes(q) ||
      String(build.summary ?? '').toLowerCase().includes(q) ||
      String(build.rootCause ?? '').toLowerCase().includes(q);
    // Searching a person by NAME or EMAIL is the point of this whole change — an admin should not
    // have to know a UID to find someone's builds.
    const inUser = opts.identity ? identityMatches(opts.identity, q) : false;
    if (!inBuild && !inUser) return false;
  }

  return true;
}

/** Per-status counts for the filter chips, so the admin sees the size before choosing. */
export function statusCounts(builds: readonly FilterableBuild[]): { all: number; failed: number; succeeded: number; unknown: number } {
  let failed = 0;
  let succeeded = 0;
  let unknown = 0;
  for (const b of builds) {
    if (b.ok === false) failed += 1;
    else if (b.ok === true) succeeded += 1;
    else unknown += 1;
  }
  return { all: builds.length, failed, succeeded, unknown };
}

/**
 * The distinct users present in a set of builds, for the "one user" picker.
 *
 * Built from the LOADED rows rather than the whole user table on purpose: a dropdown of every account
 * that ever existed is unusable, while a list of everyone who built recently is exactly the choice an
 * admin is making. Sorted by build count, because the person with the most builds is the one being
 * looked for most often.
 */
export function usersInBuilds(
  builds: readonly FilterableBuild[],
  identities: Map<string, UserIdentity>,
): Array<{ uid: string; identity: UserIdentity | null; count: number }> {
  const counts = new Map<string, number>();
  for (const b of builds) {
    const uid = String(b.ownerUid ?? '').trim();
    if (!uid) continue;
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([uid, count]) => ({ uid, identity: identities.get(uid) ?? null, count }))
    .sort((a, b) => b.count - a.count || a.uid.localeCompare(b.uid));
}
