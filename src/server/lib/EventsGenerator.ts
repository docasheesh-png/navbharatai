// Roadmap breadth — events / RSVP starter (a packaged domain vertical).
//
// A high-demand vertical: meetups, workshops, webinars, community events. The real feature is correct
// CAPACITY ENFORCEMENT with a WAITLIST: an event never confirms more attendees than its capacity, extra
// RSVPs go to a waitlist, and cancelling a confirmed seat automatically PROMOTES the first waitlisted
// attendee. This emits a dependency-free EventService + an Express router + a README. Real logic, not a
// stub — the capacity + promotion rules are unit-tested against the emitted code. Pure builder.

export const EVENT_SERVICE_SOURCE = `// Events domain logic. The core guarantee: confirmed attendees never exceed capacity; overflow goes to a
// waitlist (FIFO); cancelling a confirmed seat promotes the first waitlisted attendee. In-memory here; swap
// the Maps for your database, keeping the same method contracts.

export type RsvpStatus = 'confirmed' | 'waitlist' | 'cancelled';

export interface EventItem {
  id: string;
  title: string;
  capacity: number;
  startsAt: string;
  createdAt: string;
}

export interface Rsvp {
  id: string;
  eventId: string;
  attendee: string;
  status: RsvpStatus;
  at: string;
}

export class EventService {
  private events = new Map<string, EventItem>();
  private rsvps: Rsvp[] = [];
  private seqE = 0;
  private seqR = 0;

  createEvent(input: { title: string; capacity: number; startsAt?: string }, now: Date = new Date()): EventItem {
    const title = String(input?.title ?? '').trim();
    if (!title) throw new Error('title is required');
    const capacity = Math.floor(Number(input.capacity));
    if (!Number.isFinite(capacity) || capacity <= 0) throw new Error('capacity must be a positive number');
    const event: EventItem = {
      id: String(++this.seqE),
      title,
      capacity,
      startsAt: String(input.startsAt ?? '').trim() || now.toISOString(),
      createdAt: now.toISOString(),
    };
    this.events.set(event.id, event);
    return event;
  }

  getEvent(id: string): EventItem | undefined {
    return this.events.get(id);
  }

  private confirmedCount(eventId: string): number {
    return this.rsvps.filter((r) => r.eventId === eventId && r.status === 'confirmed').length;
  }

  /** RSVP an attendee. Confirms if there is room, else adds them to the waitlist. Idempotent per attendee
   *  (a second active RSVP for the same person on the same event is rejected). */
  rsvp(eventId: string, attendee: string, now: Date = new Date()): Rsvp {
    const event = this.events.get(eventId);
    if (!event) throw new Error('event not found');
    const who = String(attendee).trim();
    if (!who) throw new Error('attendee is required');
    const existing = this.rsvps.find(
      (r) => r.eventId === eventId && r.attendee === who && r.status !== 'cancelled',
    );
    if (existing) throw new Error('already rsvped');
    const status: RsvpStatus = this.confirmedCount(eventId) < event.capacity ? 'confirmed' : 'waitlist';
    const rsvp: Rsvp = { id: String(++this.seqR), eventId, attendee: who, status, at: now.toISOString() };
    this.rsvps.push(rsvp);
    return rsvp;
  }

  /** Cancel an RSVP. If a CONFIRMED seat is freed, promote the first waitlisted attendee (FIFO). */
  cancelRsvp(rsvpId: string): { cancelled: Rsvp; promoted: Rsvp | null } {
    const r = this.rsvps.find((x) => x.id === rsvpId);
    if (!r) throw new Error('rsvp not found');
    const wasConfirmed = r.status === 'confirmed';
    r.status = 'cancelled';
    let promoted: Rsvp | null = null;
    if (wasConfirmed) {
      const next = this.rsvps.find((x) => x.eventId === r.eventId && x.status === 'waitlist');
      if (next) {
        next.status = 'confirmed';
        promoted = next;
      }
    }
    return { cancelled: r, promoted };
  }

  /** Attendees for an event, optionally filtered by status. Order = RSVP order (FIFO). */
  attendees(eventId: string, status?: RsvpStatus): Rsvp[] {
    return this.rsvps.filter((r) => r.eventId === eventId && (status ? r.status === status : r.status !== 'cancelled'));
  }

  /** Seats left (never negative). */
  seatsLeft(eventId: string): number {
    const event = this.events.get(eventId);
    if (!event) return 0;
    return Math.max(0, event.capacity - this.confirmedCount(eventId));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const events = new EventService();
`;

