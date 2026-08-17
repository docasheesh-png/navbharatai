// AgentV3 — build concurrency model (admin plan 2026-07-05, FIX #3).
import { parseEnvFlag } from '../lib/envFlag';
//
// TODAY (default): the build lock + registry are keyed by ACCOUNT (`userId ?? 'anon'`) → one build at a
// time per account. That blocks two legitimate things the admin wants: (a) building two DIFFERENT apps
// at once, and (b) a 10-phase roadmap in one chat while editing elsewhere. It also means every
// not-fully-verified user shares the single `'anon'` lock (one anon build blocks ALL anon users).
//
// PER-WORKSPACE (flag `AGENTV3_PER_WORKSPACE_LOCK`): key the lock/registry by WORKSPACE instead — so
// different apps build concurrently, while the SAME app stays mutually exclusive (only one build writes
// its files at a time → no clobbering). A per-ACCOUNT concurrency CAP bounds sandbox cost (each build is
// a real E2B VM). Everything here is a PURE decision the route wires in; flag OFF → byte-identical to
// today (every key resolves to the account key, the cap is not consulted).

/** Default max concurrent builds per account when per-workspace locking is on (bounds sandbox cost). */
export const MAX_CONCURRENT_BUILDS_DEFAULT = 3;

/** Master opt-in for per-workspace build locking. Default OFF → today's per-account behaviour. */
export function perWorkspaceLockEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.AGENTV3_PER_WORKSPACE_LOCK || '').trim().toLowerCase();
  return parseEnvFlag(v) === true;
}

/** The per-account concurrency cap (AGENTV3_MAX_CONCURRENT_BUILDS, default 3). Always ≥ 1. */
export function maxConcurrentBuilds(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt((env.AGENTV3_MAX_CONCURRENT_BUILDS || '').trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : MAX_CONCURRENT_BUILDS_DEFAULT;
}

/**
 * The lock/registry key for a build. Per-ACCOUNT today (`userId ?? 'anon'`); per-WORKSPACE when enabled
 * (so different apps build concurrently, the same app is mutually exclusive). Falls back to the account
 * key when per-workspace is on but no stable workspaceId is available (never key on an unstable id).
 * Pure + exported for unit testing.
 */
export function buildLockKey(userId: string | null, workspaceId: string | null | undefined, perWorkspace: boolean): string {
  if (perWorkspace && workspaceId) return workspaceId;
  return userId ?? 'anon';
}

/** Count an account's currently-active (not-ended) builds — the input for the per-account cap. Pure:
 *  takes the registry's values (each carrying its owner userId + ended flag), not the live Map. */
export function countActiveBuildsForUser(builds: Iterable<{ userId?: string | null; ended: boolean }>, userId: string | null): number {
  const owner = userId ?? 'anon';
  let n = 0;
  for (const b of builds) {
    if (!b.ended && (b.userId ?? 'anon') === owner) n++;
  }
  return n;
}

/**
 * Every registry key a caller's build could legitimately live under, in lookup order (deduped):
 *   1. the primary lock key (workspace key when per-workspace is on, else the account key),
 *   2. the account key, and
 *   3. the shared 'anon' bucket.
 *
 * WHY 'anon' is always a candidate (admin's dead Stop/Resume, 2026-07-06): /chat registers a build
 * under the VERIFIED identity — when token verification fails (the known anon fallback) the build and
 * its lock live under 'anon', while /stop//attach looked up the CLIENT-CLAIMED uid key → a guaranteed
 * miss → Stop stopped nothing, Resume 404'd, and the 'anon' lock held the account in the 409 loop
 * forever. Candidates make those routes find the build wherever identity resolution actually put it.
 * (Safety: any anonymous caller could ALWAYS reach the shared 'anon' bucket — including it for a
 * signed-in caller adds no new exposure, and attach still enforces its workspaceId cross-check.)
 */
export function buildKeyCandidates(userId: string | null, workspaceId: string | null | undefined, perWorkspace: boolean): string[] {
  const out = [buildLockKey(userId, workspaceId, perWorkspace)];
  const account = userId ?? 'anon';
  if (!out.includes(account)) out.push(account);
  if (!out.includes('anon')) out.push('anon');
  return out;
}

/**
 * Do two workspace ids refer to the SAME chat session? Exact match, or the anon-fallback pair: when
 * /chat's verified identity fell back to anon, the build's workspace is `agentv3-anon-<sessionId>`
 * while the client asks about `agentv3-<uid>-<sessionId>` — same session, different owner prefix. The
 * sessionId (≥6 unguessable chars) is the discriminator, so matching on it never crosses sessions.
 * Without this, Stop/Resume's workspace cross-check rejected the caller's OWN anon-keyed build.
 */
export function workspaceSessionsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ANON = 'agentv3-anon-';
  const sessionMatches = (anonId: string, other: string): boolean => {
    const session = anonId.slice(ANON.length);
    return session.length >= 6 && other.startsWith('agentv3-') && other.endsWith(`-${session}`);
  };
  if (a.startsWith(ANON) && sessionMatches(a, b)) return true;
  if (b.startsWith(ANON) && sessionMatches(b, a)) return true;
  return false;
}

