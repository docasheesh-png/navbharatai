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
  /**
   * Should ONE instance run this, rather than all of them? (ROADMAP §12 #1.)
   *
   * Every instance runs its own tick loop, so without this a job fires once per instance. Set it for
   * any job that WRITES, costs money, or sends something — a purge, a digest, a sweep. Leave it off
   * for work that is per-instance by nature (warming this process's own cache).
   *
   * Default OFF, deliberately: turning it on for every existing job at once would change the behaviour
   * of jobs nobody has re-examined, and a job that quietly stops running is worse than one that runs
   * twice. Each job opts in when somebody has thought about it.
   */
  exclusive?: boolean;
}

/**
 * Claim the right to run an exclusive job. Returns true when THIS instance should run it.
 *
 * Injected rather than imported so the scheduler stays free of Firestore and fully testable; the
 * server wires the real one at startup. Absent ⇒ every job runs, which is exactly today's behaviour.
 */
export type RunClaim = (jobId: string) => Promise<boolean>;

/**
 * When did ANY instance last run a job? (queue Q-159.) The in-process loop keeps `nextRun` in memory, so an
 * instance that just woke has no idea a daily job already ran at 04:00 — or that it never did, because no
 * instance was alive at 04:00. Cloud Run scales to zero, so "the job runs while an instance happens to be up"
 * was the whole guarantee. The external tick (`catchUp`) decides from THIS record instead. Injected like the
 * claim, so the scheduler stays free of Firestore.
 */
export interface RunLog {
  lastRun(jobId: string): Promise<number | null>;
  record(jobId: string, atMs: number): Promise<void>;
}

/** What one external tick did — returned to the caller so a scheduler console shows real outcomes. */
export interface CatchUpReport {
  ran: string[];
  notDue: string[];
  /** Another instance held the lease: it is running (or just ran) the job. */
  heldElsewhere: string[];
  /** First sight of the job in the durable record: the clock was started, nothing was run. */
  seeded: string[];
  /** The record could not be read; the job was left alone rather than guessed at. */
  unknown: string[];
}

interface JobState {
  job: ScheduledJob;
  nextRun: number;
  lastRun?: number;
  lastError?: string;
  runs: number;
  /** Cycles this instance skipped because another instance held the lease. */
  skipped?: number;
}

export interface JobStatus {
  id: string;
  nextRun: number;
  lastRun?: number;
  lastError?: string;
  runs: number;
  enabled: boolean;
  exclusive: boolean;
  /** Reported so "this job never runs here" reads as coordination rather than as a fault. */
  skipped: number;
}

export class Scheduler {
  private jobs = new Map<string, JobState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private claim: RunClaim | null = null;
  private runLog: RunLog | null = null;
  private startedResolve: (() => void) | null = null;
  /** Resolves once `start()` has been called — the jobs are registered by then. */
  readonly started: Promise<void> = new Promise<void>((res) => { this.startedResolve = res; });

  /**
   * Wire the cross-instance claim. Until this is called nothing changes — every job runs on every
   * instance, exactly as before, which is what makes adding this safe.
   */
  setClaim(claim: RunClaim | null): void {
    this.claim = claim;
  }

  /** Wire the durable run record. Until this is called, `catchUp` reports every job as unknown. */
  setRunLog(log: RunLog | null): void {
    this.runLog = log;
  }

