import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateCourierIntegration, COURIER_SERVICE_SOURCE } from './CourierGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateCourierIntegration (wiring)', () => {
  it('emits the courier service, routes and README + express dep', () => {
    const out = generateCourierIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/courier/courierService.ts');
    expect(paths).toContain('server/courier/routes.ts');
    expect(paths).toContain('server/courier/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/courier/routes.ts']).toContain('409');
    expect(out.files['server/courier/routes.ts']).toContain('export const courierRouter');
  });
});

// Materialize + execute the emitted domain logic — the state-machine, append-only history and unique
// tracking numbers are real invariants, verified against the actual emitted code.
describe('emitted CourierService — real domain invariants', () => {
  const artifact = join(here, `._courier_emitted_${process.pid}.ts`);
  writeFileSync(artifact, COURIER_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  type Status = 'created' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed_attempt' | 'returned' | 'cancelled';
  interface Shipment { id: string; trackingNo: string; status: Status; events: unknown[]; driverId?: string }
  interface Service {
    createShipment(d: { from: unknown; to: unknown }): Shipment;
    advanceStatus(id: string, to: Status, meta?: { location?: string }): Shipment;
    assignDriver(id: string, driverId: string): Shipment;
    getByTracking(t: string): Shipment | undefined;
    history(id: string): unknown[];
    list(f?: { status?: Status }): Shipment[];
  }
  interface Emitted { CourierService: new () => Service; canTransition(a: Status, b: Status): boolean }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }
  const addr = (name: string) => ({ name, line1: '1 St', city: 'Pune', pincode: '411001' });
  async function seed() {
    const { CourierService } = await load();
    const svc = new CourierService();
    const s = svc.createShipment({ from: addr('A'), to: addr('B') });
    return { svc, s };
  }

  it('canTransition encodes the allowed state-machine (delivered is terminal)', async () => {
    const { canTransition } = await load();
    expect(canTransition('created', 'picked_up')).toBe(true);
    expect(canTransition('out_for_delivery', 'delivered')).toBe(true);
    expect(canTransition('failed_attempt', 'out_for_delivery')).toBe(true);
    expect(canTransition('created', 'delivered')).toBe(false);   // no skipping
    expect(canTransition('delivered', 'in_transit')).toBe(false); // terminal
  });

  it('walks the happy path created→picked_up→in_transit→out_for_delivery→delivered', async () => {
    const { svc, s } = await seed();
    expect(s.status).toBe('created');
    expect(svc.advanceStatus(s.id, 'picked_up').status).toBe('picked_up');
    expect(svc.advanceStatus(s.id, 'in_transit').status).toBe('in_transit');
    expect(svc.advanceStatus(s.id, 'out_for_delivery').status).toBe('out_for_delivery');
    expect(svc.advanceStatus(s.id, 'delivered').status).toBe('delivered');
  });

  it('REJECTS an invalid transition (created → delivered) and a move out of a terminal state', async () => {
    const { svc, s } = await seed();
    expect(() => svc.advanceStatus(s.id, 'delivered')).toThrow(/Invalid shipment transition/);
    svc.advanceStatus(s.id, 'cancelled');
    expect(() => svc.advanceStatus(s.id, 'in_transit')).toThrow(/Invalid shipment transition/); // cancelled terminal
  });

  it('a failed_attempt loops back and can then be delivered', async () => {
    const { svc, s } = await seed();
    svc.advanceStatus(s.id, 'picked_up');
    svc.advanceStatus(s.id, 'in_transit');
    svc.advanceStatus(s.id, 'out_for_delivery');
    svc.advanceStatus(s.id, 'failed_attempt');
    expect(svc.advanceStatus(s.id, 'out_for_delivery').status).toBe('out_for_delivery');
    expect(svc.advanceStatus(s.id, 'delivered').status).toBe('delivered');
  });

  it('history is APPEND-ONLY (one event per status change, ordered)', async () => {
    const { svc, s } = await seed();
    svc.advanceStatus(s.id, 'picked_up', { location: 'Pune Hub' });
    svc.advanceStatus(s.id, 'in_transit', { location: 'Mumbai Hub' });
    const h = svc.history(s.id) as Array<{ status: Status }>;
    expect(h.map((e) => e.status)).toEqual(['created', 'picked_up', 'in_transit']);
    // a returned copy never mutates the internal log
    (svc.history(s.id) as unknown[]).pop();
    expect(svc.history(s.id).length).toBe(3);
  });

  it('tracking numbers are UNIQUE and looked up exactly', async () => {
    const { svc } = await seed();
    const a = svc.createShipment({ from: addr('A'), to: addr('B') });
    const b = svc.createShipment({ from: addr('C'), to: addr('D') });
    expect(a.trackingNo).not.toBe(b.trackingNo);
    expect(svc.getByTracking(a.trackingNo)?.id).toBe(a.id);
    expect(svc.getByTracking('NOPE')).toBeUndefined();
  });
});
