// Roadmap breadth — announcements / site banners starter (a packaged domain vertical).
//
// Site-wide announcement banners (maintenance notices, promos, new-feature callouts). The real feature is
// SCHEDULED VISIBILITY + DISMISS-ONCE: a banner is only "active" inside its optional [startsAt, endsAt] window,
// and once a user DISMISSES a dismissible banner it NEVER shows for that user again — activeFor(user) returns
// exactly the banners a given user should currently see. This emits a dependency-free AnnouncementService (no
// crypto/deps) + an Express router + a README. Real logic, not a stub — the scheduling + dismiss rules are
// unit-tested against the emitted code. Pure builder → the caller writes the files. Distinct from
// generate_notification_center (a per-user inbox) and generate_activity_feed (an event timeline).

export const ANNOUNCEMENTS_SERVICE_SOURCE = `// Announcements / site-banner domain logic. The core guarantees: (1) a banner is only ACTIVE inside its
// optional [startsAt, endsAt] schedule window (and when published); and (2) once a user DISMISSES a dismissible
// banner it never appears for that user again — activeFor(user) returns exactly what that user should see now.
// In-memory here; swap the Maps for your database, keeping the same method contracts.

export type AnnouncementLevel = 'info' | 'success' | 'warning' | 'critical';

export interface Announcement {
  id: string;
  message: string;
  level: AnnouncementLevel;
  dismissible: boolean;          // can a user dismiss it forever?
  published: boolean;            // draft banners are never shown
  startsAt: string | null;       // ISO; null = no lower bound
  endsAt: string | null;         // ISO; null = no upper bound
  createdAt: string;
}

let counter = 0;
function nextId(now: Date): string {
  counter += 1;
  return 'anc_' + now.getTime().toString(36) + '_' + counter.toString(36);
}

export class AnnouncementService {
  private items = new Map<string, Announcement>();
  private dismissed = new Map<string, Set<string>>(); // userId -> set of announcement ids

  /** Create a banner. Draft by default (published:false); dismissible by default. */
  create(input: {
    message: string;
    level?: AnnouncementLevel;
    dismissible?: boolean;
    published?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
  }, now: Date = new Date()): Announcement {
    const message = String(input?.message ?? '').trim();
    if (!message) throw new Error('message is required');
    const level = (['info', 'success', 'warning', 'critical'] as const).includes(input?.level as AnnouncementLevel)
      ? (input.level as AnnouncementLevel) : 'info';
    const startsAt = input?.startsAt ? new Date(input.startsAt).toISOString() : null;
    const endsAt = input?.endsAt ? new Date(input.endsAt).toISOString() : null;
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new Error('endsAt must be after startsAt');
    }
    const item: Announcement = {
      id: nextId(now),
      message,
      level,
      dismissible: input?.dismissible === undefined ? true : Boolean(input.dismissible),
      published: Boolean(input?.published),
      startsAt,
      endsAt,
      createdAt: now.toISOString(),
    };
    this.items.set(item.id, item);
    return { ...item };
  }

  get(id: string): Announcement | undefined {
    const a = this.items.get(String(id ?? '').trim());
    return a ? { ...a } : undefined;
  }

  update(id: string, patch: Partial<Pick<Announcement, 'message' | 'level' | 'dismissible' | 'published' | 'startsAt' | 'endsAt'>>, now: Date = new Date()): Announcement {
    const a = this.items.get(String(id ?? '').trim());
    if (!a) throw new Error('announcement not found');
    if (patch.message !== undefined) {
      const m = String(patch.message).trim();
      if (!m) throw new Error('message cannot be empty');
      a.message = m;
    }
    if (patch.level !== undefined && (['info', 'success', 'warning', 'critical'] as const).includes(patch.level)) a.level = patch.level;
    if (patch.dismissible !== undefined) a.dismissible = Boolean(patch.dismissible);
    if (patch.published !== undefined) a.published = Boolean(patch.published);
    if (patch.startsAt !== undefined) a.startsAt = patch.startsAt ? new Date(patch.startsAt).toISOString() : null;
    if (patch.endsAt !== undefined) a.endsAt = patch.endsAt ? new Date(patch.endsAt).toISOString() : null;
    if (a.startsAt && a.endsAt && new Date(a.endsAt).getTime() <= new Date(a.startsAt).getTime()) {
      throw new Error('endsAt must be after startsAt');
    }
    void now;
    return { ...a };
  }

  remove(id: string): boolean {
    return this.items.delete(String(id ?? '').trim());
  }

  /** Is a banner within its schedule window (and published) at this instant? */
  private isLive(a: Announcement, at: Date): boolean {
    if (!a.published) return false;
    const t = at.getTime();
    if (a.startsAt && t < new Date(a.startsAt).getTime()) return false;
    if (a.endsAt && t >= new Date(a.endsAt).getTime()) return false;
    return true;
  }

  /** A user dismisses a banner forever. No-op if the banner is not dismissible or unknown. */
  dismiss(userId: string, announcementId: string): boolean {
    const user = String(userId ?? '').trim();
    if (!user) throw new Error('userId is required');
    const a = this.items.get(String(announcementId ?? '').trim());
    if (!a || !a.dismissible) return false;
    let set = this.dismissed.get(user);
    if (!set) { set = new Set(); this.dismissed.set(user, set); }
    set.add(a.id);
    return true;
  }

  hasDismissed(userId: string, announcementId: string): boolean {
    return this.dismissed.get(String(userId ?? '').trim())?.has(String(announcementId ?? '').trim()) ?? false;
  }

  /**
   * Exactly the banners a given user should see right now: published, within schedule, and NOT already
   * dismissed by that user. Newest first.
   */
  activeFor(userId: string, at: Date = new Date()): Announcement[] {
    const user = String(userId ?? '').trim();
    const dismissed = this.dismissed.get(user) ?? new Set<string>();
    return [...this.items.values()]
      .filter((a) => this.isLive(a, at) && !dismissed.has(a.id))
      .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
      .map((a) => ({ ...a }));
  }

  /** All banners (admin view), newest first. */
  list(): Announcement[] {
    return [...this.items.values()]
      .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
      .map((a) => ({ ...a }));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const announcements = new AnnouncementService();
`;

