// Housing-society / RWA management domain-vertical starter generator (ROADMAP #19 — more verticals).
//
// A distinct India-first domain: apartment complexes and residents' welfare associations. Distinct real
// guarantees from the other verticals (not a booking/sales/hiring pipeline):
//   1. MAINTENANCE-DUES LEDGER that cannot lie: a unit's balance is exactly invoiced − paid, a payment
//      can never exceed the outstanding balance (rejected, 409 — no negative balance), and every invoice
//      and payment is an append-only entry. This is money for a shared building, so it must be exact.
//   2. COMPLAINT STATE-MACHINE: open → in_progress → resolved → closed along allowed transitions only
//      (with a reopen), an invalid jump rejected (409).
//   3. APPEND-ONLY VISITOR LOG + NOTICES: a visitor check-in/out and every society notice is an
//      immutable, ordered record — the security-desk trail a society actually needs.
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.
//
// The emitted code deliberately avoids backticks so it nests cleanly inside this module's template
// literals — the escaping-bug class that silently ships broken code into a user's app.

export const SOCIETY_SERVICE_SOURCE = `// Housing-society / RWA domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) A unit's maintenance balance is exactly invoiced - paid; a payment over the balance is rejected;
//     no balance ever goes negative; the ledger is append-only.
//  2) A complaint's status follows an allowed STATE-MACHINE (open -> in_progress -> resolved -> closed, + reopen).
//  3) The visitor log and the notice board are append-only and ordered.
// In-memory by default — replace the Maps/arrays with your database, keeping the same method contracts.

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'open', 'closed'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

export function canTransitionComplaint(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return (COMPLAINT_TRANSITIONS[from] || []).includes(to);
}

export interface Unit { id: string; label: string; ownerName: string; residentName?: string; }
export interface LedgerEntry { id: string; unitId: string; kind: 'invoice' | 'payment'; amount: number; note: string; at: number; }
export interface Visitor { id: string; unitId: string; name: string; purpose: string; inAt: number; outAt?: number; }
export interface ComplaintEvent { status: ComplaintStatus; at: number; }
export interface Complaint { id: string; unitId: string; title: string; status: ComplaintStatus; createdAt: number; history: ComplaintEvent[]; }
export interface Notice { id: string; title: string; body: string; at: number; }

let seq = 0;
function nextId(prefix: string): string { seq += 1; return prefix + '_' + Date.now().toString(36) + '_' + seq; }

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

export class SocietyService {
  private units = new Map<string, Unit>();
  private ledger: LedgerEntry[] = [];
  private visitors = new Map<string, Visitor>();
  private complaints = new Map<string, Complaint>();
  private notices: Notice[] = [];

  private now: () => number;
  constructor(now: () => number = () => Date.now()) { this.now = now; }

  // ── Units ──
  addUnit(label: string, ownerName: string, residentName?: string): Unit {
    if (!label || !ownerName) throw new Error('A unit needs a label and an owner name.');
    const unit: Unit = { id: nextId('unit'), label, ownerName, residentName };
    this.units.set(unit.id, unit);
    return unit;
  }
  getUnit(id: string): Unit | undefined { return this.units.get(id); }
  listUnits(): Unit[] { return Array.from(this.units.values()); }
  private requireUnit(unitId: string): Unit {
    const u = this.units.get(unitId);
    if (!u) throw Object.assign(new Error('No such unit: ' + unitId), { status: 404 });
    return u;
  }

  // ── Maintenance-dues ledger ──
  invoice(unitId: string, amount: number, note = 'Maintenance'): LedgerEntry {
    this.requireUnit(unitId);
    if (!(amount > 0)) throw Object.assign(new Error('Invoice amount must be greater than zero.'), { status: 400 });
    const entry: LedgerEntry = { id: nextId('inv'), unitId, kind: 'invoice', amount: round2(amount), note, at: this.now() };
    this.ledger.push(entry);
    return entry;
  }
  /** A payment can never exceed the outstanding balance — no negative balance, ever. */
  pay(unitId: string, amount: number, note = 'Payment'): LedgerEntry {
    this.requireUnit(unitId);
    if (!(amount > 0)) throw Object.assign(new Error('Payment amount must be greater than zero.'), { status: 400 });
    const balance = this.balanceOf(unitId);
    if (round2(amount) > balance) {
      throw Object.assign(new Error('Payment ' + amount + ' exceeds the outstanding balance ' + balance + '.'), { status: 409 });
    }
    const entry: LedgerEntry = { id: nextId('pay'), unitId, kind: 'payment', amount: round2(amount), note, at: this.now() };
    this.ledger.push(entry);
    return entry;
  }
  balanceOf(unitId: string): number {
    let bal = 0;
    for (const e of this.ledger) {
      if (e.unitId !== unitId) continue;
      bal += e.kind === 'invoice' ? e.amount : -e.amount;
    }
    return round2(bal);
  }
  ledgerFor(unitId: string): LedgerEntry[] {
    return this.ledger.filter((e) => e.unitId === unitId).sort((a, b) => a.at - b.at);
  }
  /** Units with a positive outstanding balance — the defaulters list a society chases every month. */
  defaulters(): Array<{ unit: Unit; balance: number }> {
    return this.listUnits()
      .map((unit) => ({ unit, balance: this.balanceOf(unit.id) }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }

  // ── Visitor log (append-only) ──
  checkInVisitor(unitId: string, name: string, purpose = 'Visit'): Visitor {
    this.requireUnit(unitId);
    if (!name) throw Object.assign(new Error('A visitor needs a name.'), { status: 400 });
    const v: Visitor = { id: nextId('vis'), unitId, name, purpose, inAt: this.now() };
    this.visitors.set(v.id, v);
    return v;
  }
  checkOutVisitor(visitorId: string): Visitor {
    const v = this.visitors.get(visitorId);
    if (!v) throw Object.assign(new Error('No such visitor: ' + visitorId), { status: 404 });
    if (v.outAt) return v; // already checked out — idempotent
    v.outAt = this.now();
    return v;
  }
  visitorsFor(unitId: string): Visitor[] {
    return Array.from(this.visitors.values()).filter((v) => v.unitId === unitId).sort((a, b) => a.inAt - b.inAt);
  }
  currentlyInside(): Visitor[] {
    return Array.from(this.visitors.values()).filter((v) => !v.outAt).sort((a, b) => a.inAt - b.inAt);
  }

  // ── Complaints (state-machine) ──
  raiseComplaint(unitId: string, title: string): Complaint {
    this.requireUnit(unitId);
    if (!title) throw Object.assign(new Error('A complaint needs a title.'), { status: 400 });
    const at = this.now();
    const c: Complaint = { id: nextId('cmp'), unitId, title, status: 'open', createdAt: at, history: [{ status: 'open', at }] };
    this.complaints.set(c.id, c);
    return c;
  }
  setComplaintStatus(id: string, to: ComplaintStatus): Complaint {
    const c = this.complaints.get(id);
    if (!c) throw Object.assign(new Error('No such complaint: ' + id), { status: 404 });
    if (c.status === to) return c;
    if (!canTransitionComplaint(c.status, to)) {
      throw Object.assign(new Error('Cannot move a complaint from ' + c.status + ' to ' + to + '.'), { status: 409 });
    }
    c.status = to;
    c.history.push({ status: to, at: this.now() });
    return c;
  }
  listComplaints(filter?: { unitId?: string; status?: ComplaintStatus }): Complaint[] {
    let out = Array.from(this.complaints.values());
    if (filter?.unitId) out = out.filter((c) => c.unitId === filter.unitId);
    if (filter?.status) out = out.filter((c) => c.status === filter.status);
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  // ── Notice board (append-only) ──
  postNotice(title: string, body: string): Notice {
    if (!title) throw Object.assign(new Error('A notice needs a title.'), { status: 400 });
    const n: Notice = { id: nextId('note'), title, body: body || '', at: this.now() };
    this.notices.push(n);
    return n;
  }
  listNotices(): Notice[] { return this.notices.slice().sort((a, b) => b.at - a.at); }
}
`;

