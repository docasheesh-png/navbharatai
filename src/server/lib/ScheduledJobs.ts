// P-ORCH.1 — Scheduled / Recurring Jobs Engine.
//
// Before this, the server had only ad-hoc `setInterval` timers scattered around. This is a single,
// tested in-process scheduler: register a job with a schedule (a fixed interval, or a daily UTC time),
// and one tick loop fires each job when it's due, reschedules it, and isolates failures so one bad job
// never stops the others. Internal consumers (P-DATA.4 retention purge, future backups/digests) register
// here instead of hand-rolling intervals.
//
// Scope (honest): this runs while a Cloud Run instance is ALIVE. A guaranteed cron that survives
// scale-to-0 needs Cloud Scheduler / Cloud Tasks (external infra) — the follow-up. `computeNextRun` is
// pure (deterministic given `fromMs`) so the schedule math is fully unit-testable without a real clock.

export type Schedule =
  | { kind: 'everyMs'; ms: number }
  | { kind: 'dailyAtUtc'; hour: number; minute: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The next fire time (ms) strictly after `fromMs` for `schedule`. Pure + deterministic. */
export function computeNextRun(schedule: Schedule, fromMs: number): number {
  if (schedule.kind === 'everyMs') {
    return fromMs + Math.max(1, Math.floor(schedule.ms));
  }
  // dailyAtUtc: the next occurrence of hour:minute (UTC) strictly after fromMs.
  const d = new Date(fromMs);
  const todayAt = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), schedule.hour, schedule.minute, 0, 0);
  return todayAt > fromMs ? todayAt : todayAt + DAY_MS;
}

export interface ScheduledJob {
  id: string;
  schedule: Schedule;
  handler: () => void | Promise<void>;
  /** Default true. A disabled job stays registered but never fires. */
  enabled?: boolean;
}

interface JobState {
  job: ScheduledJob;
  nextRun: number;
  lastRun?: number;
  lastError?: string;
  runs: number;
}

export interface JobStatus {
  id: string;
  nextRun: number;
  lastRun?: number;
  lastError?: string;
  runs: number;
  enabled: boolean;
}

export class Scheduler {
  private jobs = new Map<string, JobState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Register (or replace) a job. Its first run is scheduled relative to `nowMs`. */
  register(job: ScheduledJob, nowMs: number = Date.now()): void {
    this.jobs.set(job.id, { job, nextRun: computeNextRun(job.schedule, nowMs), runs: 0 });
  }

  unregister(id: string): void {
    this.jobs.delete(id);
  }

  /** Enabled jobs whose next run is due at `nowMs`. Read-only (does not run or reschedule). */
  due(nowMs: number): ScheduledJob[] {
    const out: ScheduledJob[] = [];
    for (const st of this.jobs.values()) {
      if ((st.job.enabled ?? true) && st.nextRun <= nowMs) out.push(st.job);
    }
    return out;
  }

  /**
   * Run every due job once, then reschedule it. Best-effort: a handler that throws is recorded in
   * `lastError` and never stops the other jobs. Awaits handlers sequentially so a tick is deterministic.
   */
  async tick(nowMs: number = Date.now()): Promise<void> {
    for (const st of this.jobs.values()) {
      if (!(st.job.enabled ?? true) || st.nextRun > nowMs) continue;
      try {
        await st.job.handler();
        st.lastError = undefined;
      } catch (e) {
        st.lastError = e instanceof Error ? e.message : String(e);
      }
      st.lastRun = nowMs;
      st.runs++;
      st.nextRun = computeNextRun(st.job.schedule, nowMs);
    }
  }

  /** Start the background tick loop (default every 60s). Idempotent; unref'd so it never blocks exit. */
  start(tickMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  list(): JobStatus[] {
    return Array.from(this.jobs.values()).map((st) => ({
      id: st.job.id,
      nextRun: st.nextRun,
      lastRun: st.lastRun,
      lastError: st.lastError,
      runs: st.runs,
      enabled: st.job.enabled ?? true,
    }));
  }
}

/** Shared process-wide scheduler. */
export const scheduler = new Scheduler();
