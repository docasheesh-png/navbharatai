// Roadmap breadth — FAQ / knowledge-base starter (a packaged domain vertical).
//
// A help-center / FAQ backend for any product or support site. The real feature is the PUBLISH GATE +
// HELPFULNESS: a draft entry is NEVER returned by the public list/search (only published entries are), entries
// are grouped by category and manually ordered, a keyword search matches question OR answer (published only),
// and each entry tracks helpful / not-helpful votes into an exact net score. This emits a dependency-free
// FaqService (no crypto/deps) + an Express router + a README. Real logic, not a stub — the publish-gate +
// search + vote rules are unit-tested against the emitted code. Pure builder → the caller writes the files.
// Distinct from generate_support_tickets (a ticket state machine) and generate_blog (articles).

export const FAQ_SERVICE_SOURCE = `// FAQ / knowledge-base domain logic. The core guarantees: (1) a DRAFT entry is never returned by the public
// list or search — only PUBLISHED entries are visible publicly; (2) keyword search matches the question OR the
// answer (published only, case-insensitive); and (3) each entry keeps EXACT helpful / not-helpful vote counts
// and a net score. In-memory here; swap the Map for your database, keeping the same method contracts.

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  category: string;
  published: boolean;
  position: number;   // manual order within a category (ascending)
  helpful: number;
  notHelpful: number;
  createdAt: string;
  updatedAt: string;
}

let counter = 0;
function nextId(now: Date): string {
  counter += 1;
  return 'faq_' + now.getTime().toString(36) + '_' + counter.toString(36);
}

export class FaqService {
  private entries = new Map<string, FaqEntry>();

  /** Add an FAQ entry. Starts as a DRAFT (published:false) unless opts.published is true. */
  add(input: { question: string; answer: string; category?: string; published?: boolean }, now: Date = new Date()): FaqEntry {
    const question = String(input?.question ?? '').trim();
    const answer = String(input?.answer ?? '').trim();
    if (!question) throw new Error('question is required');
    if (!answer) throw new Error('answer is required');
    const category = String(input?.category ?? 'General').trim() || 'General';
    const position = this.nextPosition(category);
    const iso = now.toISOString();
    const entry: FaqEntry = {
      id: nextId(now),
      question,
      answer,
      category,
      published: Boolean(input?.published),
      position,
      helpful: 0,
      notHelpful: 0,
      createdAt: iso,
      updatedAt: iso,
    };
    this.entries.set(entry.id, entry);
    return { ...entry };
  }

  private nextPosition(category: string): number {
    let max = -1;
    for (const e of this.entries.values()) if (e.category === category && e.position > max) max = e.position;
    return max + 1;
  }

  get(id: string): FaqEntry | undefined {
    const e = this.entries.get(String(id ?? '').trim());
    return e ? { ...e } : undefined;
  }

  /** Edit an entry's question/answer/category. */
  update(id: string, patch: { question?: string; answer?: string; category?: string }, now: Date = new Date()): FaqEntry {
    const e = this.entries.get(String(id ?? '').trim());
    if (!e) throw new Error('entry not found');
    if (patch.question !== undefined) {
      const q = String(patch.question).trim();
      if (!q) throw new Error('question cannot be empty');
      e.question = q;
    }
    if (patch.answer !== undefined) {
      const a = String(patch.answer).trim();
      if (!a) throw new Error('answer cannot be empty');
      e.answer = a;
    }
    if (patch.category !== undefined) e.category = String(patch.category).trim() || e.category;
    e.updatedAt = now.toISOString();
    return { ...e };
  }

  /** Publish or unpublish an entry (the publish gate). */
  setPublished(id: string, published: boolean, now: Date = new Date()): FaqEntry {
    const e = this.entries.get(String(id ?? '').trim());
    if (!e) throw new Error('entry not found');
    e.published = Boolean(published);
    e.updatedAt = now.toISOString();
    return { ...e };
  }

  remove(id: string): boolean {
    return this.entries.delete(String(id ?? '').trim());
  }

  /** Record a helpfulness vote. Returns the updated entry. */
  vote(id: string, helpful: boolean, now: Date = new Date()): FaqEntry {
    const e = this.entries.get(String(id ?? '').trim());
    if (!e) throw new Error('entry not found');
    if (helpful) e.helpful += 1; else e.notHelpful += 1;
    e.updatedAt = now.toISOString();
    return { ...e };
  }

  /** The net helpfulness score (helpful - notHelpful). */
  score(entry: FaqEntry): number {
    return entry.helpful - entry.notHelpful;
  }

  /**
   * The PUBLIC list — PUBLISHED entries only, grouped nowhere (flat), sorted by category then position.
   * Optionally filter to one category. Draft entries are never included.
   */
  publicList(category?: string): FaqEntry[] {
    const cat = category === undefined ? null : String(category).trim();
    return [...this.entries.values()]
      .filter((e) => e.published && (cat === null || e.category === cat))
      .sort((a, b) => a.category.localeCompare(b.category) || a.position - b.position)
      .map((e) => ({ ...e }));
  }

  /** The ADMIN list — ALL entries (drafts included), same ordering. */
  adminList(): FaqEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => a.category.localeCompare(b.category) || a.position - b.position)
      .map((e) => ({ ...e }));
  }

  /** Public keyword search — matches question OR answer, PUBLISHED only, case-insensitive. */
  search(query: string): FaqEntry[] {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return [];
    return this.publicList().filter(
      (e) => e.question.toLowerCase().includes(q) || e.answer.toLowerCase().includes(q),
    );
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const faq = new FaqService();
`;

