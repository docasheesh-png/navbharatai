// U-4 (verified recipe modules) — in-process job scheduler (dependency-free).
//
// Real apps need recurring work: a nightly cleanup of expired rows, a daily digest email, an hourly sync, a
// "remind me in 24h". The naive approach is a bare `setInterval` sprinkled in a route file — but that has two
// classic bugs: one thrown job kills the whole timer (every later run silently stops), and a "daily at 9am"
// built from `setInterval(24h)` drifts and fires at the wrong wall-clock time. This recipe ships a small,
// correct scheduler: `scheduleEvery` (fixed interval, error-isolated so one bad run never stops the loop) and
// `scheduleDailyUtc` (fires at a real UTC time each day, recomputed — no drift), each returning a `stop()`.
// Dependency-free (native timers), no env keys. Honest scope: this runs while the server process is ALIVE —
// for a guaranteed run that survives a restart / scale-to-0, point an EXTERNAL scheduler (cron / Cloud
// Scheduler) at an endpoint. PURE builder; correct and complete — no TODO stubs (the real-features rule).
// Unit-tested.

export interface SchedulerConfig {
  files: Record<string, string>;
  instructions: string;
}

const SCHEDULER_SERVER = `// A tiny in-process job scheduler. Register recurring work here instead of hand-rolling setInterval, so a
// thrown job never stops the loop and "daily at HH:MM" fires at the real wall-clock time (no drift).
//
// SCOPE (honest): jobs run only while THIS server process is alive. For a schedule that must survive a
// restart or a scale-to-0 (serverless) instance, drive it from an EXTERNAL scheduler (a cron entry, Cloud
// Scheduler, GitHub Actions schedule, …) hitting a protected endpoint that does the work.

export type StopFn = () => void;

async function runIsolated(fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // One failing run must never stop the schedule. Log and carry on.
    console.error('[scheduler] job failed:', err);
  }
}

// Run \`fn\` every \`intervalMs\` (first run after one interval, unless runAtStart). Errors are isolated, so a
// throwing run never cancels future runs. Returns stop() to cancel.
export function scheduleEvery(
  intervalMs: number,
  fn: () => void | Promise<void>,
  opts?: { runAtStart?: boolean },
): StopFn {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('scheduleEvery: intervalMs must be > 0');
  if (opts?.runAtStart) void runIsolated(fn);
  const id = setInterval(() => { void runIsolated(fn); }, intervalMs);
  if (typeof (id as { unref?: () => void }).unref === 'function') (id as { unref: () => void }).unref();
  return () => clearInterval(id);
}

// Milliseconds from \`fromMs\` until the next occurrence of \`hour:minute\` UTC (always in the future). Pure.
export function msUntilDailyUtc(hour: number, minute: number, fromMs: number): number {
  const from = new Date(fromMs);
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0));
  if (next.getTime() <= fromMs) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - fromMs;
}

// Run \`fn\` once per day at \`hour:minute\` UTC. The next fire time is RECOMPUTED each day (from a fresh clock),
// so it never drifts the way a fixed 24h interval does. Errors are isolated. Returns stop() to cancel.
export function scheduleDailyUtc(hour: number, minute: number, fn: () => void | Promise<void>): StopFn {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('scheduleDailyUtc: hour must be 0-23');
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('scheduleDailyUtc: minute must be 0-59');
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  const arm = (): void => {
    if (stopped) return;
    const delay = msUntilDailyUtc(hour, minute, Date.now());
    timer = setTimeout(async () => {
      await runIsolated(fn);
      arm(); // recompute the next day from a fresh clock — no drift
    }, delay);
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref();
  };
  arm();
  return () => { stopped = true; clearTimeout(timer); };
}
`;

const INSTRUCTIONS =
  'Job scheduler wired at server/lib/scheduler.ts (no dependency — native timers). Use scheduleEvery(ms, fn) ' +
  'for a fixed-interval job (an hourly sync, a cleanup) and scheduleDailyUtc(hour, minute, fn) for "run once a ' +
  'day at HH:MM UTC" (a nightly purge, a daily digest) — the daily job recomputes its next run each day so it ' +
  'never drifts, and a thrown run never stops the loop. Each returns stop() to cancel. IMPORTANT (honest): ' +
  'jobs run only while the server process is alive — for a schedule that must survive a restart or a ' +
  'scale-to-0 serverless instance, drive it from an EXTERNAL scheduler (cron / Cloud Scheduler / a GitHub ' +
  'Actions schedule) hitting a protected endpoint. No API key needed.';

export function generateSchedulerIntegration(): SchedulerConfig {
  return {
    files: { 'server/lib/scheduler.ts': SCHEDULER_SERVER },
    instructions: INSTRUCTIONS,
  };
}
