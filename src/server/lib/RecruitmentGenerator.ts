// Recruitment / job-board domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the established recipe pattern. Distinct real guarantees (NOT the CRM sales pipeline — this is a
// HIRING pipeline):
//   1. APPLICATION STATE-MACHINE: an application moves applied → screening → interview → offer → hired,
//      and can be rejected from any non-terminal stage; hired/rejected/withdrawn are terminal. An invalid
//      jump is rejected (409).
//   2. ONE APPLICATION per candidate per job (a duplicate is rejected).
//   3. CLOSED-JOB GUARD: you cannot apply to a job that is closed/filled.
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const RECRUITMENT_SERVICE_SOURCE = `// Recruitment / job-board domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) An application's stage follows an allowed STATE-MACHINE (invalid jumps rejected).
//  2) A candidate can apply to a given job at most once.
//  3) A closed/filled job accepts no new applications.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.

export type JobStatus = 'open' | 'closed';
export type Stage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';

// Allowed stage transitions. hired/rejected/withdrawn are terminal.
const TRANSITIONS: Record<Stage, Stage[]> = {
  applied: ['screening', 'rejected', 'withdrawn'],
  screening: ['interview', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface Job {
  id: string;
  title: string;
  department?: string;
  location?: string;
  status: JobStatus;
  createdAt: number;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
}

export interface Application {
  id: string;
  jobId: string;
  candidateId: string;
  stage: Stage;
  history: Array<{ stage: Stage; at: number }>;
  appliedAt: number;
}

export class InvalidStageError extends Error {
  constructor(from: Stage, to: Stage) { super(\`Invalid application transition \${from} → \${to}\`); this.name = 'InvalidStageError'; }
}
export class DuplicateApplicationError extends Error {
  constructor() { super('This candidate has already applied to this job'); this.name = 'DuplicateApplicationError'; }
}
export class JobClosedError extends Error {
  constructor() { super('This job is closed — it is not accepting applications'); this.name = 'JobClosedError'; }
}

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;

export class RecruitmentService {
  private jobs = new Map<string, Job>();
  private candidates = new Map<string, Candidate>();
  private applications = new Map<string, Application>();
  private appliedIndex = new Set<string>(); // \`\${jobId}|\${candidateId}\` — uniqueness

  postJob(data: { title: string; department?: string; location?: string }): Job {
    if (!data.title?.trim()) throw new Error('Job title is required');
    const job: Job = { id: nextId('job'), title: data.title.trim(), department: data.department, location: data.location, status: 'open', createdAt: Date.now() };
    this.jobs.set(job.id, job);
    return job;
  }

  closeJob(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new Error(\`Unknown job \${id}\`);
    j.status = 'closed';
    return j;
  }
  reopenJob(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new Error(\`Unknown job \${id}\`);
    j.status = 'open';
    return j;
  }

  addCandidate(data: { name: string; email: string }): Candidate {
    if (!data.name?.trim() || !data.email?.trim()) throw new Error('Candidate name and email are required');
    const c: Candidate = { id: nextId('cnd'), name: data.name.trim(), email: data.email.trim() };
    this.candidates.set(c.id, c);
    return c;
  }

  apply(jobId: string, candidateId: string): Application {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(\`Unknown job \${jobId}\`);
    if (!this.candidates.has(candidateId)) throw new Error(\`Unknown candidate \${candidateId}\`);
    if (job.status !== 'open') throw new JobClosedError();
    const key = \`\${jobId}|\${candidateId}\`;
    if (this.appliedIndex.has(key)) throw new DuplicateApplicationError();
    const now = Date.now();
    const app: Application = { id: nextId('app'), jobId, candidateId, stage: 'applied', history: [{ stage: 'applied', at: now }], appliedAt: now };
    this.applications.set(app.id, app);
    this.appliedIndex.add(key);
    return app;
  }

  advance(applicationId: string, to: Stage): Application {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(\`Unknown application \${applicationId}\`);
    if (!canTransition(app.stage, to)) throw new InvalidStageError(app.stage, to);
    app.stage = to;
    app.history.push({ stage: to, at: Date.now() });
    return app;
  }

  applicationsFor(jobId: string, stage?: Stage): Application[] {
    return [...this.applications.values()]
      .filter((a) => a.jobId === jobId && (!stage || a.stage === stage))
      .sort((a, b) => a.appliedAt - b.appliedAt);
  }

  getJob(id: string): Job | undefined { return this.jobs.get(id); }
  getApplication(id: string): Application | undefined { return this.applications.get(id); }
  listJobs(filter?: { status?: JobStatus }): Job[] {
    return [...this.jobs.values()].filter((j) => !filter?.status || j.status === filter.status);
  }
}

export const recruitment = new RecruitmentService();
`;