export const EVENT_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { events } from './eventService';

// REST endpoints for the events service. Mount with: app.use('/api', eventRouter).
export const eventRouter = Router();

eventRouter.post('/events', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: unknown; capacity?: unknown; startsAt?: unknown };
  try {
    return res.status(201).json(events.createEvent({ title: String(body.title ?? ''), capacity: Number(body.capacity), startsAt: String(body.startsAt ?? '') }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

eventRouter.get('/events/:id', (req: Request, res: Response) => {
  const e = events.getEvent(req.params.id);
  if (!e) return res.status(404).json({ error: 'event not found' });
  return res.status(200).json({ ...e, seatsLeft: events.seatsLeft(e.id) });
});

// Attendees (optional ?status=confirmed|waitlist|cancelled).
eventRouter.get('/events/:id/attendees', (req: Request, res: Response) => {
  const q = req.query as { status?: string };
  const status = ['confirmed', 'waitlist', 'cancelled'].includes(String(q.status)) ? (q.status as 'confirmed') : undefined;
  return res.status(200).json(events.attendees(req.params.id, status));
});

// RSVP. Returns the rsvp with status 'confirmed' or 'waitlist' (auto). 404 unknown event, 409 duplicate.
eventRouter.post('/events/:id/rsvp', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { attendee?: unknown };
  try {
    return res.status(201).json(events.rsvp(req.params.id, String(body.attendee ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not rsvp';
    if (message === 'event not found') return res.status(404).json({ error: message });
    if (message === 'already rsvped') return res.status(409).json({ error: message });
    return res.status(400).json({ error: message });
  }
});

// Cancel an RSVP (frees a confirmed seat → promotes the first waitlisted attendee).
eventRouter.delete('/rsvps/:rsvpId', (req: Request, res: Response) => {
  try {
    return res.status(200).json(events.cancelRsvp(req.params.rsvpId));
  } catch {
    return res.status(404).json({ error: 'rsvp not found' });
  }
});
`;

const EVENT_README = `# Events / RSVP

A real event-signup backend. The core guarantee: **capacity enforcement + waitlist** — an event never confirms
more attendees than its capacity, overflow goes to a FIFO waitlist, and cancelling a confirmed seat
automatically **promotes** the first waitlisted attendee. Files:

- \`eventService.ts\` — the domain logic (\`EventService\` + an \`events\` singleton). In-memory; swap the Maps for
  your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { eventRouter } from './server/events/routes';
app.use('/api', eventRouter);
\`\`\`

Endpoints:
- \`POST /api/events\` \`{ title, capacity, startsAt? }\`.
- \`GET  /api/events/:id\` → the event + \`seatsLeft\`.
- \`GET  /api/events/:id/attendees\` (\`?status=confirmed|waitlist|cancelled\`).
- \`POST /api/events/:id/rsvp\` \`{ attendee }\` → 'confirmed' or 'waitlist' (auto); **409** if already RSVP'd.
- \`DELETE /api/rsvps/:rsvpId\` → cancels; if it freed a confirmed seat, the response \`promoted\` names the
  attendee moved off the waitlist.

Pairs with the OTP, notification and email recipes (confirm RSVPs, notify on promotion).
`;

export interface EventsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Events / RSVP starter wired under server/events/ (dependency-free domain logic + an Express router). The ' +
  'real guarantee is CAPACITY ENFORCEMENT + WAITLIST: eventService.ts never confirms more attendees than an ' +
  "event's capacity, overflow RSVPs go to a FIFO waitlist, and cancelRsvp() promotes the first waitlisted " +
  'attendee when a confirmed seat frees up. routes.ts exposes POST /events, GET /events/:id (+ seatsLeft), ' +
  'GET /events/:id/attendees, POST /events/:id/rsvp (409 on duplicate) and DELETE /rsvps/:rsvpId. Mount with ' +
  'app.use("/api", eventRouter). In-memory by default — swap the Maps for your DB, same contracts. Pairs with ' +
  'the OTP/notification/email recipes. No API key.';

export function generateEventsIntegration(): EventsConfig {
  return {
    files: {
      'server/events/eventService.ts': EVENT_SERVICE_SOURCE,
      'server/events/routes.ts': EVENT_ROUTES_SOURCE,
      'server/events/README.md': EVENT_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
