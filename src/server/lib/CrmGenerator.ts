// Roadmap breadth — CRM / lead-pipeline starter (a packaged domain vertical).
//
// A high-demand vertical for any SMB with a sales motion. The real feature is a correct LEAD-STAGE
// STATE-MACHINE: a lead moves new → contacted → qualified → won/lost along ALLOWED transitions only (you
// can't jump a new lead straight to "won" — it must be qualified first; won/lost are terminal except a
// reopen back to "new"). This emits a dependency-free CrmService (contacts + leads + notes + stage moves)
// + an Express router + a README. Real logic, not a stub — the state-machine is unit-tested against the
// emitted code. Pure builder → the caller writes the files.

export const CRM_SERVICE_SOURCE = `// CRM domain logic. The core guarantee: a lead's stage changes follow an allowed sales pipeline —
// invalid jumps (e.g. new -> won without qualifying) are rejected. In-memory here; swap the Maps for your
// database, keeping the same method contracts.

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';

export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  createdAt: string;
}

export interface LeadNote {
  author: string;
  body: string;
  at: string;
}

export interface Lead {
  id: string;
  contactId: string;
  title: string;
  value: number;
  stage: LeadStage;
  owner: string | null;
  notes: LeadNote[];
  createdAt: string;
  updatedAt: string;
}

export interface LeadFilter {
  stage?: LeadStage;
  owner?: string;
  contactId?: string;
}

// Allowed sales-pipeline transitions. Forward through the funnel, back a step, or lose at any point; won/lost
// are terminal except a reopen to 'new'.
const STAGE_FLOW: Record<LeadStage, LeadStage[]> = {
  new: ['contacted', 'qualified', 'lost'],
  contacted: ['qualified', 'lost', 'new'],
  qualified: ['won', 'lost', 'contacted'],
  won: ['new'],
  lost: ['new'],
};

export class CrmService {
  private contacts = new Map<string, Contact>();
  private leads = new Map<string, Lead>();
  private seqC = 0;
  private seqL = 0;

  addContact(input: { name: string; email?: string; company?: string }, now: Date = new Date()): Contact {
    const name = String(input?.name ?? '').trim();
    if (!name) throw new Error('name is required');
    const contact: Contact = {
      id: String(++this.seqC),
      name,
      email: String(input.email ?? '').trim(),
      company: String(input.company ?? '').trim(),
      createdAt: now.toISOString(),
    };
    this.contacts.set(contact.id, contact);
    return contact;
  }

  addLead(input: { contactId: string; title: string; value?: number }, now: Date = new Date()): Lead {
    const contactId = String(input?.contactId ?? '').trim();
    const title = String(input?.title ?? '').trim();
    if (!this.contacts.has(contactId)) throw new Error('unknown contact');
    if (!title) throw new Error('title is required');
    const value = Number.isFinite(Number(input.value)) ? Math.max(0, Number(input.value)) : 0;
    const iso = now.toISOString();
    const lead: Lead = {
      id: String(++this.seqL),
      contactId,
      title,
      value,
      stage: 'new',
      owner: null,
      notes: [],
      createdAt: iso,
      updatedAt: iso,
    };
    this.leads.set(lead.id, lead);
    return lead;
  }

  getLead(id: string): Lead | undefined {
    return this.leads.get(id);
  }

  private requireLead(id: string): Lead {
    const l = this.leads.get(id);
    if (!l) throw new Error('lead not found');
    return l;
  }

  /** Move a lead to a new stage, enforcing the allowed pipeline. */
  moveStage(id: string, to: LeadStage, now: Date = new Date()): Lead {
    const l = this.requireLead(id);
    if (l.stage === to) return l;
    if (!STAGE_FLOW[l.stage].includes(to)) {
      throw new Error('invalid stage transition: ' + l.stage + ' -> ' + to);
    }
    l.stage = to;
    l.updatedAt = now.toISOString();
    return l;
  }

  assign(id: string, owner: string | null, now: Date = new Date()): Lead {
    const l = this.requireLead(id);
    l.owner = owner ? String(owner).trim() : null;
    l.updatedAt = now.toISOString();
    return l;
  }

  addNote(id: string, author: string, body: string, now: Date = new Date()): Lead {
    const l = this.requireLead(id);
    const a = String(author).trim();
    const b = String(body).trim();
    if (!a) throw new Error('author is required');
    if (!b) throw new Error('body is required');
    l.notes.push({ author: a, body: b, at: now.toISOString() });
    l.updatedAt = now.toISOString();
    return l;
  }

  listContacts(): Contact[] {
    return [...this.contacts.values()];
  }

  listLeads(filter: LeadFilter = {}): Lead[] {
    let out = [...this.leads.values()];
    if (filter.stage) out = out.filter((l) => l.stage === filter.stage);
    if (filter.owner) out = out.filter((l) => l.owner === String(filter.owner).trim());
    if (filter.contactId) out = out.filter((l) => l.contactId === String(filter.contactId).trim());
    return out;
  }

  /** Total pipeline value of the OPEN leads (not won/lost) — a real sales metric. */
  openPipelineValue(): number {
    return [...this.leads.values()]
      .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
      .reduce((sum, l) => sum + l.value, 0);
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const crm = new CrmService();
`;

