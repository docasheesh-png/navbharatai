// Roadmap breadth — job board / applicant-tracking starter (a packaged domain vertical).
//
// A high-demand vertical for career sites, hiring platforms, gig marketplaces and any recruiting flow. The real
// feature is APPLICATION INTEGRITY: a candidate can apply to a given job AT MOST ONCE (a duplicate application
// is rejected), an application follows a hiring STATE-MACHINE (applied → screening → interview → offer →
// hired / rejected, with allowed transitions only), and only OPEN jobs accept applications. This emits a
// dependency-free JobBoardService + an Express router + a README. Real logic, not a stub — the apply-once +
// state-machine rules are unit-tested against the emitted code. Pure builder → the caller writes the files.

export const JOBBOARD_SERVICE_SOURCE = `// Job-board / applicant-tracking domain logic. The core guarantees: (1) a candidate can apply to a given job
// AT MOST ONCE (duplicate rejected), (2) an application follows the hiring state-machine
// applied → screening → interview → offer → hired / rejected (invalid jumps rejected), and (3) only OPEN jobs
// accept applications. In-memory here; swap the Maps for your database, keeping the same method contracts.

export type JobStatus = 'open' | 'closed';
export type AppStatus = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';

export interface Job {
  id: string;
  title: string;
  description: string;
  location: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  jobId: string;
  candidate: string;
  status: AppStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
}

// Allowed hiring-pipeline transitions. 'rejected' is reachable from any live stage; 'hired'/'rejected' are terminal.
const APP_FLOW: Record<AppStatus, AppStatus[]> = {
  applied: ['screening', 'interview', 'rejected'],
  screening: ['interview', 'offer', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['hired', 'rejected'],
  hired: [],
  rejected: [],
};

export class JobBoardService {
  private jobs = new Map<string, Job>();
  private applications = new Map<string, Application>();
  // Fast dedup of (jobId, candidate): key = jobId + '\\u0000' + candidate.
  private byJobCandidate = new Map<string, string>();
  private seq = 0;

  private key(jobId: string, candidate: string): string {
    return jobId + '\\u0000' + String(candidate).trim();
  }

  /** Post a job (starts 'open'). */
  postJob(input: { title: string; description?: string; location?: string }, now: Date = new Date()): Job {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('title is required');
    const iso = now.toISOString();
    const job: Job = {
      id: 'j' + String(++this.seq),
      title,
      description: String(input?.description ?? ''),
      location: String(input?.location ?? ''),
      status: 'open',
      createdAt: iso,
      updatedAt: iso,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Open/close a job. A closed job stops accepting applications (existing ones continue through the pipeline). */
  setJobStatus(id: string, status: JobStatus, now: Date = new Date()): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error('job not found');
    job.status = status;
    job.updatedAt = now.toISOString();
    return job;
  }

  /** Open jobs, newest first (the public board). */
  listOpenJobs(): Job[] {
    return [...this.jobs.values()]
      .filter((j) => j.status === 'open')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** Apply to a job. Rejects a closed/unknown job and a duplicate application from the same candidate. */
  apply(jobId: string, candidate: string, note = '', now: Date = new Date()): Application {
    const who = String(candidate).trim();
    if (!who) throw new Error('candidate is required');
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('job not found');
    if (job.status !== 'open') throw new Error('job is not open for applications');
    if (this.byJobCandidate.has(this.key(jobId, who))) throw new Error('already applied to this job');
    const iso = now.toISOString();
    const app: Application = {
      id: 'a' + String(++this.seq),
      jobId,
      candidate: who,
      status: 'applied',
      note: String(note),
      createdAt: iso,
      updatedAt: iso,
    };
    this.applications.set(app.id, app);
    this.byJobCandidate.set(this.key(jobId, who), app.id);
    return app;
  }

  getApplication(id: string): Application | undefined {
    return this.applications.get(id);
  }

  /** Move an application along the hiring pipeline, enforcing allowed transitions. */
  advance(applicationId: string, to: AppStatus, now: Date = new Date()): Application {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error('application not found');
    if (app.status === to) return app;
    if (!APP_FLOW[app.status].includes(to)) {
      throw new Error('invalid application transition: ' + app.status + ' -> ' + to);
    }
    app.status = to;
    app.updatedAt = now.toISOString();
    return app;
  }

  /** All applications for a job (the recruiter's pipeline view), newest first. */
  applicationsForJob(jobId: string, filter: { status?: AppStatus } = {}): Application[] {
    return [...this.applications.values()]
      .filter((a) => a.jobId === jobId && (!filter.status || a.status === filter.status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** All applications a candidate has submitted. */
  applicationsByCandidate(candidate: string): Application[] {
    const who = String(candidate).trim();
    return [...this.applications.values()].filter((a) => a.candidate === who);
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const jobBoard = new JobBoardService();
`;

export const JOBBOARD_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { jobBoard } from './jobBoardService';

