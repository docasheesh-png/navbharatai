// THE EXTERNAL TICK — scheduled work that does not depend on an instance happening to be awake (queue Q-159).
//
// Cloud Run runs `--min-instances 0`. The in-process scheduler (`ScheduledJobs.ts`) fires jobs only while an
// instance is alive, so with no traffic a renewal reminder, the daily hosting bill or the image cleanup could be
// hours late. The admin chose Cloud Scheduler (2026-10-05) over a standing instance: it costs nothing while idle.
// Cloud Scheduler calls `POST /api/internal/scheduler-tick` every few minutes with a shared secret; the request
// wakes an instance, and `scheduler.catchUp` runs every exclusive job that is due by the DURABLE record of its
// last run — written by whichever instance ran it, in-process or by tick.
//
// 🔒 The secret is a header, compared in constant time, and the route answers 503 (not 200) while it is unset,
// so a half-configured setup is visible in the Cloud Scheduler console instead of silently doing nothing.

import crypto from 'crypto';
import type { RunLog } from './ScheduledJobs';

/** Header Cloud Scheduler sends. */
export const SCHEDULER_TICK_HEADER = 'x-scheduler-secret';
/** Where each job's last run is kept. One document per job id. */
export const JOB_RUNS_COLLECTION = 'job_runs';
/** Every store call is bounded: a slow database must not hold the tick open. */
const STORE_TIMEOUT_MS = 4_000;

export type TickAuth = 'ok' | 'not-configured' | 'denied';

/** May this request run the tick? PURE. */
export function tickAuth(configured: string | undefined, presented: unknown): TickAuth {
  const want = String(configured ?? '').trim();
  if (want.length < 16) return 'not-configured';
  const got = typeof presented === 'string' ? presented : '';
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'denied';
}

function bounded<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('job run store timed out')), STORE_TIMEOUT_MS))]);
}

/** The Firestore surface this needs — narrowed so tests never touch a database. */
export interface RunLogStore {
  collection(name: string): { doc(id: string): { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(v: Record<string, unknown>, o?: { merge: boolean }): Promise<unknown> } };
}

/** The durable run record on Firestore. `null` store ⇒ no record (every job reads as unknown). */
export function firestoreRunLog(store: RunLogStore | null | undefined): RunLog | null {
  if (!store) return null;
  return {
    async lastRun(jobId) {
      const snap = await bounded(store.collection(JOB_RUNS_COLLECTION).doc(jobId).get());
      const at = snap.exists ? Number(snap.data()?.lastRunAt) : NaN;
      return Number.isFinite(at) && at > 0 ? at : null;
    },
    async record(jobId, atMs) {
      await bounded(store.collection(JOB_RUNS_COLLECTION).doc(jobId).set({ jobId, lastRunAt: atMs }, { merge: true }));
    },
  };
}
