import { describe, it, expect, afterAll } from 'vitest';

import { generateFieldServiceIntegration, FIELD_SERVICE_SERVICE_SOURCE } from './FieldServiceGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateFieldServiceIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generateFieldServiceIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/fieldservice/fieldService.ts');
    expect(paths).toContain('server/fieldservice/routes.ts');
    expect(paths).toContain('server/fieldservice/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/fieldservice/routes.ts']).toContain('409');
    expect(out.files['server/fieldservice/routes.ts']).toContain('export function fieldServiceRouter');
  });
});

describe('emitted FieldServiceService — job state-machine + one-active-job-per-technician', () => {
  const emitted = emitModule('fieldservice', FIELD_SERVICE_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  const NOW = Date.UTC(2024, 3, 1);

  type JobStatus = 'requested' | 'assigned' | 'en_route' | 'on_site' | 'completed' | 'cancelled';
  interface Job { id: string; status: JobStatus; technicianId?: string; history: unknown[] }
  interface Service {
    addTechnician(name: string, skills?: string[]): { id: string };
    activeJobOf(techId: string): Job | undefined;
    createJob(customer: string, address: string, desc?: string): Job;
    assign(jobId: string, techId: string): Job;
    setStatus(jobId: string, to: JobStatus): Job;
    cancel(jobId: string): Job;
    listJobs(f?: { technicianId?: string; status?: JobStatus }): Job[];
    getJob(id: string): Job | undefined;
  }
  interface Emitted { FieldServiceService: new (now?: () => number) => Service; canTransitionJob(a: JobStatus, b: JobStatus): boolean }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('walks requested→assigned→en_route→on_site→completed and rejects an invalid jump', async () => {
    const { FieldServiceService } = await load();
    const svc = new FieldServiceService(() => NOW);
    const t = svc.addTechnician('Ravi', ['ac']);
    const j = svc.createJob('Asha', '12 MG Road', 'AC not cooling');
    expect(j.status).toBe('requested');
    expect(() => svc.setStatus(j.id, 'on_site')).toThrow(/Cannot move a job/); // can't skip assignment
    svc.assign(j.id, t.id);
    expect(svc.getJob(j.id)!.status).toBe('assigned');
    svc.setStatus(j.id, 'en_route');
    svc.setStatus(j.id, 'on_site');
    expect(svc.setStatus(j.id, 'completed').status).toBe('completed');
    expect(() => svc.setStatus(j.id, 'en_route')).toThrow(/Cannot move a job/); // completed is terminal
  });

  it("'assigned' is reachable ONLY through assign(), never a bare status change", async () => {
    const { FieldServiceService, canTransitionJob } = await load();
    expect(canTransitionJob('requested', 'assigned')).toBe(false); // not via setStatus
    expect(canTransitionJob('requested', 'cancelled')).toBe(true);
    const svc = new FieldServiceService(() => NOW);
    const j = svc.createJob('A', 'addr', 'x');
    expect(() => svc.setStatus(j.id, 'assigned')).toThrow(/Cannot move a job/);
  });

  it('a technician holds at most ONE active job — assigning a busy tech is 409', async () => {
    const { FieldServiceService } = await load();
    const svc = new FieldServiceService(() => NOW);
    const t = svc.addTechnician('Ravi');
    const j1 = svc.createJob('A', 'a1', 'x');
    const j2 = svc.createJob('B', 'a2', 'y');
    svc.assign(j1.id, t.id);
    expect(svc.activeJobOf(t.id)!.id).toBe(j1.id);
    expect(() => svc.assign(j2.id, t.id)).toThrow(/one active job at a time/);
    // completing j1 frees the technician (derived, not a flag)
    svc.setStatus(j1.id, 'en_route'); svc.setStatus(j1.id, 'on_site'); svc.setStatus(j1.id, 'completed');
    expect(svc.activeJobOf(t.id)).toBeUndefined();
    expect(svc.assign(j2.id, t.id).status).toBe('assigned'); // now allowed
  });

  it('unassigning (assigned→requested) frees the technician', async () => {
    const { FieldServiceService } = await load();
    const svc = new FieldServiceService(() => NOW);
    const t = svc.addTechnician('Ravi');
    const j = svc.createJob('A', 'a', 'x');
    svc.assign(j.id, t.id);
    svc.setStatus(j.id, 'requested'); // unassign
    expect(svc.getJob(j.id)!.technicianId).toBeUndefined();
    expect(svc.activeJobOf(t.id)).toBeUndefined();
  });

  it('rejects unknown job/technician and a job with no address', async () => {
    const { FieldServiceService } = await load();
    const svc = new FieldServiceService(() => NOW);
    expect(() => svc.createJob('A', '', 'x')).toThrow(/address/);
    const j = svc.createJob('A', 'a', 'x');
    expect(() => svc.assign(j.id, 'nope')).toThrow(/No such technician/);
    const t = svc.addTechnician('R');
    expect(() => svc.assign('nope', t.id)).toThrow(/No such job/);
  });

  it('history is append-only and records assignment + status changes', async () => {
    const { FieldServiceService } = await load();
    const svc = new FieldServiceService(() => NOW);
    const t = svc.addTechnician('R');
    const j = svc.createJob('A', 'a', 'x');
    svc.assign(j.id, t.id);
    svc.setStatus(j.id, 'en_route');
    expect(svc.getJob(j.id)!.history.length).toBe(3); // requested + assigned + en_route
  });
});
