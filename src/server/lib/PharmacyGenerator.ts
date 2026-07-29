// Pharmacy domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the established recipe pattern. Distinct real guarantees (NOT overlapping the inventory recipe's
// no-overselling): the value here is pharmacy-specific safety —
//   1. EXPIRY GATE: a batch cannot be dispensed once it is past its expiry date (date-deterministic).
//   2. FEFO DISPENSING: dispensing draws from the EARLIEST-expiry non-expired batch first (First-Expiry-
//      First-Out), and never oversells across batches.
//   3. CONTROLLED-SUBSTANCE Rx: a prescription-only (Schedule-H) drug cannot be dispensed without a
//      prescription id.
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const PHARMACY_SERVICE_SOURCE = `// Pharmacy domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) An EXPIRED batch can never be dispensed (date gate).
//  2) Dispensing is FEFO (earliest-expiry first) and never oversells.
//  3) A prescription-only drug needs a prescription id to dispense.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.
// Date-sensitive methods take an explicit 'now' for deterministic, testable behaviour (default Date.now()).

export interface Drug {
  id: string;
  name: string;
  form?: string;          // tablet / syrup / injection
  prescriptionOnly: boolean; // Schedule-H / controlled — needs an Rx
}

export interface Batch {
  id: string;
  drugId: string;
  batchNo: string;
  quantity: number;       // units on hand in this batch
  expiryAt: number;       // epoch ms — batch is unusable AT/after this instant
  addedAt: number;
}

export interface Dispense {
  id: string;
  drugId: string;
  quantity: number;
  prescriptionId: string | null;
  batchIds: string[];     // which batches the units came from (FEFO order)
  at: number;
}

export class ExpiredStockError extends Error {
  constructor() { super('No non-expired stock available to dispense'); this.name = 'ExpiredStockError'; }
}
export class InsufficientStockError extends Error {
  constructor(available: number, requested: number) {
    super(\`Insufficient non-expired stock: \${available} available, \${requested} requested\`);
    this.name = 'InsufficientStockError';
  }
}
export class PrescriptionRequiredError extends Error {
  constructor(drugName: string) { super(\`"\${drugName}" is prescription-only — a prescription id is required to dispense it\`); this.name = 'PrescriptionRequiredError'; }
}

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;

export class PharmacyService {
  private drugs = new Map<string, Drug>();
  private batches = new Map<string, Batch>();
  private dispenses: Dispense[] = [];

  addDrug(data: { name: string; form?: string; prescriptionOnly?: boolean }): Drug {
    if (!data.name?.trim()) throw new Error('Drug name is required');
    const drug: Drug = { id: nextId('drg'), name: data.name.trim(), form: data.form, prescriptionOnly: data.prescriptionOnly === true };
    this.drugs.set(drug.id, drug);
    return drug;
  }

  addBatch(data: { drugId: string; batchNo: string; quantity: number; expiryAt: number }): Batch {
    if (!this.drugs.has(data.drugId)) throw new Error(\`Unknown drug \${data.drugId}\`);
    if (!(data.quantity > 0)) throw new Error('Batch quantity must be > 0');
    const batch: Batch = { id: nextId('bat'), drugId: data.drugId, batchNo: data.batchNo, quantity: data.quantity, expiryAt: data.expiryAt, addedAt: Date.now() };
    this.batches.set(batch.id, batch);
    return batch;
  }

  /** Non-expired batches for a drug, ordered EARLIEST-expiry first (FEFO). */
  private usableBatches(drugId: string, now: number): Batch[] {
    return [...this.batches.values()]
      .filter((b) => b.drugId === drugId && b.quantity > 0 && b.expiryAt > now)
      .sort((a, b) => a.expiryAt - b.expiryAt);
  }

  /** Total non-expired units on hand for a drug. */
  availableStock(drugId: string, now: number = Date.now()): number {
    return this.usableBatches(drugId, now).reduce((s, b) => s + b.quantity, 0);
  }

  /**
   * Dispense units of a drug: FEFO across non-expired batches, blocking on expiry, insufficient stock, or a
   * missing prescription for a prescription-only drug. Deterministic with an explicit 'now'.
   */
  dispense(data: { drugId: string; quantity: number; prescriptionId?: string | null }, now: number = Date.now()): Dispense {
    const drug = this.drugs.get(data.drugId);
    if (!drug) throw new Error(\`Unknown drug \${data.drugId}\`);
    if (!(data.quantity > 0)) throw new Error('Dispense quantity must be > 0');
    if (drug.prescriptionOnly && !data.prescriptionId) throw new PrescriptionRequiredError(drug.name);

    const usable = this.usableBatches(data.drugId, now);
    if (usable.length === 0) throw new ExpiredStockError();
    const available = usable.reduce((s, b) => s + b.quantity, 0);
    if (available < data.quantity) throw new InsufficientStockError(available, data.quantity);

    // Draw FEFO, decrementing each batch until the quantity is satisfied.
    let remaining = data.quantity;
    const batchIds: string[] = [];
    for (const b of usable) {
      if (remaining <= 0) break;
      const take = Math.min(b.quantity, remaining);
      b.quantity -= take;
      remaining -= take;
      batchIds.push(b.id);
    }
    const record: Dispense = {
      id: nextId('dsp'), drugId: data.drugId, quantity: data.quantity,
      prescriptionId: data.prescriptionId ?? null, batchIds, at: now,
    };
    this.dispenses.push(record);
    return record;
  }

  /** Batches expiring at/before a cutoff (for a "remove expired stock" workflow). */
  expiringBefore(cutoff: number): Batch[] {
    return [...this.batches.values()].filter((b) => b.expiryAt <= cutoff).sort((a, b) => a.expiryAt - b.expiryAt);
  }

  getDrug(id: string): Drug | undefined { return this.drugs.get(id); }
  listDrugs(): Drug[] { return [...this.drugs.values()]; }
  dispenseHistory(drugId?: string): Dispense[] {
    return this.dispenses.filter((d) => !drugId || d.drugId === drugId);
  }
}

export const pharmacy = new PharmacyService();
`;

