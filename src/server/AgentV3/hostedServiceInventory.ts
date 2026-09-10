// THE HOSTING CEILING, made visible before it arrives (ROADMAP §11; the same discipline as §10).
//
// 🔴 THE CAP: **1,000 Cloud Run services per project per region, and Google does not raise it**
// (verified 2026-09-07). Past it, hosting stops working for EVERYBODY.
//
// §10 already paid for the lesson that matters most about a cap like this: **it is not reached by
// working apps, it is reached by dead ones nobody deleted.** The Firebase channel ceiling filled with
// records a purge had orphaned — apps still holding the scarce resource, invisible to every count the
// platform had, because our registry counts apps we know about while the cap counts services that
// EXIST. Those two drift, and only reconciling them shows the truth.
//
// 🔒 AND THE SAFETY LESSON, INHERITED VERBATIM FROM channelInventory.ts, WHERE IT WAS A REAL BUG.
// A service with no matching record could mean "genuinely orphaned" or it could mean "the registry did
// not answer". Both used to collapse into one state, that state was reclaimable, and reclaiming
// DELETES — so a single Firestore hiccup listed every live app as reclaimable waste, one click from
// taking working sites down. A missing record is evidence of orphanhood ONLY if the registry was read
// in full. When it was not, that is what `indeterminate` says, and it is never reclaimable.
//
// PURE — no network, no Firestore. The classification is the part worth being certain about.

import { SERVICES_PER_PROJECT_CAP, serviceBelongsTo } from './cloudRunHosting';

export type HostedServiceState =
  /** A hosted app we know about, and it is meant to be live. The service is doing its job. */
  | 'live'
  /** We have a record and it is NOT live any more — the service LEAKED and its slot is wasted. */
  | 'stale'
  /** No record names this service, and the registry WAS read in full — a genuine orphan. */
  | 'orphan'
  /** We cannot tell, because the registry we compared against was incomplete. NEVER reclaimable. */
  | 'indeterminate';

export interface ClassifiedService {
  service: string;
  state: HostedServiceState;
  /** The workspace it belongs to, when a record names it. Null when nothing does. */
  workspaceId: string | null;
  /** True only when removing it frees a slot WITHOUT taking a working app off the internet. */
  reclaimable: boolean;
}

/** What the caller knows about one workspace's hosted app. */
export interface HostedRecord {
  workspaceId: string;
  /** Is this app supposed to be serving right now? */
  live: boolean;
}

/**
 * Reconcile the services that EXIST against the apps we have a record of.
 *
 * `registryComplete` is not a detail — it is the whole safety of this function. Pass false whenever
 * the record list was truncated, errored, or is otherwise not the full picture, and every unmatched
 * service becomes `indeterminate` instead of `orphan`. PURE.
 */
export function classifyHostedServices(
  services: readonly string[] | null | undefined,
  records: readonly HostedRecord[] | null | undefined,
  registryComplete: boolean,
): ClassifiedService[] {
  const known = (records ?? []).filter((r) => r && typeof r.workspaceId === 'string' && r.workspaceId);
  const out: ClassifiedService[] = [];
  for (const service of services ?? []) {
    if (typeof service !== 'string' || !service) continue;
    /**
     * 🔒 MATCHED BY THE WORKSPACE FINGERPRINT, NEVER BY THE FULL NAME. A service is named
     * `<app-slug>-<hash>`, and the slug follows the app's NAME — which the user can change. Matching
     * on the whole name would make a renamed app's live service match nothing, be classified an
     * ORPHAN, and be offered for reclaim: a rename would take the app off the internet.
     */
    const rec = known.find((r) => serviceBelongsTo(service, r.workspaceId));
    if (rec) {
      const state: HostedServiceState = rec.live ? 'live' : 'stale';
      out.push({
        service,
        state,
        workspaceId: rec.workspaceId ?? null,
        // A 'stale' service is also a BUG SIGNAL, not just waste: unpublish deletes the service before
        // touching the registry, so a not-live record whose service still exists means one of those
        // deletes failed and reported success somewhere.
        reclaimable: state === 'stale',
      });
      continue;
    }
    out.push({
      service,
      state: registryComplete ? 'orphan' : 'indeterminate',
      workspaceId: null,
      reclaimable: registryComplete,
    });
  }
  return out;
}

export type CapacityLevel = 'ok' | 'warn' | 'critical' | 'full';

export interface HostingCapacity {
  used: number;
  cap: number;
  /** Slots that could be freed right now without taking a working app down. */
  reclaimable: number;
  /** Slots left after reclaiming what is safely reclaimable. */
  headroom: number;
  level: CapacityLevel;
  /** One sentence for the admin — what is happening and what to do about it. */
  message: string;
}

/**
 * How full is this project, and what should be done about it?
 *
 * The thresholds leave real room to act: a project is called `warn` well before it is a problem,
 * because the fix (a second apps project) is a config change somebody has to actually make, and
 * discovering the need at 999 is discovering it too late. PURE.
 */
export function hostingCapacity(
  classified: readonly ClassifiedService[] | null | undefined,
  cap: number = SERVICES_PER_PROJECT_CAP,
): HostingCapacity {
  const list = classified ?? [];
  const used = list.length;
  const reclaimable = list.filter((c) => c.reclaimable).length;
  const headroom = Math.max(0, cap - used + reclaimable);
  const pct = cap > 0 ? used / cap : 0;

  let level: CapacityLevel = 'ok';
  if (used >= cap) level = 'full';
  else if (pct >= 0.9) level = 'critical';
  else if (pct >= 0.8) level = 'warn';

  const base = `${used} of ${cap} hosting slots used in this project`;
  if (level === 'full') {
    return {
      used, cap, reclaimable, headroom, level,
      message: `${base} — FULL. No new app can be hosted here. ${reclaimable > 0
        ? `${reclaimable} slot(s) can be reclaimed from apps that are no longer live.`
        : 'Add a second apps project (NAVBHARAT_APPS_PROJECT) to keep hosting.'}`,
    };
  }
  if (level === 'critical' || level === 'warn') {
    return {
      used, cap, reclaimable, headroom, level,
      message: `${base}. Google does NOT raise this cap, so the fix is a second apps project — start `
        + `it now rather than at 999.${reclaimable > 0 ? ` ${reclaimable} slot(s) are reclaimable first.` : ''}`,
    };
  }
  return {
    used, cap, reclaimable, headroom, level,
    message: `${base}.${reclaimable > 0 ? ` ${reclaimable} slot(s) are reclaimable from apps no longer live.` : ''}`,
  };
}