export const SOCIETY_ROUTES_SOURCE = `// Express router for the housing-society backend. Mount with: app.use('/api/society', societyRouter(service)).
import { Router, type Request, type Response } from 'express';
import { SocietyService, type ComplaintStatus } from './societyService';

export function societyRouter(society: SocietyService = new SocietyService()): Router {
  const router = Router();
  const fail = (res: Response, err: any) => res.status(err?.status || 500).json({ error: err?.message || 'Error' });

  router.post('/units', (req: Request, res: Response) => {
    try { res.status(201).json(society.addUnit(req.body?.label, req.body?.ownerName, req.body?.residentName)); }
    catch (err) { fail(res, err); }
  });
  router.get('/units', (_req: Request, res: Response) => res.json(society.listUnits()));

  router.post('/units/:id/invoice', (req: Request, res: Response) => {
    try { res.status(201).json(society.invoice(req.params.id, Number(req.body?.amount), req.body?.note)); }
    catch (err) { fail(res, err); }
  });
  // A payment over the outstanding balance is rejected with 409 — the balance can never go negative.
  router.post('/units/:id/pay', (req: Request, res: Response) => {
    try { res.status(201).json(society.pay(req.params.id, Number(req.body?.amount), req.body?.note)); }
    catch (err) { fail(res, err); }
  });
  router.get('/units/:id/ledger', (req: Request, res: Response) => {
    try { res.json({ balance: society.balanceOf(req.params.id), entries: society.ledgerFor(req.params.id) }); }
    catch (err) { fail(res, err); }
  });
  router.get('/defaulters', (_req: Request, res: Response) => res.json(society.defaulters()));

  router.post('/units/:id/visitors', (req: Request, res: Response) => {
    try { res.status(201).json(society.checkInVisitor(req.params.id, req.body?.name, req.body?.purpose)); }
    catch (err) { fail(res, err); }
  });
  router.patch('/visitors/:id/checkout', (req: Request, res: Response) => {
    try { res.json(society.checkOutVisitor(req.params.id)); }
    catch (err) { fail(res, err); }
  });
  router.get('/units/:id/visitors', (req: Request, res: Response) => res.json(society.visitorsFor(req.params.id)));
  router.get('/visitors/inside', (_req: Request, res: Response) => res.json(society.currentlyInside()));

  router.post('/complaints', (req: Request, res: Response) => {
    try { res.status(201).json(society.raiseComplaint(req.body?.unitId, req.body?.title)); }
    catch (err) { fail(res, err); }
  });
  router.patch('/complaints/:id/status', (req: Request, res: Response) => {
    try { res.json(society.setComplaintStatus(req.params.id, req.body?.status as ComplaintStatus)); }
    catch (err) { fail(res, err); }
  });
  router.get('/complaints', (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? (req.query.status as ComplaintStatus) : undefined;
    const unitId = typeof req.query.unitId === 'string' ? req.query.unitId : undefined;
    res.json(society.listComplaints({ status, unitId }));
  });

  router.post('/notices', (req: Request, res: Response) => {
    try { res.status(201).json(society.postNotice(req.body?.title, req.body?.body)); }
    catch (err) { fail(res, err); }
  });
  router.get('/notices', (_req: Request, res: Response) => res.json(society.listNotices()));

  return router;
}
`;

