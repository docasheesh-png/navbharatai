// Roadmap breadth — inventory / stock management starter (a packaged domain vertical).
//
// A high-demand vertical for NavBharatAI's retail/e-commerce market. The real feature is NO OVERSELLING:
// reserving stock can never drive available quantity below zero, even across concurrent orders. This emits a
// self-contained, dependency-free InventoryService (in-memory, swap the store for your DB) + an Express
// router + a README. Real business logic, not a stub — the no-oversell guarantee is unit-tested against the
// emitted code. Pure builder → the caller writes the files.

export const INVENTORY_SERVICE_SOURCE = `// Inventory domain logic. The core guarantee: you can never reserve more than is on hand (NO OVERSELLING) —
// reserve() rejects when stock is insufficient and never lets available go negative. release() puts stock
// back (order cancelled / returned). In-memory here; swap the Map for your database, keeping the contracts.

export interface StockItem {
  sku: string;
  quantity: number;
}

export class InventoryService {
  private stock = new Map<string, number>();

  /** Set the absolute on-hand quantity for a SKU (e.g. after a stock count). Negative is clamped to 0. */
  setStock(sku: string, quantity: number): void {
    const s = String(sku).trim();
    if (!s) throw new Error('sku is required');
    this.stock.set(s, Math.max(0, Math.floor(Number(quantity) || 0)));
  }

  /** On-hand quantity for a SKU (0 if unknown). */
  getStock(sku: string): number {
    return this.stock.get(String(sku).trim()) ?? 0;
  }

  /** Add stock (a delivery / a return). Returns the new quantity. */
  restock(sku: string, quantity: number): number {
    const s = String(sku).trim();
    if (!s) throw new Error('sku is required');
    const qty = Math.floor(Number(quantity) || 0);
    if (qty <= 0) throw new Error('quantity must be positive');
    const next = this.getStock(s) + qty;
    this.stock.set(s, next);
    return next;
  }

  /** Reserve stock for an order. Throws if there isn't enough — NEVER oversells. Returns the remaining qty. */
  reserve(sku: string, quantity: number): number {
    const s = String(sku).trim();
    if (!s) throw new Error('sku is required');
    const qty = Math.floor(Number(quantity) || 0);
    if (qty <= 0) throw new Error('quantity must be positive');
    const have = this.getStock(s);
    if (qty > have) throw new Error('insufficient stock');
    const next = have - qty;
    this.stock.set(s, next);
    return next;
  }

  /** Release previously-reserved stock back to on-hand (order cancelled). Returns the new quantity. */
  release(sku: string, quantity: number): number {
    return this.restock(sku, quantity);
  }

  /** Is this SKU at or below its low-stock threshold (reorder point)? */
  isLowStock(sku: string, threshold: number): boolean {
    return this.getStock(sku) <= Math.max(0, Math.floor(Number(threshold) || 0));
  }

  /** All known SKUs and quantities. */
  list(): StockItem[] {
    return [...this.stock.entries()].map(([sku, quantity]) => ({ sku, quantity }));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const inventory = new InventoryService();
`;

export const INVENTORY_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { inventory } from './inventoryService';

// REST endpoints for the inventory service. Mount with: app.use('/api', inventoryRouter).
export const inventoryRouter = Router();

// List all stock.
inventoryRouter.get('/stock', (_req: Request, res: Response) => {
  return res.status(200).json(inventory.list());
});

// Get one SKU's quantity.
inventoryRouter.get('/stock/:sku', (req: Request, res: Response) => {
  return res.status(200).json({ sku: req.params.sku, quantity: inventory.getStock(req.params.sku) });
});

// Set / restock. { quantity, mode?: 'set' | 'restock' } (default 'set').
inventoryRouter.put('/stock/:sku', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { quantity?: unknown; mode?: unknown };
  const quantity = Number(body.quantity);
  try {
    if (body.mode === 'restock') {
      const next = inventory.restock(req.params.sku, quantity);
      return res.status(200).json({ sku: req.params.sku, quantity: next });
    }
    inventory.setStock(req.params.sku, quantity);
    return res.status(200).json({ sku: req.params.sku, quantity: inventory.getStock(req.params.sku) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Reserve stock for an order. 409 if there isn't enough (no overselling).
inventoryRouter.post('/stock/:sku/reserve', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { quantity?: unknown };
  try {
    const remaining = inventory.reserve(req.params.sku, Number(body.quantity));
    return res.status(200).json({ sku: req.params.sku, reserved: Number(body.quantity), remaining });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not reserve';
    const status = message === 'insufficient stock' ? 409 : 400;
    return res.status(status).json({ error: message });
  }
});

// Release reserved stock back (order cancelled / returned).
inventoryRouter.post('/stock/:sku/release', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { quantity?: unknown };
  try {
    const quantity = inventory.release(req.params.sku, Number(body.quantity));
    return res.status(200).json({ sku: req.params.sku, quantity });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});
`;

const INVENTORY_README = `# Inventory / stock management

A real inventory backend. The core guarantee: **no overselling** — \`reserve()\` rejects when stock is
insufficient and never lets on-hand go negative. Files:

- \`inventoryService.ts\` — the domain logic (\`InventoryService\` + an \`inventory\` singleton). In-memory; swap the
  Map for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { inventoryRouter } from './server/inventory/routes';
app.use('/api', inventoryRouter);
\`\`\`

Endpoints:
- \`GET  /api/stock\` → all SKUs + quantities.
- \`GET  /api/stock/:sku\` → one SKU's quantity.
- \`PUT  /api/stock/:sku\` \`{ quantity, mode?: 'set' | 'restock' }\` → set an absolute count or add stock.
- \`POST /api/stock/:sku/reserve\` \`{ quantity }\` → reserve for an order, **409** if insufficient.
- \`POST /api/stock/:sku/release\` \`{ quantity }\` → put reserved stock back (cancel / return).

Use \`isLowStock(sku, threshold)\` to drive reorder alerts. Pairs with the payment, notification and audit-log
recipes for a full order flow.
`;

export interface InventoryConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Inventory/stock starter wired under server/inventory/ (dependency-free domain logic + an Express router). ' +
  'The real guarantee is NO OVERSELLING: inventoryService.ts reserve() rejects when stock is insufficient and ' +
  'never lets on-hand go negative; restock()/release() add stock back; isLowStock() drives reorder alerts. ' +
  'routes.ts exposes GET /stock, GET/PUT /stock/:sku, POST /stock/:sku/reserve (409 if insufficient) and ' +
  '/release. Mount with app.use("/api", inventoryRouter). In-memory by default — swap the Map for your DB, same ' +
  'contracts. Pairs with the payment/notification/audit recipes for a full order flow. No API key.';

export function generateInventoryIntegration(): InventoryConfig {
  return {
    files: {
      'server/inventory/inventoryService.ts': INVENTORY_SERVICE_SOURCE,
      'server/inventory/routes.ts': INVENTORY_ROUTES_SOURCE,
      'server/inventory/README.md': INVENTORY_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
