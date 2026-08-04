import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateSupportTicketIntegration, TICKET_SERVICE_SOURCE } from './SupportTicketGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateSupportTicketIntegration (wiring)', () => {
  it('emits the ticket service, routes and README', () => {
    const out = generateSupportTicketIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/tickets/ticketService.ts');
    expect(paths).toContain('server/tickets/routes.ts');
    expect(paths).toContain('server/tickets/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/tickets/routes.ts']).toContain('409');
    expect(out.files['server/tickets/routes.ts']).toContain('export const ticketRouter');
  });
});

// Materialize + execute the emitted domain logic — the status state-machine is a real business rule,
// verified against the actual emitted code.
describe('emitted TicketService — status state-machine (real logic)', () => {
  const artifact = join(here, `._ticket_emitted_${process.pid}.ts`);
  writeFileSync(artifact, TICKET_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  type Status = 'open' | 'in_progress' | 'resolved' | 'closed';
  interface Ticket { id: string; status: Status; assignee: string | null; comments: unknown[] }
  interface Service {
    create(subject: string, requester: string): Ticket;
    transition(id: string, to: Status): Ticket;
    assign(id: string, assignee: string | null): Ticket;
    comment(id: string, author: string, body: string): Ticket;
    list(filter?: { status?: Status; assignee?: string; requester?: string }): Ticket[];
  }
  interface Emitted { TicketService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('creates open tickets and walks the happy path open→in_progress→resolved→closed', async () => {
    const { TicketService } = await load();
    const svc = new TicketService();
    const t = svc.create('Cannot log in', 'asha@example.com');
    expect(t.status).toBe('open');
    expect(svc.transition(t.id, 'in_progress').status).toBe('in_progress');
    expect(svc.transition(t.id, 'resolved').status).toBe('resolved');
    expect(svc.transition(t.id, 'closed').status).toBe('closed');
  });

  it('REJECTS an invalid transition (a closed ticket cannot jump to resolved)', async () => {
    const { TicketService } = await load();
    const svc = new TicketService();
    const t = svc.create('x', 'y');
    svc.transition(t.id, 'closed'); // open -> closed is allowed
    expect(() => svc.transition(t.id, 'resolved')).toThrow(/invalid transition/);
    expect(() => svc.transition(t.id, 'in_progress')).toThrow(/invalid transition/);
    // ...but a closed ticket CAN be reopened.
    expect(svc.transition(t.id, 'open').status).toBe('open');
  });

  it('assign, comment and filtered list reflect real state', async () => {
    const { TicketService } = await load();
    const svc = new TicketService();
    const a = svc.create('a', 'req1');
    const b = svc.create('b', 'req2');
    svc.assign(a.id, 'agent-1');
    svc.transition(b.id, 'in_progress');
    svc.comment(a.id, 'agent-1', 'looking into it');
    expect(svc.list({ assignee: 'agent-1' }).map((t) => t.id)).toEqual([a.id]);
    expect(svc.list({ status: 'in_progress' }).map((t) => t.id)).toEqual([b.id]);
    expect(svc.list({ status: 'open' }).map((t) => t.id)).toEqual([a.id]);
    // comment recorded, status unchanged by commenting
    expect(svc.list({ assignee: 'agent-1' })[0].comments.length).toBe(1);
  });

  it('validates input and unknown ids', async () => {
    const { TicketService } = await load();
    const svc = new TicketService();
    expect(() => svc.create('', 'r')).toThrow(/subject is required/);
    expect(() => svc.create('s', '')).toThrow(/requester is required/);
    expect(() => svc.transition('nope', 'open')).toThrow(/not found/);
    const t = svc.create('s', 'r');
    expect(() => svc.comment(t.id, '', 'b')).toThrow(/author is required/);
  });
});
