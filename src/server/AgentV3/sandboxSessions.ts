// WHERE DO A SANDBOX'S MINUTES GO? — per-session accounting, pure, so the admin's question has a number.
//
// THE QUESTION (admin's E2B dashboard, 2026-09-11). A session averages ~29 minutes of billed wall-clock.
// A build is ~5-7 minutes of work; the idle window is 5. Roughly seventeen minutes per session were
// unexplained — and "idle between commands" and "slow commands" have completely different fixes. One
// is a sweep problem; the other is a machine or a workload problem. Nothing recorded which it was.
//
// WHAT IS MEASURED. The actuator already holds the raw facts: when the machine came up
// (`_sandboxStartedAt`), how it came up (`_sandboxOrigin`), every operation's start and end
// (`_holdSandboxOp`). This module turns them into ONE record per session — wall-clock, time INSIDE
// operations, time BETWEEN them, how many operations, what started it, what ended it — and the pure
// summaries the build report and the admin card read.
//
// It changes no behaviour. It only makes a number exist that the bill has been implying for a month.

import type { SandboxReason } from './sandboxSessionZone';

export interface SandboxSession {
  sandboxId: string;
  /** How the machine came up — created fresh, resumed, or created after a refused resume. */
  origin: string;
  /** Which caller started it — see sandboxSessionZone.ts. */
  reason: SandboxReason;
  startedAt: number;
  /** First and last moments an operation ran on it, or undefined when none ever did. */
  firstOpAt?: number;
  lastOpAt?: number;
  /** Milliseconds spent with at least one operation in flight. */
  busyMs: number;
  /** Operations run (commands, installs, file ops that hold the machine). */
  ops: number;
  endedAt?: number;
  /** What stopped it, when we know. */
  endedBy?: 'idle-sweep' | 'orphan-sweep' | 'dropped';
}

export interface SessionSummary {
  wallMs: number;
  busyMs: number;
  /** wall − busy: the machine was up and nothing of ours was running on it. */
  idleMs: number;
  /** idle ÷ wall, 0..1; 0 when wall is 0. */
  idleShare: number;
  ops: number;
}

/** Fold a session into the three numbers that matter. `now` stands in for `endedAt` on a live one. */
export function summarizeSession(s: SandboxSession | null | undefined, now: number): SessionSummary | null {
  if (!s) return null;
  const end = Number(s.endedAt ?? now);
  const start = Number(s.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const wallMs = end - start;
  const busyMs = Math.max(0, Math.min(wallMs, Number(s.busyMs) || 0));
  const idleMs = wallMs - busyMs;
  return { wallMs, busyMs, idleMs, idleShare: wallMs > 0 ? idleMs / wallMs : 0, ops: Math.max(0, Number(s.ops) || 0) };
}

/** The one line the build report shows. Never names a vendor. */
export function describeSession(s: SandboxSession | null | undefined, now: number): string {
  const sum = summarizeSession(s, now);
  if (!s || !sum) return 'Sandbox session: not measured on this build';
  const m = (ms: number) => (ms / 60_000).toFixed(1);
  return `Sandbox session: ${m(sum.wallMs)} min up · ${m(sum.busyMs)} min running our operations (${sum.ops}) · `
    + `${m(sum.idleMs)} min idle (${Math.round(sum.idleShare * 100)}%) · started by ${s.reason} · came up ${s.origin}`;
}

export interface MinutesTally {
  sessions: number;
  avgWallMin: number;
  avgBusyMin: number;
  avgIdleMin: number;
  /** Share of all measured wall-clock that was idle, 0..1. */
  idleShare: number;
}

/** Average the ENDED sessions the admin card can see. Live sessions are excluded — their wall is not final. */
export function tallyMinutes(sessions: ReadonlyArray<SandboxSession | null | undefined>): MinutesTally {
  let n = 0, wall = 0, busy = 0;
  for (const s of sessions || []) {
    if (!s || !Number.isFinite(Number(s.endedAt))) continue;
    const sum = summarizeSession(s, Number(s.endedAt));
    if (!sum) continue;
    n++; wall += sum.wallMs; busy += sum.busyMs;
  }
  const r = (ms: number) => Math.round(ms / 6_000) / 10;
  return {
    sessions: n,
    avgWallMin: n ? r(wall / n) : 0,
    avgBusyMin: n ? r(busy / n) : 0,
    avgIdleMin: n ? r((wall - busy) / n) : 0,
    idleShare: wall > 0 ? (wall - busy) / wall : 0,
  };
}

/** Sum the per-day start counters into "how many starts per reason" over the window. */
export function tallyStarts(
  days: ReadonlyArray<{ day: string; counts: Record<string, number> } | null | undefined>,
): { total: number; byReason: Record<string, number>; days: number } {
  const byReason: Record<string, number> = {};
  let total = 0, n = 0;
  for (const d of days || []) {
    if (!d || !d.counts) continue;
    n++;
    for (const [reason, c] of Object.entries(d.counts)) {
      const v = Number(c) || 0;
      if (v <= 0) continue;
      byReason[reason] = (byReason[reason] ?? 0) + v;
      total += v;
    }
  }
  return { total, byReason, days: n };
}

/** The UTC calendar day a start is filed under. Server clock, never the client's. */
export function dayKey(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

// ─── PEAK MEMORY ────────────────────────────────────────────────────────────────────────────────
//
// Needed before ANY change to the template's RAM is safe. E2B bills RAM per wall-clock hour, so the
// only saving that does not risk slowing (and therefore raising the bill on) every build is to keep
// the vCPUs and drop RAM — which is safe only if a real build, WITH the post-build browser gates
// running, provably fits. This asks the machine's own accounting rather than guessing.
//
// cgroup v2 keeps `memory.peak`; v1 keeps `memory.max_usage_in_bytes`. Which one the template's kernel
// exposes is not knowable from here, so the probe tries both and says `unavailable` if neither exists
// — an honest gap, never an invented number.

/** One shell command; prints `v2 <bytes>`, `v1 <bytes>` or `unavailable`. Read-only. */
export const PEAK_MEMORY_PROBE =
  'if [ -r /sys/fs/cgroup/memory.peak ]; then echo "v2 $(cat /sys/fs/cgroup/memory.peak)"; '
  + 'elif [ -r /sys/fs/cgroup/memory/memory.max_usage_in_bytes ]; then echo "v1 $(cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes)"; '
  + 'else echo unavailable; fi';

export interface PeakMemory {
  bytes: number;
  source: 'cgroup-v2' | 'cgroup-v1';
}

/** Parse the probe's output. Anything unexpected is null — the report then says "not available". */
export function parsePeakMemory(stdout: string | null | undefined): PeakMemory | null {
  const m = /^\s*(v1|v2)\s+(\d+)\s*$/m.exec(String(stdout ?? ''));
  if (!m) return null;
  const bytes = Number(m[2]);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return { bytes, source: m[1] === 'v2' ? 'cgroup-v2' : 'cgroup-v1' };
}

/** The report line. States the template's size beside the peak so the headroom is visible. */
export function describePeakMemory(peak: PeakMemory | null, templateGb: number): string {
  if (!peak) return 'Peak memory: not available on this machine (no cgroup accounting exposed)';
  const gb = peak.bytes / 1024 ** 3;
  return `Peak memory: ${gb.toFixed(2)} GB of ${templateGb} GB (${Math.round((gb / templateGb) * 100)}%, ${peak.source})`;
}
