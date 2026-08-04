// Invoicing / freelance-billing domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the established recipe pattern. Distinct real guarantees (not overlapping the subscriptions or
// restaurant-GST recipes): the value here is an INVOICE LIFECYCLE + exact payment ledger:
//   1. INVOICE STATE-MACHINE: draft → sent → paid | cancelled along allowed transitions only; a paid or
//      cancelled invoice is terminal. An invalid jump is rejected (409).
//   2. EXACT PAYMENT LEDGER: balance = total − sum(payments); a payment can never exceed the balance
//      (no negative balance); the invoice auto-marks PAID when the balance reaches 0.
//   3. OVERDUE is DERIVED (never a manual status): a sent, unpaid invoice past its due date is overdue —
//      computed exactly from the dates, so the status is always honest.
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const INVOICING_SERVICE_SOURCE = `// Invoicing / billing domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) An invoice's status follows an allowed STATE-MACHINE (draft → sent → paid|cancelled).
//  2) The payment ledger is exact: balance = total − paid, never negative; auto-PAID at zero balance.
//  3) "overdue" is DERIVED from the due date (a sent, unpaid, past-due invoice) — never set by hand.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.
// Date-sensitive reads take an explicit 'now' for deterministic, testable behaviour (default Date.now()).

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled';
/** The status shown to a user — the stored status, except a sent+unpaid+past-due invoice reads 'overdue'. */
export type DisplayStatus = InvoiceStatus | 'overdue';

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface LineItem { description: string; qty: number; unitPrice: number; }
export interface Payment { id: string; amount: number; method?: string; at: number; }

export interface Invoice {
  id: string;
  number: string;
  clientName: string;
  lines: LineItem[];
  taxRatePct: number;
  status: InvoiceStatus;
  issuedAt: number | null; // set when moved to 'sent'
  dueAt: number | null;    // due date (epoch ms)
  payments: Payment[];
  createdAt: number;
}

export class InvalidTransitionError extends Error {
  constructor(from: InvoiceStatus, to: InvoiceStatus) { super(\`Invalid invoice transition \${from} → \${to}\`); this.name = 'InvalidTransitionError'; }
}
export class OverpaymentError extends Error {
  constructor(balance: number, amount: number) { super(\`Payment \${amount} exceeds the outstanding balance \${balance}\`); this.name = 'OverpaymentError'; }
}

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export class InvoicingService {
  private invoices = new Map<string, Invoice>();
  private counter = 0;

  createInvoice(data: { clientName: string; lines: LineItem[]; taxRatePct?: number; dueAt?: number }): Invoice {
    if (!data.clientName?.trim()) throw new Error('Client name is required');
    if (!Array.isArray(data.lines) || data.lines.length === 0) throw new Error('At least one line item is required');
    const inv: Invoice = {
      id: nextId('inv'),
      number: \`INV-\${String(++this.counter).padStart(4, '0')}\`,
      clientName: data.clientName.trim(),
      lines: data.lines,
      taxRatePct: data.taxRatePct ?? 0,
      status: 'draft',
      issuedAt: null,
      dueAt: data.dueAt ?? null,
      payments: [],
      createdAt: Date.now(),
    };
    this.invoices.set(inv.id, inv);
    return inv;
  }

  /** subtotal + tax = total, computed exactly from the line items. */
  total(inv: Invoice): { subtotal: number; tax: number; total: number } {
    const subtotal = round2(inv.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
    const tax = round2(subtotal * (inv.taxRatePct / 100));
    return { subtotal, tax, total: round2(subtotal + tax) };
  }

  paidAmount(inv: Invoice): number {
    return round2(inv.payments.reduce((s, p) => s + p.amount, 0));
  }
  balance(inv: Invoice): number {
    return round2(this.total(inv).total - this.paidAmount(inv));
  }

  setStatus(id: string, to: InvoiceStatus, now: number = Date.now()): Invoice {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(\`Unknown invoice \${id}\`);
    if (!canTransition(inv.status, to)) throw new InvalidTransitionError(inv.status, to);
    inv.status = to;
    if (to === 'sent' && inv.issuedAt === null) inv.issuedAt = now;
    return inv;
  }

  recordPayment(id: string, amount: number, method?: string, now: number = Date.now()): Invoice {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(\`Unknown invoice \${id}\`);
    if (!(amount > 0)) throw new Error('Payment amount must be > 0');
    if (inv.status === 'cancelled') throw new Error('Cannot pay a cancelled invoice');
    const bal = this.balance(inv);
    if (amount > bal) throw new OverpaymentError(bal, amount);
    inv.payments.push({ id: nextId('pay'), amount: round2(amount), method, at: now });
    if (this.balance(inv) === 0) inv.status = 'paid'; // auto-mark paid at zero balance
    return inv;
  }

  /** The HONEST display status — 'overdue' when a sent, unpaid invoice is past its due date. */
  displayStatus(inv: Invoice, now: number = Date.now()): DisplayStatus {
    if (inv.status === 'sent' && inv.dueAt !== null && now > inv.dueAt && this.balance(inv) > 0) return 'overdue';
    return inv.status;
  }
  isOverdue(inv: Invoice, now: number = Date.now()): boolean {
    return this.displayStatus(inv, now) === 'overdue';
  }

  get(id: string): Invoice | undefined { return this.invoices.get(id); }
  list(filter?: { status?: DisplayStatus }, now: number = Date.now()): Invoice[] {
    return [...this.invoices.values()]
      .filter((inv) => !filter?.status || this.displayStatus(inv, now) === filter.status)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  outstandingTotal(now: number = Date.now()): number {
    return round2([...this.invoices.values()]
      .filter((inv) => inv.status === 'sent')
      .reduce((s, inv) => s + this.balance(inv), 0));
  }
}

export const invoicing = new InvoicingService();
`;

