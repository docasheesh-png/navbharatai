import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateEventsIntegration, EVENT_SERVICE_SOURCE } from './EventsGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateEventsIntegration (wiring)', () => {
  it('emits the event service, routes and README', () => {
    const out = generateEventsIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/events/eventService.ts');
    expect(paths).toContain('server/events/routes.ts');
    expect(paths).toContain('server/events/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/events/routes.ts']).toContain('export const eventRouter');
    expect(out.files['server/events/routes.ts']).toContain('409');
  });
});

// Materialize + execute the emitted domain logic — capacity enforcement + waitlist promotion are real
// business rules, verified against the actual emitted code.
describe('emitted EventService — capacity + waitlist (real logic)', () => {
  const artifact = join(here, `._events_emitted_${process.pid}.ts`);
  writeFileSync(artifact, EVENT_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface EventItem { id: string; capacity: number }
  interface Rsvp { id: string; attendee: string; status: string }
  interface Service {
    createEvent(i: { title: string; capacity: number; startsAt?: string }): EventItem;
    rsvp(eventId: string, attendee: string): Rsvp;
    cancelRsvp(rsvpId: string): { cancelled: Rsvp; promoted: Rsvp | null };
    attendees(eventId: string, status?: string): Rsvp[];
    seatsLeft(eventId: string): number;
  }
  interface Emitted { EventService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('confirms up to capacity, then WAITLISTS overflow (never overbooks)', async () => {
    const { EventService } = await load();
    const svc = new EventService();
    const e = svc.createEvent({ title: 'Workshop', capacity: 2 });
    expect(svc.rsvp(e.id, 'Asha').status).toBe('confirmed');
    expect(svc.rsvp(e.id, 'Ravi').status).toBe('confirmed');
    expect(svc.seatsLeft(e.id)).toBe(0);
    expect(svc.rsvp(e.id, 'Meera').status).toBe('waitlist'); // capacity full → waitlist
    expect(svc.attendees(e.id, 'confirmed').length).toBe(2);
    expect(svc.attendees(e.id, 'waitlist').length).toBe(1);
  });

  it('cancelling a confirmed seat PROMOTES the first waitlisted attendee (FIFO)', async () => {
    const { EventService } = await load();
    const svc = new EventService();
    const e = svc.createEvent({ title: 'Meetup', capacity: 1 });
    const a = svc.rsvp(e.id, 'Asha');   // confirmed
    svc.rsvp(e.id, 'Ravi');             // waitlist
    svc.rsvp(e.id, 'Meera');            // waitlist
    const { promoted } = svc.cancelRsvp(a.id);
    expect(promoted?.attendee).toBe('Ravi'); // first waitlisted promoted
    expect(svc.attendees(e.id, 'confirmed').map((r) => r.attendee)).toEqual(['Ravi']);
    expect(svc.attendees(e.id, 'waitlist').map((r) => r.attendee)).toEqual(['Meera']);
  });

  it('cancelling a WAITLIST seat does not promote anyone', async () => {
    const { EventService } = await load();
    const svc = new EventService();
    const e = svc.createEvent({ title: 'x', capacity: 1 });
    svc.rsvp(e.id, 'Asha');           // confirmed
    const w = svc.rsvp(e.id, 'Ravi'); // waitlist
    const { promoted } = svc.cancelRsvp(w.id);
    expect(promoted).toBeNull();
    expect(svc.attendees(e.id, 'confirmed').length).toBe(1);
  });

  it('validates input and rejects a duplicate RSVP', async () => {
    const { EventService } = await load();
    const svc = new EventService();
    expect(() => svc.createEvent({ title: '', capacity: 5 })).toThrow(/title is required/);
    expect(() => svc.createEvent({ title: 'x', capacity: 0 })).toThrow(/capacity must be a positive number/);
    const e = svc.createEvent({ title: 'x', capacity: 5 });
    expect(() => svc.rsvp('nope', 'Asha')).toThrow(/event not found/);
    svc.rsvp(e.id, 'Asha');
    expect(() => svc.rsvp(e.id, 'Asha')).toThrow(/already rsvped/);
  });
});
