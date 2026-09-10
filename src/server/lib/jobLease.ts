// ONE INSTANCE RUNS THE JOB, NOT ALL OF THEM (ROADMAP §12 #1).
//
// `ScheduledJobs.ts` says plainly what it is: "this runs while a Cloud Run instance is ALIVE". There is
// no leader election in it — every instance starts its own tick loop and runs every registered job. At
// one instance that is correct; at ten it is ten times the work.
//
// ⚠️ HOW BAD IS IT TODAY? Less bad than it looks, and saying so is part of being able to trust the rest
// of this file. Two jobs are registered: `monitor-alerts`, which ALREADY protects itself — its state
// write is a Firestore transaction precisely "so several instances sweeping at the same moment send ONE
// notification between them" — and `retention-purge`, which is currently switched off. So there is no
// live duplicate-work bug right now.
//
// 🔴 WHAT MAKES IT WORTH BUILDING ANYWAY: the engine offers no protection, so every FUTURE job is
// unprotected by default — and the very next job anyone will switch on is `retention-purge`, which
// DELETES. Its deletes are idempotent, so N instances would not destroy anything they should not; they
// would simply do the whole purge N times, paying N times the Firestore reads and writes on a schedule.
// A safety net that has to be remembered per job is not a safety net; this makes it a property of the
// scheduler instead.
//
// PURE decision + a tiny Firestore claim, in the shape the rest of this codebase uses: the rule is
// testable without a database, and the I/O is the thin part.

/** A lease as it is stored: who holds it, and until when. */
export interface JobLease {
  owner: string;
  expiresAt: number;
}

export type LeaseDecision = 'claim' | 'skip';

/**
 * May this instance run the job?
 *
 * 🔒 AN EXPIRED LEASE IS CLAIMABLE, and that is what stops one crashed instance from silently
 * cancelling a scheduled job forever. The TTL is therefore a real decision: long enough to outlast a
 * normal run, short enough that a crash costs at most one cycle.
 *
 * 🔒 AND A LEASE THIS INSTANCE ALREADY HOLDS IS CLAIMABLE TOO. A job that runs longer than expected
 * must not lock itself out of its own next run — that would turn a slow job into a job that never runs
 * again, which is worse than the duplication this exists to prevent. PURE.
 */
export function leaseDecision(
  existing: JobLease | null | undefined,
  opts: { owner: string; nowMs: number },
): LeaseDecision {
  if (!existing || typeof existing.owner !== 'string' || !existing.owner) return 'claim';
  const expires = Number(existing.expiresAt);
  // An unreadable expiry is treated as expired rather than as "held forever": a corrupt lease document
  // must not be able to stop a job permanently, and the worst case is one duplicated run.
  if (!Number.isFinite(expires) || expires <= opts.nowMs) return 'claim';
  return existing.owner === opts.owner ? 'claim' : 'skip';
}

/** The lease to write when claiming. PURE. */
export function nextLease(opts: { owner: string; nowMs: number; ttlMs: number }): JobLease {
  const ttl = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? Math.floor(opts.ttlMs) : DEFAULT_LEASE_TTL_MS;
  return { owner: opts.owner, expiresAt: opts.nowMs + ttl };
}

/**
 * How long a claim holds by default.
 *
 * Ten minutes: comfortably longer than any job registered today (an alert sweep is seconds, a purge is
 * minutes), and short enough that an instance dying mid-run costs a single cycle rather than a day.
 */
export const DEFAULT_LEASE_TTL_MS = 10 * 60_000;

/** Where leases live. One document per job id — no cross-job contention by construction. */
export const JOB_LEASE_COLLECTION = 'job_leases';

/**
 * This instance's identity.
 *
 * Cloud Run does not hand a process a stable instance id, so this is a per-PROCESS random value. That
 * is exactly the right granularity: the thing we are deduplicating is processes, and two processes must
 * never share an identity. Regenerating on restart is harmless — a restarted instance is a new claimant.
 */
export function processOwnerId(): string {
  return OWNER_ID;
}
const OWNER_ID = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

/** The Firestore surface this needs — narrowed so tests never touch a database. */
export interface LeaseStore {
  runTransaction<T>(fn: (tx: {
    get(ref: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    set(ref: unknown, value: Record<string, unknown>): void;
  }) => Promise<T>): Promise<T>;
  collection(name: string): { doc(id: string): unknown };
}

/**
 * Try to claim the right to run `jobId` right now.
 *
 * 🔒 A TRANSACTION, because the whole point is that two instances deciding simultaneously must not both
 * win. Read-then-write without one would be a race with the exact shape of the bug it is fixing.
 *
 * 🔒 AND A STORE WE CANNOT REACH MUST NOT STOP THE WORK. When Firestore is unavailable this returns
 * TRUE — the job runs. Failing closed would mean one database hiccup silently cancels every scheduled
 * job on the platform, which is a far worse outcome than running a purge twice. Duplication is
 * wasteful; a purge that never runs is a bill that never stops.
 */
export async function claimJobRun(
  store: LeaseStore | null | undefined,
  opts: { jobId: string; owner?: string; nowMs?: number; ttlMs?: number },
): Promise<boolean> {
  if (!store || !opts.jobId) return true;
  const owner = opts.owner || processOwnerId();
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  try {
    const ref = store.collection(JOB_LEASE_COLLECTION).doc(opts.jobId);
    return await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as JobLease | undefined;
      if (leaseDecision(existing ?? null, { owner, nowMs }) === 'skip') return false;
      tx.set(ref, { ...nextLease({ owner, nowMs, ttlMs: opts.ttlMs ?? DEFAULT_LEASE_TTL_MS }), jobId: opts.jobId });
      return true;
    });
  } catch {
    // See the doc comment: an unreachable store runs the job rather than cancelling it.
    return true;
  }
}