export const INVOICING_ROUTES_SOURCE = `import { Router } from 'express';
import { invoicing, InvalidTransitionError, OverpaymentError } from './invoicingService';

export const invoicingRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    const out = fn();
    if (out === undefined) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(out);
  } catch (e) {
    if (e instanceof InvalidTransitionError || e instanceof OverpaymentError) { res.status(409).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

// A view helper: attach the derived totals + display status to an invoice for the client.
function view(id: string) {
  const inv = invoicing.get(id);
  if (!inv) return undefined;
  return { ...inv, ...invoicing.total(inv), balance: invoicing.balance(inv), displayStatus: invoicing.displayStatus(inv) };
}

invoicingRouter.get('/invoices', (req, res) => handle(res, () => invoicing.list({ status: req.query.status as never })));
invoicingRouter.post('/invoices', (req, res) => handle(res, () => invoicing.createInvoice(req.body)));
invoicingRouter.get('/invoices/:id', (req, res) => handle(res, () => view(req.params.id)));
invoicingRouter.patch('/invoices/:id/status', (req, res) => handle(res, () => invoicing.setStatus(req.params.id, req.body?.status))); // 409 invalid
invoicingRouter.post('/invoices/:id/payments', (req, res) => handle(res, () => invoicing.recordPayment(req.params.id, Number(req.body?.amount), req.body?.method))); // 409 overpay
invoicingRouter.get('/invoices/outstanding/total', (_req, res) => handle(res, () => ({ outstanding: invoicing.outstandingTotal() })));
`;

export const INVOICING_README = `# Invoicing / billing starter

A dependency-free invoicing backend under \`server/invoicing/\`, wired for Express.

## Real guarantees (not a stub)
- **Invoice state-machine** — \`draft → sent → paid|cancelled\` along allowed transitions only; \`paid\` and
  \`cancelled\` are terminal. An invalid jump is rejected (**409**).
- **Exact payment ledger** — \`balance = total − sum(payments)\`; a payment can never exceed the balance
  (**409**, no negative balance); the invoice auto-marks **paid** when the balance reaches 0.
- **Overdue is derived** — a sent, unpaid invoice past its due date reads \`overdue\` (computed from the
  dates, never set by hand), so the status is always honest.

## Endpoints (mount with \`app.use("/api", invoicingRouter)\`)
- \`GET /invoices\` (filter by displayStatus incl. \`overdue\`), \`POST /invoices\`, \`GET /invoices/:id\`
  (returns subtotal/tax/total/balance/displayStatus)
- \`PATCH /invoices/:id/status\` (**409** on invalid), \`POST /invoices/:id/payments\` (**409** on overpay)
- \`GET /invoices/outstanding/total\`

In-memory by default; swap the Maps in \`invoicingService.ts\` for your DB. Pairs with the auth/payment/notification recipes.
`;

export interface InvoicingConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Invoicing / billing starter wired under server/invoicing/ (dependency-free domain logic + an Express ' +
  'router). Three real guarantees: (1) INVOICE STATE-MACHINE — draft → sent → paid|cancelled along allowed ' +
  'transitions only (paid/cancelled terminal), invalid jumps rejected (409); (2) EXACT PAYMENT LEDGER — ' +
  'balance = total − sum(payments), a payment can never exceed the balance (409, no negative), auto-PAID at ' +
  'zero balance; (3) OVERDUE is DERIVED — a sent, unpaid, past-due invoice reads "overdue" (computed from ' +
  'the dates, never set by hand). Endpoints: GET/POST /invoices, GET /invoices/:id (with subtotal/tax/total/' +
  'balance/displayStatus), PATCH /invoices/:id/status, POST /invoices/:id/payments, GET ' +
  '/invoices/outstanding/total. Mount with app.use("/api", invoicingRouter). In-memory by default — swap the ' +
  'Maps for your DB, same contracts. Pairs with the auth/payment/notification recipes. No key.';

export function generateInvoicingIntegration(): InvoicingConfig {
  return {
    files: {
      'server/invoicing/invoicingService.ts': INVOICING_SERVICE_SOURCE,
      'server/invoicing/routes.ts': INVOICING_ROUTES_SOURCE,
      'server/invoicing/README.md': INVOICING_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
