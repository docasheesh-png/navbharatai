// Roadmap breadth — support-ticket / helpdesk starter (a packaged domain vertical).
//
// Universal for any SaaS or service business. The real feature is a correct STATUS STATE-MACHINE: a ticket
// moves open → in_progress → resolved → closed along ALLOWED transitions only (you can't jump a closed ticket
// straight back to "resolved" — it must be reopened). This emits a dependency-free TicketService (in-memory,
// swap the store for your DB) + an Express router + a README. Real logic, not a stub — the state-machine is
// unit-tested against the emitted code. Pure builder → the caller writes the files.

export const TICKET_SERVICE_SOURCE = `// Support-ticket domain logic. The core guarantee: status changes follow an allowed state-machine —
// invalid jumps (e.g. closed -> resolved without reopening) are rejected. In-memory here; swap the Map for
// your database, keeping the same method contracts.

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface TicketComment {
  author: string;
  body: string;
  at: string;
}

export interface Ticket {
  id: string;
  subject: string;
  requester: string;
  assignee: string | null;
  status: TicketStatus;
  comments: TicketComment[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketFilter {
  status?: TicketStatus;
  assignee?: string;
  requester?: string;
}

// Allowed status transitions. A ticket can always be reopened; a closed ticket can ONLY be reopened.
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

export class TicketService {
  private tickets = new Map<string, Ticket>();
  private seq = 0;

  create(subject: string, requester: string, now: Date = new Date()): Ticket {
    const s = String(subject).trim();
    const r = String(requester).trim();
    if (!s) throw new Error('subject is required');
    if (!r) throw new Error('requester is required');
    const iso = now.toISOString();
    const ticket: Ticket = {
      id: String(++this.seq),
      subject: s,
      requester: r,
      assignee: null,
      status: 'open',
      comments: [],
      createdAt: iso,
      updatedAt: iso,
    };
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  get(id: string): Ticket | undefined {
    return this.tickets.get(id);
  }

  private require(id: string): Ticket {
    const t = this.tickets.get(id);
    if (!t) throw new Error('ticket not found');
    return t;
  }

  /** Move a ticket to a new status, enforcing the allowed state-machine. */
  transition(id: string, to: TicketStatus, now: Date = new Date()): Ticket {
    const t = this.require(id);
    if (t.status === to) return t;
    if (!TRANSITIONS[t.status].includes(to)) {
      throw new Error('invalid transition: ' + t.status + ' -> ' + to);
    }
    t.status = to;
    t.updatedAt = now.toISOString();
    return t;
  }

  /** Assign (or unassign with null) a ticket to an agent. */
  assign(id: string, assignee: string | null, now: Date = new Date()): Ticket {
    const t = this.require(id);
    t.assignee = assignee ? String(assignee).trim() : null;
    t.updatedAt = now.toISOString();
    return t;
  }

  /** Add a comment. Does not change status. */
  comment(id: string, author: string, body: string, now: Date = new Date()): Ticket {
    const t = this.require(id);
    const a = String(author).trim();
    const b = String(body).trim();
    if (!a) throw new Error('author is required');
    if (!b) throw new Error('body is required');
    t.comments.push({ author: a, body: b, at: now.toISOString() });
    t.updatedAt = now.toISOString();
    return t;
  }

  list(filter: TicketFilter = {}): Ticket[] {
    let out = [...this.tickets.values()];
    if (filter.status) out = out.filter((t) => t.status === filter.status);
    if (filter.assignee) out = out.filter((t) => t.assignee === String(filter.assignee).trim());
    if (filter.requester) out = out.filter((t) => t.requester === String(filter.requester).trim());
    return out;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const tickets = new TicketService();
`;

export const TICKET_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { tickets } from './ticketService';

// REST endpoints for the support-ticket service. Mount with: app.use('/api', ticketRouter).
export const ticketRouter = Router();

