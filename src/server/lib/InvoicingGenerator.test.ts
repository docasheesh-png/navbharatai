import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateInvoicingIntegration, INVOICING_SERVICE_SOURCE } from './InvoicingGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateInvoicingIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generateInvoicingIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/invoicing/invoicingService.ts');
    expect(paths).toContain('server/invoicing/routes.ts');
    expect(paths).toContain('server/invoicing/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/invoicing/routes.ts']).toContain('409');
    expect(out.files['server/invoicing/routes.ts']).toContain('export const invoicingRouter');
  });
});

describe('emitted InvoicingService — invoice lifecycle + exact payment ledger + derived overdue', () => {
  const artifact = join(here, `._invoicing_emitted_${process.pid}.ts`);
  writeFileSync(artifact, INVOICING_SERVICE_SOURCE);
  afterAll(() => { try { unlinkSync(artifact); } catch { /* gone */ } });

  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2024, 2, 1);

  type Status = 'draft' | 'sent' | 'paid' | 'cancelled';
  interface Invoice { id: string; status: Status; number: string }
  interface Service {
    createInvoice(d: { clientName: string; lines: Array<{ description: string; qty: number; unitPrice: number }>; taxRatePct?: number; dueAt?: number }): Invoice;
    total(inv: Invoice): { subtotal: number; tax: number; total: number };
    balance(inv: Invoice): number;
    setStatus(id: string, to: Status, now?: number): Invoice;
    recordPayment(id: string, amount: number, method?: string, now?: number): Invoice;
    displayStatus(inv: Invoice, now?: number): string;
    isOverdue(inv: Invoice, now?: number): boolean;
    get(id: string): Invoice | undefined;
    outstandingTotal(now?: number): number;
  }
  interface Emitted { InvoicingService: new () => Service; canTransition(a: Status, b: Status): boolean }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }
  async function seed(opts?: { dueAt?: number; taxRatePct?: number }) {
    const { InvoicingService } = await load();
    const svc = new InvoicingService();
    const inv = svc.createInvoice({
      clientName: 'Acme', taxRatePct: opts?.taxRatePct ?? 18, dueAt: opts?.dueAt,
      lines: [{ description: 'Design', qty: 2, unitPrice: 500 }, { description: 'Dev', qty: 1, unitPrice: 1000 }],
    });
    return { svc, inv };
  }

  it('total = exact subtotal + tax from the line items', async () => {
    const { svc, inv } = await seed({ taxRatePct: 18 });
    const t = svc.total(inv);
    expect(t.subtotal).toBe(2000); // 2*500 + 1*1000
    expect(t.tax).toBe(360);       // 18% of 2000
    expect(t.total).toBe(2360);
  });

  it('state-machine: draft→sent ok; draft→paid REJECTED; paid terminal', async () => {
    const { svc, inv } = await seed();
    expect(() => svc.setStatus(inv.id, 'paid', NOW)).toThrow(/Invalid invoice transition/); // must be sent first
    svc.setStatus(inv.id, 'sent', NOW);
    // full payment auto-marks paid; then no further transitions
    svc.recordPayment(inv.id, 2360, 'card', NOW);
    expect(svc.get(inv.id)!.status).toBe('paid');
    expect(() => svc.setStatus(inv.id, 'sent', NOW)).toThrow(/Invalid invoice transition/);
  });

  it('payment ledger: partial payments reduce balance; overpayment rejected (409-class); auto-PAID at zero', async () => {
    const { svc, inv } = await seed();
    svc.setStatus(inv.id, 'sent', NOW);
    svc.recordPayment(inv.id, 1000, 'upi', NOW);
    expect(svc.balance(svc.get(inv.id)!)).toBe(1360);
    expect(() => svc.recordPayment(inv.id, 2000, 'upi', NOW)).toThrow(/exceeds the outstanding balance/);
    svc.recordPayment(inv.id, 1360, 'upi', NOW);
    expect(svc.balance(svc.get(inv.id)!)).toBe(0);
    expect(svc.get(inv.id)!.status).toBe('paid');
  });

  it('OVERDUE is derived: a sent, unpaid, past-due invoice reads "overdue"; a paid one never does', async () => {
    const { svc, inv } = await seed({ dueAt: NOW + 7 * DAY });
    svc.setStatus(inv.id, 'sent', NOW);
    expect(svc.displayStatus(svc.get(inv.id)!, NOW + 3 * DAY)).toBe('sent');       // before due
    expect(svc.isOverdue(svc.get(inv.id)!, NOW + 10 * DAY)).toBe(true);            // after due, unpaid
    svc.recordPayment(inv.id, 2360, 'card', NOW + 11 * DAY);                        // fully paid
    expect(svc.isOverdue(svc.get(inv.id)!, NOW + 20 * DAY)).toBe(false);           // paid is never overdue
  });

  it('cannot pay a cancelled invoice; outstandingTotal sums sent balances', async () => {
    const { svc, inv } = await seed();
    const inv2 = svc.createInvoice({ clientName: 'B', lines: [{ description: 'x', qty: 1, unitPrice: 500 }] });
    svc.setStatus(inv.id, 'sent', NOW);   // total 2360 outstanding
    svc.setStatus(inv2.id, 'cancelled', NOW);
    expect(() => svc.recordPayment(inv2.id, 100, 'x', NOW)).toThrow(/cancelled/);
    expect(svc.outstandingTotal(NOW)).toBe(2360);
  });
});
