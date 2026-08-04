// Roadmap breadth — launch waitlist starter (a packaged domain vertical).
//
// A high-demand vertical for product launches, beta access, drops and any "get in line" flow. The real feature
// is QUEUE INTEGRITY: an email joins AT MOST ONCE (a repeat join returns the same stable position, never a
// duplicate), positions are a contiguous 1..n in join order among people still WAITING, and inviting the front
// N moves exactly those people (in order) from 'waiting' to 'invited' so the remaining queue re-numbers
// correctly. This emits a dependency-free Waitlist + an Express router + a README. Real logic, not a stub — the
// dedup + FIFO-position + invite-in-order rules are unit-tested against the emitted code. Pure builder → the
// caller writes the files.

export const WAITLIST_SERVICE_SOURCE = `// Launch-waitlist domain logic. The core guarantees: (1) an email joins AT MOST ONCE (case-insensitive dedup) —
// a repeat join returns the SAME entry with its stable join order, (2) position() is a contiguous 1..n over the
// people still WAITING, in join order, and (3) invite(n) moves the front n WAITING entries (in order) to
// 'invited', after which the remaining waiting queue re-numbers correctly. In-memory here; swap the Map for your
// database, keeping the same method contracts.

export type WaitStatus = 'waiting' | 'invited' | 'removed';

export interface WaitEntry {
  id: string;
  email: string;      // normalized lower-case
  name: string;
  seq: number;        // monotonic join counter (stable ordering key; never reused)
  status: WaitStatus;
  referredBy: string; // optional referrer email (for referral-boosted waitlists)
  joinedAt: string;
  invitedAt: string | null;
}

export class Waitlist {
  private entries = new Map<string, WaitEntry>(); // key = normalized email
  private seq = 0;

  private norm(email: string): string {
    return String(email ?? '').trim().toLowerCase();
  }

  private waitingSorted(): WaitEntry[] {
    return [...this.entries.values()].filter((e) => e.status === 'waiting').sort((a, b) => a.seq - b.seq);
  }

  /** Join the waitlist. Idempotent per email — a repeat join returns the existing (stable) entry. */
  join(email: string, input: { name?: string; referredBy?: string } = {}, now: Date = new Date()): WaitEntry {
    const key = this.norm(email);
    if (!key || !key.includes('@')) throw new Error('a valid email is required');
    const existing = this.entries.get(key);
    if (existing) return existing; // dedup: keep the original position
    const entry: WaitEntry = {
      id: 'w' + String(++this.seq),
      email: key,
      name: String(input?.name ?? '').trim(),
      seq: this.seq,
      status: 'waiting',
      referredBy: this.norm(input?.referredBy ?? ''),
      joinedAt: now.toISOString(),
      invitedAt: null,
    };
    this.entries.set(key, entry);
    return entry;
  }

  get(email: string): WaitEntry | undefined {
    return this.entries.get(this.norm(email));
  }

  /** 1-based position among people still WAITING (in join order), or 0 if not waiting / not found. */
  position(email: string): number {
    const key = this.norm(email);
    const idx = this.waitingSorted().findIndex((e) => e.email === key);
    return idx < 0 ? 0 : idx + 1;
  }

  /** How many people are still waiting. */
  waitingCount(): number {
    return this.waitingSorted().length;
  }

  /** Invite the front n WAITING entries (in order). Returns the invited entries. */
  invite(n: number, now: Date = new Date()): WaitEntry[] {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    const front = this.waitingSorted().slice(0, count);
    const iso = now.toISOString();
    for (const e of front) {
      e.status = 'invited';
      e.invitedAt = iso;
    }
    return front;
  }

  /** Remove an email from the queue (e.g. unsubscribe). Returns true if one was removed/marked. */
  remove(email: string): boolean {
    const e = this.entries.get(this.norm(email));
    if (!e || e.status === 'removed') return false;
    e.status = 'removed';
    return true;
  }

  /** Entries by status, in join order. */
  list(status?: WaitStatus): WaitEntry[] {
    const all = [...this.entries.values()].sort((a, b) => a.seq - b.seq);
    return status ? all.filter((e) => e.status === status) : all;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const waitlist = new Waitlist();
`;

export const WAITLIST_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { waitlist } from './waitlistService';

// REST endpoints for the waitlist. Mount with: app.use('/api', waitlistRouter).
export const waitlistRouter = Router();

