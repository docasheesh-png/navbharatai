// Field-service / job-dispatch domain-vertical starter generator (ROADMAP #19 — more verticals).
//
// A distinct domain (India's huge on-site services market: plumbers, electricians, AC/appliance repair,
// pest control). Distinct from the helpdesk/support-ticket verticals — those queue SOFTWARE issues; this
// dispatches a TECHNICIAN to a physical job. Distinct real guarantees:
//   1. JOB STATE-MACHINE: requested → assigned → en_route → on_site → completed along allowed transitions
//      only (cancel from any non-terminal; unassign back to requested), an invalid jump rejected (409).
//      A job can only become 'assigned' through assign() — never a bare status change with no technician.
//   2. ONE ACTIVE JOB PER TECHNICIAN: assigning a technician who already has an active job (assigned /
//      en_route / on_site) is rejected (409). A field tech does one job at a time; completing or
//      cancelling frees them automatically (derived, not a flag that can drift).
//   3. APPEND-ONLY job history — every assignment and status change is an immutable, ordered entry.
// In-memory by default (swap the Maps for a real DB). No API key.
//
// The emitted code avoids backticks so it nests cleanly inside this module's template literals.

export const FIELD_SERVICE_SERVICE_SOURCE = `// Field-service / dispatch domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) A job's status follows an allowed STATE-MACHINE; a job becomes 'assigned' ONLY via assign().
//  2) A technician can hold at most ONE active job at a time (assigning a busy tech is rejected).
//  3) The per-job history is append-only and ordered.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.

export type JobStatus = 'requested' | 'assigned' | 'en_route' | 'on_site' | 'completed' | 'cancelled';

// 'assigned' is deliberately NOT reachable through setStatus — assign() is the only door in, because
// becoming assigned without a technician is the exact nonsense this vertical exists to prevent.
const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  requested: ['cancelled'],
  assigned: ['en_route', 'requested', 'cancelled'], // 'requested' = unassign
  en_route: ['on_site', 'cancelled'],
  on_site: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** The statuses in which a technician is actively occupied by a job. */
export const ACTIVE_STATUSES: JobStatus[] = ['assigned', 'en_route', 'on_site'];

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return (JOB_TRANSITIONS[from] || []).includes(to);
}

export interface Technician { id: string; name: string; skills: string[]; }
export interface JobEvent { status: JobStatus; technicianId?: string; at: number; }
export interface Job {
  id: string; customerName: string; address: string; description: string;
  status: JobStatus; technicianId?: string; createdAt: number; history: JobEvent[];
}

let seq = 0;
function nextId(prefix: string): string { seq += 1; return prefix + '_' + Date.now().toString(36) + '_' + seq; }

export class FieldServiceService {
  private technicians = new Map<string, Technician>();
  private jobs = new Map<string, Job>();

  private now: () => number;
  constructor(now: () => number = () => Date.now()) { this.now = now; }

  // ── Technicians ──
  addTechnician(name: string, skills: string[] = []): Technician {
    if (!name) throw Object.assign(new Error('A technician needs a name.'), { status: 400 });
    const t: Technician = { id: nextId('tech'), name, skills: Array.isArray(skills) ? skills : [] };
    this.technicians.set(t.id, t);
    return t;
  }
  listTechnicians(): Technician[] { return Array.from(this.technicians.values()); }
  private requireTech(id: string): Technician {
    const t = this.technicians.get(id);
    if (!t) throw Object.assign(new Error('No such technician: ' + id), { status: 404 });
    return t;
  }
  /** The technician's current active job, if any — derived, never stored, so it cannot drift. */
  activeJobOf(technicianId: string): Job | undefined {
    return Array.from(this.jobs.values()).find(
      (j) => j.technicianId === technicianId && ACTIVE_STATUSES.includes(j.status),
    );
  }

  // ── Jobs ──
  createJob(customerName: string, address: string, description: string): Job {
    if (!customerName || !address) throw Object.assign(new Error('A job needs a customer name and an address.'), { status: 400 });
    const at = this.now();
    const job: Job = {
      id: nextId('job'), customerName, address, description: description || '',
      status: 'requested', createdAt: at, history: [{ status: 'requested', at }],
    };
    this.jobs.set(job.id, job);
    return job;
  }
  getJob(id: string): Job | undefined { return this.jobs.get(id); }
  private requireJob(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw Object.assign(new Error('No such job: ' + id), { status: 404 });
    return j;
  }

  /** Assign a REQUESTED job to a free technician. Rejects a busy technician (409) — one job at a time. */
  assign(jobId: string, technicianId: string): Job {
    const job = this.requireJob(jobId);
    this.requireTech(technicianId);
    if (job.status !== 'requested') {
      throw Object.assign(new Error('Only a requested job can be assigned (this one is ' + job.status + '). Unassign it first.'), { status: 409 });
    }
    const busy = this.activeJobOf(technicianId);
    if (busy) {
      throw Object.assign(new Error('Technician is already on job ' + busy.id + ' — one active job at a time.'), { status: 409 });
    }
    job.technicianId = technicianId;
    job.status = 'assigned';
    job.history.push({ status: 'assigned', technicianId, at: this.now() });
    return job;
  }

  /** Move a job along the lifecycle. 'assigned' is not reachable here — use assign(). */
  setStatus(jobId: string, to: JobStatus): Job {
    const job = this.requireJob(jobId);
    if (job.status === to) return job;
    if (!canTransitionJob(job.status, to)) {
      throw Object.assign(new Error('Cannot move a job from ' + job.status + ' to ' + to + '.'), { status: 409 });
    }
    job.status = to;
    if (to === 'requested') job.technicianId = undefined; // unassign frees the technician
    job.history.push({ status: to, technicianId: job.technicianId, at: this.now() });
    return job;
  }
  cancel(jobId: string): Job { return this.setStatus(jobId, 'cancelled'); }

  listJobs(filter: { technicianId?: string; status?: JobStatus } = {}): Job[] {
    let out = Array.from(this.jobs.values());
    if (filter.technicianId) out = out.filter((j) => j.technicianId === filter.technicianId);
    if (filter.status) out = out.filter((j) => j.status === filter.status);
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }
}
`;