export const ANNOUNCEMENTS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { announcements } from './announcementService';

// REST endpoints for site announcements. Mount with: app.use('/api/announcements', announcementRouter).
// In production take the userId from the auth session; guard the admin write routes.
export const announcementRouter = Router();

// The banners the current user should see now. ?user=<id>.
announcementRouter.get('/active', (req: Request, res: Response) => {
  const user = String(req.query.user ?? '').trim();
  return res.status(200).json(announcements.activeFor(user));
});

// Admin: all banners.
announcementRouter.get('/', (_req: Request, res: Response) => {
  return res.status(200).json(announcements.list());
});

// Create a banner. { message, level?, dismissible?, published?, startsAt?, endsAt? }. Guard with auth.
announcementRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    return res.status(201).json(announcements.create({
      message: String(body.message ?? ''),
      level: body.level as 'info' | 'success' | 'warning' | 'critical' | undefined,
      dismissible: body.dismissible === undefined ? undefined : Boolean(body.dismissible),
      published: Boolean(body.published),
      startsAt: body.startsAt === undefined ? null : String(body.startsAt),
      endsAt: body.endsAt === undefined ? null : String(body.endsAt),
    }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Edit a banner. Guard with auth.
announcementRouter.patch('/:id', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    return res.status(200).json(announcements.update(req.params.id, body));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'announcement not found' ? 404 : 400).json({ error: message });
  }
});

announcementRouter.delete('/:id', (req: Request, res: Response) => {
  if (!announcements.remove(req.params.id)) return res.status(404).json({ error: 'announcement not found' });
  return res.status(204).send();
});

// A user dismisses a banner forever. { user }.
announcementRouter.post('/:id/dismiss', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { user?: unknown };
  try {
    const ok = announcements.dismiss(String(body.user ?? ''), req.params.id);
    return res.status(200).json({ dismissed: ok });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});
`;

const ANNOUNCEMENTS_README = `# Announcements / site banners

A real site-wide announcement-banner backend (maintenance notices, promos, new-feature callouts). The core
guarantees: a banner is only **active** inside its optional \`[startsAt, endsAt]\` schedule window (and when
published), and once a user **dismisses** a dismissible banner it **never** shows for that user again —
\`activeFor(user)\` returns exactly the banners a given user should currently see. Files:

- \`announcementService.ts\` — the domain logic (\`AnnouncementService\` + an \`announcements\` singleton).
  Dependency-free. In-memory; swap the Maps for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { announcementRouter } from './server/announcements/routes';
app.use('/api/announcements', announcementRouter);
\`\`\`

Endpoints:
- \`GET  /api/announcements/active?user=<id>\` → the banners this user should see now (scheduled + not dismissed).
- \`GET  /api/announcements\` → all banners (**admin**).
- \`POST /api/announcements\` \`{ message, level?, dismissible?, published?, startsAt?, endsAt? }\` → create (**guard with auth**).
- \`PATCH /api/announcements/:id\` → edit (**guard with auth**).
- \`DELETE /api/announcements/:id\`.
- \`POST /api/announcements/:id/dismiss\` \`{ user }\` → this user dismisses the banner forever.

\`level\` is one of \`info | success | warning | critical\`. Distinct from \`generate_notification_center\`
(a per-user inbox) and \`generate_activity_feed\` (an event timeline).
`;

export interface AnnouncementsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Announcements / site-banner starter wired under server/announcements/ (dependency-free domain logic + an ' +
  'Express router). The real guarantee is SCHEDULED VISIBILITY + DISMISS-ONCE: a banner is only active inside ' +
  'its optional [startsAt, endsAt] window and when published; dismiss(user, id) hides a dismissible banner for ' +
  'that user forever; activeFor(user) returns exactly the banners a given user should see now (published + ' +
  'in-schedule + not dismissed), newest first. create() is a draft by default and dismissible by default; ' +
  'level is info|success|warning|critical. routes.ts exposes GET /api/announcements/active (?user=), GET/POST ' +
  '/api/announcements, PATCH/DELETE /api/announcements/:id and POST /api/announcements/:id/dismiss ({user}). ' +
  'Mount at app.use("/api/announcements", announcementRouter); take userId from the auth session and guard the ' +
  'admin write routes. Distinct from generate_notification_center (per-user inbox) and generate_activity_feed ' +
  '(event timeline). In-memory by default — swap the Maps for your DB.';

export function generateAnnouncementsIntegration(): AnnouncementsConfig {
  return {
    files: {
      'server/announcements/announcementService.ts': ANNOUNCEMENTS_SERVICE_SOURCE,
      'server/announcements/routes.ts': ANNOUNCEMENTS_ROUTES_SOURCE,
      'server/announcements/README.md': ANNOUNCEMENTS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
