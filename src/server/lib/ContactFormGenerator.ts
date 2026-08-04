// Roadmap breadth — contact form starter (a packaged domain vertical).
//
// The universal "Contact us" / lead-capture form every site needs. The real feature is VALIDATED CAPTURE +
// SPAM REJECTION: a submission requires a name, a syntactically valid email and a non-empty message (bad input
// is rejected, never silently stored), a filled hidden HONEYPOT field marks the submission as spam (bots fill
// it; humans never see it) so it is dropped, and every accepted message moves through a status lifecycle
// (new → read → archived / spam). This emits a dependency-free ContactService (no crypto/deps) + an Express
// router + a README. Real logic, not a stub — the validation + honeypot + status rules are unit-tested against
// the emitted code. Pure builder → the caller writes the files. Distinct from generate_newsletter (email-only
// capture) and generate_feedback (a public voting board).

export const CONTACTFORM_SERVICE_SOURCE = `// Contact-form domain logic. The core guarantees: (1) a submission requires name + a valid email + a non-empty
// message (invalid input throws — never silently stored); (2) a filled honeypot field flags the submission as
// spam and it is NOT counted among real messages; and (3) every accepted message has a status lifecycle
// new → read → archived (and can be marked spam). In-memory here; swap the Map for your database.

export type ContactStatus = 'new' | 'read' | 'archived' | 'spam';

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: ContactStatus;
  createdAt: string;
}

// Deliberately simple, permissive email check — good enough to reject obvious garbage without over-rejecting.
function isEmail(s: string): boolean {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(s).trim());
}

let counter = 0;
function nextId(now: Date): string {
  counter += 1;
  return 'msg_' + now.getTime().toString(36) + '_' + counter.toString(36);
}

const NEXT: Record<ContactStatus, ContactStatus[]> = {
  new: ['read', 'archived', 'spam'],
  read: ['archived', 'spam', 'new'],
  archived: ['read', 'new'],
  spam: ['new'],
};

export class ContactService {
  private messages = new Map<string, ContactMessage>();

  /**
   * Submit the contact form. Validates name/email/message. If the honeypot field is filled (opts.honeypot),
   * the submission is stored as 'spam' and { accepted:false } is returned — the caller should respond 200 to
   * the bot but not notify anyone. A clean submission is stored 'new' with { accepted:true }.
   */
  submit(input: { name: string; email: string; message: string; subject?: string; honeypot?: string }, now: Date = new Date()): { accepted: boolean; message: ContactMessage } {
    const name = String(input?.name ?? '').trim();
    const email = String(input?.email ?? '').trim();
    const message = String(input?.message ?? '').trim();
    if (!name) throw new Error('name is required');
    if (!isEmail(email)) throw new Error('a valid email is required');
    if (!message) throw new Error('message is required');
    const honeypotFilled = String(input?.honeypot ?? '').trim().length > 0;
    const record: ContactMessage = {
      id: nextId(now),
      name,
      email,
      subject: String(input?.subject ?? '').trim(),
      message,
      status: honeypotFilled ? 'spam' : 'new',
      createdAt: now.toISOString(),
    };
    this.messages.set(record.id, record);
    return { accepted: !honeypotFilled, message: { ...record } };
  }

  get(id: string): ContactMessage | undefined {
    const m = this.messages.get(String(id ?? '').trim());
    return m ? { ...m } : undefined;
  }

  /** Advance the status along the allowed lifecycle. Throws on an illegal transition. */
  setStatus(id: string, to: ContactStatus, now: Date = new Date()): ContactMessage {
    const m = this.messages.get(String(id ?? '').trim());
    if (!m) throw new Error('message not found');
    if (m.status === to) return { ...m };
    if (!NEXT[m.status].includes(to)) throw new Error('illegal transition: ' + m.status + ' -> ' + to);
    m.status = to;
    void now;
    return { ...m };
  }

  remove(id: string): boolean {
    return this.messages.delete(String(id ?? '').trim());
  }

  /** List messages, newest first, optionally filtered by status. Excludes spam unless status==='spam'. */
  list(status?: ContactStatus): ContactMessage[] {
    const all = [...this.messages.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (status) return all.filter((m) => m.status === status).map((m) => ({ ...m }));
    return all.filter((m) => m.status !== 'spam').map((m) => ({ ...m })); // real inbox hides spam by default
  }

  /** Count of unread ('new') real messages — drives an inbox badge. */
  unreadCount(): number {
    let n = 0;
    for (const m of this.messages.values()) if (m.status === 'new') n += 1;
    return n;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const contact = new ContactService();
`;

export const CONTACTFORM_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { contact } from './contactService';

