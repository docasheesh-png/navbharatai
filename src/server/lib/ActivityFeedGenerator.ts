// Roadmap breadth — activity feed / timeline starter (a packaged domain vertical).
//
// A high-demand vertical for "what happened" timelines: a social feed, an audit-visible activity stream, a
// per-project event log, or a notification timeline. The real feature is STABLE CURSOR PAGINATION: events are
// numbered by a monotonic sequence id and paged newest-first by that id, so paging a live feed NEVER duplicates
// or skips an item even as new events are appended between page fetches (the classic offset-pagination bug this
// vertical exists to prevent). Also: per-actor feeds, a global feed, and an unseen counter with markSeen.
// This emits a dependency-free ActivityFeedService (no crypto/deps) + an Express router + a README.
// Real logic, not a stub — the cursor-stability + unseen-count rules are unit-tested against the emitted code.
// Pure builder → the caller writes the files.

export const ACTIVITYFEED_SERVICE_SOURCE = `// Activity-feed / timeline domain logic. The core guarantee is STABLE CURSOR PAGINATION: every event gets a
// monotonically increasing sequence id, and a feed is paged newest-first by "give me items with id < cursor".
// Because ids never change and only ever grow, paging a live feed can never DUPLICATE or SKIP an item even when
// new events are appended between two page fetches — the bug that offset/limit pagination silently introduces.
// In-memory here; swap the array for your database (an auto-increment / bigserial column plays the id role),
// keeping the same method contracts.

export interface ActivityEvent {
  id: number;          // monotonic sequence id — the stable pagination cursor
  actor: string;       // who did it (user id / handle)
  verb: string;        // what they did ('created', 'commented', 'liked', ...)
  object: string;      // what they did it to ('post:42', 'order:7', ...)
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface FeedPage {
  events: ActivityEvent[];
  nextCursor: number | null; // pass back as {cursor} to fetch the next (older) page; null = no more
}

export interface FeedQuery {
  cursor?: number | null; // return events with id < cursor (omit for the newest page)
  limit?: number;         // page size (default 20, capped 1..100)
}

export class ActivityFeedService {
  private events: ActivityEvent[] = []; // kept in ascending id order (append-only)
  private seq = 0;
  private lastSeen = new Map<string, number>(); // viewer -> highest event id they have seen

  /** Record an event. Returns the stored event (with its assigned sequence id). */
  record(actor: string, verb: string, object: string, meta: Record<string, unknown> = {}, now: Date = new Date()): ActivityEvent {
    const who = String(actor ?? '').trim();
    const what = String(verb ?? '').trim();
    const on = String(object ?? '').trim();
    if (!who) throw new Error('actor is required');
    if (!what) throw new Error('verb is required');
    if (!on) throw new Error('object is required');
    const event: ActivityEvent = {
      id: ++this.seq,
      actor: who,
      verb: what,
      object: on,
      meta: meta && typeof meta === 'object' ? { ...meta } : {},
      createdAt: now.toISOString(),
    };
    this.events.push(event);
    return event;
  }

  private normalizeLimit(limit?: number): number {
    const n = Number.isFinite(limit) ? Math.floor(Number(limit)) : 20;
    return Math.max(1, Math.min(100, n));
  }

  /**
   * Newest-first page of the GLOBAL feed. Stable cursor pagination: returns up to {limit} events whose id is
   * strictly less than {cursor} (or the newest {limit} when no cursor), plus a nextCursor for the following
   * (older) page. Because ids are immutable and monotonic, appending new events between page fetches can never
   * cause a duplicate or a skip within a pagination walk.
   */
  feed(query: FeedQuery = {}): FeedPage {
    return this.pageFrom(this.events, query);
  }

  /** Newest-first page of a single actor's feed — same stable-cursor guarantee, filtered to one actor. */
  actorFeed(actor: string, query: FeedQuery = {}): FeedPage {
    const who = String(actor ?? '').trim();
    return this.pageFrom(this.events.filter((e) => e.actor === who), query);
  }

  private pageFrom(source: ActivityEvent[], query: FeedQuery): FeedPage {
    const limit = this.normalizeLimit(query.limit);
    const cursor = query.cursor === undefined || query.cursor === null ? null : Number(query.cursor);
    // Walk from newest to oldest; take events strictly older than the cursor.
    const older = cursor === null ? source : source.filter((e) => e.id < cursor);
    const desc = [...older].sort((a, b) => b.id - a.id);
    const events = desc.slice(0, limit);
    // There is a next page only if more events remain beyond this slice.
    const nextCursor = desc.length > limit ? events[events.length - 1].id : null;
    return { events, nextCursor };
  }

  /** Mark a viewer as having seen everything up to (and including) the newest event right now. */
  markSeen(viewer: string): number {
    const who = String(viewer ?? '').trim();
    if (!who) throw new Error('viewer is required');
    this.lastSeen.set(who, this.seq);
    return this.seq;
  }

  /** How many events a viewer has NOT yet seen (newer than their last markSeen). */
  unseenCount(viewer: string): number {
    const who = String(viewer ?? '').trim();
    const seen = this.lastSeen.get(who) ?? 0;
    let count = 0;
    for (const e of this.events) if (e.id > seen) count += 1;
    return count;
  }

  /** Total number of recorded events. */
  size(): number {
    return this.events.length;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const activityFeed = new ActivityFeedService();
`;

