// IS THERE REALLY A NETWORK? — the honest half of the offline state (admin 2026-09-19, item C of five).
//
// 🔴 THE GAP IS NOT THAT THERE WAS NO OFFLINE SIGNAL. There was one, and it is the UNRELIABLE one.
// `useNetworkStatus` has reported `navigator.onLine` since Phase 6.2, and App.tsx raises a toast from
// it. But that flag answers a narrower question than anyone reads it as:
//
//   • `navigator.onLine === false` is TRUSTWORTHY — the OS is certain there is no interface at all.
//   • `navigator.onLine === true` means only "an interface exists". One bar and no data, a captive
//     portal, dead DNS, aeroplane wifi: all report TRUE. In a WebView this is the common case, not an
//     exotic one, and in it the app shows no offline state and every request fails with a generic error.
//
// So this module adds the only thing that settles it: a real request. `navigator.onLine` is kept as the
// fast negative, and a probe is what turns a "true" into an answer.
//
// 🔒 A 503 IS A SUCCESS HERE, and that is not a bug. The question is "did a packet reach the server and
// come back", not "is the server healthy" — a server that answers 503 has proven the network works.
// Only a THROW or a timeout is a failure. Conflating the two would show "you are offline" to a user
// whose connection is perfect while we were deploying.
//
// 💸 IT NEVER POLLS WHILE THINGS ARE FINE, which is what makes it affordable at scale. A probe happens
// on a reason — app start, an online/offline event, returning to the foreground — and then, ONLY while
// we believe we are offline, on a backoff so recovery is noticed quickly. A healthy user costs roughly
// one tiny request per foreground, and a happy path with no foreground change costs nothing.
//
// The ASYMMETRY is deliberate and is this repo's own existing rule, borrowed from the site-uptime sweep:
// TWO consecutive failures to declare offline, ONE success to clear it. Telling somebody they are
// offline when they are not is the expensive mistake; being slow to say it is cheap.

/** Two bad probes raise the alarm — the same threshold `siteUptime` uses, for the same reason. */
export const FAILURES_BEFORE_OFFLINE = 2;

/** No two probes closer together than this, however many reasons arrive at once. */
export const MIN_PROBE_GAP_MS = 20_000;

/** While we believe we are offline, re-probe on this backoff so recovery is noticed quickly. */
export const OFFLINE_RETRY_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000] as const;

/** How long a probe may take before it counts as a failure. */
export const PROBE_TIMEOUT_MS = 6_000;

/** The cheapest endpoint that proves a round trip. Readiness, not health — no dependency checks. */
export const PROBE_PATH = '/api/ready';

export interface ReachabilityState {
  /** What the UI shows. Starts optimistic: an app that cries offline on launch is worse than useless. */
  reachable: boolean;
  /** Consecutive failed probes. Reset by any success. */
  failures: number;
  /** When the last probe was ATTEMPTED, for the gap rule. */
  lastProbeAt: number | null;
}

export const INITIAL_REACHABILITY: ReachabilityState = { reachable: true, failures: 0, lastProbeAt: null };

/** Why a probe is being considered. `recovery` is the only one allowed to ignore the gap. */
export type ProbeReason = 'start' | 'online-event' | 'foreground' | 'recovery';

/**
 * The OS's certain answer, when it has one.
 *
 * `false` here is the one network fact a browser reports reliably, so it is honoured WITHOUT a probe —
 * spending a request to confirm what the operating system already knows would be pure latency.
 */
export function offlineByOs(onLine: boolean | undefined): boolean {
  return onLine === false;
}

/** Should a probe run now? */
export function shouldProbe(
  state: ReachabilityState,
  opts: { onLine?: boolean; now: number; reason: ProbeReason },
): boolean {
  // Nothing to learn: the OS is certain, and the answer is already applied by `afterOsChange`.
  if (offlineByOs(opts.onLine)) return false;
  if (state.lastProbeAt === null) return true;
  // A backoff retry has already waited its own delay; the gap rule would only make recovery slower.
  if (opts.reason === 'recovery') return true;
  return opts.now - state.lastProbeAt >= MIN_PROBE_GAP_MS;
}

/** Fold a probe result into the state. */
export function afterProbe(state: ReachabilityState, ok: boolean, now: number): ReachabilityState {
  if (ok) return { reachable: true, failures: 0, lastProbeAt: now };
  const failures = state.failures + 1;
  return { reachable: failures < FAILURES_BEFORE_OFFLINE, failures, lastProbeAt: now };
}

/**
 * Fold an OS-level change into the state.
 *
 * Going offline is applied at once (the OS is certain). Coming back is NOT: the interface returning
 * says nothing about whether the internet beyond it works, which is the whole reason this module
 * exists — so it only clears `failures` enough to let a probe decide.
 */
export function afterOsChange(state: ReachabilityState, onLine: boolean): ReachabilityState {
  if (!onLine) return { ...state, reachable: false, failures: FAILURES_BEFORE_OFFLINE };
  return { ...state, failures: 0 };
}

/**
 * How long until the next recovery probe, or null when there is nothing to watch for.
 *
 * `null` while reachable is the cost control: a healthy app schedules no timer at all.
 */
export function retryDelayMs(state: ReachabilityState): number | null {
  if (state.reachable) return null;
  const extra = Math.max(0, state.failures - FAILURES_BEFORE_OFFLINE);
  const index = Math.min(extra, OFFLINE_RETRY_BACKOFF_MS.length - 1);
  return OFFLINE_RETRY_BACKOFF_MS[index];
}

/**
 * Run one probe. Injected `fetch` and `timeoutMs` so the policy above is testable without a network.
 *
 * ANY completed response counts, including 4xx and 5xx — see the note at the top of this file.
 */
export async function probeOnce(
  doFetch: (url: string, init: { method: string; cache: RequestCache; signal?: AbortSignal }) => Promise<unknown>,
  opts: { path?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const path = opts.path ?? PROBE_PATH;
  try {
    // `no-store` because a cached 200 would prove nothing about the network right now.
    await doFetch(`${path}?_=${Date.now()}`, { method: 'GET', cache: 'no-store', signal: opts.signal });
    return true;
  } catch {
    return false;
  }
}