// REST endpoints for the job board. Mount with: app.use('/api', jobBoardRouter).
export const jobBoardRouter = Router();

// Post a job. { title, description?, location? }.
jobBoardRouter.post('/jobs', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; description?: unknown; location?: unknown };
  try {
    return res.status(201).json(jobBoard.postJob({ title: String(body.title ?? ''), description: String(body.description ?? ''), location: String(body.location ?? '') }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Public board — open jobs only.
jobBoardRouter.get('/jobs', (_req: Request, res: Response) => {
  return res.status(200).json(jobBoard.listOpenJobs());
});

// Open/close a job. { status } — 'open' | 'closed'.
jobBoardRouter.patch('/jobs/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  const status = String(body.status ?? '');
  if (status !== 'open' && status !== 'closed') return res.status(400).json({ error: 'status must be open or closed' });
  try {
    return res.status(200).json(jobBoard.setJobStatus(req.params.id, status));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'job not found' });
  }
});

// Apply to a job. { candidate, note? } — 409 on a closed job or a duplicate application.
jobBoardRouter.post('/jobs/:id/apply', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { candidate?: unknown; note?: unknown };
  try {
    return res.status(201).json(jobBoard.apply(req.params.id, String(body.candidate ?? ''), String(body.note ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not apply';
    if (message === 'job not found') return res.status(404).json({ error: message });
    if (message === 'candidate is required') return res.status(400).json({ error: message });
    return res.status(409).json({ error: message });
  }
});

// A job's applications (recruiter view) (?status=).
jobBoardRouter.get('/jobs/:id/applications', (req: Request, res: Response) => {
  const q = req.query as { status?: string };
  const valid = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
  const status = valid.includes(String(q.status)) ? (q.status as 'applied') : undefined;
  return res.status(200).json(jobBoard.applicationsForJob(req.params.id, { status }));
});

// Advance an application along the pipeline. { status } — 409 on an invalid transition.
jobBoardRouter.patch('/applications/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    return res.status(200).json(jobBoard.advance(req.params.id, String(body.status ?? '') as 'screening'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not advance';
    if (message === 'application not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});
`;

const JOBBOARD_README = `# Job board / applicant tracking

A real hiring backend. The core guarantees: a candidate can apply to a given job **at most once** (a duplicate
application is rejected), an application follows the hiring **state-machine**
\`applied → screening → interview → offer → hired / rejected\` (invalid jumps rejected), and only **open** jobs
accept applications. Files:

- \`jobBoardService.ts\` — the domain logic (\`JobBoardService\` + a \`jobBoard\` singleton). In-memory; swap the
  Maps for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { jobBoardRouter } from './server/jobboard/routes';
app.use('/api', jobBoardRouter);
\`\`\`

Endpoints:
- \`POST /api/jobs\` \`{ title, description?, location? }\` → posts an **open** job.
- \`GET  /api/jobs\` → the public board (open jobs).
- \`PATCH /api/jobs/:id/status\` \`{ status }\` → open/close a job.
- \`POST /api/jobs/:id/apply\` \`{ candidate, note? }\` → **409** on a closed job or a duplicate application.
- \`GET  /api/jobs/:id/applications\` (\`?status=\`) → the recruiter pipeline view.
- \`PATCH /api/applications/:id/status\` \`{ status }\` → advance the pipeline (**409** on an invalid transition).

Take \`candidate\` from the auth session in production. A closed job keeps its existing applications moving
through the pipeline; it just stops accepting new ones.
`;

export interface JobBoardConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Job board / applicant-tracking starter wired under server/jobboard/ (dependency-free domain logic + an ' +
  'Express router). The real guarantee is APPLICATION INTEGRITY: apply() links a candidate to a job but ' +
  'rejects a closed/unknown job and a DUPLICATE application (one per candidate per job); advance() moves an ' +
  'application along the hiring STATE-MACHINE applied→screening→interview→offer→hired/rejected (invalid jumps ' +
  'rejected; hired/rejected terminal). listOpenJobs() is the public board. routes.ts exposes POST /jobs, GET ' +
  '/jobs, PATCH /jobs/:id/status, POST /jobs/:id/apply (409 on closed/duplicate), GET /jobs/:id/applications ' +
  'and PATCH /applications/:id/status (409 on invalid transition). Mount with app.use("/api", jobBoardRouter). ' +
  'Take candidate from the auth session in production. In-memory by default — swap the Maps for your DB. NOTE: ' +
  'this is a HIRING job board, distinct from generate_jobs (background job queue).';

export function generateJobBoardIntegration(): JobBoardConfig {
  return {
    files: {
      'server/jobboard/jobBoardService.ts': JOBBOARD_SERVICE_SOURCE,
      'server/jobboard/routes.ts': JOBBOARD_ROUTES_SOURCE,
      'server/jobboard/README.md': JOBBOARD_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
