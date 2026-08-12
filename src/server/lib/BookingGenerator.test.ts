import { describe, it, expect, afterAll } from 'vitest';

import { generateBookingIntegration, BOOKING_SERVICE_SOURCE } from './BookingGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateBookingIntegration (wiring)', () => {
  it('emits the booking service, routes and README', () => {
    const out = generateBookingIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/booking/bookingService.ts');
    expect(paths).toContain('server/booking/routes.ts');
    expect(paths).toContain('server/booking/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    // routes surface the double-booking 409 + export the router
    expect(out.files['server/booking/routes.ts']).toContain('409');
    expect(out.files['server/booking/routes.ts']).toContain('export const bookingRouter');
  });
});

// Materialize + execute the emitted domain logic — the double-booking guarantee is a real business rule,
// so it is verified against the actual emitted code, not just asserted structurally.
describe('emitted BookingService — double-booking prevention (real logic)', () => {
  const emitted = emitModule('booking', BOOKING_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface Booking { id: string; slotId: string; customer: string; status: string }
  interface Service {
    isSlotAvailable(slotId: string): boolean;
    book(slotId: string, customer: string, now?: Date): Booking;
    cancel(id: string): Booking;
    get(id: string): Booking | undefined;
    list(filter?: { status?: string; slotId?: string; customer?: string }): Booking[];
  }
  interface Emitted { BookingService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('books an available slot and then REJECTS a second booking of the same slot', async () => {
    const { BookingService } = await load();
    const svc = new BookingService();
    expect(svc.isSlotAvailable('slot-1')).toBe(true);
    const b1 = svc.book('slot-1', 'Asha');
    expect(b1.status).toBe('confirmed');
    expect(svc.isSlotAvailable('slot-1')).toBe(false);
    expect(() => svc.book('slot-1', 'Ravi')).toThrow(/already booked/);
  });

  it('cancelling a booking FREES the slot for a new booking', async () => {
    const { BookingService } = await load();
    const svc = new BookingService();
    const b = svc.book('slot-2', 'Asha');
    svc.cancel(b.id);
    expect(svc.isSlotAvailable('slot-2')).toBe(true);
    const b2 = svc.book('slot-2', 'Ravi'); // now allowed
    expect(b2.status).toBe('confirmed');
    expect(b2.customer).toBe('Ravi');
  });

  it('validates input and unknown-cancel', async () => {
    const { BookingService } = await load();
    const svc = new BookingService();
    expect(() => svc.book('', 'Asha')).toThrow(/slotId is required/);
    expect(() => svc.book('slot-3', '')).toThrow(/customer is required/);
    expect(() => svc.cancel('nope')).toThrow(/not found/);
  });

  it('list filters by status / slot / customer', async () => {
    const { BookingService } = await load();
    const svc = new BookingService();
    const a = svc.book('slot-a', 'Asha');
    svc.book('slot-b', 'Ravi');
    svc.cancel(a.id);
    expect(svc.list({ status: 'confirmed' }).map((b) => b.slotId)).toEqual(['slot-b']);
    expect(svc.list({ status: 'cancelled' }).map((b) => b.slotId)).toEqual(['slot-a']);
    expect(svc.list({ customer: 'Ravi' }).length).toBe(1);
    expect(svc.list().length).toBe(2);
  });
});
