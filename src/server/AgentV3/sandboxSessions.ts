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
import { ownCgroupMemoryProbe } from '../lib/cgroupSelf';

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
 * The read-only probe that asks a machine for the high-water mark of the cgroup the build's commands run in. Built in
 * `cgroupSelf.ts` (the one module that knows cgroup file names); the parameters exist for the fixture tests.
 *
 * 🔴 AUTOPSY 303e8a6f: the first probe read `/sys/fs/cgroup/memory.peak` — a file the kernel never creates in the
 * ROOT cgroup — so every E2B build since 2026-09-11 reported "no cgroup accounting exposed". The probe now reads its
 * OWN cgroup (v2 `/user` on an E2B VM; its own v1 memory cgroup on a hybrid host, never the host's root).
 */
export function peakMemoryProbe(cgroupRoot?: string, selfCgroup?: string): string {
  return ownCgroupMemoryProbe(cgroupRoot, selfCgroup);
}

/** The probe production runs — the tested builder, never a separate string. */
export const PEAK_MEMORY_PROBE = peakMemoryProbe();

/** What the probe found. `null` from the parser means it gave no readable answer at all. */
export type PeakMemory =
  | {
    kind: 'value'; bytes: number; source: 'cgroup-v2' | 'cgroup-v1'; cgroup?: string;
    /** memory.events: out-of-memory kills, and `high` (reclaim-throttle) events — both counted since the cgroup began. */
    oomKills?: number; highEvents?: number;
    /** The cgroup's OWN limit (memory.max) — the real ceiling, which envd sets below the template's RAM. */
    limitBytes?: number;
  }
  | { kind: 'unavailable'; cgroup?: string };

/** Parse the probe's output. Anything unexpected is null — the report then says it was not measured. */
export function parsePeakMemory(stdout: string | null | undefined): PeakMemory | null {
  const text = String(stdout ?? '');
  const m = /^\s*(v1|v2)\s+(\d+)((?:\s+[a-z_]+=\S*)*)\s*$/m.exec(text);
  if (m) {
    const bytes = Number(m[2]);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    const kv = new Map([...(m[3] ?? '').matchAll(/([a-z_]+)=(\S*)/g)].map((x) => [x[1]!, x[2]!] as [string, string]));
    const num = (k: string): number | undefined => {
      const v = kv.get(k);
      if (v === undefined || v === '' || !/^\d+$/.test(v)) return undefined;
      return Number(v);
    };
    const oom = num('oom_kill');
    const high = num('high');
    const limit = num('max');
    const cgroup = kv.get('cgroup');
    return {
      kind: 'value', bytes, source: m[1] === 'v2' ? 'cgroup-v2' : 'cgroup-v1',
      ...(cgroup ? { cgroup } : {}),
      ...(oom !== undefined ? { oomKills: oom } : {}),
      ...(high !== undefined ? { highEvents: high } : {}),
      ...(limit !== undefined && limit > 0 && limit < 1024 ** 4 ? { limitBytes: limit } : {}),
    };
  }
  const u = /^\s*unavailable(?:\s+cgroup=(\S+))?\s*$/m.exec(text);
  if (u) return { kind: 'unavailable', ...(u[1] && u[1] !== 'unknown' ? { cgroup: u[1] } : {}) };
  return null;
}

/** Why a probe gave no reading, when it did not: it timed out, or it failed (a dead or unreachable machine). */
export type PeakProbeFailure = { kind: 'timeout' | 'error' | 'no-session'; reason?: string };

export interface DescribePeakOptions {
  /** The same probe at the end of setup — the machine's high-water mark BEFORE this build's work began. */
  start?: PeakMemory | null;
  /** Why the end probe gave nothing, when it did not. */
  failure?: PeakProbeFailure | null;
  /** How long ago this sandbox session started, and how it came up ("created fresh", "resumed", …). */
  sessionAgeMs?: number | null;
  sessionOrigin?: string | null;
}

const gbOf = (bytes: number) => bytes / 1024 ** 3;

/**
 * The report line. Each different fact gets its own sentence — and a number says what it is the peak OF.
 *
 * ⚠️ THE COUNTER IS THE MACHINE'S, NOT THE BUILD'S (adversarial review of 303e8a6f). `memory.peak` and the
 * `memory.events` counts run from when the cgroup was created; kernel 6.1 cannot reset them, and our machines are
 * kept warm, paused and resumed across builds. So the probe also runs at the end of setup: if the end value is
 * higher, the build raised the mark and it IS this build's peak; if not, the build stayed under an earlier mark
 * and only that is said. With no start reading, the number is labelled "since this machine came up". The
 * percentage is of the cgroup's own limit (envd sets it below the template's RAM), never of a number it can't reach.
 */
export function describePeakMemory(peak: PeakMemory | null, templateGb: number, opts: DescribePeakOptions = {}): string {
  if (!peak) {
    const f = opts.failure;
    if (f?.kind === 'no-session') return 'Peak memory: not measured — no live sandbox session was left to ask, and a probe would only have started a new machine.';
    if (f?.kind === 'timeout') return `Peak memory: not measured — the probe did not answer in time${f.reason ? ` (${f.reason})` : ''}, so nothing is known about memory.`;
    if (f?.kind === 'error') return `Peak memory: not measured — the probe failed${f.reason ? ` (${f.reason})` : ''}, so nothing is known about memory.`;
    return 'Peak memory: not measured — the probe printed nothing readable, so nothing is known about memory.';
  }
  if (peak.kind === 'unavailable') {
    return `Peak memory: not available — the build's cgroup (${peak.cgroup ?? 'not identified'}) keeps no peak-memory counter (cgroup v2), and there is no cgroup-v1 counter either.`;
  }
  const ceilingGb = typeof peak.limitBytes === 'number' ? gbOf(peak.limitBytes) : templateGb;
  const ceiling = typeof peak.limitBytes === 'number' ? `${ceilingGb.toFixed(2)} GB (the cgroup's own limit; template ${templateGb} GB)` : `${templateGb} GB`;
  const pct = (bytes: number) => Math.round((gbOf(bytes) / ceilingGb) * 100);
  const where = `${peak.source}${peak.cgroup ? ` ${peak.cgroup}` : ''}`;
  const bound = peak.source === 'cgroup-v2' ? ' — an upper bound: it includes reclaimable file cache' : '';
  const start = opts.start && opts.start.kind === 'value' && opts.start.source === peak.source && opts.start.cgroup === peak.cgroup ? opts.start : null;
  const events = (oom?: number, high?: number, scope = '') => {
    const parts: string[] = [];
    if (typeof oom === 'number') parts.push(`${oom} out-of-memory kill${oom === 1 ? '' : 's'}`);
    if (typeof high === 'number') parts.push(`${high} reclaim-throttle event${high === 1 ? '' : 's'}`);
    return parts.length ? `; ${parts.join(', ')}${scope}` : '';
  };
  const delta = (a?: number, b?: number) => (typeof a === 'number' && typeof b === 'number' ? Math.max(0, a - b) : undefined);
  if (start) {
    const ev = events(delta(peak.oomKills, start.oomKills), delta(peak.highEvents, start.highEvents), ' during this build');
    if (peak.bytes > start.bytes) {
      return `Peak memory during this build: ${gbOf(peak.bytes).toFixed(2)} GB of ${ceiling} (${pct(peak.bytes)}%, ${where} — the build raised the machine's high-water mark, so this is its own peak${bound ? '; it includes reclaimable file cache' : ''}${ev})`;
    }
    return `Peak memory: this build stayed under the machine's earlier high-water mark of ${gbOf(peak.bytes).toFixed(2)} GB of ${ceiling} (${pct(peak.bytes)}%, ${where}; set before this build began — this kernel cannot reset the counter, so the build's own peak is at most that${ev})`;
  }
  const age = typeof opts.sessionAgeMs === 'number' && opts.sessionAgeMs >= 0 ? ` (this session started ${Math.max(1, Math.round(opts.sessionAgeMs / 60_000))} min ago${opts.sessionOrigin ? `, ${opts.sessionOrigin}` : ''})` : '';
  return `Peak memory since this machine came up${age}: ${gbOf(peak.bytes).toFixed(2)} GB of ${ceiling} (${pct(peak.bytes)}%, ${where}${bound}; includes anything that ran on this machine before this build${events(peak.oomKills, peak.highEvents, ' since it came up')})`;
}

/** A probe outcome turned into a reading and, when there is none, the reason — a timeout is never called a failure. */
export function peakProbeOutcome(result: { stdout?: string } | null, error?: unknown): { peak: PeakMemory | null; failure: PeakProbeFailure | null } {
  if (error !== undefined) {
    const msg = String((error as { message?: unknown })?.message ?? error).slice(0, 120);
    return { peak: null, failure: /timed out/i.test(msg) ? { kind: 'timeout', reason: msg } : { kind: 'error', reason: msg } };
  }
  return { peak: parsePeakMemory(result?.stdout), failure: null };
}