// REST endpoints for the contact form. Mount with: app.use('/api/contact', contactRouter).
// The POST is public; guard the admin GET/PATCH/DELETE routes with your auth middleware.
export const contactRouter = Router();

// Public submit. { name, email, message, subject?, honeypot? }. The honeypot must be a hidden field.
contactRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = contact.submit({
      name: String(body.name ?? ''),
      email: String(body.email ?? ''),
      message: String(body.message ?? ''),
      subject: body.subject === undefined ? '' : String(body.subject),
      honeypot: body.honeypot === undefined ? '' : String(body.honeypot),
    });
    // Always 201 to a bot (don't reveal the honeypot caught it); only notify staff when accepted.
    return res.status(201).json({ ok: true, accepted: result.accepted });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Admin inbox (hides spam unless ?status=spam). Guard with auth.
contactRouter.get('/', (req: Request, res: Response) => {
  const status = req.query.status === undefined ? undefined : String(req.query.status);
  return res.status(200).json({
    unread: contact.unreadCount(),
    messages: contact.list(status as 'new' | 'read' | 'archived' | 'spam' | undefined),
  });
});

contactRouter.get('/:id', (req: Request, res: Response) => {
  const m = contact.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'message not found' });
  return res.status(200).json(m);
});

// Change status. { status }. Guard with auth.
contactRouter.patch('/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    return res.status(200).json(contact.setStatus(req.params.id, String(body.status ?? '') as 'new' | 'read' | 'archived' | 'spam'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'message not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});

contactRouter.delete('/:id', (req: Request, res: Response) => {
  if (!contact.remove(req.params.id)) return res.status(404).json({ error: 'message not found' });
  return res.status(204).send();
});
`;

const CONTACTFORM_README = `# Contact form

A real "Contact us" / lead-capture backend. The core guarantees: a submission requires a **name**, a **valid
email** and a **non-empty message** (bad input is rejected, never silently stored), a filled hidden **honeypot**
field marks the submission as **spam** and drops it (bots fill it, humans never see it), and every accepted
message moves through a status lifecycle **new → read → archived** (or **spam**). Files:

- \`contactService.ts\` — the domain logic (\`ContactService\` + a \`contact\` singleton). Dependency-free.
  In-memory; swap the Map for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { contactRouter } from './server/contact/routes';
app.use('/api/contact', contactRouter);
\`\`\`

Endpoints:
- \`POST   /api/contact\` \`{ name, email, message, subject?, honeypot? }\` → submit (**public**). Add a hidden
  \`honeypot\` input to your form; a bot that fills it is silently marked spam (still returns 201).
- \`GET    /api/contact\` \`?status=\` → the inbox (hides spam unless \`?status=spam\`) + unread count (**admin**).
- \`GET    /api/contact/:id\` → one message.
- \`PATCH  /api/contact/:id/status\` \`{ status }\` → new | read | archived | spam (**409** on an illegal move).
- \`DELETE /api/contact/:id\`.

Pair with \`generate_email\` to notify your team when \`accepted\` is true. Distinct from \`generate_newsletter\`
(email-only capture) and \`generate_feedback\` (a public voting board).
`;

export interface ContactFormConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Contact form starter wired under server/contact/ (dependency-free domain logic + an Express router). The ' +
  'real guarantee is VALIDATED CAPTURE + SPAM REJECTION: submit() requires name + a valid email + a non-empty ' +
  'message (invalid input throws, never silently stored); a filled hidden honeypot field stores the message as ' +
  "'spam' and returns { accepted:false } (respond 200 to the bot, notify no one); a clean submission is 'new' " +
  'with { accepted:true }. Accepted messages have a status lifecycle new → read → archived (+ spam), an ' +
  'illegal transition 409s; list() hides spam by default; unreadCount() drives an inbox badge. routes.ts ' +
  'exposes POST /api/contact (public: {name,email,message,subject?,honeypot?}), GET /api/contact (?status=, ' +
  'admin), GET /api/contact/:id, PATCH /api/contact/:id/status ({status}) and DELETE /api/contact/:id. Mount at ' +
  'app.use("/api/contact", contactRouter); guard the admin routes. Pair with generate_email to notify staff. ' +
  'Distinct from generate_newsletter (email-only) and generate_feedback (voting board). In-memory by default — ' +
  'swap the Map for your DB.';

export function generateContactFormIntegration(): ContactFormConfig {
  return {
    files: {
      'server/contact/contactService.ts': CONTACTFORM_SERVICE_SOURCE,
      'server/contact/routes.ts': CONTACTFORM_ROUTES_SOURCE,
      'server/contact/README.md': CONTACTFORM_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