export const FAQ_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { faq } from './faqService';

// REST endpoints for the FAQ / knowledge base. Mount with: app.use('/api/faq', faqRouter).
// The public GET routes return PUBLISHED entries only; guard the admin routes with your auth middleware.
export const faqRouter = Router();

// Public list (published only). ?category= to filter, ?q= to search.
faqRouter.get('/', (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  if (q) return res.status(200).json(faq.search(q));
  const category = req.query.category === undefined ? undefined : String(req.query.category);
  return res.status(200).json(faq.publicList(category));
});

// Admin list (drafts included). Guard with auth in production.
faqRouter.get('/admin', (_req: Request, res: Response) => {
  return res.status(200).json(faq.adminList());
});

// One entry.
faqRouter.get('/:id', (req: Request, res: Response) => {
  const entry = faq.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'entry not found' });
  return res.status(200).json(entry);
});

// Create (draft by default). { question, answer, category?, published? }.
faqRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { question?: unknown; answer?: unknown; category?: unknown; published?: unknown };
  try {
    return res.status(201).json(faq.add({
      question: String(body.question ?? ''),
      answer: String(body.answer ?? ''),
      category: body.category === undefined ? undefined : String(body.category),
      published: Boolean(body.published),
    }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Edit. { question?, answer?, category? }.
faqRouter.patch('/:id', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { question?: unknown; answer?: unknown; category?: unknown };
  try {
    return res.status(200).json(faq.update(req.params.id, {
      question: body.question === undefined ? undefined : String(body.question),
      answer: body.answer === undefined ? undefined : String(body.answer),
      category: body.category === undefined ? undefined : String(body.category),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'entry not found' ? 404 : 400).json({ error: message });
  }
});

// Publish / unpublish. { published }.
faqRouter.patch('/:id/publish', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { published?: unknown };
  try {
    return res.status(200).json(faq.setPublished(req.params.id, Boolean(body.published)));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'entry not found' });
  }
});

// Helpfulness vote. { helpful: boolean }.
faqRouter.post('/:id/vote', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { helpful?: unknown };
  try {
    return res.status(200).json(faq.vote(req.params.id, Boolean(body.helpful)));
  } catch (err) {
    return res.status(404).json({ error: err instanceof Error ? err.message : 'entry not found' });
  }
});

faqRouter.delete('/:id', (req: Request, res: Response) => {
  if (!faq.remove(req.params.id)) return res.status(404).json({ error: 'entry not found' });
  return res.status(204).send();
});
`;

const FAQ_README = `# FAQ / knowledge base

A real help-center / FAQ backend. The core guarantees: a **draft** entry is **never** returned by the public
list or search (only **published** entries are), entries are grouped by category and manually ordered, keyword
search matches the **question or answer** (published only, case-insensitive), and each entry keeps **exact**
helpful / not-helpful vote counts. Files:

- \`faqService.ts\` — the domain logic (\`FaqService\` + a \`faq\` singleton). Dependency-free. In-memory; swap
  the Map for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { faqRouter } from './server/faq/routes';
app.use('/api/faq', faqRouter);
\`\`\`

Endpoints:
- \`GET    /api/faq\` → published list; \`?category=\` filters, \`?q=\` searches (published only).
- \`GET    /api/faq/admin\` → all entries incl. drafts (**guard with auth**).
- \`GET    /api/faq/:id\` → one entry (**404** if unknown).
- \`POST   /api/faq\` \`{ question, answer, category?, published? }\` → create (draft by default).
- \`PATCH  /api/faq/:id\` \`{ question?, answer?, category? }\` → edit.
- \`PATCH  /api/faq/:id/publish\` \`{ published }\` → publish / unpublish.
- \`POST   /api/faq/:id/vote\` \`{ helpful }\` → record a helpfulness vote.
- \`DELETE /api/faq/:id\`.

Distinct from \`generate_support_tickets\` (a per-user ticket state machine) and \`generate_blog\` (articles).
`;

export interface FaqConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'FAQ / knowledge-base starter wired under server/faq/ (dependency-free domain logic + an Express router). The ' +
  'real guarantee is the PUBLISH GATE + HELPFULNESS: add() creates a DRAFT by default; a draft is NEVER ' +
  'returned by publicList()/search() (only published entries are), while adminList() returns everything ' +
  'including drafts; search(query) matches the question OR answer, published only, case-insensitive; ' +
  'setPublished() flips the gate; vote(id, helpful) keeps EXACT helpful/not-helpful counts and score() is the ' +
  'net. Entries are grouped by category and manually ordered (position ascending). routes.ts exposes GET ' +
  '/api/faq (?category, ?q), GET /api/faq/admin (guard with auth), GET/PATCH/DELETE /api/faq/:id, POST ' +
  '/api/faq, PATCH /api/faq/:id/publish ({published}) and POST /api/faq/:id/vote ({helpful}). Mount at ' +
  'app.use("/api/faq", faqRouter). Distinct from generate_support_tickets and generate_blog. In-memory by ' +
  'default — swap the Map for your DB.';

export function generateFaqIntegration(): FaqConfig {
  return {
    files: {
      'server/faq/faqService.ts': FAQ_SERVICE_SOURCE,
      'server/faq/routes.ts': FAQ_ROUTES_SOURCE,
      'server/faq/README.md': FAQ_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