export const RECRUITMENT_ROUTES_SOURCE = `import { Router } from 'express';
import { recruitment, InvalidStageError, DuplicateApplicationError, JobClosedError } from './recruitmentService';

export const recruitmentRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    const out = fn();
    if (out === undefined) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(out);
  } catch (e) {
    if (e instanceof InvalidStageError || e instanceof DuplicateApplicationError || e instanceof JobClosedError) {
      res.status(409).json({ error: e.message }); return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

recruitmentRouter.get('/jobs', (req, res) => handle(res, () => recruitment.listJobs({ status: req.query.status as never })));
recruitmentRouter.post('/jobs', (req, res) => handle(res, () => recruitment.postJob(req.body)));
recruitmentRouter.get('/jobs/:id', (req, res) => handle(res, () => recruitment.getJob(req.params.id)));
recruitmentRouter.post('/jobs/:id/close', (req, res) => handle(res, () => recruitment.closeJob(req.params.id)));
recruitmentRouter.post('/jobs/:id/reopen', (req, res) => handle(res, () => recruitment.reopenJob(req.params.id)));
recruitmentRouter.post('/candidates', (req, res) => handle(res, () => recruitment.addCandidate(req.body)));
recruitmentRouter.post('/jobs/:id/apply', (req, res) => handle(res, () => recruitment.apply(req.params.id, req.body?.candidateId))); // 409 dup / closed
recruitmentRouter.get('/jobs/:id/applications', (req, res) => handle(res, () => recruitment.applicationsFor(req.params.id, req.query.stage as never)));
recruitmentRouter.patch('/applications/:id/stage', (req, res) => handle(res, () => recruitment.advance(req.params.id, req.body?.stage))); // 409 invalid
`;

export const RECRUITMENT_README = `# Recruitment / job-board starter

A dependency-free recruitment / ATS backend under \`server/recruitment/\`, wired for Express.

## Real guarantees (not a stub)
- **Application state-machine** — an application moves \`applied → screening → interview → offer → hired\`
  along allowed transitions only; it can be \`rejected\` or \`withdrawn\` from any non-terminal stage;
  \`hired\`/\`rejected\`/\`withdrawn\` are terminal. An invalid jump is rejected (**409**).
- **One application per candidate per job** — a duplicate application is rejected (**409**).
- **Closed-job guard** — a closed/filled job accepts no new applications (**409**).

## Endpoints (mount with \`app.use("/api", recruitmentRouter)\`)
- \`GET/POST /jobs\`, \`GET /jobs/:id\`, \`POST /jobs/:id/close\`, \`POST /jobs/:id/reopen\`
- \`POST /candidates\`, \`POST /jobs/:id/apply\` (**409** on duplicate / closed job)
- \`GET /jobs/:id/applications\` (filter by stage), \`PATCH /applications/:id/stage\` (**409** on invalid)

In-memory by default; swap the Maps in \`recruitmentService.ts\` for your DB. Pairs with the auth/notification/email recipes.
`;

export interface RecruitmentConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Recruitment / job-board (ATS) starter wired under server/recruitment/ (dependency-free domain logic + an ' +
  'Express router). Three real guarantees: (1) APPLICATION STATE-MACHINE — applied → screening → interview → ' +
  'offer → hired along allowed transitions only (reject/withdraw from any non-terminal stage; hired/rejected/' +
  'withdrawn terminal), invalid jumps rejected (409); (2) ONE application per candidate per job (duplicate ' +
  'rejected, 409); (3) CLOSED-JOB GUARD — a closed job accepts no applications (409). Endpoints: GET/POST ' +
  '/jobs, GET /jobs/:id, POST /jobs/:id/close|/reopen, POST /candidates, POST /jobs/:id/apply, GET ' +
  '/jobs/:id/applications, PATCH /applications/:id/stage. Mount with app.use("/api", recruitmentRouter). ' +
  'In-memory by default — swap the Maps for your DB, same contracts. Pairs with the auth/notification/email recipes. No key.';

export function generateRecruitmentIntegration(): RecruitmentConfig {
  return {
    files: {
      'server/recruitment/recruitmentService.ts': RECRUITMENT_SERVICE_SOURCE,
      'server/recruitment/routes.ts': RECRUITMENT_ROUTES_SOURCE,
      'server/recruitment/README.md': RECRUITMENT_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