// Join the waitlist. { email, name?, referredBy? } — idempotent per email.
waitlistRouter.post('/waitlist', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { email?: unknown; name?: unknown; referredBy?: unknown };
  try {
    const entry = waitlist.join(String(body.email ?? ''), { name: String(body.name ?? ''), referredBy: String(body.referredBy ?? '') });
    return res.status(201).json({ ...entry, position: waitlist.position(entry.email) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// A given email's status + current position.
waitlistRouter.get('/waitlist/:email', (req: Request, res: Response) => {
  const entry = waitlist.get(req.params.email);
  if (!entry) return res.status(404).json({ error: 'not on the waitlist' });
  return res.status(200).json({ ...entry, position: waitlist.position(entry.email) });
});

// Invite the front N (admin). { n }. Returns the invited entries.
waitlistRouter.post('/waitlist/invite', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { n?: unknown };
  const invited = waitlist.invite(Number(body.n ?? 0));
  return res.status(200).json({ invited, remainingWaiting: waitlist.waitingCount() });
});

// List entries (?status=waiting|invited|removed).
waitlistRouter.get('/waitlist', (req: Request, res: Response) => {
  const q = req.query as { status?: string };
  const status = ['waiting', 'invited', 'removed'].includes(String(q.status)) ? (q.status as 'waiting') : undefined;
  return res.status(200).json({ entries: waitlist.list(status), waitingCount: waitlist.waitingCount() });
});

// Remove an email (unsubscribe).
waitlistRouter.delete('/waitlist/:email', (req: Request, res: Response) => {
  if (!waitlist.remove(req.params.email)) return res.status(404).json({ error: 'not on the waitlist' });
  return res.status(204).send();
});
`;

const WAITLIST_README = `# Launch waitlist

A real waitlist backend. The core guarantees: an email joins **at most once** (case-insensitive dedup — a
repeat join returns the same stable position), positions are a contiguous **1..n in join order** among people
still **waiting**, and inviting the front **N** moves exactly those people (in order) to \`invited\` so the
remaining queue re-numbers correctly. Files:

- \`waitlistService.ts\` — the domain logic (\`Waitlist\` + a \`waitlist\` singleton). In-memory; swap the Map for
  your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { waitlistRouter } from './server/waitlist/routes';
app.use('/api', waitlistRouter);
\`\`\`

Endpoints:
- \`POST /api/waitlist\` \`{ email, name?, referredBy? }\` → join (idempotent); returns the entry + \`position\`.
- \`GET  /api/waitlist/:email\` → status + current position (**404** if not on the list).
- \`POST /api/waitlist/invite\` \`{ n }\` → invite the front N; returns \`{ invited, remainingWaiting }\`.
- \`GET  /api/waitlist\` (\`?status=\`) → entries + \`waitingCount\`.
- \`DELETE /api/waitlist/:email\` → remove (unsubscribe).

\`referredBy\` is captured for referral-boosted launches (pair with the referrals recipe). Send the invite email
from wherever your \`invite\` call runs.
`;

export interface WaitlistConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Launch-waitlist starter wired under server/waitlist/ (dependency-free domain logic + an Express router). The ' +
  'real guarantee is QUEUE INTEGRITY: join() dedups by email (case-insensitive) so a repeat join returns the ' +
  'SAME stable entry (never a duplicate); position() is a contiguous 1..n over the people still WAITING in join ' +
  'order; invite(n) moves the front n waiting entries (in order) to invited, after which the remaining queue ' +
  're-numbers correctly. routes.ts exposes POST /waitlist (idempotent join, returns position), GET ' +
  '/waitlist/:email (status + position), POST /waitlist/invite ({ n } → invited + remainingWaiting), GET ' +
  '/waitlist (?status=) and DELETE /waitlist/:email. Mount with app.use("/api", waitlistRouter). referredBy is ' +
  'captured for referral-boosted launches (pairs with generate_referrals). In-memory by default — swap the Map ' +
  'for your DB.';

export function generateWaitlistIntegration(): WaitlistConfig {
  return {
    files: {
      'server/waitlist/waitlistService.ts': WAITLIST_SERVICE_SOURCE,
      'server/waitlist/routes.ts': WAITLIST_ROUTES_SOURCE,
      'server/waitlist/README.md': WAITLIST_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
