// Roadmap breadth — shopping-cart starter (a packaged domain vertical).
//
// The foundational ecommerce primitive: a per-user shopping cart. The real feature is CART INTEGRITY: adding the
// same product MERGES quantities into ONE line (never a duplicate line), a set-to-zero (or remove) drops the
// line, quantities can never go negative, and the cart total is ALWAYS the exact sum of (unitPrice × qty) over
// the lines — money is computed in integer minor units (paise/cents) so it never drifts on floating point.
// This emits a dependency-free CartService (no crypto/deps) + an Express router + a README. Real logic, not a
// stub — the merge + exact-total + non-negative rules are unit-tested against the emitted code.
// Pure builder → the caller writes the files. Distinct from generate_inventory (stock) and generate_payment (charge).

export const CART_SERVICE_SOURCE = `// Shopping-cart domain logic. The core guarantees: (1) adding the same product MERGES into one line (quantities
// add up — never a duplicate line), (2) removing / setting a line to 0 drops it and quantities never go negative,
// and (3) the cart total is ALWAYS the exact sum of (unitPrice × qty). Money is kept in INTEGER MINOR UNITS
// (paise / cents) so totals never drift on floating point. In-memory here; swap the Maps for your database,
// keeping the same method contracts.

export interface CartLine {
  productId: string;
  name: string;
  unitPriceMinor: number; // price per unit in minor units (paise / cents) — integer
  qty: number;            // always >= 1 for a stored line
}

export interface CartView {
  userId: string;
  lines: CartLine[];
  itemCount: number;      // total quantity across all lines
  totalMinor: number;     // exact sum of unitPriceMinor * qty
}

export class CartService {
  // userId -> (productId -> line)
  private carts = new Map<string, Map<string, CartLine>>();

  private lines(userId: string): Map<string, CartLine> {
    const key = String(userId ?? '').trim();
    if (!key) throw new Error('userId is required');
    let m = this.carts.get(key);
    if (!m) { m = new Map(); this.carts.set(key, m); }
    return m;
  }

  private static intQty(qty: unknown): number {
    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n)) throw new Error('qty must be a number');
    return n;
  }

  /**
   * Add a product to the cart. If the product is already in the cart the quantity is ADDED to the existing line
   * (merge — never a second line). qty defaults to 1; a qty <= 0 is rejected on add. Returns the merged line.
   */
  add(userId: string, item: { productId: string; name: string; unitPriceMinor: number }, qty: number = 1): CartLine {
    const productId = String(item?.productId ?? '').trim();
    if (!productId) throw new Error('productId is required');
    const price = Math.floor(Number(item?.unitPriceMinor));
    if (!Number.isFinite(price) || price < 0) throw new Error('unitPriceMinor must be a non-negative integer');
    const addQty = CartService.intQty(qty);
    if (addQty <= 0) throw new Error('qty to add must be at least 1');
    const m = this.lines(userId);
    const existing = m.get(productId);
    if (existing) {
      existing.qty += addQty;          // MERGE — no duplicate line
      existing.unitPriceMinor = price; // keep the latest known price
      existing.name = String(item.name ?? existing.name);
      return existing;
    }
    const line: CartLine = { productId, name: String(item?.name ?? productId), unitPriceMinor: price, qty: addQty };
    m.set(productId, line);
    return line;
  }

  /**
   * Set the ABSOLUTE quantity of a product. qty <= 0 removes the line. Quantities can never go negative.
   * Returns the line, or null if it was removed / never existed.
   */
  setQty(userId: string, productId: string, qty: number): CartLine | null {
    const m = this.lines(userId);
    const id = String(productId ?? '').trim();
    const line = m.get(id);
    const next = CartService.intQty(qty);
    if (next <= 0) { m.delete(id); return null; } // remove on zero/negative — never store a negative qty
    if (!line) throw new Error('product not in cart');
    line.qty = next;
    return line;
  }

  /** Remove a product from the cart. Returns true if a line was removed. */
  remove(userId: string, productId: string): boolean {
    return this.lines(userId).delete(String(productId ?? '').trim());
  }

  /** Empty the whole cart. */
  clear(userId: string): void {
    this.lines(userId).clear();
  }

  /** The cart with lines, item count, and the EXACT total (sum of unitPriceMinor * qty). */
  view(userId: string): CartView {
    const key = String(userId ?? '').trim();
    const m = this.lines(key);
    const lines = [...m.values()].map((l) => ({ ...l }));
    let itemCount = 0;
    let totalMinor = 0;
    for (const l of lines) {
      itemCount += l.qty;
      totalMinor += l.unitPriceMinor * l.qty;
    }
    return { userId: key, lines, itemCount, totalMinor };
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const carts = new CartService();
`;