  /**
   * The EXTERNAL tick (Q-159): run every exclusive job that is due by the DURABLE record, whichever instance
   * this is and however recently it woke. Per-instance jobs (not `exclusive`) are left to the in-process loop —
   * they warm THIS process, and a woken instance runs its own at boot.
   *
   * 🔒 FIRST SIGHT SEEDS, IT DOES NOT RUN. A job with no record yet (the first tick after this ships) has its
   * clock started at `nowMs` instead of firing: a daily bill or a purge run at a random hour because a record
   * did not exist yet is exactly the surprise this must not cause. From then on it is due on its own schedule.
   *
   * 🔒 AN UNREADABLE RECORD IS LEFT ALONE. Running on a guess could double a daily bill; skipping one tick
   * costs one tick — the next call tries again.
   */
  async catchUp(nowMs: number = Date.now()): Promise<CatchUpReport> {
    const report: CatchUpReport = { ran: [], notDue: [], heldElsewhere: [], seeded: [], unknown: [] };
    for (const st of this.jobs.values()) {
      if (!(st.job.enabled ?? true) || !st.job.exclusive) continue;
      const id = st.job.id;
      if (!this.runLog) { report.unknown.push(id); continue; }
      let last: number | null;
      try { last = await this.runLog.lastRun(id); } catch { report.unknown.push(id); continue; }
      if (last === null) {
        await this.runLog.record(id, nowMs).catch(() => {});
        report.seeded.push(id);
        continue;
      }
      if (computeNextRun(st.job.schedule, last) > nowMs) { report.notDue.push(id); continue; }
      const ran = await this.runOnce(st, nowMs);
      st.nextRun = computeNextRun(st.job.schedule, nowMs);
      (ran ? report.ran : report.heldElsewhere).push(id);
    }
    return report;
  }

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
      await this.runOnce(st, nowMs);
      /**
       * 🔒 RESCHEDULED WHETHER OR NOT THIS INSTANCE WON THE CLAIM — and the order matters. A losing
       * instance that did not advance `nextRun` would retry on every single tick, hammering the lease
       * document once a minute forever: a deduplication mechanism that becomes its own load. It lost
       * this cycle; it is due again at the next one, like everybody else.
       */
      st.nextRun = computeNextRun(st.job.schedule, nowMs);
    }
  }

  /**
   * Run ONE registered job right now, honouring its claim — the entry point for a run that is not on
   * the schedule, such as a job that should also fire once at boot.
   *
   * 🔴 WHY THIS EXISTS. `server.ts` called the retention purge's handler DIRECTLY at boot, straight
   * past the scheduler. Marking the job `exclusive` therefore protected its 03:00 run and did nothing
   * at all for the boot run — so every instance still purged on startup, and with the instance ceiling
   * newly raised to 100 (§12 #2) a single deploy could mean a hundred simultaneous purges. Nothing
   * would break (the deletes are idempotent and bounded), but it is exactly the duplicated scheduled
   * work `exclusive` was built to prevent, arriving through the one door that did not check.
   *
   * Unknown job id ⇒ false, so a typo cannot silently look like a completed run.
   */
  async runNow(id: string, nowMs: number = Date.now()): Promise<boolean> {
    const st = this.jobs.get(id);
    if (!st || !(st.job.enabled ?? true)) return false;
    return this.runOnce(st, nowMs);
  }

  /** Claim, run, record. Returns whether THIS instance actually ran the handler. */
  private async runOnce(st: JobState, nowMs: number): Promise<boolean> {
    let mayRun = true;
    if (st.job.exclusive && this.claim) {
      // A claim that throws must not stop the job — see claimJobRun: a database hiccup silently
      // cancelling every scheduled job is far worse than one duplicated run.
      mayRun = await this.claim(st.job.id).catch(() => true);
    }
    if (!mayRun) {
      st.skipped = (st.skipped ?? 0) + 1;
      return false;
    }
    try {
      await st.job.handler();
      st.lastError = undefined;
    } catch (e) {
      st.lastError = e instanceof Error ? e.message : String(e);
    }
    st.lastRun = nowMs;
    st.runs++;
    // Recorded for exclusive jobs only — the ones `catchUp` decides — and never allowed to fail the run.
    if (st.job.exclusive && this.runLog) await this.runLog.record(st.job.id, nowMs).catch(() => {});
    return true;
  }

  /** Start the background tick loop (default every 60s). Idempotent; unref'd so it never blocks exit. */
  start(tickMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, tickMs);
    this.timer.unref?.();
    this.startedResolve?.();
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
      exclusive: st.job.exclusive === true,
      skipped: st.skipped ?? 0,
    }));
  }
}

/** Shared process-wide scheduler. */
export const scheduler = new Scheduler();
