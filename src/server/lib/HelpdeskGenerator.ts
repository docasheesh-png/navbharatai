// Helpdesk / ticketing domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the established recipe pattern. Distinct real guarantees (a SUPPORT workflow, not a hiring/sales
// pipeline): the value here is a status state-machine + PRIORITY-DRIVEN SLA:
//   1. TICKET STATE-MACHINE: open → in_progress → resolved → closed along allowed transitions only, with a
//      reopen (resolved/closed → open). An invalid jump is rejected (409).
//   2. PRIORITY-DRIVEN SLA + BREACH DETECTION: each priority has an SLA target (hours); a still-unresolved
//      ticket past its due time is SLA-breached — computed exactly from the dates, so the breach flag is
//      always honest.
//   3. APPEND-ONLY COMMENT/EVENT THREAD: every status change and comment is an immutable, ordered entry.
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const HELPDESK_SERVICE_SOURCE = `// Helpdesk / ticketing domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) A ticket's status follows an allowed STATE-MACHINE (open → in_progress → resolved → closed, + reopen).
//  2) SLA is priority-driven and BREACH is derived from the due time (never set by hand).
//  3) The comment/event thread is append-only and ordered.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.
// Date-sensitive reads take an explicit 'now' for deterministic, testable behaviour (default Date.now()).

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'open', 'closed'],
  resolved: ['closed', 'open'],   // reopen from resolved
  closed: ['open'],               // reopen from closed
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** SLA target in HOURS per priority (tune to your support policy). */
export const SLA_HOURS: Record<Priority, number> = { urgent: 4, high: 12, medium: 24, low: 72 };

export interface ThreadEntry {
  id: string;
  kind: 'comment' | 'status';
  by: string;
  text: string;          // comment body, or "open → in_progress" for a status entry
  at: number;
}

export interface Ticket {
  id: string;
  subject: string;
  requester: string;
  priority: Priority;
  status: TicketStatus;
  assigneeId: string | null;
  thread: ThreadEntry[];
  createdAt: number;
  resolvedAt: number | null;
}

export class InvalidTransitionError extends Error {
  constructor(from: TicketStatus, to: TicketStatus) { super(\`Invalid ticket transition \${from} → \${to}\`); this.name = 'InvalidTransitionError'; }
}

const HOUR_MS = 60 * 60 * 1000;
let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;

export class HelpdeskService {
  private tickets = new Map<string, Ticket>();

  createTicket(data: { subject: string; requester: string; priority?: Priority }, now: number = Date.now()): Ticket {
    if (!data.subject?.trim()) throw new Error('Ticket subject is required');
    const priority: Priority = data.priority ?? 'medium';
    const t: Ticket = {
      id: nextId('tkt'), subject: data.subject.trim(), requester: data.requester, priority,
      status: 'open', assigneeId: null, thread: [], createdAt: now, resolvedAt: null,
    };
    this.tickets.set(t.id, t);
    return t;
  }

  setStatus(id: string, to: TicketStatus, by = 'system', now: number = Date.now()): Ticket {
    const t = this.tickets.get(id);
    if (!t) throw new Error(\`Unknown ticket \${id}\`);
    if (!canTransition(t.status, to)) throw new InvalidTransitionError(t.status, to);
    const from = t.status;
    t.status = to;
    if (to === 'resolved') t.resolvedAt = now;
    if (to === 'open') t.resolvedAt = null; // reopened → SLA clock is live again
    t.thread.push({ id: nextId('evt'), kind: 'status', by, text: \`\${from} → \${to}\`, at: now });
    return t;
  }

  assign(id: string, assigneeId: string, now: number = Date.now()): Ticket {
    const t = this.tickets.get(id);
    if (!t) throw new Error(\`Unknown ticket \${id}\`);
    t.assigneeId = assigneeId;
    t.thread.push({ id: nextId('evt'), kind: 'status', by: 'system', text: \`assigned to \${assigneeId}\`, at: now });
    return t;
  }

  addComment(id: string, by: string, text: string, now: number = Date.now()): Ticket {
    const t = this.tickets.get(id);
    if (!t) throw new Error(\`Unknown ticket \${id}\`);
    if (!text?.trim()) throw new Error('Comment text is required');
    t.thread.push({ id: nextId('evt'), kind: 'comment', by, text: text.trim(), at: now });
    return t;
  }

  /** The instant this ticket's SLA is due = createdAt + the priority's SLA hours. */
  slaDueAt(t: Ticket): number {
    return t.createdAt + SLA_HOURS[t.priority] * HOUR_MS;
  }

  /** SLA-breached = still UNRESOLVED (open/in_progress) past the SLA due time. Derived, never stored. */
  isSlaBreached(t: Ticket, now: number = Date.now()): boolean {
    if (t.status === 'resolved' || t.status === 'closed') return false;
    return now > this.slaDueAt(t);
  }

  get(id: string): Ticket | undefined { return this.tickets.get(id); }
  thread(id: string): ThreadEntry[] { return [...(this.tickets.get(id)?.thread ?? [])]; }

  list(filter?: { status?: TicketStatus; priority?: Priority; assigneeId?: string; breached?: boolean }, now: number = Date.now()): Ticket[] {
    return [...this.tickets.values()].filter((t) =>
      (!filter?.status || t.status === filter.status) &&
      (!filter?.priority || t.priority === filter.priority) &&
      (!filter?.assigneeId || t.assigneeId === filter.assigneeId) &&
      (filter?.breached === undefined || this.isSlaBreached(t, now) === filter.breached),
    ).sort((a, b) => a.createdAt - b.createdAt);
  }
}

export const helpdesk = new HelpdeskService();
`;

