/**
 * SERVER LOAD — is this instance struggling, right now?
 *
 * The admin's question was "when millions of users arrive, will the server slow down or hang?". Every
 * number the platform had was about BUILDS — how many, how much they cost, whether they worked. None
 * of them answers whether the server itself is close to falling over, and by the time builds start
 * failing the answer is already yes.
 *
 * WHAT IS MEASURED, AND WHY EACH ONE
 *
 * • EVENT-LOOP LAG is the single most important number here and the least obvious. Node runs one
 *   thread; when something blocks it, every request waits — the server is not "down", it is simply
 *   not answering. CPU can look calm while this is terrible. `monitorEventLoopDelay` measures it in
 *   the runtime itself, so it costs almost nothing.
 * • CPU is sampled as a DELTA over real elapsed time, which is the only way to get a percentage.
 *   A single `process.cpuUsage()` reading is a lifetime total and says nothing about now.
 * • MEMORY is real RSS. Its LIMIT is read from the container's own cgroup, because `os.totalmem()`
 *   on Cloud Run reports the HOST machine — a number so much larger than the container's real limit
 *   that it would show 4% while the instance is about to be killed for exceeding memory.
 * • IN-FLIGHT REQUESTS is the honest "how busy is it" count: requests accepted and not yet finished.
 *
 * WHAT IS DELIBERATELY NOT MEASURED
 *
 * `os.loadavg()` is excluded, not forgotten. In a container it reports the HOST's load, which mixes
 * in every other tenant's work — a number that looks authoritative and means nothing about us.
 *
 * ⚠️ THIS IS ONE INSTANCE. Cloud Run runs several, and each has its own memory and its own event
 * loop; a request goes to whichever one answers. So this describes the instance that served the
 * request, and the UI must say so. Presenting it as "the server" would be the same mistake as
 * building a live-sandbox count from one process's memory.
 */
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import type { Request, Response, NextFunction } from 'express';

export type LoadLevel = 'ok' | 'warn' | 'critical';

export interface ServerLoadSnapshot {
  /** Percent of ONE core, averaged over the sampling window. null until the first sample lands. */
  cpuPercent: number | null;
  memoryRssBytes: number;
  /** The container's real limit, or null when the cgroup could not be read — never a host figure. */
  memoryLimitBytes: number | null;
  memoryPercent: number | null;
  /** Milliseconds the event loop was delayed — the number that says "the server is not answering". */
  eventLoopP50Ms: number | null;
  eventLoopP99Ms: number | null;
  inFlightRequests: number;
  uptimeSeconds: number;
  /** Worst of the individual signals, so one glance is enough. */
  level: LoadLevel;
  /** Which signal drove the level, in plain words. Empty when everything is fine. */
  reason: string;
}

/** CPU percent of one core from a cpuUsage delta. Pure. */
export function cpuPercentFromDelta(deltaMicros: number, elapsedMs: number): number | null {
  if (!Number.isFinite(deltaMicros) || deltaMicros < 0) return null;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  return Math.round((deltaMicros / 1000 / elapsedMs) * 100 * 10) / 10;
}

/**
 * Grade the instance. Thresholds are deliberately generous on CPU and tight on event-loop lag:
 * a busy server at 80% CPU that still answers in milliseconds is healthy, while 200ms of lag at 30%
 * CPU means every user is waiting on something blocking the one thread. Pure.
 */
export function gradeLoad(s: {
  cpuPercent: number | null;
  memoryPercent: number | null;
  eventLoopP99Ms: number | null;
}): { level: LoadLevel; reason: string } {
  const reasons: Array<{ level: LoadLevel; text: string }> = [];

  if (s.eventLoopP99Ms != null) {
    if (s.eventLoopP99Ms >= 250) reasons.push({ level: 'critical', text: `requests are waiting ${Math.round(s.eventLoopP99Ms)}ms on a blocked thread` });
    else if (s.eventLoopP99Ms >= 100) reasons.push({ level: 'warn', text: `requests are waiting ${Math.round(s.eventLoopP99Ms)}ms at the worst moments` });
  }
  if (s.memoryPercent != null) {
    // Memory is the one that gets an instance KILLED rather than merely slowed, so it grades harder.
    if (s.memoryPercent >= 90) reasons.push({ level: 'critical', text: `memory is at ${Math.round(s.memoryPercent)}% of the container limit` });
    else if (s.memoryPercent >= 75) reasons.push({ level: 'warn', text: `memory is at ${Math.round(s.memoryPercent)}% of the container limit` });
  }
  if (s.cpuPercent != null) {
    if (s.cpuPercent >= 190) reasons.push({ level: 'critical', text: `CPU is saturated at ${Math.round(s.cpuPercent)}% of a core` });
    else if (s.cpuPercent >= 150) reasons.push({ level: 'warn', text: `CPU is busy at ${Math.round(s.cpuPercent)}% of a core` });
  }

  const critical = reasons.find((r) => r.level === 'critical');
  if (critical) return { level: 'critical', reason: critical.text };
  const warn = reasons.find((r) => r.level === 'warn');
  if (warn) return { level: 'warn', reason: warn.text };
  return { level: 'ok', reason: '' };
}

