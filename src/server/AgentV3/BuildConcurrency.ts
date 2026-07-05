// AgentV3 — build concurrency model (admin plan 2026-07-05, FIX #3).
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
  return v === 'on' || v === 'true' || v === '1';
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
