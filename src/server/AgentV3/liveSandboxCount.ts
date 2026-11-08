// HOW MANY MACHINES ARE ACTUALLY RUNNING — asked of E2B, not inferred from our own bookkeeping.
//
// WHY THIS EXISTS (admin screenshot, 2026-09-11). The Monitor showed **"LIVE SANDBOXES 18 — Running
// now, billed by the minute"** directly beside **"BUILDS —, no build in window"** for the last six
// hours. Eighteen machines billing with nobody building is either the most expensive bug in the
// platform or a counting error, and NOBODY COULD TELL WHICH, because the tile never asked E2B
// anything.
//
// What it did instead: `sandboxStore.listRecent(200).filter(r => !r.pausedAt)` — "every record we did
// not pause OURSELVES". `pausedAt` is written from exactly three places, all inside our own idle and
// orphan sweeps. So every other way a sandbox stops running left the record looking alive:
//
//   • E2B pausing it at timeout when its lifecycle permits it — new creates request pause, but
//     connect/setTimeout do not convert legacy kill policies and this list cannot verify them;
//   • E2B killing it, which is what happened before #2782;
//   • the sandbox dying for any other reason.
//
// None of those is billing. All of them were counted as "billed by the minute". And the error runs
// the other way too: before the safety repair, the orphan sweep wrote `pausedAt` after three FAILED
// pause attempts even though the machine might still be alive. That historical false settlement
// has since been removed; provider state remains the authority for this counter.
//
// 🔒 THE RULE THIS BREAKS is the one about status indicators: a number that claims money is being
// spent must reflect real state, never a guess. On the platform's largest infrastructure line, an
// invented figure is worse than no figure — it is the one an admin would act on.
//
// So this asks the only authority there is. E2B's own API lists sandboxes filtered by state, and
// `running` is the state that bills. Everything here is PURE except the injected lister, so the
// pagination, the bounding and the honest-unknown rules are unit-testable without a network.

/**
 * Fields accepted from the provider adapter. E2B SDK 2.50.0's list paginator currently drops
 * lifecycle, even if present in the raw response. Its getInfo mapping differs. The running count
 * is measured, but real list results therefore have UNKNOWN policies. Do not infer defaults or
 * add per-machine getInfo calls here; this admin read must remain bounded and list-only.
 */
export interface ListedSandbox {
  state?: string | null;
  /** Only explicit provider-reported timeout actions count; absence is unknown. */
  lifecycle?: { onTimeout?: unknown } | null;
}

/**
 * Fetch one page of sandboxes from E2B. Injected so this module never imports the SDK — the network
 * lives at the call site and the decisions live here, where they can be tested.
 */
export type SandboxPageFetcher = (nextToken?: string) => Promise<{
  items: ListedSandbox[];
  nextToken?: string | null;
}>;

/**
 * How many pages we will walk before stopping.
 *
 * A bound rather than a full enumeration, because this runs inside an ADMIN DASHBOARD REQUEST: an
 * account with thousands of paused sandboxes must not turn one panel load into a minutes-long crawl
 * of an external API. Five pages at E2B's default hundred-per-page is five hundred running machines,
 * which is far beyond anything this platform's cost profile could survive unnoticed anyway.
 */
export const MAX_SANDBOX_PAGES = 5;

/** The state that actually costs money. A paused sandbox bills no compute; only a running one does. */
export const BILLING_STATE = 'running';

export interface RunningSandboxLifecycle {
  scope: 'configured provider account';
  population: 'running only';
  /** Completion time of this bounded read, not a transactionally consistent fleet snapshot. */
  observedAt: string;
  partial: boolean;
  pauseOnTimeout: number | null;
  killOnTimeout: number | null;
  unknown: number | null;
}

export interface LiveSandboxCount {
  lifecycle?: RunningSandboxLifecycle;
  /** Machines E2B says are RUNNING right now, or null when we could not ask. */
  running: number | null;
  /**
   * True when the walk stopped at the page bound with more pages left, so `running` is a floor rather
   * than a total. Surfaced instead of silently reporting a smaller number as if it were complete.
   */
  truncated: boolean;
  /** Why the answer is null, in plain words, for the tile to show instead of a confident dash. */
  reason?: string;
}

