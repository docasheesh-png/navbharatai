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
// cgroup v2 keeps `memory.peak`; v1 keeps `memory.max_usage_in_bytes`. Either may be missing, so the probe tries
// both and says `unavailable` if neither exists — an honest gap, never an invented number.
//
// 🔴 READ IN THE BUILD'S OWN cgroup, NOT AT THE MOUNT ROOT (autopsy 303e8a6f, 2026-10-12). `memory.peak` exists
// only in non-root cgroups. An E2B sandbox is a VM whose envd runs every build command in `/sys/fs/cgroup/user`,
// so reading `/sys/fs/cgroup/memory.peak` found nothing on every build since this shipped (2026-09-11) — and the
// report blamed the machine ("no cgroup accounting exposed") for a file we looked for in the wrong directory.
// The probe now resolves its own cgroup from /proc/self/cgroup (see cgroupSelf.ts); under a cgroup namespace
// that is `/`, so a container reads exactly what it read before.

/**
 * One shell command, read-only. Prints `v2 <bytes> oom_kill=<n> cgroup=<path>`, `v1 <bytes>` or
 * `unavailable cgroup=<path>`. The paths are parameters only so a test can run it against a fixture tree.
 */
export function peakMemoryProbe(cgroupRoot = '/sys/fs/cgroup', selfCgroup = '/proc/self/cgroup'): string {
  const root = cgroupRoot.replace(/\/+$/, '');
  return `cg=$(sed -n 's/^0:://p' ${selfCgroup} 2>/dev/null | head -n1); d="${root}\${cg%/}"; `
    + `if [ -r "$d/memory.peak" ]; then echo "v2 $(cat "$d/memory.peak") oom_kill=$(sed -n 's/^oom_kill //p' "$d/memory.events" 2>/dev/null) cgroup=\${cg:-/}"; `
    + `elif [ -r ${root}/memory/memory.max_usage_in_bytes ]; then echo "v1 $(cat ${root}/memory/memory.max_usage_in_bytes)"; `
    + `else echo "unavailable cgroup=\${cg:-unknown}"; fi`;
}

/** The probe production runs — the tested builder, never a separate string. */
export const PEAK_MEMORY_PROBE = peakMemoryProbe();

/** What the probe found. `null` from the parser means it gave no readable answer at all. */
export type PeakMemory =
  | { kind: 'value'; bytes: number; source: 'cgroup-v2' | 'cgroup-v1'; cgroup?: string; oomKills?: number }
  | { kind: 'unavailable'; cgroup?: string };

/** Parse the probe's output. Anything unexpected is null — the report then says it was not measured. */
export function parsePeakMemory(stdout: string | null | undefined): PeakMemory | null {
  const text = String(stdout ?? '');
  const m = /^\s*(v1|v2)\s+(\d+)(?:\s+oom_kill=(\d*))?(?:\s+cgroup=(\S+))?\s*$/m.exec(text);
  if (m) {
    const bytes = Number(m[2]);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    const oom = m[3] ? Number(m[3]) : NaN;
    return {
      kind: 'value', bytes, source: m[1] === 'v2' ? 'cgroup-v2' : 'cgroup-v1',
      ...(m[4] ? { cgroup: m[4] } : {}),
      ...(Number.isFinite(oom) ? { oomKills: oom } : {}),
    };
  }
  const u = /^\s*unavailable(?:\s+cgroup=(\S+))?\s*$/m.exec(text);
  if (u) return { kind: 'unavailable', ...(u[1] && u[1] !== 'unknown' ? { cgroup: u[1] } : {}) };
  return null;
}

/**
 * The report line. Three different facts, three different sentences: a number (with the template's size beside
 * it, so the headroom is visible), a machine that answered "this cgroup keeps no counter", and a probe that never
 * answered. The last two used to share one sentence that blamed the machine for both.
 */
export function describePeakMemory(peak: PeakMemory | null, templateGb: number): string {
  if (!peak) return 'Peak memory: not measured — the probe gave no readable answer (it timed out, failed or printed something unexpected), so nothing is known about memory.';
  if (peak.kind === 'unavailable') {
    return `Peak memory: not available — the build's cgroup (${peak.cgroup ?? 'not identified'}) keeps no memory.peak, and there is no cgroup-v1 counter either.`;
  }
  const gb = peak.bytes / 1024 ** 3;
  // memory.peak counts reclaimable file cache too, so this is an UPPER bound on what the build needed; the
  // out-of-memory kill count is the fact that says whether memory ever actually ran out.
  const where = peak.cgroup ? ` ${peak.cgroup}` : '';
  const oom = typeof peak.oomKills === 'number' ? `; ${peak.oomKills} out-of-memory kill${peak.oomKills === 1 ? '' : 's'}` : '';
  const bound = peak.source === 'cgroup-v2' ? ' — an upper bound: it includes reclaimable file cache' : '';
  return `Peak memory: ${gb.toFixed(2)} GB of ${templateGb} GB (${Math.round((gb / templateGb) * 100)}%, ${peak.source}${where}${bound}${oom})`;
}