export const HELPDESK_ROUTES_SOURCE = `import { Router } from 'express';
import { helpdesk, InvalidTransitionError } from './helpdeskService';

export const helpdeskRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    const out = fn();
    if (out === undefined) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(out);
  } catch (e) {
    if (e instanceof InvalidTransitionError) { res.status(409).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

// Attach the derived SLA fields for the client.
function view(id: string) {
  const t = helpdesk.get(id);
  if (!t) return undefined;
  return { ...t, slaDueAt: helpdesk.slaDueAt(t), slaBreached: helpdesk.isSlaBreached(t) };
}

helpdeskRouter.get('/tickets', (req, res) => handle(res, () => helpdesk.list({
  status: req.query.status as never,
  priority: req.query.priority as never,
  assigneeId: req.query.assigneeId as string | undefined,
  breached: req.query.breached === undefined ? undefined : req.query.breached === 'true',
})));
helpdeskRouter.post('/tickets', (req, res) => handle(res, () => helpdesk.createTicket(req.body)));
helpdeskRouter.get('/tickets/:id', (req, res) => handle(res, () => view(req.params.id)));
helpdeskRouter.patch('/tickets/:id/status', (req, res) => handle(res, () => helpdesk.setStatus(req.params.id, req.body?.status, req.body?.by))); // 409 invalid
helpdeskRouter.patch('/tickets/:id/assign', (req, res) => handle(res, () => helpdesk.assign(req.params.id, req.body?.assigneeId)));
helpdeskRouter.post('/tickets/:id/comments', (req, res) => handle(res, () => helpdesk.addComment(req.params.id, req.body?.by ?? 'agent', String(req.body?.text ?? ''))));
helpdeskRouter.get('/tickets/:id/thread', (req, res) => handle(res, () => helpdesk.thread(req.params.id)));
`;

export const HELPDESK_README = `# Helpdesk / ticketing starter

A dependency-free support-desk backend under \`server/helpdesk/\`, wired for Express.

## Real guarantees (not a stub)
- **Ticket state-machine** — status moves \`open → in_progress → resolved → closed\` along allowed
  transitions only, with a **reopen** (resolved/closed → open). An invalid jump is rejected (**409**).
- **Priority-driven SLA + breach detection** — each priority has an SLA target (urgent 4h / high 12h /
  medium 24h / low 72h); a still-unresolved ticket past its due time is **SLA-breached** (computed from
  the dates, never set by hand — reopening restarts the clock).
- **Append-only thread** — every status change and comment is an immutable, ordered thread entry.

## Endpoints (mount with \`app.use("/api", helpdeskRouter)\`)
- \`GET /tickets\` (filter by status/priority/assignee/\`breached=true\`), \`POST /tickets\`, \`GET /tickets/:id\`
  (returns \`slaDueAt\` + \`slaBreached\`)
- \`PATCH /tickets/:id/status\` (**409** on invalid), \`PATCH /tickets/:id/assign\`
- \`POST /tickets/:id/comments\`, \`GET /tickets/:id/thread\`

Tune \`SLA_HOURS\` to your support policy. In-memory by default; swap the Maps in \`helpdeskService.ts\` for
your DB. Pairs with the auth/notification/email recipes.
`;

export interface HelpdeskConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Helpdesk / ticketing starter wired under server/helpdesk/ (dependency-free domain logic + an Express ' +
  'router). Three real guarantees: (1) TICKET STATE-MACHINE — open → in_progress → resolved → closed along ' +
  'allowed transitions only (+ reopen), invalid jumps rejected (409); (2) PRIORITY-DRIVEN SLA + BREACH — each ' +
  'priority has an SLA target (urgent 4h/high 12h/medium 24h/low 72h); a still-unresolved ticket past its due ' +
  'time is SLA-breached, derived from the dates (reopen restarts the clock); (3) APPEND-ONLY thread — every ' +
  'status change + comment is an immutable ordered entry. Endpoints: GET/POST /tickets, GET /tickets/:id ' +
  '(with slaDueAt + slaBreached), PATCH /tickets/:id/status, PATCH /tickets/:id/assign, POST ' +
  '/tickets/:id/comments, GET /tickets/:id/thread. Mount with app.use("/api", helpdeskRouter). In-memory by ' +
  'default — swap the Maps for your DB, same contracts. Pairs with the auth/notification/email recipes. No key.';

export function generateHelpdeskIntegration(): HelpdeskConfig {
  return {
    files: {
      'server/helpdesk/helpdeskService.ts': HELPDESK_SERVICE_SOURCE,
      'server/helpdesk/routes.ts': HELPDESK_ROUTES_SOURCE,
      'server/helpdesk/README.md': HELPDESK_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
