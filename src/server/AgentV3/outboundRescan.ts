// AN APP THAT WAS CLEAN ON MONDAY CAN BE LISTED BY FRIDAY (NavBharat Cloud slice 4 — ROADMAP §11).
//
// The publish-time check (`DeploymentStore` → `webRisk.ts`) asks about an app's outbound hosts ONCE,
// at the moment it goes live. That is the right moment to catch an app that was BUILT to harvest
// credentials — but it is powerless against the other shape: an app published perfectly innocently
// whose outbound host is compromised, sold, or listed weeks later. Nothing about the app changes; the
// world's opinion of where it points does.
//
// So the same question is asked again, on a schedule, over apps that are already live. This module is
// the PURE half — which apps are due, what to do with each verdict — so the policy is testable without
// a database, a clock or a network. The scheduled job that drives it lives in `server.ts`.
//
// 🔒 WHY THIS RE-SCAN IS ALMOST FREE, and why that is by construction rather than by luck: it re-asks
// about ORIGINS, not apps, and `webRisk.ts` caches a clean verdict for six hours. A thousand published
// apps pointing at `api.stripe.com` cost ONE lookup between them. The free tier is spent on the number
// of DISTINCT hosts the platform has ever seen — a number that grows like a vocabulary, not like a
// user base.

import type { DeploymentRecord } from './DeploymentStore';

/**
 * How many apps one sweep will look at.
 *
 * A bound, not a tuning knob — the same discipline as the retention purge's `maxPerRun`. A backlog
 * drains over successive sweeps, which is slower and cannot spike anything.
 */
export const RESCAN_MAX_APPS_PER_RUN = 200;

/** How long before an app is asked about again. Daily is well inside Web Risk's own list churn. */
export const RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RescanCandidate {
  workspaceId: string;
  origins: string[];
}

/**
 * Which live apps are due for a re-scan, and what to ask about. PURE.
 *
 * 🔒 ONLY 'active' APPS. An app already held or taken down is not made safer by re-checking it, and
 * re-flagging one the admin has already actioned is how a queue of real work becomes noise. An
 * 'unpublished' app is not reachable at all, so nobody can be harmed by where it points.
 *
 * 🔒 AN APP WITH NO RECORDED ORIGINS IS SKIPPED, NOT ASSUMED CLEAN. `outboundOrigins` absent means the
 * app was published before that field existed — we do not know what it points at, and inventing "it
 * points at nothing" would be exactly the "unmeasured rendered as zero" mistake this codebase keeps
 * catching. It is reported separately so the gap is visible rather than silent.
 */
export function dueForRescan(
  records: readonly DeploymentRecord[],
  nowMs: number,
  opts: { intervalMs?: number; max?: number } = {},
): { due: RescanCandidate[]; unknownOrigins: string[] } {
  const interval = Number.isFinite(opts.intervalMs) && Number(opts.intervalMs) > 0
    ? Number(opts.intervalMs) : RESCAN_INTERVAL_MS;
  const max = Number.isFinite(opts.max) && Number(opts.max) > 0
    ? Math.floor(Number(opts.max)) : RESCAN_MAX_APPS_PER_RUN;
  const due: RescanCandidate[] = [];
  const unknownOrigins: string[] = [];
  for (const r of records ?? []) {
    if (!r?.workspaceId) continue;
    if ((r.status ?? 'active') !== 'active') continue;
    if (!Array.isArray(r.outboundOrigins)) { unknownOrigins.push(r.workspaceId); continue; }
    if (r.outboundOrigins.length === 0) continue;      // measured, and it points nowhere outbound
    const last = typeof r.updatedAt === 'number' ? r.updatedAt : 0;
    if (nowMs - last < interval) continue;
    due.push({ workspaceId: r.workspaceId, origins: r.outboundOrigins });
    if (due.length >= max) break;
  }
  return { due, unknownOrigins };
}

export type RescanAction =
  /** Google named a threat: hold it, and tell the admin. */
  | 'hold'
  /** Checked, nothing listed. */
  | 'clean'
  /** Could not be checked. Explicitly NOT 'clean', and explicitly not grounds for a takedown. */
  | 'unknown';

