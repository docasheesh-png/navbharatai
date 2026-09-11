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
//   • E2B pausing it when its own `timeoutMs` expires — which is now the NORMAL end for any sandbox
//     both sweeps miss, because #2782 set `lifecycle: { onTimeout: 'pause' }` deliberately;
//   • E2B killing it, which is what happened before #2782;
//   • the sandbox dying for any other reason.
//
// None of those is billing. All of them were counted as "billed by the minute". And the error runs
// the other way too: the orphan sweep writes `pausedAt` after three FAILED pause attempts
// (`shouldMarkPausedAfterFailure`) precisely because the machine might still be alive — so a sandbox
// that really is running can be counted as stopped.
//
// 🔒 THE RULE THIS BREAKS is the one about status indicators: a number that claims money is being
// spent must reflect real state, never a guess. On the platform's largest infrastructure line, an
// invented figure is worse than no figure — it is the one an admin would act on.
//
// So this asks the only authority there is. E2B's own API lists sandboxes filtered by state, and
// `running` is the state that bills. Everything here is PURE except the injected lister, so the
// pagination, the bounding and the honest-unknown rules are unit-testable without a network.

/** One sandbox as E2B reports it. Only the field this module judges on is required. */
export interface ListedSandbox {
  state?: string | null;
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

export interface LiveSandboxCount {
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
  if (typeof fetchPage !== 'function') {
    return { running: null, truncated: false, reason: 'No cloud sandbox provider is configured on this deployment.' };
  }
  let running = 0;
  let token: string | undefined;
  try {
    for (let page = 0; page < MAX_SANDBOX_PAGES; page++) {
      const res = await fetchPage(token);
      const items = Array.isArray(res?.items) ? res.items : [];
      for (const s of items) {
        if (String(s?.state ?? '').trim().toLowerCase() === BILLING_STATE) running++;
      }
      const next = res?.nextToken;
      if (!next) return { running, truncated: false };
      token = next;
    }
    // Ran out of pages before running out of sandboxes: the number is a floor, and says so.
    return { running, truncated: true };
  } catch (err) {
    return {
      running: null,
      truncated: false,
      reason: err instanceof Error ? `Could not reach the sandbox provider: ${err.message}` : 'Could not reach the sandbox provider.',
    };
  }
}

/**
 * The sub-line under the tile. It must never say "billed by the minute" about a number we did not
 * measure — that sentence is the one an admin reads as "money is leaving right now".
 */
export function liveSandboxNote(count: LiveSandboxCount): string {
  if (count.running === null) return count.reason || 'Could not ask the sandbox provider — this is unknown, not zero.';
  if (count.running === 0) return 'Nothing running — no machine is billing right now.';
  const base = `Running now — billed by the minute${count.truncated ? ' (at least; more pages not read)' : ''}`;
  return base;
}