// Create a ticket (opens in status 'open').
ticketRouter.post('/tickets', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { subject?: unknown; requester?: unknown };
  try {
    const ticket = tickets.create(String(body.subject ?? ''), String(body.requester ?? ''));
    return res.status(201).json(ticket);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// List tickets (optional ?status= / ?assignee= / ?requester= filters).
ticketRouter.get('/tickets', (req: Request, res: Response) => {
  const q = req.query as { status?: string; assignee?: string; requester?: string };
  const status = ['open', 'in_progress', 'resolved', 'closed'].includes(String(q.status)) ? (q.status as 'open') : undefined;
  return res.status(200).json(tickets.list({ status, assignee: q.assignee, requester: q.requester }));
});

// Get one ticket.
ticketRouter.get('/tickets/:id', (req: Request, res: Response) => {
  const t = tickets.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'ticket not found' });
  return res.status(200).json(t);
});

// Change status. { status } — 409 on an invalid state transition, 404 if unknown.
ticketRouter.patch('/tickets/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    const t = tickets.transition(req.params.id, String(body.status ?? '') as 'open');
    return res.status(200).json(t);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    if (message === 'ticket not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});

// Assign / unassign. { assignee } (null to unassign).
ticketRouter.patch('/tickets/:id/assign', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { assignee?: unknown };
  try {
    const t = tickets.assign(req.params.id, body.assignee == null ? null : String(body.assignee));
    return res.status(200).json(t);
  } catch {
    return res.status(404).json({ error: 'ticket not found' });
  }
});

// Add a comment. { author, body }
ticketRouter.post('/tickets/:id/comments', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { author?: unknown; body?: unknown };
  try {
    const t = tickets.comment(req.params.id, String(body.author ?? ''), String(body.body ?? ''));
    return res.status(201).json(t);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'ticket not found') return res.status(404).json({ error: message });
    return res.status(400).json({ error: message });
  }
});
`;

const TICKET_README = `# Support tickets / helpdesk

A real support-ticket backend. The core guarantee: status changes follow an allowed **state-machine** —
\`open → in_progress → resolved → closed\`, and a closed ticket can only be **reopened** (not jumped straight
back to another status). Files:

- \`ticketService.ts\` — the domain logic (\`TicketService\` + a \`tickets\` singleton). In-memory; swap the Map for
  your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { ticketRouter } from './server/tickets/routes';
app.use('/api', ticketRouter);
\`\`\`

Endpoints:
- \`POST  /api/tickets\` \`{ subject, requester }\` → 201 (opens in 'open').
- \`GET   /api/tickets\` (\`?status=&assignee=&requester=\`) → the list.
- \`GET   /api/tickets/:id\` → one ticket.
- \`PATCH /api/tickets/:id/status\` \`{ status }\` → **409** on an invalid transition.
- \`PATCH /api/tickets/:id/assign\` \`{ assignee }\` (null to unassign).
- \`POST  /api/tickets/:id/comments\` \`{ author, body }\`.

Pairs with the auth, notification and audit-log recipes (notify on assignment, audit status changes).
`;

export interface SupportTicketConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Support-ticket/helpdesk starter wired under server/tickets/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is a status state-machine: ticketService.ts transition() only allows ' +
  'open→in_progress→resolved→closed moves (a closed ticket can only be reopened) and rejects invalid jumps. ' +
  'It also supports assign, comment and filtered list. routes.ts exposes POST /tickets, GET /tickets(/:id), ' +
  'PATCH /tickets/:id/status (409 on invalid transition), PATCH /tickets/:id/assign and POST ' +
  '/tickets/:id/comments. Mount with app.use("/api", ticketRouter). In-memory by default — swap the Map for ' +
  'your DB, same contracts. Pairs with the auth/notification/audit recipes. No API key.';

export function generateSupportTicketIntegration(): SupportTicketConfig {
  return {
    files: {
      'server/tickets/ticketService.ts': TICKET_SERVICE_SOURCE,
      'server/tickets/routes.ts': TICKET_ROUTES_SOURCE,
      'server/tickets/README.md': TICKET_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
