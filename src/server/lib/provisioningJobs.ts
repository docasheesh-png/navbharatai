// PROVISIONING JOBS — an idempotent state machine for every bought or connected service (go-live PR 10).
//
// Today `resellExecute` runs quote → create → charge → teardown in ONE request. If the process dies in
// the middle, nothing remembers where it was. A job doc makes every step durable:
//
//   REQUESTED → QUOTED → PROVISIONING → READY → LINKED → CHARGED → ACTIVE
//        ↘ FAILED_RETRYABLE → (retry) PROVISIONING          ↘ FAILED_FINAL → TEARING_DOWN → RELEASED
//   ACTIVE → SUSPENDED → DEPROVISIONING → DELETED
//
// Rules (tested): only listed transitions are legal; every transition is applied inside a transaction
// that re-reads the job and checks the FROM state; the job id is a hash of (uid, workspace, sku,
// clientRequestId) so a repeated request finds the same job instead of creating a second resource;
// money is only ever taken in LINKED → CHARGED, i.e. after the resource is real and connected.
//
// 🔒 OFF BY DEFAULT (PROVISION_JOBS_V1). No route uses this yet. Server-only collection.

import { createHash } from 'crypto';
import { parseEnvFlag } from './envFlag';

export const PROVISION_JOBS = 'provisioning_jobs';

export type JobState =
  | 'REQUESTED' | 'QUOTED' | 'PROVISIONING' | 'READY' | 'LINKED' | 'CHARGED' | 'ACTIVE'
  | 'FAILED_RETRYABLE' | 'FAILED_FINAL' | 'TEARING_DOWN' | 'RELEASED'
  | 'SUSPENDED' | 'DEPROVISIONING' | 'DELETED';

export const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = Object.freeze({
  REQUESTED: ['QUOTED', 'FAILED_FINAL'],
  QUOTED: ['PROVISIONING', 'FAILED_FINAL'],
  PROVISIONING: ['READY', 'FAILED_RETRYABLE', 'FAILED_FINAL'],
  READY: ['LINKED', 'FAILED_FINAL'],
  LINKED: ['CHARGED', 'FAILED_FINAL'],
  CHARGED: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'DEPROVISIONING'],
  FAILED_RETRYABLE: ['PROVISIONING', 'FAILED_FINAL'],
  FAILED_FINAL: ['TEARING_DOWN', 'RELEASED'],
  TEARING_DOWN: ['RELEASED'],
  RELEASED: [],
  SUSPENDED: ['ACTIVE', 'DEPROVISIONING'],
  DEPROVISIONING: ['DELETED'],
  DELETED: [],
});

export const TERMINAL: ReadonlySet<JobState> = new Set<JobState>(['RELEASED', 'DELETED']);
/** States in which a resource may exist at the provider and must not be forgotten. */
export const HOLDS_RESOURCE: ReadonlySet<JobState> = new Set<JobState>(['READY', 'LINKED', 'CHARGED', 'ACTIVE', 'SUSPENDED', 'FAILED_FINAL', 'TEARING_DOWN', 'DEPROVISIONING']);

export interface ProvisionJob {
  id: string;
  uid: string;
  workspaceId: string;
  skuId: string;
  providerKey: string;
  state: JobState;
  attempts: number;
  resourceRef: string | null;
  chargeRef: string | null;
  lastError: string | null;
  history: Array<{ from: JobState | null; to: JobState; at: string; note?: string }>;
  createdAt: string;
  updatedAt: string;
}

export function provisionJobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.PROVISION_JOBS_V1) ?? false;
}

export function jobIdFor(uid: string, workspaceId: string, skuId: string, clientRequestId: string): string {
  return 'job_' + createHash('sha256').update([uid, workspaceId, skuId, clientRequestId].join('\u0000')).digest('hex').slice(0, 40);
}