export const CART_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { carts } from './cartService';

// REST endpoints for the shopping cart. Mount with: app.use('/api/cart', cartRouter).
// In production take the userId from the auth session, not the URL/body.
export const cartRouter = Router();

// The current cart with its exact total.
cartRouter.get('/:userId', (req: Request, res: Response) => {
  try {
    return res.status(200).json(carts.view(req.params.userId));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Add a product (merges quantity if already present). { productId, name, unitPriceMinor, qty? }.
cartRouter.post('/:userId/items', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { productId?: unknown; name?: unknown; unitPriceMinor?: unknown; qty?: unknown };
  try {
    carts.add(
      req.params.userId,
      { productId: String(body.productId ?? ''), name: String(body.name ?? ''), unitPriceMinor: Number(body.unitPriceMinor) },
      body.qty === undefined ? 1 : Number(body.qty),
    );
    return res.status(201).json(carts.view(req.params.userId));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Set the absolute quantity of a line (0 removes it). { qty }.
cartRouter.patch('/:userId/items/:productId', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { qty?: unknown };
  try {
    carts.setQty(req.params.userId, req.params.productId, Number(body.qty));
    return res.status(200).json(carts.view(req.params.userId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'product not in cart' ? 404 : 400).json({ error: message });
  }
});

// Remove a line.
cartRouter.delete('/:userId/items/:productId', (req: Request, res: Response) => {
  if (!carts.remove(req.params.userId, req.params.productId)) return res.status(404).json({ error: 'product not in cart' });
  return res.status(200).json(carts.view(req.params.userId));
});

// Empty the cart.
cartRouter.delete('/:userId', (req: Request, res: Response) => {
  carts.clear(req.params.userId);
  return res.status(200).json(carts.view(req.params.userId));
});
`;

const CART_README = `# Shopping cart

A real per-user shopping-cart backend — the foundational ecommerce primitive. The core guarantees: adding the
same product **merges quantities** into one line (never a duplicate line), setting a line to 0 (or removing it)
drops it, quantities **never go negative**, and the cart total is **always the exact sum** of
\`unitPriceMinor × qty\`. Money is kept in **integer minor units** (paise / cents) so totals never drift on
floating point. Files:

- \`cartService.ts\` — the domain logic (\`CartService\` + a \`carts\` singleton). Dependency-free. In-memory;
  swap the Maps for your DB.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { cartRouter } from './server/cart/routes';
app.use('/api/cart', cartRouter);
\`\`\`

Endpoints (take the userId from the auth session in production, not the URL):
- \`GET    /api/cart/:userId\` → the cart + \`{ itemCount, totalMinor }\`.
- \`POST   /api/cart/:userId/items\` \`{ productId, name, unitPriceMinor, qty? }\` → add (merges if present).
- \`PATCH  /api/cart/:userId/items/:productId\` \`{ qty }\` → set absolute quantity (**404** if not in cart; 0 removes).
- \`DELETE /api/cart/:userId/items/:productId\` → remove a line (**404** if not present).
- \`DELETE /api/cart/:userId\` → empty the cart.

Pairs with \`generate_inventory\` (stock reservation at checkout), \`generate_coupons\` (discounts) and
\`generate_payment\` (charge the \`totalMinor\`).
`;

export interface CartConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Shopping-cart starter wired under server/cart/ (dependency-free domain logic + an Express router). The real ' +
  'guarantee is CART INTEGRITY: add() MERGES the same product into ONE line (quantities add up — never a ' +
  'duplicate line) and keeps the latest price; setQty() sets the absolute quantity and a qty <= 0 REMOVES the ' +
  'line so a quantity can never go negative; view() returns the lines plus itemCount and an EXACT totalMinor = ' +
  'sum of unitPriceMinor × qty. Money is in INTEGER MINOR UNITS (paise/cents) so totals never drift on floating ' +
  'point. routes.ts exposes GET /api/cart/:userId, POST /api/cart/:userId/items ({productId,name,unitPriceMinor,' +
  'qty?}), PATCH /api/cart/:userId/items/:productId ({qty}, 404 if not in cart), DELETE ' +
  '/api/cart/:userId/items/:productId and DELETE /api/cart/:userId (empty). Mount at app.use("/api/cart", ' +
  'cartRouter); take userId from the auth session in production. Pairs with generate_inventory, generate_coupons ' +
  'and generate_payment. In-memory by default — swap the Maps for your DB.';

export function generateCartIntegration(): CartConfig {
  return {
    files: {
      'server/cart/cartService.ts': CART_SERVICE_SOURCE,
      'server/cart/routes.ts': CART_ROUTES_SOURCE,
      'server/cart/README.md': CART_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
