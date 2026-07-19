// U-4 (verified recipe modules) — background-jobs / task-queue generator (BullMQ + pg-boss).
//
// Real, working background-job processing generated into the app, Bring-Your-Own-infra (the user points the
// recipe at their own Redis or Postgres via .env; NavBharatAI never stores the connection string). Background
// jobs are what move slow work (sending email, image/video processing, webhooks, scheduled tasks) OFF the
// request path so the API stays fast. Each recipe is a SERVER helper: enqueueJob(queue, data) to add work +
// processJobs(queue, handler) to run a worker. PURE builders; the generated code is correct and complete —
// no TODO stubs (the real-features rule). Unit-tested.
//
// Provider choice is driven by the infra the user already has:
//   • BullMQ  — Redis-backed (fast, the Node standard). Needs REDIS_URL + ioredis.
//   • pg-boss — Postgres-backed (no extra service if you already run Postgres). Needs DATABASE_URL.

export type JobsProvider = 'bullmq' | 'pgboss';

export interface JobsConfig {
  provider: JobsProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── BullMQ (Redis) ───────────────────────────────────────────────────────────────────────────────────────
const BULLMQ_SERVER = `import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

// Bring-Your-Own Redis — REDIS_URL (e.g. redis://default:password@host:6379). maxRetriesPerRequest:null is
// REQUIRED by BullMQ workers (BullMQ blocks on Redis, so the default retry cap would throw). Never hardcode it.
const connection = new IORedis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });

const queues = new Map<string, Queue>();
function queueFor(name: string): Queue {
  let q = queues.get(name);
  if (!q) { q = new Queue(name, { connection }); queues.set(name, q); }
  return q;
}

// Add a job to a named queue. Returns as soon as it is enqueued — the work runs in a worker, off the request path.
export async function enqueueJob(queue: string, data: Record<string, unknown>): Promise<void> {
  await queueFor(queue).add('job', data);
}

// Start a worker that processes jobs from a named queue. Call ONCE at server start. A thrown handler retries
// per BullMQ's backoff; return normally to mark the job done.
export function processJobs(queue: string, handler: (data: any) => Promise<void>): Worker {
  return new Worker(queue, async (job) => { await handler(job.data); }, { connection });
}
`;

// ── pg-boss (Postgres) ───────────────────────────────────────────────────────────────────────────────────
const PGBOSS_SERVER = `import PgBoss from 'pg-boss';

// Bring-Your-Own Postgres — DATABASE_URL. pg-boss creates and manages its own tables (a "pgboss" schema) on
// start, so no manual migration is needed. Never hardcode the connection string.
const boss = new PgBoss(process.env.DATABASE_URL as string);

// pg-boss must be started once before send/work. We start lazily and share the single promise.
let starting: Promise<void> | null = null;
function ensureStarted(): Promise<void> {
  if (!starting) starting = boss.start().then(() => undefined);
  return starting;
}

// Add a job to a named queue. Returns as soon as it is enqueued — the work runs in a worker, off the request path.
export async function enqueueJob(queue: string, data: Record<string, unknown>): Promise<void> {
  await ensureStarted();
  await boss.send(queue, data);
}

// Start a worker that processes jobs from a named queue. Call ONCE at server start. A thrown handler retries
// per pg-boss's policy; return normally to mark the job done.
export async function processJobs(queue: string, handler: (data: any) => Promise<void>): Promise<void> {
  await ensureStarted();
  await boss.work(queue, async (job) => { await handler(job.data); });
}
`;

const BULLMQ_INSTRUCTIONS =
  'BullMQ background jobs wired (Redis). Point REDIS_URL at your own Redis (Upstash/Redis Cloud/self-hosted) ' +
  'in .env — NavBharatAI never stores it. Import enqueueJob to add work from a route, and call ' +
  'processJobs("emails", handler) ONCE at server start to run the worker. Keep slow work (email, image ' +
  'processing, webhooks) off the request path this way.';

const PGBOSS_INSTRUCTIONS =
  'pg-boss background jobs wired (Postgres). Point DATABASE_URL at your own Postgres in .env — NavBharatAI ' +
  'never stores it; pg-boss creates its own tables on start (no manual migration). Import enqueueJob to add ' +
  'work from a route, and call processJobs("emails", handler) ONCE at server start to run the worker. Best ' +
  'when you already run Postgres and do not want a separate Redis service.';

export function generateJobsIntegration(provider: JobsProvider): JobsConfig {
  if (provider === 'bullmq') {
    return {
      provider,
      files: {
        'server/lib/jobs.ts': BULLMQ_SERVER,
        [ENV_EXAMPLE]: 'REDIS_URL=\n',
      },
      envKeys: ['REDIS_URL'],
      dependencies: [
        { name: 'bullmq', version: '^5' },
        { name: 'ioredis', version: '^5' },
      ],
      instructions: BULLMQ_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/jobs.ts': PGBOSS_SERVER,
      [ENV_EXAMPLE]: 'DATABASE_URL=\n',
    },
    envKeys: ['DATABASE_URL'],
    // Pinned to pg-boss ^9: a stable major whose work(name, job => …) single-job handler this recipe targets.
    dependencies: [{ name: 'pg-boss', version: '^9' }],
    instructions: PGBOSS_INSTRUCTIONS,
  };
}

export function isJobsProvider(v: unknown): v is JobsProvider {
  return v === 'bullmq' || v === 'pgboss';
}