export const FIELD_SERVICE_ROUTES_SOURCE = `// Express router for the field-service backend. Mount with: app.use('/api/field', fieldServiceRouter(service)).
import { Router, type Request, type Response } from 'express';
import { FieldServiceService, type JobStatus } from './fieldService';

export function fieldServiceRouter(svc: FieldServiceService = new FieldServiceService()): Router {
  const router = Router();
  const fail = (res: Response, err: any) => res.status(err?.status || 500).json({ error: err?.message || 'Error' });

  router.post('/technicians', (req: Request, res: Response) => {
    try { res.status(201).json(svc.addTechnician(req.body?.name, req.body?.skills)); }
    catch (err) { fail(res, err); }
  });
  router.get('/technicians', (_req: Request, res: Response) => res.json(svc.listTechnicians()));
  router.get('/technicians/:id/active-job', (req: Request, res: Response) => res.json(svc.activeJobOf(req.params.id) || null));

  router.post('/jobs', (req: Request, res: Response) => {
    try { res.status(201).json(svc.createJob(req.body?.customerName, req.body?.address, req.body?.description)); }
    catch (err) { fail(res, err); }
  });
  router.get('/jobs', (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? (req.query.status as JobStatus) : undefined;
    const technicianId = typeof req.query.technicianId === 'string' ? req.query.technicianId : undefined;
    res.json(svc.listJobs({ status, technicianId }));
  });
  router.get('/jobs/:id', (req: Request, res: Response) => {
    const j = svc.getJob(req.params.id);
    if (!j) { res.status(404).json({ error: 'No such job.' }); return; }
    res.json(j);
  });
  // Assign a requested job to a technician — 409 if that technician already has an active job.
  router.patch('/jobs/:id/assign', (req: Request, res: Response) => {
    try { res.json(svc.assign(req.params.id, req.body?.technicianId)); }
    catch (err) { fail(res, err); }
  });
  // Advance the lifecycle (en_route / on_site / completed / requested-to-unassign) — 409 on an invalid jump.
  router.patch('/jobs/:id/status', (req: Request, res: Response) => {
    try { res.json(svc.setStatus(req.params.id, req.body?.status as JobStatus)); }
    catch (err) { fail(res, err); }
  });
  router.patch('/jobs/:id/cancel', (req: Request, res: Response) => {
    try { res.json(svc.cancel(req.params.id)); }
    catch (err) { fail(res, err); }
  });

  return router;
}
`;

export const FIELD_SERVICE_README = `# Field-service / dispatch backend (server/fieldservice/)

A dependency-free backend for an on-site services business (plumbing, electrical, AC/appliance repair, pest control).

## Real guarantees
- **Job state-machine** — requested → assigned → en_route → on_site → completed (cancel from any
  non-terminal; unassign back to requested); an invalid jump is 409. A job becomes assigned ONLY through
  assign(), never a bare status change with no technician.
- **One active job per technician** — assigning a technician who already has an active job (assigned /
  en_route / on_site) is rejected (409); completing or cancelling frees them automatically.
- **Append-only job history.**

## Wire it up

    import { fieldServiceRouter } from './server/fieldservice/routes';
    app.use('/api/field', fieldServiceRouter());

## Endpoints
- POST /technicians, GET /technicians, GET /technicians/:id/active-job
- POST /jobs, GET /jobs?status=&technicianId=, GET /jobs/:id
- PATCH /jobs/:id/assign (409 if the technician is busy), PATCH /jobs/:id/status (409 on invalid), PATCH /jobs/:id/cancel

In-memory by default — swap the Maps for your database, keeping the same method contracts.
`;

const INSTRUCTIONS = [
  'Wired a field-service / job-dispatch backend under server/fieldservice/. It enforces a job',
  'lifecycle state-machine, guarantees a technician holds at most one active job at a time (a busy',
  'assign is rejected), and keeps an append-only per-job history. Mount the router (see',
  'server/fieldservice/README.md) and swap the in-memory store for your database when ready. No API key.',
].join(' ');

export interface FieldServiceConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** Emit a real, dependency-free field-service dispatch backend for the user's app. Pure. */
export function generateFieldServiceIntegration(): FieldServiceConfig {
  return {
    files: {
      'server/fieldservice/fieldService.ts': FIELD_SERVICE_SERVICE_SOURCE,
      'server/fieldservice/routes.ts': FIELD_SERVICE_ROUTES_SOURCE,
      'server/fieldservice/README.md': FIELD_SERVICE_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