/**
 * How long a registry entry may stay SILENT before it stops counting as a running build.
 *
 * A genuinely-live build cannot be silent this long: the server emits progress narration on minute
 * boundaries ("⏱️ Still building… N min") and stream deltas besides, so a live entry's
 * `lastEventTs` refreshes at least every couple of minutes. Six minutes of nothing means the build
 * loop is gone — crashed, stuck on an un-abortable await, or orphaned by a dropped connection whose
 * cleanup never ran.
 *
 * Chosen against the real failure (admin report 2026-08-17): an orphaned entry sat `ended: false`
 * in the registry, `/status` reported it as running, and the panel showed a Resume button for a
 * build that was already finished on screen. The only sweeper that would have cleared it runs at
 * the ~32-minute hard max — so the button lied for up to half an hour.
 */
export const STALE_BUILD_SILENCE_MS = 6 * 60_000;

/** The slice of a registry entry the attach/status decision needs. */
export interface AttachableBuildEntry {
  ended: boolean;
  startedTs: number;
  workspaceId?: string;
  /** Stamped on every broadcast event. Absent on entries created before this field existed. */
  lastEventTs?: number;
}

/** True when a not-ended entry has emitted nothing for longer than a live build ever goes quiet. */
export function isSilentlyStale(rb: AttachableBuildEntry, now: number = Date.now()): boolean {
  if (rb.ended) return false; // ended is its own, louder verdict — not "stale"
  const lastSeen = typeof rb.lastEventTs === 'number' ? rb.lastEventTs : rb.startedTs;
  return now - lastSeen > STALE_BUILD_SILENCE_MS;
}

/**
 * THE ONE ANSWER to "is there a build this caller can attach to?" — used by BOTH `/status` (which
 * decides whether the Resume button exists) and `/attach` (which decides what clicking it does).
 *
 * ROOT CAUSE THIS CLOSES (admin report 2026-08-17: "build 100% poora, phir bhi Resume aa gaya —
 * click kiya to sab gayab"). The two endpoints answered the same question with DIFFERENT code:
 * `/status` keyed on the CLAIMED query userId, treated an unstamped legacy entry as a match, and
 * had no anon-bucket guard; `/attach` keyed on the VERIFIED token uid with a strict session match.
 * Every one of those differences is a door to "the button shows, the click 404s" — the user is
 * promised a build that the click then cannot find, and the panel tears down a finished
 * conversation chasing it. Two implementations of one question WILL disagree eventually; this
 * function is the question implemented once.
 *
 * The guards are `/attach`'s (the stricter, security-reviewed set), plus staleness: an entry that
 * has been silent past `STALE_BUILD_SILENCE_MS` is invisible to both endpoints, so a corpse in the
 * registry can no longer summon a Resume button — and attaching to one (which would stream
 * nothing) is refused for the same reason, by the same line.
 */
export function findAttachableBuild<T extends AttachableBuildEntry>(
  get: (key: string) => T | undefined,
  opts: { verifiedUid: string | null; workspaceId: string | null; perWorkspace: boolean; now?: number },
): { key: string; build: T } | null {
  const now = opts.now ?? Date.now();
  for (const key of buildKeyCandidates(opts.verifiedUid, opts.workspaceId, opts.perWorkspace)) {
    const cand = get(key);
    if (!cand || cand.ended) continue;
    if (isSilentlyStale(cand, now)) continue;
    // Never surface a DIFFERENT session's build (defense-in-depth on every key).
    if (opts.workspaceId && cand.workspaceId && !workspaceSessionsMatch(cand.workspaceId, opts.workspaceId)) continue;
    // The shared anon bucket for a SIGNED-IN caller: require a positive session match — never blind.
    if (key === 'anon' && opts.verifiedUid && !(opts.workspaceId && cand.workspaceId && workspaceSessionsMatch(cand.workspaceId, opts.workspaceId))) continue;
    return { key, build: cand };
  }
  return null;
}

export type AcquireResult =
  | { ok: true }
  /** This exact workspace is already building (same-app mutual exclusion) — attach/stop it, don't start a second. */
  | { ok: false; reason: 'same-workspace-busy' }
  /** The account is at its concurrent-build cap — let one finish (or stop it) first. */
  | { ok: false; reason: 'account-cap'; active: number; cap: number };

/**
 * Decide whether a NEW build may start, GIVEN the caller has already handled the existing-lock reclaim
 * path (an abandoned/zombie same-key lock is reclaimed upstream — see shouldReclaimBuildLock). Pure.
 *  - `lockHeldByLiveBuild`: this key still has a genuinely-live build (not reclaimable) → refuse.
 *  - per-workspace only: if the account already has ≥ cap live builds → refuse with the count.
 * With `perWorkspace=false` this only ever refuses on a live same-key lock (today's exact semantics).
 */
export function acquireDecision(input: {
  perWorkspace: boolean;
  lockHeldByLiveBuild: boolean;
  accountActiveCount: number;
  cap: number;
}): AcquireResult {
  if (input.lockHeldByLiveBuild) return { ok: false, reason: 'same-workspace-busy' };
  if (input.perWorkspace && input.cap >= 1 && input.accountActiveCount >= input.cap) {
    return { ok: false, reason: 'account-cap', active: input.accountActiveCount, cap: input.cap };
  }
  return { ok: true };
}