/**
 * What to do about one app's re-scan result. PURE.
 *
 * 🔒 ONLY A REAL LISTING ACTS, and the reasoning is the same one that runs through every safety
 * decision in this codebase: an app is taken off the internet on EVIDENCE, never on the absence of an
 * answer. A Web Risk outage, an expired key or a rate limit would otherwise take down every published
 * app on the platform at once — a self-inflicted outage dressed as a safety feature.
 *
 * 🔒 AND IT HOLDS RATHER THAN TAKES DOWN. 'held' is reversible by the admin from the existing restore
 * route; 'taken_down' blocks the owner from ever republishing. A machine acting on a third party's
 * list should reach for the reversible one — the irreversible verdict stays a human's to give.
 */
export function rescanAction(scan: { listed: readonly unknown[]; incomplete: boolean }): RescanAction {
  if (scan.listed.length > 0) return 'hold';
  return scan.incomplete ? 'unknown' : 'clean';
}

export interface RescanReport {
  checked: number;
  held: string[];
  unknown: string[];
  /** Live apps we could not even ask about, because we never recorded what they point at. */
  originsUnrecorded: string[];
}

/** One honest line for the admin. PURE. */
export function rescanSummary(r: RescanReport): string {
  if (r.checked === 0 && r.originsUnrecorded.length === 0) return 'Outbound re-scan: no live apps were due.';
  const bits = [`checked ${r.checked}`];
  if (r.held.length) bits.push(`HELD ${r.held.length} (${r.held.slice(0, 5).join(', ')})`);
  if (r.unknown.length) bits.push(`${r.unknown.length} could not be checked`);
  // Named, because an app nobody can re-check is a permanent blind spot, not a rounding error.
  if (r.originsUnrecorded.length) bits.push(`${r.originsUnrecorded.length} have no recorded outbound hosts (published before the check existed)`);
  return `Outbound re-scan: ${bits.join(', ')}.`;
}

/**
 * Run one sweep. The thin I/O half — the policy above decides, this only carries it out.
 *
 * Best-effort throughout: a store read that fails, a lookup that times out or a write that is refused
 * all leave the app exactly as it was. Nothing here may take an app off the internet except a verdict
 * that named a threat.
 */
export async function runOutboundRescan(deps: {
  list: (opts: { status: 'active'; limit: number }) => Promise<DeploymentRecord[]>;
  scan: (origins: string[]) => Promise<{ listed: readonly { origin: string }[]; incomplete: boolean }>;
  hold: (workspaceId: string, note: string) => Promise<unknown>;
  nowMs?: number;
  intervalMs?: number;
  max?: number;
}): Promise<RescanReport> {
  const now = Number.isFinite(deps.nowMs) ? Number(deps.nowMs) : Date.now();
  const report: RescanReport = { checked: 0, held: [], unknown: [], originsUnrecorded: [] };
  let records: DeploymentRecord[] = [];
  try {
    records = await deps.list({ status: 'active', limit: RESCAN_MAX_APPS_PER_RUN * 4 });
  } catch {
    return report; // a store we cannot read is not evidence about anybody's app
  }
  const { due, unknownOrigins } = dueForRescan(records, now, { intervalMs: deps.intervalMs, max: deps.max });
  report.originsUnrecorded = unknownOrigins;
  for (const candidate of due) {
    report.checked++;
    let action: RescanAction = 'unknown';
    let listedNote = '';
    try {
      const scan = await deps.scan(candidate.origins);
      action = rescanAction(scan);
      listedNote = scan.listed.map((l) => l.origin).join(', ');
    } catch {
      action = 'unknown';
    }
    if (action === 'hold') {
      try {
        await deps.hold(candidate.workspaceId, `Outbound host flagged by the safe-browsing list: ${listedNote}`);
        report.held.push(candidate.workspaceId);
      } catch { /* a failed hold is reported as not-held, never as held */ }
    } else if (action === 'unknown') {
      report.unknown.push(candidate.workspaceId);
    }
  }
  return report;
}
