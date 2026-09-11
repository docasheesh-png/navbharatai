// HOW LONG A SANDBOX MAY LIVE WITHOUT ANYONE VOUCHING FOR IT — the provider's own dead-man switch.
//
// THE MONEY THIS IS ABOUT (admin's E2B dashboards, 2026-09-11). A sandbox averaged 28.8 minutes of
// wall-clock per start, of which the build itself was about 5. The other ~24 were a machine nobody was
// using, and the arithmetic of the sweeps says where they went: the in-memory idle sweep pauses at
// 5 minutes but can only see sandboxes THIS instance holds, and Cloud Run recycles instances on every
// deploy — so most sandboxes fell to the DURABLE orphan sweep, whose window is 20 minutes. Twenty
// minutes, times ~1,100 sandboxes a month, at $0.1656 an hour.
//
// WHY THE ORPHAN WINDOW HAD TO BE TWENTY. The reaper trusts a durable timestamp that is refreshed only
// by SANDBOX OPERATIONS (`_touchDurable` rides `getSandbox` and `noteActivity`). A build spends its
// longest stretches inside a model call, which touches the sandbox not at all — so a live build and an
// abandoned machine produce the same silence, and the only safe cut-off was one that outlasts the
// longest silence a build can legitimately have. The window was long because the SIGNAL was false.
//
// THE FIX IS TO STOP BEING THE ONE WHO DECIDES. E2B already has a timer on every sandbox (`timeoutMs`),
// and we already set its expiry action to PAUSE (previewWake.ts, #2782). Today that timer is set to an
// hour and refreshed on every operation — a backstop nobody expected to fire. Make it SHORT instead,
// and keep it alive on purpose:
//
//   • every operation and every viewer ping still extends it (throttled, so a hot path costs at most
//     one API call a minute);
//   • while a build or an operation is in flight, a TIMER-driven heartbeat extends it whether or not
//     the sandbox is being touched — a model call no longer looks like abandonment;
//   • when nothing extends it, E2B pauses the machine itself.
//
// 🔒 WHY THIS IS PERMANENT RATHER THAN A SHORTER WINDOW. The heartbeat runs in the process that owns
// the build. If Cloud Run recycles that instance mid-build, the heartbeat dies WITH the build — and a
// machine whose build is dead SHOULD be paused. If our whole service is down, every sandbox pauses on
// its own. There is no cross-instance question left to answer, because the provider's timer does not
// care which instance set it. The durable reaper stays as a second net, unchanged.
//
// 🔒 WHY A MISSED HEARTBEAT IS SAFE. The expiry action is `pause`, never `kill`. A sandbox paused by
// mistake mid-build fails its next command with a shape `isDeadSandboxError` already recognises
// ("sandbox … paused"), the stale handle is dropped, and `getSandbox` reconnects by durable id —
// which resumes the machine with its files and node_modules. Slower, never lost. That recovery
// exists for the kill case already; this change only makes it reachable in a milder form.
//
// PURE. Every number here is a decision the actuator applies; none of it touches the SDK.

import { buildFlagExpiryMs } from './sandboxReaper';

/**
 * Below this a heartbeat could not be missed even once without the machine pausing under a live
 * build; also the floor for two viewer keep-alive pings (60 s apart) to fit inside one lifetime.
 */
export const LIFETIME_MIN_MINUTES = 2;
/** E2B's Hobby plan caps a session at an hour; above it the value would be refused anyway. */
export const LIFETIME_MAX_MINUTES = 60;
/**
 * Six minutes: above the 5-minute idle limit, so on a healthy instance OUR sweep still pauses first
 * and today's behaviour there is unchanged; short enough that an orphan costs six minutes instead
 * of twenty. Two missed heartbeats (see `heartbeatIntervalMs`) still leave two minutes of slack.
 */
export const DEFAULT_LIFETIME_MINUTES = 6;

/** How long E2B keeps a sandbox running after the last extension. Env-tunable, clamped. */
export function sandboxLifetimeMs(env: NodeJS.ProcessEnv = process.env): number {
  const mins = Number(env.AGENTV3_SANDBOX_LIFETIME_MINUTES);
  const chosen = Number.isFinite(mins) && mins > 0 ? mins : DEFAULT_LIFETIME_MINUTES;
  const clamped = Math.min(LIFETIME_MAX_MINUTES, Math.max(LIFETIME_MIN_MINUTES, chosen));
  return Math.floor(clamped * 60_000);
}

