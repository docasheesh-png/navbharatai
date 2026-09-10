/**
 * DUPLICATE APP — "make a copy of this app" (ROADMAP §13, 3.6).
 *
 * A user who wants a variant — the same shop with a different catalogue, a second client's site from
 * the first — could only rebuild from scratch or hand-edit the original in place. A copy is the
 * ordinary answer, and every builder has one. This module holds the two PURE decisions the route
 * makes; the route does the copying.
 *
 * 🔒 WHAT A COPY CARRIES, AND WHAT IT MUST NOT. It carries the FILES and the CHAT (the history is
 * what lets the next edit understand the app) under a new name. It does NOT carry anything that
 * points at a place in the world: the GitHub repo (two apps pushing to one repo would overwrite each
 * other), the deployment, the connected domain, the site settings, or the secrets vault (per-app by
 * construction, so nothing copies unless copied on purpose — and it is not). A copy starts life
 * unpublished and unconnected, which is the only honest state for a thing that has never been
 * published or connected.
 *
 * PURE.
 */

/** The copy's name: "X (copy)", then "X (copy 2)" … — never a name the user already has. */
export function copyName(base: string, existing: readonly string[]): string {
  const clean = String(base ?? '').trim().replace(/\s+\(copy(?: \d+)?\)$/i, '') || 'My app';
  const taken = new Set(existing.map((n) => String(n ?? '').trim().toLowerCase()));
  const first = `${clean} (copy)`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${clean} (copy ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${clean} (copy ${Date.now()})`;
}

/**
 * The copy's status. A copy of a build that is still RUNNING would claim a build in progress that
 * nobody started; everything else keeps the original's terminal state, which is a true description
 * of the files it now holds.
 */
export function copyStatus(original: string | null | undefined): 'complete' | 'stopped' | 'error' {
  if (original === 'stopped' || original === 'error') return original;
  return 'complete';
}