/**
 * The container's memory limit, from its own cgroup. Returns null on ANY doubt.
 *
 * cgroup v2 reports the literal string "max" for "no limit", and v1 reports a number so large it is
 * effectively unlimited — both must read as "unknown", because a percentage of an unlimited limit is
 * meaningless and a made-up denominator here would understate a real memory problem.
 */
export function readMemoryLimitBytes(read: (p: string) => string = (p) => readFileSync(p, 'utf8')): number | null {
  const candidates = ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'];
  for (const path of candidates) {
    try {
      const raw = read(path).trim();
      if (!raw || raw === 'max') continue;
      const n = Number(raw);
      // Anything past ~1 TB is the "no limit" sentinel, not a real container limit.
      if (Number.isFinite(n) && n > 0 && n < 1024 ** 4) return n;
    } catch { /* not this cgroup layout, or not a container — try the next */ }
  }
  return null;
}

class ServerLoadSampler {
  private histogram: IntervalHistogram | null = null;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = Date.now();
  private cpuPercent: number | null = null;
  private inFlight = 0;
  private memoryLimit: number | null | undefined;

  /** Begin measuring. Idempotent; safe to call at boot. */
  start(): void {
    if (this.histogram) return;
    try {
      // 20ms resolution: fine enough to see a blocked thread, coarse enough to cost nothing.
      this.histogram = monitorEventLoopDelay({ resolution: 20 });
      this.histogram.enable();
    } catch {
      this.histogram = null; // an older runtime simply reports no lag rather than breaking boot
    }
  }

  /** Count a request as in flight until its response finishes. Never throws. */
  middleware = (_req: Request, res: Response, next: NextFunction): void => {
    this.inFlight += 1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // 'close' fires for an ABANDONED request that never finishes; without it a user who navigates
      // away mid-request would leak the counter upward forever and the panel would slowly lie.
      this.inFlight = Math.max(0, this.inFlight - 1);
    };
    res.on('finish', finish);
    res.on('close', finish);
    next();
  };

  private sampleCpu(): void {
    const now = Date.now();
    const elapsed = now - this.lastCpuAt;
    // Below a second the delta is mostly noise; keep the previous reading rather than jitter.
    if (elapsed < 1000) return;
    const usage = process.cpuUsage(this.lastCpu);
    this.cpuPercent = cpuPercentFromDelta(usage.user + usage.system, elapsed);
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
  }

  snapshot(): ServerLoadSnapshot {
    this.sampleCpu();
    if (this.memoryLimit === undefined) this.memoryLimit = readMemoryLimitBytes();

    const rss = process.memoryUsage().rss;
    const memoryPercent = this.memoryLimit && this.memoryLimit > 0
      ? Math.round((rss / this.memoryLimit) * 1000) / 10
      : null;

    let p50: number | null = null;
    let p99: number | null = null;
    if (this.histogram) {
      try {
        p50 = Math.round((this.histogram.percentile(50) / 1e6) * 10) / 10;
        p99 = Math.round((this.histogram.percentile(99) / 1e6) * 10) / 10;
        // RESET after reading, so the numbers describe the window since the last look rather than
        // every spike since boot — a single stall hours ago would otherwise show as a permanent
        // problem and the panel would stop being believed.
        this.histogram.reset();
      } catch { p50 = null; p99 = null; }
    }

    const { level, reason } = gradeLoad({ cpuPercent: this.cpuPercent, memoryPercent, eventLoopP99Ms: p99 });
    return {
      cpuPercent: this.cpuPercent,
      memoryRssBytes: rss,
      memoryLimitBytes: this.memoryLimit ?? null,
      memoryPercent,
      eventLoopP50Ms: p50,
      eventLoopP99Ms: p99,
      inFlightRequests: this.inFlight,
      uptimeSeconds: Math.round(process.uptime()),
      level,
      reason,
    };
  }
}

export const serverLoad = new ServerLoadSampler();
