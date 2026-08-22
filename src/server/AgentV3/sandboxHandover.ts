// PHASE 0 of the in-browser preview plan — where does a sandbox's billed life actually GO?
//
// WHY THIS EXISTS. The plan (IN_BROWSER_PREVIEW_PLAN.md §0) opens by correcting my own framing: I was
// about to argue that hardening the in-browser preview would remove most of the E2B bill. The
// arithmetic already recorded in CLAUDE.md says otherwise — AGENTV3_SANDBOX_IDLE_MINUTES is 5 (this
// comment said 15 until 2026-08-22; it was written the same day the change landed), which caps TOTAL
// idle across 1,260 sandboxes at ~105 billed hours (~$8.70/month). The idle lever is spent. So the
// remaining ~1,970 of 2,078 billed hours must be real build activity, which no browser can absorb.
//
// That correction came from arithmetic on a monthly total. This module replaces the arithmetic with a
// per-build MEASUREMENT, because the same project has now twice acted on a remembered number instead of
// a read one, and "an estimate wearing a roadmap" is exactly what Phase 3 must not be approved on.
//
// THE ONE QUESTION IT ANSWERS: after a build's own work FINISHED, how much longer did its sandbox stay
// billable — and how much of that belonged to a frontend-only app the browser could have served itself?
// That number, and nothing else, is what Phase 3 (hand the preview over and pause the sandbox) can
// reclaim.
//
// NO NEW TELEMETRY. Both halves are already persisted:
//   • the build report  → `startedAt` / `endedAt` / the manifest's file paths (DiagnosticsStore)
//   • the sandbox record → `updatedAt` / `pausedAt` (SandboxStore; `pausedAt` is stamped by BOTH pause
//     paths — the owning instance's idle sweep AND the durable orphan reaper — so the common case is
//     covered, not just orphans)
// Adding a new recorder would mean waiting weeks for data we can read today.
//
// PURE and deterministic. UNKNOWN IS A FIRST-CLASS ANSWER: a sandbox with no `pausedAt` was not held
// for zero minutes, it was held for a time we cannot see (the process died, or E2B's own lifetime
// expired). Counting those as zero would flatter exactly the number this exists to test.

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
      /** ms the sandbox stayed billable AFTER the build finished — the window Phase 3 targets. */
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
  /** Total hours of real build work across the measured builds. */
  buildHours: number;
  /** Total hours those sandboxes stayed billable after their build finished. */
  heldAfterHours: number;
  /** Of the measured builds, how many wrote no server code. */
  frontendOnlyCount: number;
  /**
   * Held-after hours belonging to frontend-only builds — the ONLY hours Phase 3 can actually reclaim.
   * An app with a server still needs the sandbox to answer its own API calls.
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
 * The measured E2B rate, in USD per running sandbox-hour.
 *
 * NOT invented: CLAUDE.md derives $0.083 from the admin's own dashboard ($172.08 ÷ 2,078.29 vCPU-hours,
 * with RAM-hours exactly 2× vCPU-hours, i.e. every sandbox is 1 vCPU + 2 GB). Env-tunable because the
 * rate is a real-world number that moves, and a hardcoded price is a future lie.
 */
export function sandboxUsdPerHour(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.E2B_USD_PER_HOUR);
  return Number.isFinite(v) && v > 0 ? v : 0.083;
}

export interface HandoverProjection {
  /** Days the measured sample spans. 0 when fewer than two builds landed. */
  spanDays: number;
  /** Reclaimable hours per day, at the sample's own rate. */
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

/**
 * The honest headline — the measured split first, the extrapolation last, and the limits stated inline.
 *
 * It says what share of billed life is post-build holding, because that is the whole question: if the
 * share is small, Phase 3 is a reliability change and must not be sold as a cost one, and this sentence
 * is what stops it being sold as a cost one.
 */
export function handoverHeadline(t: HandoverTally, p: HandoverProjection = projectHandover(t)): string {
  if (!t || t.measured <= 0) {
    return `No builds could be measured yet (${t?.examined ?? 0} looked at). A build needs both a settled report and a stamped sandbox pause before its hold is visible.`;
  }
  const billed = t.buildHours + t.heldAfterHours;
  const heldPct = billed > 0 ? Math.round((t.heldAfterHours / billed) * 100) : 0;
  const parts = [
    `Across ${t.measured} measured builds: ${t.buildHours}h of real build work and ${t.heldAfterHours}h of sandbox held AFTER the build finished — post-build holding is ${heldPct}% of billed sandbox life.`,
    `${t.recoverableHours}h of that belongs to frontend-only apps (${t.frontendOnlyCount} builds), which is the only part handing the preview to the browser can reclaim.`,
  ];
  if (p.monthlyUsdEstimate > 0) {
    parts.push(`Over the sample's ${p.spanDays} days that extrapolates to about $${p.monthlyUsdEstimate}/month — an EXTRAPOLATION from this window, not a bill.`);
  }
  if (t.measured < t.examined) {
    parts.push(`${t.examined - t.measured} of ${t.examined} builds could not be measured and are excluded, never counted as zero.`);
  }
  return parts.join(' ');
}
