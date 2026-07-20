import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateJobBoardIntegration, JOBBOARD_SERVICE_SOURCE } from './JobBoardGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateJobBoardIntegration (wiring)', () => {
  it('emits the job-board service, routes and README', () => {
    const out = generateJobBoardIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/jobboard/jobBoardService.ts');
    expect(paths).toContain('server/jobboard/routes.ts');
    expect(paths).toContain('server/jobboard/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/jobboard/routes.ts']).toContain('export const jobBoardRouter');
    expect(out.files['server/jobboard/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — the apply-once + hiring state-machine rules are real
// business rules, verified against the actual emitted code.
describe('emitted JobBoardService — apply-once + hiring state-machine (real logic)', () => {
  const artifact = join(here, `._jobboard_emitted_${process.pid}.ts`);
  writeFileSync(artifact, JOBBOARD_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  type JobStatus = 'open' | 'closed';
  type AppStatus = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
  interface Job { id: string; status: JobStatus; title: string }
  interface Application { id: string; jobId: string; candidate: string; status: AppStatus }
  interface Service {
    postJob(i: { title: string; description?: string; location?: string }, now?: Date): Job;
    getJob(id: string): Job | undefined;
    setJobStatus(id: string, status: JobStatus, now?: Date): Job;
    listOpenJobs(): Job[];
    apply(jobId: string, candidate: string, note?: string, now?: Date): Application;
    advance(applicationId: string, to: AppStatus, now?: Date): Application;
    applicationsForJob(jobId: string, filter?: { status?: AppStatus }): Application[];
    applicationsByCandidate(candidate: string): Application[];
  }
  interface Emitted { JobBoardService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('posts an open job; the public board shows open jobs only', async () => {
    const { JobBoardService } = await load();
    const svc = new JobBoardService();
    const j = svc.postJob({ title: 'Backend Engineer' });
    expect(j.status).toBe('open');
    expect(svc.listOpenJobs().map((x) => x.id)).toEqual([j.id]);
    svc.setJobStatus(j.id, 'closed');
    expect(svc.listOpenJobs().length).toBe(0);
  });

  it('a candidate can apply AT MOST ONCE per job; a closed job is rejected', async () => {
    const { JobBoardService } = await load();
    const svc = new JobBoardService();
    const j = svc.postJob({ title: 'X' });
    const app = svc.apply(j.id, 'alice');
    expect(app.status).toBe('applied');
    // duplicate application from the same candidate is rejected
    expect(() => svc.apply(j.id, 'alice')).toThrow(/already applied/);
    // a different candidate can still apply
    expect(svc.apply(j.id, 'bob').candidate).toBe('bob');
    // once closed, no new applications
    svc.setJobStatus(j.id, 'closed');
    expect(() => svc.apply(j.id, 'carol')).toThrow(/not open/);
  });

  it('enforces the hiring state-machine (applied→screening→interview→offer→hired; invalid rejected)', async () => {
    const { JobBoardService } = await load();
    const svc = new JobBoardService();
    const j = svc.postJob({ title: 'X' });
    const app = svc.apply(j.id, 'alice');
    // applied cannot jump straight to offer
    expect(() => svc.advance(app.id, 'offer')).toThrow(/invalid application transition/);
    expect(svc.advance(app.id, 'screening').status).toBe('screening');
    expect(svc.advance(app.id, 'interview').status).toBe('interview');
    expect(svc.advance(app.id, 'offer').status).toBe('offer');
    expect(svc.advance(app.id, 'hired').status).toBe('hired');
    // hired is terminal
    expect(() => svc.advance(app.id, 'rejected')).toThrow(/invalid application transition/);
  });

  it('rejection is reachable from any live stage and is terminal', async () => {
    const { JobBoardService } = await load();
    const svc = new JobBoardService();
    const j = svc.postJob({ title: 'X' });
    const app = svc.apply(j.id, 'alice');
    svc.advance(app.id, 'screening');
    expect(svc.advance(app.id, 'rejected').status).toBe('rejected');
    expect(() => svc.advance(app.id, 'interview')).toThrow(/invalid application transition/);
  });

  it('recruiter + candidate views; input validation', async () => {
    const { JobBoardService } = await load();
    const svc = new JobBoardService();
    const j1 = svc.postJob({ title: 'A' });
    const j2 = svc.postJob({ title: 'B' });
    svc.apply(j1.id, 'alice');
    svc.apply(j1.id, 'bob');
    svc.apply(j2.id, 'alice');
    expect(svc.applicationsForJob(j1.id).length).toBe(2);
    expect(svc.applicationsByCandidate('alice').length).toBe(2);
    expect(() => svc.postJob({ title: '' })).toThrow(/title is required/);
    expect(() => svc.apply(j1.id, '')).toThrow(/candidate is required/);
    expect(() => svc.apply('nope', 'alice')).toThrow(/job not found/);
    expect(() => svc.advance('nope', 'screening')).toThrow(/application not found/);
  });
});
