import { describe, it, expect, afterAll } from 'vitest';

import { generateCrmIntegration, CRM_SERVICE_SOURCE } from './CrmGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateCrmIntegration (wiring)', () => {
  it('emits the CRM service, routes and README', () => {
    const out = generateCrmIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/crm/crmService.ts');
    expect(paths).toContain('server/crm/routes.ts');
    expect(paths).toContain('server/crm/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/crm/routes.ts']).toContain('409');
    expect(out.files['server/crm/routes.ts']).toContain('export const crmRouter');
  });
});

// Materialize + execute the emitted domain logic — the sales-stage state-machine + pipeline value are real
// business rules, verified against the actual emitted code.
describe('emitted CrmService — sales pipeline state-machine (real logic)', () => {
  const emitted = emitModule('crm', CRM_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type Stage = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';
  interface Contact { id: string }
  interface Lead { id: string; stage: Stage; value: number; owner: string | null; notes: unknown[] }
  interface Service {
    addContact(i: { name: string; email?: string; company?: string }): Contact;
    addLead(i: { contactId: string; title: string; value?: number }): Lead;
    moveStage(id: string, to: Stage): Lead;
    assign(id: string, owner: string | null): Lead;
    addNote(id: string, author: string, body: string): Lead;
    listLeads(f?: { stage?: Stage; owner?: string; contactId?: string }): Lead[];
    openPipelineValue(): number;
  }
  interface Emitted { CrmService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('walks the happy path new→contacted→qualified→won', async () => {
    const { CrmService } = await load();
    const svc = new CrmService();
    const c = svc.addContact({ name: 'Asha', company: 'Acme' });
    const l = svc.addLead({ contactId: c.id, title: 'Annual plan', value: 50000 });
    expect(l.stage).toBe('new');
    expect(svc.moveStage(l.id, 'contacted').stage).toBe('contacted');
    expect(svc.moveStage(l.id, 'qualified').stage).toBe('qualified');
    expect(svc.moveStage(l.id, 'won').stage).toBe('won');
  });

  it('REJECTS an invalid stage jump (new -> won without qualifying)', async () => {
    const { CrmService } = await load();
    const svc = new CrmService();
    const c = svc.addContact({ name: 'Ravi' });
    const l = svc.addLead({ contactId: c.id, title: 'Deal' });
    expect(() => svc.moveStage(l.id, 'won')).toThrow(/invalid stage transition/);
    // won is terminal except reopen: qualify → win → then only 'new' is allowed
    svc.moveStage(l.id, 'qualified');
    svc.moveStage(l.id, 'won');
    expect(() => svc.moveStage(l.id, 'qualified')).toThrow(/invalid stage transition/);
    expect(svc.moveStage(l.id, 'new').stage).toBe('new'); // reopen allowed
  });

  it('a lead requires a KNOWN contact + a title', async () => {
    const { CrmService } = await load();
    const svc = new CrmService();
    expect(() => svc.addLead({ contactId: 'nope', title: 'x' })).toThrow(/unknown contact/);
    const c = svc.addContact({ name: 'A' });
    expect(() => svc.addLead({ contactId: c.id, title: '' })).toThrow(/title is required/);
    expect(() => svc.addContact({ name: '' })).toThrow(/name is required/);
  });

  it('openPipelineValue sums OPEN leads only (won/lost excluded)', async () => {
    const { CrmService } = await load();
    const svc = new CrmService();
    const c = svc.addContact({ name: 'A' });
    const a = svc.addLead({ contactId: c.id, title: 'a', value: 100 });
    const b = svc.addLead({ contactId: c.id, title: 'b', value: 200 });
    svc.addLead({ contactId: c.id, title: 'c', value: 50 });
    expect(svc.openPipelineValue()).toBe(350);
    // move one to won → it leaves the open pipeline
    svc.moveStage(a.id, 'qualified');
    svc.moveStage(a.id, 'won');
    expect(svc.openPipelineValue()).toBe(250);
    // move one to lost → also excluded
    svc.moveStage(b.id, 'lost');
    expect(svc.openPipelineValue()).toBe(50);
  });

  it('assign / note / filtered list reflect real state', async () => {
    const { CrmService } = await load();
    const svc = new CrmService();
    const c = svc.addContact({ name: 'A' });
    const l = svc.addLead({ contactId: c.id, title: 'x' });
    svc.assign(l.id, 'rep-1');
    svc.addNote(l.id, 'rep-1', 'called, interested');
    expect(svc.listLeads({ owner: 'rep-1' }).map((x) => x.id)).toEqual([l.id]);
    expect(svc.listLeads({ stage: 'new' }).length).toBe(1);
    expect(svc.listLeads({ owner: 'rep-1' })[0].notes.length).toBe(1);
  });
});