/**
 * How often the heartbeat extends a busy sandbox: a THIRD of the lifetime, so two consecutive misses
 * (a throttled API, a slow tick) still leave a third of the window before the machine pauses.
 */
export function heartbeatIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(30_000, Math.floor(sandboxLifetimeMs(env) / 3));
}

/**
 * The hot-path throttle: an operation or a viewer ping extends the lifetime at most this often.
 * A sixth of the lifetime — one call a minute at the default — is plenty when the heartbeat is
 * already covering the busy case; this exists so a burst of file writes is not a burst of API calls.
 */
export function extendThrottleMs(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(10_000, Math.floor(sandboxLifetimeMs(env) / 6));
}

/** May an operation extend the lifetime now? Unknown last-extension ⇒ yes. Pure. */
export function shouldExtendLifetime(
  lastExtendAt: number | null | undefined,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const last = Number(lastExtendAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  if (last > now) return true; // clock went backwards — extend rather than trust it
  return now - last >= extendThrottleMs(env);
}

/** What the heartbeat knows about one held sandbox. */
export interface HeartbeatCandidate {
  workspaceId: string;
  /** Epoch ms the build flag was raised, or null/undefined when no build is in flight. */
  buildStartedAt?: number | null;
  /** Sandbox operations currently running (see E2BActuator._opsInFlight). */
  opsInFlight?: number;
  /** When the lifetime was last extended by any path, so a just-extended machine is skipped. */
  lastExtendAt?: number | null;
}

/**
 * Which held sandboxes the heartbeat must extend on this tick. Pure.
 *
 * A sandbox is BUSY when a build flag is raised and not yet expired (`buildFlagExpiryMs` — a build
 * that crashed between raising and lowering the flag must not be kept alive forever), or when any
 * operation is in flight. A busy sandbox extended within the last heartbeat interval by some other
 * path is skipped: the extension already happened and repeating it is one wasted call.
 *
 * An IDLE sandbox is deliberately NOT extended. That is the whole point — its timer is meant to run
 * out.
 */
export function heartbeatTargets(
  candidates: ReadonlyArray<HeartbeatCandidate>,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const interval = heartbeatIntervalMs(env);
  const flagExpiry = buildFlagExpiryMs(env);
  const out: string[] = [];
  for (const c of candidates || []) {
    if (!c || !c.workspaceId) continue;
    const started = Number(c.buildStartedAt);
    const buildLive = Number.isFinite(started) && started > 0 && now - started <= flagExpiry;
    const busy = buildLive || (Number(c.opsInFlight) || 0) > 0;
    if (!busy) continue;
    const last = Number(c.lastExtendAt);
    if (Number.isFinite(last) && last > 0 && last <= now && now - last < interval) continue;
    out.push(c.workspaceId);
  }
  return out;
}

/**
 * Who stopped a sandbox — recorded on the durable record so the admin can finally SEE which
 * mechanism ends machines, instead of inferring it from the bill.
 *
 * A record with `pausedAt` but no cause was paused by a sweep before this field existed. A machine
 * E2B paused at its own lifetime never receives a stamp from us at all — it is the absence that
 * identifies it, which `tallyPauseCauses` reports as `provider-or-unknown` rather than guessing.
 */
export type PauseCause = 'idle-sweep' | 'orphan-sweep';

export interface PauseCauseTally {
  idleSweep: number;
  orphanSweep: number;
  /** Paused by a sweep before the cause was recorded. */
  sweepUnattributed: number;
  /** No pause stamp from us at all: E2B's own timer, a kill, or still running. */
  providerOrUnknown: number;
  total: number;
}

/** Count how recent sandboxes were stopped. Pure; tolerant of partial records. */
export function tallyPauseCauses(
  records: ReadonlyArray<{ pausedAt?: number | null; pausedBy?: string | null }>,
): PauseCauseTally {
  const t: PauseCauseTally = { idleSweep: 0, orphanSweep: 0, sweepUnattributed: 0, providerOrUnknown: 0, total: 0 };
  for (const r of records || []) {
    if (!r) continue;
    t.total++;
    const paused = Number(r.pausedAt);
    if (!Number.isFinite(paused) || paused <= 0) { t.providerOrUnknown++; continue; }
    if (r.pausedBy === 'idle-sweep') t.idleSweep++;
    else if (r.pausedBy === 'orphan-sweep') t.orphanSweep++;
    else t.sweepUnattributed++;
  }
  return t;
}
