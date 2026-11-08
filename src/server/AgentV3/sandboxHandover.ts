// Read-only legacy build/pause timing proxies. The workspace-only join does not establish exact
// sandbox identity or non-overlapping provider billing intervals. Preserve numeric API fields for
// compatibility, but do not interpret frontend-only hold or its global-rate projection as savings.
// Missing pause metadata stays unknown; a recorded pause is still local evidence, not an invoice.

import { builtAServer } from './serverNecessity';

/** One build, joined with whatever the durable sandbox record knows about the same workspace. */
export interface HandoverInput {
  workspaceId: string;
  /** Build report: when the build's own work started and finished. */
  startedAt?: number | null;
  endedAt?: number | null;
  /** Build report: the manifest's file paths — what the build actually WROTE. */
  paths?: ReadonlyArray<string> | null;
  /** Sandbox record: epoch ms a build last took or released this sandbox. */
  sandboxUpdatedAt?: number | null;
  /** Sandbox record: epoch ms a pause path stamped it. Absent = we cannot see when it stopped. */
  sandboxPausedAt?: number | null;
}

/** Why a sample could not be measured. Each is a genuinely different unknown, so each is counted apart. */
export type HandoverUnknown =
  /** The report never recorded a usable start/end — an unsettled or legacy build. */
  | 'no-build-window'
  /** No durable sandbox record for this workspace (warm resume off, or the record was cleared). */
  | 'no-sandbox-record'
  /** A record exists but nothing ever stamped a pause — the hold is real but unmeasurable. */
  | 'never-paused'
  /** The pause predates this build's end: the record belongs to an earlier sandbox, not this build. */
  | 'stale-pairing';

export type HandoverSample =
  | { known: false; why: HandoverUnknown }
  | {
      known: true;
      /** ms the build's own work took. */
      buildMs: number;
      /** Legacy proxy: time between the build end and workspace record's pause timestamp. */
      heldAfterMs: number;
      /** True when the build wrote no server code, so the browser could have served the preview. */
      frontendOnly: boolean;
    };

/**
 * Measure ONE build. Pure.
 *
 * Order matters: the build window is checked first because without it there is nothing to measure the
 * hold against, and reporting "no sandbox record" for a build that never even settled would point the
 * reader at the wrong missing thing.
 */