export function canTransition(from: JobState, to: JobState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export const MAX_ATTEMPTS = 5;

/** Apply one transition to a job. PURE. Returns the new job or an error string. */
export function applyTransition(
  job: ProvisionJob, to: JobState, at: string,
  patch: Partial<Pick<ProvisionJob, 'resourceRef' | 'chargeRef' | 'lastError'>> = {}, note?: string,
): { ok: true; job: ProvisionJob } | { ok: false; error: string } {
  if (!canTransition(job.state, to)) return { ok: false, error: `illegal transition ${job.state} → ${to}` };
  if (to === 'CHARGED' && !(patch.chargeRef ?? job.chargeRef)) return { ok: false, error: 'CHARGED needs a chargeRef' };
  if (to === 'READY' && !(patch.resourceRef ?? job.resourceRef)) return { ok: false, error: 'READY needs a resourceRef' };
  const attempts = to === 'PROVISIONING' ? job.attempts + 1 : job.attempts;
  if (to === 'PROVISIONING' && attempts > MAX_ATTEMPTS) return { ok: false, error: 'too many attempts' };
  return {
    ok: true,
    job: {
      ...job, ...patch, state: to, attempts, updatedAt: at,
      history: [...job.history, { from: job.state, to, at, ...(note ? { note: note.slice(0, 200) } : {}) }].slice(-50),
    },
  };
}

export function newJob(input: { uid: string; workspaceId: string; skuId: string; providerKey: string; clientRequestId: string }, at: string): ProvisionJob {
  return {
    id: jobIdFor(input.uid, input.workspaceId, input.skuId, input.clientRequestId),
    uid: input.uid, workspaceId: input.workspaceId, skuId: input.skuId, providerKey: input.providerKey,
    state: 'REQUESTED', attempts: 0, resourceRef: null, chargeRef: null, lastError: null,
    history: [{ from: null, to: 'REQUESTED', at }], createdAt: at, updatedAt: at,
  };
}

/** Jobs a sweep should look at: non-terminal and untouched for `staleMs`. PURE. */
export function staleJobs(jobs: ProvisionJob[], nowMs: number, staleMs = 10 * 60_000): ProvisionJob[] {
  return jobs.filter((j) => !TERMINAL.has(j.state) && j.state !== 'ACTIVE' && j.state !== 'SUSPENDED'
    && nowMs - Date.parse(j.updatedAt) > staleMs);
}

// ── Store (transactional). `db` is the admin Firestore; injected so tests use a fake. ─────────────

type Tx = { get(ref: unknown): Promise<{ exists: boolean | (() => boolean); data(): unknown }>; set(ref: unknown, v: unknown): void };
type Db = { doc(path: string): unknown; runTransaction<T>(fn: (t: Tx) => Promise<T>): Promise<T> };
const exists = (s: { exists: boolean | (() => boolean) }) => (typeof s.exists === 'function' ? s.exists() : s.exists);

/** Create the job, or return the existing one for the same request (idempotent). */
export async function openJob(db: Db, input: Parameters<typeof newJob>[0], at = new Date().toISOString()): Promise<{ job: ProvisionJob; created: boolean }> {
  const fresh = newJob(input, at);
  const ref = db.doc(`${PROVISION_JOBS}/${fresh.id}`);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (exists(snap)) return { job: snap.data() as ProvisionJob, created: false };
    t.set(ref, fresh);
    return { job: fresh, created: true };
  });
}

/** Move a job from `from` to `to` atomically. A concurrent mover that got there first wins. */
export async function transitionJob(
  db: Db, id: string, from: JobState, to: JobState,
  patch: Parameters<typeof applyTransition>[3] = {}, note?: string, at = new Date().toISOString(),
): Promise<{ ok: true; job: ProvisionJob } | { ok: false; error: string; job?: ProvisionJob }> {
  const ref = db.doc(`${PROVISION_JOBS}/${id}`);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!exists(snap)) return { ok: false as const, error: 'no such job' };
    const job = snap.data() as ProvisionJob;
    if (job.state !== from) return { ok: false as const, error: `job is ${job.state}, not ${from}`, job };
    const r = applyTransition(job, to, at, patch, note);
    if (!r.ok) return { ok: false as const, error: r.error, job };
    t.set(ref, r.job);
    return r;
  });
}
