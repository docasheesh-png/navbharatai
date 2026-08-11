import { describe, it, expect, afterAll } from 'vitest';

import { generatePharmacyIntegration, PHARMACY_SERVICE_SOURCE } from './PharmacyGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generatePharmacyIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generatePharmacyIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/pharmacy/pharmacyService.ts');
    expect(paths).toContain('server/pharmacy/routes.ts');
    expect(paths).toContain('server/pharmacy/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/pharmacy/routes.ts']).toContain('403'); // Rx gate
    expect(out.files['server/pharmacy/routes.ts']).toContain('409'); // expiry / stock
    expect(out.files['server/pharmacy/routes.ts']).toContain('export const pharmacyRouter');
  });
});

describe('emitted PharmacyService — expiry gate + FEFO + controlled-substance', () => {
  const emitted = emitModule('pharmacy', PHARMACY_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2024, 5, 1);

  interface Drug { id: string }
  interface Batch { id: string }
  interface Service {
    addDrug(d: { name: string; prescriptionOnly?: boolean }): Drug;
    addBatch(d: { drugId: string; batchNo: string; quantity: number; expiryAt: number }): Batch;
    availableStock(drugId: string, now?: number): number;
    dispense(d: { drugId: string; quantity: number; prescriptionId?: string | null }, now?: number): { batchIds: string[]; prescriptionId: string | null };
    dispenseHistory(drugId?: string): unknown[];
  }
  interface Emitted { PharmacyService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('availableStock counts only NON-EXPIRED batches', async () => {
    const { PharmacyService } = await load();
    const svc = new PharmacyService();
    const d = svc.addDrug({ name: 'Paracetamol' });
    svc.addBatch({ drugId: d.id, batchNo: 'A', quantity: 100, expiryAt: NOW + 30 * DAY });
    svc.addBatch({ drugId: d.id, batchNo: 'B', quantity: 50, expiryAt: NOW - 1 * DAY }); // already expired
    expect(svc.availableStock(d.id, NOW)).toBe(100); // the expired 50 is excluded
  });

  it('EXPIRY GATE: dispensing with only expired stock is rejected (409-class)', async () => {
    const { PharmacyService } = await load();
    const svc = new PharmacyService();
    const d = svc.addDrug({ name: 'Amoxicillin' });
    svc.addBatch({ drugId: d.id, batchNo: 'X', quantity: 20, expiryAt: NOW - 1 * DAY });
    expect(() => svc.dispense({ drugId: d.id, quantity: 5 }, NOW)).toThrow(/non-expired stock/);
  });

  it('FEFO: dispensing draws from the EARLIEST-expiry batch first, then the next', async () => {
    const { PharmacyService } = await load();
    const svc = new PharmacyService();
    const d = svc.addDrug({ name: 'Vitamin C' });
    const near = svc.addBatch({ drugId: d.id, batchNo: 'NEAR', quantity: 10, expiryAt: NOW + 10 * DAY });
    const far = svc.addBatch({ drugId: d.id, batchNo: 'FAR', quantity: 10, expiryAt: NOW + 60 * DAY });
    // request 15 → 10 from NEAR (earliest) + 5 from FAR
    const r = svc.dispense({ drugId: d.id, quantity: 15 }, NOW);
    expect(r.batchIds).toEqual([near.id, far.id]);
    expect(svc.availableStock(d.id, NOW)).toBe(5); // 20 − 15
  });

  it('never oversells across non-expired batches (409-class)', async () => {
    const { PharmacyService } = await load();
    const svc = new PharmacyService();
    const d = svc.addDrug({ name: 'Cetirizine' });
    svc.addBatch({ drugId: d.id, batchNo: 'A', quantity: 3, expiryAt: NOW + 30 * DAY });
    expect(() => svc.dispense({ drugId: d.id, quantity: 5 }, NOW)).toThrow(/Insufficient non-expired stock/);
  });

  it('CONTROLLED-SUBSTANCE: a prescription-only drug needs a prescription id (403-class)', async () => {
    const { PharmacyService } = await load();
    const svc = new PharmacyService();
    const d = svc.addDrug({ name: 'Alprazolam', prescriptionOnly: true });
    svc.addBatch({ drugId: d.id, batchNo: 'A', quantity: 10, expiryAt: NOW + 30 * DAY });
    expect(() => svc.dispense({ drugId: d.id, quantity: 1 }, NOW)).toThrow(/prescription-only/);
    // with an Rx id it dispenses
    const r = svc.dispense({ drugId: d.id, quantity: 1, prescriptionId: 'RX-123' }, NOW);
    expect(r.prescriptionId).toBe('RX-123');
  });

  it('an OTC drug dispenses without a prescription', async () => {
    const { PharmacyService } = await load();
    const svc = new PharmacyService();
    const d = svc.addDrug({ name: 'ORS' }); // not prescriptionOnly
    svc.addBatch({ drugId: d.id, batchNo: 'A', quantity: 10, expiryAt: NOW + 30 * DAY });
    expect(svc.dispense({ drugId: d.id, quantity: 2 }, NOW).prescriptionId).toBeNull();
    expect(svc.dispenseHistory(d.id).length).toBe(1);
  });
});
