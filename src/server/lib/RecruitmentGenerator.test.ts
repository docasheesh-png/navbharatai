import { describe, it, expect, afterAll } from 'vitest';

import { generateRecruitmentIntegration, RECRUITMENT_SERVICE_SOURCE } from './RecruitmentGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateRecruitmentIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generateRecruitmentIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/recruitment/recruitmentService.ts');
    expect(paths).toContain('server/recruitment/routes.ts');
    expect(paths).toContain('server/recruitment/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/recruitment/routes.ts']).toContain('409');
    expect(out.files['server/recruitment/routes.ts']).toContain('export const recruitmentRouter');
  });
});

describe('emitted RecruitmentService — hiring pipeline invariants', () => {
  const emitted = emitModule('recruitment', RECRUITMENT_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type Stage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';
  interface Job { id: string; status: string }
  interface Candidate { id: string }
  interface Application { id: string; stage: Stage; history: unknown[] }
  interface Service {
    postJob(d: { title: string }): Job;
    closeJob(id: string): Job;
    reopenJob(id: string): Job;
    addCandidate(d: { name: string; email: string }): Candidate;
    apply(jobId: string, candidateId: string): Application;
    advance(appId: string, to: Stage): Application;
    applicationsFor(jobId: string, stage?: Stage): Application[];
  }
  interface Emitted { RecruitmentService: new () => Service; canTransition(a: Stage, b: Stage): boolean }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }
  async function seed() {
    const { RecruitmentService } = await load();
    const svc = new RecruitmentService();
    const job = svc.postJob({ title: 'Backend Engineer' });
    const cand = svc.addCandidate({ name: 'Asha', email: 'asha@example.com' });
    return { svc, job, cand };
  }

  it('canTransition encodes the pipeline (applied→screening ok, applied→hired no, hired terminal)', async () => {
    const { canTransition } = await load();
    expect(canTransition('applied', 'screening')).toBe(true);
    expect(canTransition('offer', 'hired')).toBe(true);
    expect(canTransition('applied', 'hired')).toBe(false); // no skipping
    expect(canTransition('hired', 'offer')).toBe(false);   // terminal
    expect(canTransition('interview', 'rejected')).toBe(true); // reject from any non-terminal
  });

  it('walks applied→screening→interview→offer→hired and REJECTS an invalid jump', async () => {
    const { svc, job, cand } = await seed();
    const app = svc.apply(job.id, cand.id);
    expect(app.stage).toBe('applied');
    expect(() => svc.advance(app.id, 'offer')).toThrow(/Invalid application transition/);
    svc.advance(app.id, 'screening');
    svc.advance(app.id, 'interview');
    svc.advance(app.id, 'offer');
    expect(svc.advance(app.id, 'hired').stage).toBe('hired');
    expect(() => svc.advance(app.id, 'screening')).toThrow(/Invalid application transition/); // hired terminal
  });

  it('a candidate can apply to a job at most ONCE (409-class)', async () => {
    const { svc, job, cand } = await seed();
    svc.apply(job.id, cand.id);
    expect(() => svc.apply(job.id, cand.id)).toThrow(/already applied/);
    // a DIFFERENT candidate can still apply
    const other = svc.addCandidate({ name: 'Ravi', email: 'ravi@example.com' });
    expect(svc.apply(job.id, other.id).stage).toBe('applied');
  });

  it('a CLOSED job accepts no applications (409-class); reopen restores it', async () => {
    const { svc, job, cand } = await seed();
    svc.closeJob(job.id);
    expect(() => svc.apply(job.id, cand.id)).toThrow(/closed/);
    svc.reopenJob(job.id);
    expect(svc.apply(job.id, cand.id).stage).toBe('applied');
  });

  it('applicationsFor filters by stage and records history', async () => {
    const { svc, job, cand } = await seed();
    const app = svc.apply(job.id, cand.id);
    svc.advance(app.id, 'screening');
    expect(svc.applicationsFor(job.id, 'screening').map((a) => a.id)).toEqual([app.id]);
    expect(svc.applicationsFor(job.id, 'applied').length).toBe(0);
    expect(svc.applicationsFor(job.id)[0].history.length).toBe(2); // applied + screening
  });
});
