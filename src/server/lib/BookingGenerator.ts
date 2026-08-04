// Roadmap breadth — booking / appointment starter recipe (a packaged domain vertical).
//
// A high-demand app type for NavBharatAI's market (clinics, salons, tutors, consultants). The real feature
// is CORRECT double-booking prevention: a time slot can hold at most one confirmed booking, and cancelling
// frees it. This emits a self-contained, dependency-free BookingService (in-memory, swap the store for your
// DB) + an Express router wiring it to REST endpoints + a README. Real business logic, not a stub — the
// conflict-prevention core is unit-tested against the emitted code. Pure builder → the caller writes the files.

export const BOOKING_SERVICE_SOURCE = `// Booking domain logic. The core guarantee: a slot holds at most ONE confirmed booking (no double-booking),
// and cancelling a booking frees its slot again. In-memory here — swap the Map for your database (the method
// contracts stay the same). "Slots" (the bookable times) are defined by YOUR app; this service books against them.

export type BookingStatus = 'confirmed' | 'cancelled';

export interface Booking {
  id: string;
  slotId: string;
  customer: string;
  createdAt: string;
  status: BookingStatus;
}

export interface BookingFilter {
  status?: BookingStatus;
  slotId?: string;
  customer?: string;
}

export class BookingService {
  private bookings = new Map<string, Booking>();
  private seq = 0;

  /** Is this slot free (no confirmed booking holds it)? */
  isSlotAvailable(slotId: string): boolean {
    const s = String(slotId).trim();
    for (const b of this.bookings.values()) {
      if (b.slotId === s && b.status === 'confirmed') return false;
    }
    return true;
  }

  /** Book a slot for a customer. Throws if the slot is already taken (double-booking prevented). */
  book(slotId: string, customer: string, now: Date = new Date()): Booking {
    const s = String(slotId).trim();
    const c = String(customer).trim();
    if (!s) throw new Error('slotId is required');
    if (!c) throw new Error('customer is required');
    if (!this.isSlotAvailable(s)) throw new Error('slot already booked');
    const booking: Booking = {
      id: String(++this.seq),
      slotId: s,
      customer: c,
      createdAt: now.toISOString(),
      status: 'confirmed',
    };
    this.bookings.set(booking.id, booking);
    return booking;
  }

  /** Cancel a booking, freeing its slot. Throws if the id is unknown. */
  cancel(id: string): Booking {
    const b = this.bookings.get(id);
    if (!b) throw new Error('booking not found');
    b.status = 'cancelled';
    return b;
  }

  get(id: string): Booking | undefined {
    return this.bookings.get(id);
  }

  /** List bookings, optionally filtered by status / slot / customer. */
  list(filter: BookingFilter = {}): Booking[] {
    let out = [...this.bookings.values()];
    if (filter.status) out = out.filter((b) => b.status === filter.status);
    if (filter.slotId) out = out.filter((b) => b.slotId === String(filter.slotId).trim());
    if (filter.customer) out = out.filter((b) => b.customer === String(filter.customer).trim());
    return out;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const bookings = new BookingService();
`;

export const BOOKING_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { bookings } from './bookingService';

// REST endpoints for the booking service. Mount with: app.use('/api', bookingRouter).
export const bookingRouter = Router();

// Create a booking. 409 if the slot is already taken (double-booking), 400 on bad input.
bookingRouter.post('/bookings', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { slotId?: unknown; customer?: unknown };
  try {
    const booking = bookings.book(String(body.slotId ?? ''), String(body.customer ?? ''));
    return res.status(201).json(booking);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not book';
    const status = message === 'slot already booked' ? 409 : 400;
    return res.status(status).json({ error: message });
  }
});

// List bookings (optional ?status= / ?slotId= / ?customer= filters).
bookingRouter.get('/bookings', (req: Request, res: Response) => {
  const q = req.query as { status?: string; slotId?: string; customer?: string };
  return res.status(200).json(
    bookings.list({
      status: q.status === 'confirmed' || q.status === 'cancelled' ? q.status : undefined,
      slotId: q.slotId,
      customer: q.customer,
    }),
  );
});

// Check whether a slot is free.
bookingRouter.get('/slots/:slotId/available', (req: Request, res: Response) => {
  return res.status(200).json({ slotId: req.params.slotId, available: bookings.isSlotAvailable(req.params.slotId) });
});

// Cancel a booking (frees the slot). 404 if unknown.
bookingRouter.delete('/bookings/:id', (req: Request, res: Response) => {
  try {
    return res.status(200).json(bookings.cancel(req.params.id));
  } catch {
    return res.status(404).json({ error: 'booking not found' });
  }
});
`;

const BOOKING_README = `# Booking / appointments

A real booking backend: a slot holds at most one **confirmed** booking (no double-booking), and cancelling
frees the slot. Files:

- \`bookingService.ts\` — the domain logic (\`BookingService\`, plus a \`bookings\` singleton). In-memory; swap the
  Map for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { bookingRouter } from './server/booking/routes';
app.use('/api', bookingRouter);
\`\`\`

Endpoints:
- \`POST /api/bookings\` \`{ slotId, customer }\` → 201 booking, or **409** if the slot is already booked.
- \`GET  /api/bookings\` (\`?status=confirmed|cancelled&slotId=&customer=\`) → the list.
- \`GET  /api/slots/:slotId/available\` → \`{ available: true|false }\`.
- \`DELETE /api/bookings/:id\` → cancels (frees the slot), 404 if unknown.

"Slots" (the bookable times) are defined by your app — generate them from your business hours / calendar and
book against their ids. Pairs with the OTP, payment and notification recipes for a full booking flow.
`;

export interface BookingConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Booking/appointment starter wired under server/booking/ (dependency-free domain logic + an Express router). ' +
  'The real guarantee is double-booking prevention: bookingService.ts holds at most one CONFIRMED booking per ' +
  'slot and cancelling frees it; routes.ts exposes POST /bookings (409 if the slot is taken), GET /bookings ' +
  '(filterable), GET /slots/:id/available and DELETE /bookings/:id. Mount with app.use("/api", bookingRouter). ' +
  'In-memory by default — swap the Map for your DB, same contracts. Slots are defined by your app; pairs with ' +
  'the OTP/payment/notification recipes for a full flow. No API key, no dependency (Express for the router).';

export function generateBookingIntegration(): BookingConfig {
  return {
    files: {
      'server/booking/bookingService.ts': BOOKING_SERVICE_SOURCE,
      'server/booking/routes.ts': BOOKING_ROUTES_SOURCE,
      'server/booking/README.md': BOOKING_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