export const ACTIVITYFEED_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { activityFeed } from './activityFeedService';

// REST endpoints for the activity feed. Mount with: app.use('/api/activity', activityFeedRouter).
export const activityFeedRouter = Router();

// Record an event. { actor, verb, object, meta? }.
activityFeedRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { actor?: unknown; verb?: unknown; object?: unknown; meta?: unknown };
  try {
    const event = activityFeed.record(
      String(body.actor ?? ''),
      String(body.verb ?? ''),
      String(body.object ?? ''),
      body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : {},
    );
    return res.status(201).json(event);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Global feed, newest-first. ?cursor=<id>&limit=<n> for stable pagination.
activityFeedRouter.get('/', (req: Request, res: Response) => {
  const cursor = req.query.cursor === undefined ? null : Number(req.query.cursor);
  const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
  return res.status(200).json(activityFeed.feed({ cursor, limit }));
});

// A single actor's feed, newest-first, same stable pagination.
activityFeedRouter.get('/actor/:actor', (req: Request, res: Response) => {
  const cursor = req.query.cursor === undefined ? null : Number(req.query.cursor);
  const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
  return res.status(200).json(activityFeed.actorFeed(req.params.actor, { cursor, limit }));
});

// Unseen counter for a viewer. ?viewer=<id>.
activityFeedRouter.get('/unseen', (req: Request, res: Response) => {
  const viewer = String(req.query.viewer ?? '').trim();
  if (!viewer) return res.status(400).json({ error: 'viewer is required' });
  return res.status(200).json({ viewer, unseen: activityFeed.unseenCount(viewer) });
});

// Mark everything up to now as seen for a viewer. { viewer }.
activityFeedRouter.post('/seen', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { viewer?: unknown };
  try {
    const seenUpTo = activityFeed.markSeen(String(body.viewer ?? ''));
    return res.status(200).json({ seenUpTo });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});
`;

const ACTIVITYFEED_README = `# Activity feed / timeline

A real activity-stream backend — a social feed, an audit-visible activity timeline, a per-project event log, or
a notification timeline. The core guarantee is **stable cursor pagination**: every event gets a monotonic
sequence id, and the feed is paged newest-first by \`id < cursor\`. Because ids never change and only grow,
paging a live feed **can never duplicate or skip** an item even as new events are appended between page fetches —
the exact bug that naive offset/limit pagination introduces. Files:

- \`activityFeedService.ts\` — the domain logic (\`ActivityFeedService\` + an \`activityFeed\` singleton).
  Dependency-free. In-memory; swap the array for your DB (an auto-increment / bigserial id column plays the id role).
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { activityFeedRouter } from './server/activity/routes';
app.use('/api/activity', activityFeedRouter);
\`\`\`

Endpoints:
- \`POST /api/activity\` \`{ actor, verb, object, meta? }\` → record an event.
- \`GET  /api/activity?cursor=<id>&limit=<n>\` → global feed, newest-first + \`nextCursor\`.
- \`GET  /api/activity/actor/:actor?cursor=<id>&limit=<n>\` → one actor's feed.
- \`GET  /api/activity/unseen?viewer=<id>\` → \`{ unseen }\` count of events newer than the viewer's last markSeen.
- \`POST /api/activity/seen\` \`{ viewer }\` → mark everything up to now as seen.

To page: call \`GET /api/activity\` (no cursor) for the newest page, then repeat with \`cursor = nextCursor\` until
\`nextCursor\` is null. New events arriving mid-walk simply appear on a later refresh of the first page — they can
never corrupt the walk you are on.
`;

export interface ActivityFeedConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Activity feed / timeline starter wired under server/activity/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is STABLE CURSOR PAGINATION: every event gets a monotonic sequence id and the ' +
  'feed is paged newest-first by "id < cursor", so paging a live feed NEVER duplicates or skips an item even ' +
  'when new events are appended between page fetches (the classic offset-pagination bug this prevents). ' +
  'record(actor, verb, object, meta?) appends an event; feed({cursor, limit}) returns a newest-first page + ' +
  'nextCursor for the GLOBAL feed; actorFeed(actor, {cursor, limit}) does the same for one actor; ' +
  'markSeen(viewer) / unseenCount(viewer) drive an unread badge. routes.ts exposes POST /api/activity, ' +
  'GET /api/activity (?cursor&limit), GET /api/activity/actor/:actor, GET /api/activity/unseen (?viewer) and ' +
  'POST /api/activity/seen. Mount at app.use("/api/activity", activityFeedRouter). In-memory by default — swap ' +
  'the array for your DB (an auto-increment id column plays the sequence-id role).';

export function generateActivityFeedIntegration(): ActivityFeedConfig {
  return {
    files: {
      'server/activity/activityFeedService.ts': ACTIVITYFEED_SERVICE_SOURCE,
      'server/activity/routes.ts': ACTIVITYFEED_ROUTES_SOURCE,
      'server/activity/README.md': ACTIVITYFEED_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