export function handoverSample(input: HandoverInput): HandoverSample {
  const startedAt = Number(input?.startedAt);
  const endedAt = Number(input?.endedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0 || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return { known: false, why: 'no-build-window' };
  }
  const updatedAt = Number(input?.sandboxUpdatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return { known: false, why: 'no-sandbox-record' };
  const pausedAt = Number(input?.sandboxPausedAt);
  if (!Number.isFinite(pausedAt) || pausedAt <= 0) return { known: false, why: 'never-paused' };
  // A pause stamped BEFORE this build ended cannot describe this build's sandbox. The record is
  // per-workspace and the latest write wins, so an older pairing is normal — and silently treating it
  // as a zero-length hold would drag the average down with data that is simply about something else.
  if (pausedAt < endedAt) return { known: false, why: 'stale-pairing' };
  return {
    known: true,
    buildMs: endedAt - startedAt,
    heldAfterMs: pausedAt - endedAt,
    frontendOnly: !builtAServer(input?.paths ?? []),
  };
}

export interface HandoverTally {
  /** Builds looked at. */
  examined: number;
  /** Builds with both halves present — the only ones any number below is computed from. */
  measured: number;
  /** Why the rest could not be measured, counted by cause. */
  unknown: Record<HandoverUnknown, number>;
  /** Sum of reported build durations across paired records; may overlap. */
  buildHours: number;
  /** Sum of build-to-pause timing proxies; not distinct billed intervals. */
  heldAfterHours: number;
  /** Of the measured builds, how many wrote no server code. */
  frontendOnlyCount: number;
  /**
   * Legacy name: frontend-only build-to-pause proxy hours, not measured reclaimable time.
   * Interval identity, overlap and actual preview requirements have not been verified.
   */
  recoverableHours: number;
  /** Epoch ms of the earliest and latest measured build, so a rate can be stated with its window. */
  firstAt: number;
  lastAt: number;
}

const MS_PER_HOUR = 3_600_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Roll a set of builds into the table Phase 3's go/no-go needs. PURE. */
export function tallyHandover(inputs: ReadonlyArray<HandoverInput>): HandoverTally {
  const t: HandoverTally = {
    examined: 0,
    measured: 0,
    unknown: { 'no-build-window': 0, 'no-sandbox-record': 0, 'never-paused': 0, 'stale-pairing': 0 },
    buildHours: 0,
    heldAfterHours: 0,
    frontendOnlyCount: 0,
    recoverableHours: 0,
    firstAt: 0,
    lastAt: 0,
  };
  let buildMs = 0;
  let heldMs = 0;
  let recoverableMs = 0;
  for (const input of inputs ?? []) {
    if (!input) continue;
    t.examined += 1;
    const s = handoverSample(input);
    if (!s.known) { t.unknown[s.why] += 1; continue; }
    t.measured += 1;
    buildMs += s.buildMs;
    heldMs += s.heldAfterMs;
    if (s.frontendOnly) { t.frontendOnlyCount += 1; recoverableMs += s.heldAfterMs; }
    const at = Number(input.startedAt);
    if (!t.firstAt || at < t.firstAt) t.firstAt = at;
    if (at > t.lastAt) t.lastAt = at;
  }
  t.buildHours = round2(buildMs / MS_PER_HOUR);
  t.heldAfterHours = round2(heldMs / MS_PER_HOUR);
  t.recoverableHours = round2(recoverableMs / MS_PER_HOUR);
  return t;
}

/**
 * The measured E2B rate, in USD per running sandbox-hour — re-exported from the single source of truth.
 *
 * 🔴 THE COMMENT THAT STOOD HERE WAS THE BUG, WRITTEN DOWN AS A JUSTIFICATION. It read: *"CLAUDE.md
 * derives $0.083 from the admin's own dashboard ($172.08 ÷ 2,078.29 vCPU-hours, with RAM-hours exactly
 * 2× vCPU-hours, i.e. every sandbox is 1 vCPU + 2 GB)"*. Every clause is true except the last one, and
 * that one does not follow: a RAM-to-vCPU ratio of 2.0 describes the sandbox's shape and is equally
 * true of 2 vCPU + 4 GB — which is what `infra/e2b/build.mjs` actually builds. So $0.0828 per
 * **vCPU**-hour was recorded as the price of a **wall-clock** hour, understating every VM figure by 2×.
 *
 * Kept as a re-export rather than deleted because the reasoning is the useful part: "not invented" was
 * true, and it was still wrong. A derivation is only checked when it can fail — see `sandboxRate.ts`,
 * which reproduces two consecutive invoices to the cent.
 */
export { sandboxUsdPerHour } from './sandboxRate';
import { sandboxUsdPerHour } from './sandboxRate';

export interface HandoverProjection {
  /** Days the measured sample spans. 0 when fewer than two builds landed. */
  spanDays: number;
  /** Legacy frontend-only timing proxy per day, not verified savings. */
  recoverableHoursPerDay: number;
  /** A 30-day extrapolation in USD. An extrapolation — the field name says so on purpose. */
  monthlyUsdEstimate: number;
}

/**
 * Extrapolate the sample to a month. Deliberately separate from `tallyHandover` so the MEASURED
 * numbers and the ESTIMATED one can never be mistaken for each other in a caller or on a screen.
 *
 * Returns zeros for a sample too short to have a rate — a single build spans no time, and dividing by
 * that would produce an enormous confident number from one data point.
 */
export function projectHandover(t: HandoverTally, usdPerHour = sandboxUsdPerHour()): HandoverProjection {
  const spanMs = t && t.lastAt > t.firstAt ? t.lastAt - t.firstAt : 0;
  const spanDays = spanMs / 86_400_000;
  if (!(spanDays > 0) || t.measured < 2) return { spanDays: 0, recoverableHoursPerDay: 0, monthlyUsdEstimate: 0 };
  const perDay = t.recoverableHours / spanDays;
  return {
    spanDays: round2(spanDays),
    recoverableHoursPerDay: round2(perDay),
    monthlyUsdEstimate: round2(perDay * 30 * usdPerHour),
  };
}

/** Describe the unchanged legacy timing proxies without treating them as billing or savings. */
export function handoverHeadline(t: HandoverTally, p: HandoverProjection = projectHandover(t)): string {
  const limits = 'Workspace-only joins may pair different sandbox observations or overlap across builds. These are sampled timing proxies, not provider-billed intervals or measured savings.';
  if (!t || t.measured <= 0) {
    return `No builds could be paired yet (${t?.examined ?? 0} looked at). Missing timing is unknown, not zero. ${limits}`;
  }
  const parts = [
    `Across ${t.measured} paired build records: ${t.buildHours}h of reported build duration and ${t.heldAfterHours}h between build ends and recorded pauses.`,
    `${t.recoverableHours}h of the latter is associated with frontend-only manifests (${t.frontendOnlyCount} builds); this does not establish avoidable time.`,
    limits,
  ];
  if (p.monthlyUsdEstimate > 0) {
    parts.push('The legacy monthly projection is not a savings forecast: interval identity, non-overlap and per-session rates are unverified.');
  }
  if (t.measured < t.examined) {
    parts.push(`${t.examined - t.measured} of ${t.examined} builds could not be paired and are excluded, never counted as zero.`);
  }
  return parts.join(' ');
}