export const PHARMACY_ROUTES_SOURCE = `import { Router } from 'express';
import { pharmacy, ExpiredStockError, InsufficientStockError, PrescriptionRequiredError } from './pharmacyService';

export const pharmacyRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    const out = fn();
    if (out === undefined) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(out);
  } catch (e) {
    if (e instanceof PrescriptionRequiredError) { res.status(403).json({ error: e.message }); return; }
    if (e instanceof ExpiredStockError || e instanceof InsufficientStockError) { res.status(409).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

pharmacyRouter.get('/drugs', (_req, res) => handle(res, () => pharmacy.listDrugs()));
pharmacyRouter.post('/drugs', (req, res) => handle(res, () => pharmacy.addDrug(req.body)));
pharmacyRouter.post('/batches', (req, res) => handle(res, () => pharmacy.addBatch(req.body)));
pharmacyRouter.get('/drugs/:id/stock', (req, res) => handle(res, () => ({ available: pharmacy.availableStock(req.params.id) })));
pharmacyRouter.post('/dispense', (req, res) => handle(res, () =>
  pharmacy.dispense({ drugId: req.body?.drugId, quantity: Number(req.body?.quantity), prescriptionId: req.body?.prescriptionId }))); // 403 no-Rx, 409 expired/insufficient
pharmacyRouter.get('/dispense/history', (req, res) => handle(res, () => pharmacy.dispenseHistory(req.query.drugId as string | undefined)));
`;

export const PHARMACY_README = `# Pharmacy starter

A dependency-free pharmacy backend under \`server/pharmacy/\`, wired for Express.

## Real guarantees (not a stub)
- **Expiry gate** — a batch cannot be dispensed once it is at/past its expiry date; if all stock is expired
  a dispense is rejected (**409**).
- **FEFO dispensing** — dispensing draws from the **earliest-expiry** non-expired batch first
  (First-Expiry-First-Out) and never oversells across batches (**409** on insufficient non-expired stock).
- **Controlled-substance Rx** — a prescription-only (Schedule-H) drug cannot be dispensed without a
  prescription id (**403**).

## Endpoints (mount with \`app.use("/api", pharmacyRouter)\`)
- \`GET/POST /drugs\`, \`POST /batches\`, \`GET /drugs/:id/stock\`
- \`POST /dispense\` (**403** if Rx required + missing, **409** if expired/insufficient), \`GET /dispense/history\`

In-memory by default; swap the Maps in \`pharmacyService.ts\` for your DB. Pairs with the auth/inventory/notification recipes.
`;

export interface PharmacyConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Pharmacy starter wired under server/pharmacy/ (dependency-free domain logic + an Express router). Three ' +
  'real guarantees: (1) EXPIRY GATE — an expired batch can never be dispensed (409 if all stock expired); ' +
  '(2) FEFO DISPENSING — draws from the earliest-expiry non-expired batch first and never oversells (409 on ' +
  'insufficient non-expired stock); (3) CONTROLLED-SUBSTANCE — a prescription-only drug needs a prescription ' +
  'id to dispense (403 otherwise). Endpoints: GET/POST /drugs, POST /batches, GET /drugs/:id/stock, POST ' +
  '/dispense, GET /dispense/history. Mount with app.use("/api", pharmacyRouter). In-memory by default — swap ' +
  'the Maps for your DB, same contracts. Pairs with the auth/inventory/notification recipes. No key.';

export function generatePharmacyIntegration(): PharmacyConfig {
  return {
    files: {
      'server/pharmacy/pharmacyService.ts': PHARMACY_SERVICE_SOURCE,
      'server/pharmacy/routes.ts': PHARMACY_ROUTES_SOURCE,
      'server/pharmacy/README.md': PHARMACY_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
