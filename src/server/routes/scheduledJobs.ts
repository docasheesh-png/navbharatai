// THE EXTERNAL TRIGGER FOR SCHEDULED JOBS (Q-159, admin-approved Cloud Scheduler 2026-10-05).
//
// The scheduler (`ScheduledJobs.ts`) ticks inside a live instance, and Cloud Run runs `--min-instances 0`,
// so with no traffic nothing runs: the retention purge, the hosting bill, the plan reminders and the
// uptime probes could all be hours late. The admin chose Cloud Scheduler (free while idle) over a
// standing instance. Cloud Scheduler calls this route on each job's own schedule; it wakes an instance
// and runs the job through `scheduler.runNow`, which takes the same lease the tick takes — and that
// lease carries the slot, so the tick and this call never both run one slot.
//
// 🔒 Guarded by a shared secret (`SCHEDULED_JOBS_SECRET`, sent as `x-scheduler-secret`), compared in
// constant time. Without the key set the route answers 503 and says so — it never runs a job unguarded.
// Only EXCLUSIVE jobs can be triggered: a per-instance job (warming this process's FX cache) means
// nothing when one instance is poked from outside.

import type { Express, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { scheduler } from '../lib/ScheduledJobs';
import { routeParam } from '../lib/expressCompat';

/** Does `given` match the configured secret? Constant time; false when either is empty. PURE. */
export function schedulerSecretMatches(configured: string | undefined, given: unknown): boolean {
  const want = (configured || '').trim();
  const got = typeof given === 'string' ? given.trim() : '';
  if (!want || !got) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerScheduledJobRoutes(app: Express): void {
  app.post('/api/internal/jobs/:id/run', async (req: Request, res: Response) => {
    if (!(process.env.SCHEDULED_JOBS_SECRET || '').trim()) {
      return res.status(503).json({ error: 'SCHEDULED_JOBS_SECRET is not set on this server, so scheduled jobs cannot be triggered from outside.' });
    }
    if (!schedulerSecretMatches(process.env.SCHEDULED_JOBS_SECRET, req.header('x-scheduler-secret'))) {
      return res.status(401).json({ error: 'Not allowed.' });
    }
    const id = String(routeParam(req.params.id) || '');
    if (!scheduler.isExclusive(id)) {
      const known = scheduler.list().filter((j) => j.exclusive && j.enabled).map((j) => j.id);
      return res.status(404).json({ error: `No enabled one-instance job named "${id}" on this server.`, jobs: known });
    }
    const ran = await scheduler.runNow(id);
    const status = scheduler.list().find((j) => j.id === id);
    // `ran: false` is an honest answer, not a failure: this slot already ran (here or on another
    // instance), or another instance holds the lease right now.
    return res.json({
      ok: true,
      id,
      ran,
      reason: ran ? undefined : 'this slot already ran, or another instance is running it now',
      lastError: status?.lastError ?? null,
    });
  });
}