export const SOCIETY_README = `# Housing-society / RWA backend (server/society/)

A dependency-free backend for an apartment complex or residents' welfare association.

## Real guarantees
- **Maintenance-dues ledger** — a unit's balance is exactly invoiced minus paid; a payment can never
  exceed the outstanding balance (rejected with 409); the ledger is append-only.
- **Complaint state-machine** — open -> in_progress -> resolved -> closed (with reopen); an invalid jump is 409.
- **Append-only visitor log and notice board.**

## Wire it up

    import { societyRouter } from './server/society/routes';
    app.use('/api/society', societyRouter());

## Endpoints
- POST /units, GET /units
- POST /units/:id/invoice, POST /units/:id/pay (409 on overpay), GET /units/:id/ledger, GET /defaulters
- POST /units/:id/visitors (check-in), PATCH /visitors/:id/checkout, GET /units/:id/visitors, GET /visitors/inside
- POST /complaints, PATCH /complaints/:id/status (409 on invalid), GET /complaints?status=&unitId=
- POST /notices, GET /notices

In-memory by default — swap the Maps for your database, keeping the same method contracts.
`;

const INSTRUCTIONS = [
  'Wired a housing-society / RWA management backend under server/society/. It gives you an exact',
  'maintenance-dues ledger (a payment can never overshoot the balance), a complaint state-machine, and an',
  'append-only visitor log + notice board. Mount the router (see server/society/README.md) and swap the',
  'in-memory store for your database when ready. No API key.',
].join(' ');

export interface SocietyConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** Emit a real, dependency-free housing-society backend for the user's app. Pure. */
export function generateSocietyIntegration(): SocietyConfig {
  return {
    files: {
      'server/society/societyService.ts': SOCIETY_SERVICE_SOURCE,
      'server/society/routes.ts': SOCIETY_ROUTES_SOURCE,
      'server/society/README.md': SOCIETY_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