/**
 * Count the sandboxes E2B reports as running.
 *
 * 🔒 NEVER RETURNS 0 FOR A FAILED QUESTION. A count is only a number when the API actually answered;
 * a timeout, a missing key or a rejected request yields `null` with a reason. Zero and "we could not
 * ask" are opposite facts about a cost line, and a gate that reports the reassuring one when it means
 * the other is exactly the fake-status this file exists to end.
 */
export async function countRunningSandboxes(
  fetchPage: SandboxPageFetcher | null | undefined,
): Promise<LiveSandboxCount> {
  let pauseOnTimeout = 0;
  let killOnTimeout = 0;
  let unknown = 0;
  const lifecycle = (partial: boolean, failed = false): RunningSandboxLifecycle => ({
    scope: 'configured provider account',
    population: 'running only',
    observedAt: new Date().toISOString(),
    partial,
    pauseOnTimeout: failed ? null : pauseOnTimeout,
    killOnTimeout: failed ? null : killOnTimeout,
    unknown: failed ? null : unknown,
  });
  if (typeof fetchPage !== 'function') {
    return { running: null, truncated: false, lifecycle: lifecycle(true, true), reason: 'No cloud sandbox provider is configured on this deployment.' };
  }
  let running = 0;
  let token: string | undefined;
  try {
    for (let page = 0; page < MAX_SANDBOX_PAGES; page++) {
      const res = await fetchPage(token);
      if (!Array.isArray(res?.items)) throw new Error('Invalid provider page');
      const items = res.items;
      for (const s of items) {
        if (String(s?.state ?? '').trim().toLowerCase() !== BILLING_STATE) continue;
        running++;
        if (s?.lifecycle?.onTimeout === 'pause') pauseOnTimeout++;
        else if (s?.lifecycle?.onTimeout === 'kill') killOnTimeout++;
        else unknown++;
      }
      const next = res?.nextToken;
      if (!next) return { running, truncated: false, lifecycle: lifecycle(false) };
      token = next;
    }
    // Ran out of pages before running out of sandboxes: the number is a floor, and says so.
    return { running, truncated: true, lifecycle: lifecycle(true) };
  } catch {
    return {
      running: null,
      truncated: false,
      lifecycle: lifecycle(true, true),
      // Provider errors can contain credentials, URLs or identifiers. Never return their raw text.
      reason: 'Could not read the sandbox provider; running machines and timeout policies are unknown.',
    };
  }
}

/**
 * The sub-line under the tile. It must never say "billed by the minute" about a number we did not
 * measure — that sentence is the one an admin reads as "money is leaving right now".
 */
export function liveSandboxNote(count: LiveSandboxCount): string {
  if (count.running === null) return count.reason || 'Could not ask the sandbox provider — this is unknown, not zero.';
  if (count.running === 0 && !count.truncated) return 'Provider listing reported no running VMs in the configured account.';
  const base = `Running now — billed by the minute${count.truncated ? ' (at least; more pages not read)' : ''}`;
  return base;
}

/** Admin-only explanation; timeout policy is not a promise of recovery or an inventory of paused VMs. */
export function runningSandboxLifecycleNote(count: LiveSandboxCount): string {
  const summary = count.lifecycle;
  const scope = 'Configured provider account; running VMs only. Paused VMs are not inventoried.';
  if (!summary || count.running === null) return `${scope} Timeout policies unknown: no successful reading.`;
  const coverage = summary.partial ? 'Partial reading; counts are lower bounds.' : 'Bounded listing completed; not an atomic snapshot.';
  if (count.running > 0 && summary.unknown === count.running) {
    return `${scope} ${coverage} Timeout policy unknown for ${summary.unknown} running VMs: this listing/SDK supplies no recognized timeout policies. Pause/kill behavior is unknown; workspace recovery cannot be confirmed. Observed at ${summary.observedAt}.`;
  }
  return `${scope} ${coverage} Reported pause on timeout: ${summary.pauseOnTimeout}; reported kill on timeout: ${summary.killOnTimeout}; unknown policy: ${summary.unknown}. Observed at ${summary.observedAt}. Policy does not guarantee workspace recovery.`;
}
