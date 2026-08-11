import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateHelpdeskIntegration, HELPDESK_SERVICE_SOURCE } from './HelpdeskGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateHelpdeskIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generateHelpdeskIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/helpdesk/helpdeskService.ts');
    expect(paths).toContain('server/helpdesk/routes.ts');
    expect(paths).toContain('server/helpdesk/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/helpdesk/routes.ts']).toContain('409');
    expect(out.files['server/helpdesk/routes.ts']).toContain('export const helpdeskRouter');
  });
});

describe('emitted HelpdeskService — status state-machine + priority SLA breach', () => {
  const artifact = join(here, `._helpdesk_emitted_${process.pid}.ts`);
  writeFileSync(artifact, HELPDESK_SERVICE_SOURCE);
  afterAll(() => { try { unlinkSync(artifact); } catch { /* gone */ } });

  const HOUR = 60 * 60 * 1000;
  const NOW = Date.UTC(2024, 3, 1);

  type Status = 'open' | 'in_progress' | 'resolved' | 'closed';
  type Priority = 'low' | 'medium' | 'high' | 'urgent';
  interface Ticket { id: string; status: Status; thread: unknown[] }
  interface Service {
    createTicket(d: { subject: string; requester: string; priority?: Priority }, now?: number): Ticket;
    setStatus(id: string, to: Status, by?: string, now?: number): Ticket;
    assign(id: string, a: string, now?: number): Ticket;
    addComment(id: string, by: string, text: string, now?: number): Ticket;
    slaDueAt(t: Ticket): number;
    isSlaBreached(t: Ticket, now?: number): boolean;
    thread(id: string): unknown[];
    list(f?: { breached?: boolean }, now?: number): Ticket[];
    get(id: string): Ticket | undefined;
  }
  interface Emitted { HelpdeskService: new () => Service; canTransition(a: Status, b: Status): boolean; SLA_HOURS: Record<Priority, number> }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('canTransition encodes the workflow (open→in_progress ok, open→closed ok, resolved→open reopen)', async () => {
    const { canTransition } = await load();
    expect(canTransition('open', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'open')).toBe(true); // reopen
    expect(canTransition('closed', 'in_progress')).toBe(false); // must reopen to 'open' first
  });

  it('walks open→in_progress→resolved→closed and REJECTS an invalid jump', async () => {
    const { HelpdeskService } = await load();
    const svc = new HelpdeskService();
    const t = svc.createTicket({ subject: 'Login broken', requester: 'asha', priority: 'high' }, NOW);
    expect(() => svc.setStatus(t.id, 'closed', 'agent', NOW), ).not.toThrow(); // open→closed allowed
    const t2 = svc.createTicket({ subject: 'x', requester: 'y' }, NOW);
    svc.setStatus(t2.id, 'in_progress', 'agent', NOW);
    svc.setStatus(t2.id, 'resolved', 'agent', NOW);
    expect(svc.setStatus(t2.id, 'closed', 'agent', NOW).status).toBe('closed');
    expect(() => svc.setStatus(t2.id, 'in_progress', 'agent', NOW)).toThrow(/Invalid ticket transition/);
  });

  it('SLA breach is PRIORITY-driven and derived from the due time', async () => {
    const { HelpdeskService, SLA_HOURS } = await load();
    const svc = new HelpdeskService();
    expect(SLA_HOURS.urgent).toBe(4);
    const t = svc.createTicket({ subject: 'urgent!', requester: 'a', priority: 'urgent' }, NOW); // SLA 4h
    expect(svc.isSlaBreached(svc.get(t.id)!, NOW + 3 * HOUR)).toBe(false); // within 4h
    expect(svc.isSlaBreached(svc.get(t.id)!, NOW + 5 * HOUR)).toBe(true);  // past 4h, unresolved
    // resolving stops the breach
    svc.setStatus(t.id, 'resolved', 'agent', NOW + 5 * HOUR);
    expect(svc.isSlaBreached(svc.get(t.id)!, NOW + 100 * HOUR)).toBe(false);
  });

  it('reopening a resolved ticket restarts the SLA clock (breach reappears when past due again)', async () => {
    const { HelpdeskService } = await load();
    const svc = new HelpdeskService();
    const t = svc.createTicket({ subject: 'x', requester: 'a', priority: 'urgent' }, NOW);
    svc.setStatus(t.id, 'resolved', 'agent', NOW + 1 * HOUR);
    expect(svc.isSlaBreached(svc.get(t.id)!, NOW + 100 * HOUR)).toBe(false);
    svc.setStatus(t.id, 'open', 'agent', NOW + 100 * HOUR); // reopened → resolvedAt cleared, unresolved again
    expect(svc.isSlaBreached(svc.get(t.id)!, NOW + 200 * HOUR)).toBe(true);
  });

  it('thread is append-only (status changes + comments, ordered) and breached filter works', async () => {
    const { HelpdeskService } = await load();
    const svc = new HelpdeskService();
    const t = svc.createTicket({ subject: 'x', requester: 'a', priority: 'urgent' }, NOW);
    svc.setStatus(t.id, 'in_progress', 'agent', NOW + HOUR);
    svc.addComment(t.id, 'agent', 'looking into it', NOW + 2 * HOUR);
    const thread = svc.thread(t.id) as Array<{ kind: string }>;
    expect(thread.length).toBe(2); // one status + one comment
    (svc.thread(t.id) as unknown[]).pop();
    expect(svc.thread(t.id).length).toBe(2); // returned copy never mutates the internal thread
    // breached filter at a time past the urgent SLA
    expect(svc.list({ breached: true }, NOW + 10 * HOUR).map((x) => x.id)).toEqual([t.id]);
  });
});
