// The running-build registry — WHICH builds this instance is running right now — in a module of its own.
//
// WHY IT MOVED OUT OF routes/agentv3.ts (Q-867, 2026-10-12). The admin load board needs exactly one
// number from it, `runningBuildCount()`, and `routes/admin.ts` imported that number from
// `routes/agentv3.ts` — the build engine's route, ~1.9 MB and the largest module in the repo, with its
// whole import graph behind it. Measured under vitest: `await import('routes/admin')` took 22.0 s, of
// which the admin route's own body was a sliver; the login handler then answered 503 in 9 ms. The
// test `routesAdmin › returns 503 when ADMIN_PASSWORD env var is not set` sat on its 20 s timeout and
// flipped red or green with machine load, measuring a module LOAD and calling it a login failure.
//
// This is the SAME class `routes/actuatorFactory.ts` fixed for the zip routes on 2026-08-06 (6.5 s per
// import) — that fix moved one function and guarded two files, so the next route that needed one small
// thing from the engine reached for it the same way. The census in
// tests/aRouteDoesNotLoadTheBuildEngine.test.ts now guards every file, not two.
//
// ONE REGISTRY, NOT TWO. The Map below is the one the build route registers into, stops from, attaches
// to and reaps — `routes/agentv3.ts` imports THIS instance and never declares its own. A second Map
// would make the admin tile count a registry no build ever enters (it would read 0 forever), and the
// /stop and /attach guards' test seam would register a build the routes cannot see.
//
// Imports nothing: it holds state and three functions, so any module may read the count for free.

/** A client attached to a running build's event stream (the original request, or a Resume). */
export interface BuildSubscriber { write: (e: unknown) => void; end: () => void; }

// ── Resumable / stoppable builds ────────────────────────────────────────────────
// A running BUILD's events are buffered and fanned out to subscribers, so the user can
// (a) RE-ATTACH to a build whose original connection was lost ("Resume"), and
// (b) actually STOP it server-side ("Stop") — not just abort their own local fetch.
export interface RunningBuild {
  abort: AbortController;
  buffer: unknown[];
  subscribers: Set<BuildSubscriber>;
  ended: boolean;
  startedTs: number;
  /** Full Team steering (Fix 60): user messages sent MID-BUILD ('max' tier only). The AgentRunner
   *  drains this between turns and injects each as a REAL user turn, so the very next model call
   *  acts on it — the Claude-Code-style "talk to the team while it builds" experience. */
  steerQueue?: string[];
  /** The build's resolved power level — gates mid-build steering to the Full Team ('max') tier. */
  powerLevel?: string;
  /** The channel key (userId) — used to mirror events to the cross-device LiveChannel. Stays the
   *  ACCOUNT key even under per-workspace locking, so the cross-device mirror is unchanged. */
  key?: string;
  /** The owning account (userId ?? 'anon') — lets the per-account concurrency cap count this account's
   *  live builds even when the registry Map is keyed by workspace (per-workspace locking). */
  userId?: string | null;
  /** Which v5.0 session/project this build belongs to (agentv3-{uid}-{sessionId}). One account can
   *  have several DIFFERENT chat sessions; `runningBuilds` is keyed by userId only (one account can
   *  only build one thing at a time), but the auto-resume/attach and live-mirror paths must still
   *  verify the running build is actually the CALLER's session before replaying/mirroring it — else a
   *  build genuinely still running in session A silently bleeds into a freshly-opened session B under
   *  the same account (root-caused 2026-07-01: "+ New chat" showing an unrelated build's progress). */
  workspaceId?: string;
  /** Stamped by broadcastBuild on every event — the liveness signal isSilentlyStale() reads. */
  lastEventTs?: number;
  /** True once the build handler's own code has finished (its `finally` ran) — see stoppingBuild.ts. */
  exited?: boolean;
  /** When the user pressed Stop on it. */
  stoppedAt?: number;
  /** Woken when the build exits. */
  exitWaiters?: Array<() => void>;
}

/**
 * The registry itself. Written ONLY by `routes/agentv3.ts` (register, stop, reap) — the census test
 * holds every other module to the read-only `runningBuildCount()`.
 */
export const runningBuilds = new Map<string, RunningBuild>();

/**
 * How many builds this INSTANCE is running right now.
 *
 * Exported for the admin load board, whose "Build load" tile read `unknown` because nothing exposed
 * this — a ceiling nobody can see is a hope, not a trigger. Per-instance by nature: no process can
 * count its siblings' builds, and the tile says so rather than presenting one instance's number as
 * the platform's.
 */
export function runningBuildCount(): number {
  return runningBuilds.size;
}

/**
 * TEST-ONLY seam (VITEST): register/clear a running build under a key so the /stop and /attach identity
 * guards (T0-9 — match by VERIFIED uid, never a claimed body.userId) can be regression-tested;
 * `runningBuilds` is written only by the build route. A hard no-op outside tests, so it can never
 * affect production.
 */
export function __setRunningBuildForTest(key: string, rb: RunningBuild | null): void {
  if (!process.env.VITEST) return;
  if (rb) runningBuilds.set(key, rb);
  else runningBuilds.delete(key);
}