export const CRM_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { crm } from './crmService';

// REST endpoints for the CRM service. Mount with: app.use('/api', crmRouter).
export const crmRouter = Router();

crmRouter.get('/contacts', (_req: Request, res: Response) => res.status(200).json(crm.listContacts()));

crmRouter.post('/contacts', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: unknown; email?: unknown; company?: unknown };
  try {
    return res.status(201).json(crm.addContact({ name: String(body.name ?? ''), email: String(body.email ?? ''), company: String(body.company ?? '') }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

crmRouter.get('/leads', (req: Request, res: Response) => {
  const q = req.query as { stage?: string; owner?: string; contactId?: string };
  const stage = ['new', 'contacted', 'qualified', 'won', 'lost'].includes(String(q.stage)) ? (q.stage as 'new') : undefined;
  return res.status(200).json(crm.listLeads({ stage, owner: q.owner, contactId: q.contactId }));
});

crmRouter.post('/leads', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { contactId?: unknown; title?: unknown; value?: unknown };
  try {
    const lead = crm.addLead({ contactId: String(body.contactId ?? ''), title: String(body.title ?? ''), value: Number(body.value) });
    return res.status(201).json(lead);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'unknown contact' ? 404 : 400).json({ error: message });
  }
});

// Move a lead's stage. { stage } — 409 on an invalid pipeline transition, 404 if unknown.
crmRouter.patch('/leads/:id/stage', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { stage?: unknown };
  try {
    return res.status(200).json(crm.moveStage(req.params.id, String(body.stage ?? '') as 'new'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    if (message === 'lead not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});

crmRouter.patch('/leads/:id/assign', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { owner?: unknown };
  try {
    return res.status(200).json(crm.assign(req.params.id, body.owner == null ? null : String(body.owner)));
  } catch {
    return res.status(404).json({ error: 'lead not found' });
  }
});

crmRouter.post('/leads/:id/notes', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { author?: unknown; body?: unknown };
  try {
    return res.status(201).json(crm.addNote(req.params.id, String(body.author ?? ''), String(body.body ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'lead not found') return res.status(404).json({ error: message });
    return res.status(400).json({ error: message });
  }
});

// Open-pipeline value — a real sales metric for a dashboard.
crmRouter.get('/pipeline/value', (_req: Request, res: Response) => res.status(200).json({ openPipelineValue: crm.openPipelineValue() }));
`;

const CRM_README = `# CRM / lead pipeline

A real CRM backend. The core guarantee: a lead's stage follows an allowed sales **pipeline state-machine** —
\`new → contacted → qualified → won/lost\`, and won/lost are terminal except a reopen to \`new\`. Files:

- \`crmService.ts\` — the domain logic (\`CrmService\` + a \`crm\` singleton). In-memory; swap the Maps for your
  database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { crmRouter } from './server/crm/routes';
app.use('/api', crmRouter);
\`\`\`

Endpoints:
- \`GET/POST /api/contacts\`.
- \`GET/POST /api/leads\` (\`?stage=&owner=&contactId=\`) — a lead needs a known \`contactId\`.
- \`PATCH /api/leads/:id/stage\` \`{ stage }\` → **409** on an invalid pipeline transition.
- \`PATCH /api/leads/:id/assign\` \`{ owner }\` (null to unassign).
- \`POST /api/leads/:id/notes\` \`{ author, body }\`.
- \`GET /api/pipeline/value\` → total value of the OPEN leads (a real sales metric).

Pairs with the auth, notification and audit-log recipes.
`;

export interface CrmConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'CRM / lead-pipeline starter wired under server/crm/ (dependency-free domain logic + an Express router). ' +
  'The real guarantee is a sales-stage state-machine: crmService.ts moveStage() only allows ' +
  'new→contacted→qualified→won/lost moves (won/lost terminal except a reopen to new) and rejects invalid ' +
  'jumps. It also supports contacts, lead assignment, notes, filtered lists and openPipelineValue(). ' +
  'routes.ts exposes GET/POST /contacts + /leads, PATCH /leads/:id/stage (409 on invalid transition), PATCH ' +
  '/leads/:id/assign, POST /leads/:id/notes and GET /pipeline/value. Mount with app.use("/api", crmRouter). ' +
  'In-memory by default — swap the Maps for your DB, same contracts. Pairs with the auth/notification/audit ' +
  'recipes. No API key.';

export function generateCrmIntegration(): CrmConfig {
  return {
    files: {
      'server/crm/crmService.ts': CRM_SERVICE_SOURCE,
      'server/crm/routes.ts': CRM_ROUTES_SOURCE,
      'server/crm/README.md': CRM_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
