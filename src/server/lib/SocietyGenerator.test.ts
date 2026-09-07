import { describe, it, expect, afterAll } from 'vitest';

import { generateSocietyIntegration, SOCIETY_SERVICE_SOURCE } from './SocietyGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateSocietyIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generateSocietyIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/society/societyService.ts');
    expect(paths).toContain('server/society/routes.ts');
    expect(paths).toContain('server/society/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/society/routes.ts']).toContain('409');
    expect(out.files['server/society/routes.ts']).toContain('export function societyRouter');
  });
});

describe('emitted SocietyService — dues ledger + complaint state-machine + append-only logs', () => {
  const emitted = emitModule('society', SOCIETY_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  const NOW = Date.UTC(2024, 3, 1);

  interface Unit { id: string; label: string }
  interface Entry { kind: 'invoice' | 'payment'; amount: number }
  type Status = 'open' | 'in_progress' | 'resolved' | 'closed';
  interface Complaint { id: string; status: Status; history: unknown[] }
  interface Visitor { id: string; outAt?: number }
  interface Service {
    addUnit(label: string, owner: string, resident?: string): Unit;
    invoice(unitId: string, amount: number, note?: string): Entry;
    pay(unitId: string, amount: number, note?: string): Entry;
    balanceOf(unitId: string): number;
    ledgerFor(unitId: string): Entry[];
    defaulters(): Array<{ unit: Unit; balance: number }>;
    checkInVisitor(unitId: string, name: string, purpose?: string): Visitor;
    checkOutVisitor(id: string): Visitor;
    currentlyInside(): Visitor[];
    raiseComplaint(unitId: string, title: string): Complaint;
    setComplaintStatus(id: string, to: Status): Complaint;
    listComplaints(f?: { status?: Status; unitId?: string }): Complaint[];
    postNotice(title: string, body?: string): { id: string };
    listNotices(): Array<{ title: string }>;
  }
  interface Emitted { SocietyService: new (now?: () => number) => Service; canTransitionComplaint(a: Status, b: Status): boolean }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('maintenance balance is invoiced − paid, and a payment can NEVER exceed the balance (409, no negative)', async () => {
    const { SocietyService } = await load();
    const svc = new SocietyService(() => NOW);
    const u = svc.addUnit('A-101', 'Asha');
    svc.invoice(u.id, 1000);
    expect(svc.balanceOf(u.id)).toBe(1000);
    svc.pay(u.id, 400);
    expect(svc.balanceOf(u.id)).toBe(600);
    expect(() => svc.pay(u.id, 700)).toThrow(/exceeds the outstanding balance/); // overpay rejected
    expect(svc.balanceOf(u.id)).toBe(600); // unchanged — never went negative
    svc.pay(u.id, 600);
    expect(svc.balanceOf(u.id)).toBe(0);
    expect(svc.ledgerFor(u.id).length).toBe(3); // append-only: 1 invoice + 2 payments
  });

  it('rejects a non-positive invoice/payment amount', async () => {
    const { SocietyService } = await load();
    const svc = new SocietyService(() => NOW);
    const u = svc.addUnit('A-102', 'Bá');
    expect(() => svc.invoice(u.id, 0)).toThrow(/greater than zero/);
    expect(() => svc.pay(u.id, -5)).toThrow(/greater than zero/);
  });

  it('lists defaulters (positive balance) worst-first', async () => {
    const { SocietyService } = await load();
    const svc = new SocietyService(() => NOW);
    const a = svc.addUnit('A-1', 'A'); const b = svc.addUnit('B-1', 'B'); const c = svc.addUnit('C-1', 'C');
    svc.invoice(a.id, 500); svc.invoice(b.id, 900); svc.invoice(c.id, 100); svc.pay(c.id, 100);
    const d = svc.defaulters();
    expect(d.map((x) => x.balance)).toEqual([900, 500]); // c is settled → excluded
  });

  it('complaint status follows the state-machine and rejects an invalid jump (409)', async () => {
    const { SocietyService, canTransitionComplaint } = await load();
    expect(canTransitionComplaint('open', 'in_progress')).toBe(true);
    expect(canTransitionComplaint('resolved', 'open')).toBe(true); // reopen
    expect(canTransitionComplaint('closed', 'in_progress')).toBe(false);
    const svc = new SocietyService(() => NOW);
    const u = svc.addUnit('A-1', 'A');
    const c = svc.raiseComplaint(u.id, 'Lift not working');
    svc.setComplaintStatus(c.id, 'in_progress');
    svc.setComplaintStatus(c.id, 'resolved');
    expect(svc.setComplaintStatus(c.id, 'closed').status).toBe('closed');
    expect(() => svc.setComplaintStatus(c.id, 'in_progress')).toThrow(/Cannot move a complaint/);
    expect(svc.listComplaints({ status: 'closed' }).length).toBe(1);
  });

  it('visitor log: check-out is idempotent and currentlyInside excludes checked-out visitors', async () => {
    const { SocietyService } = await load();
    const svc = new SocietyService(() => NOW);
    const u = svc.addUnit('A-1', 'A');
    const v = svc.checkInVisitor(u.id, 'Courier', 'Delivery');
    expect(svc.currentlyInside().length).toBe(1);
    const out1 = svc.checkOutVisitor(v.id).outAt;
    const out2 = svc.checkOutVisitor(v.id).outAt; // idempotent — same timestamp, no error
    expect(out1).toBe(out2);
    expect(svc.currentlyInside().length).toBe(0);
  });

  it('notice board is newest-first', async () => {
    const { SocietyService } = await load();
    let t = NOW;
    const svc = new SocietyService(() => t);
    svc.postNotice('Water supply', 'Off 10-12'); t += 1000;
    svc.postNotice('AGM', 'Sunday 5pm');
    expect(svc.listNotices().map((n) => n.title)).toEqual(['AGM', 'Water supply']);
  });
});
