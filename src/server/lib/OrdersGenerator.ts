// Roadmap breadth — orders starter (a packaged domain vertical).
//
// The ecommerce order-lifecycle primitive (checkout → fulfillment). The real feature is ORDER IMMUTABILITY +
// a STATUS STATE-MACHINE: when an order is placed it captures an IMMUTABLE SNAPSHOT of its line items and total
// (a later catalog price change can NEVER alter a placed order's total), and it then moves
// placed → paid → shipped → delivered along allowed transitions only, with cancel allowed until it ships
// (a delivered/shipped order can no longer be cancelled). The order total is the EXACT sum of the snapshot
// line subtotals in integer minor units. This emits a dependency-free OrderService (no crypto/deps) + an
// Express router + a README. Real logic, not a stub — the immutable-total + state-machine rules are unit-tested
// against the emitted code. Pure builder → the caller writes the files. Distinct from generate_cart (pre-checkout,
// mutable) and generate_payment (the charge itself).

export const ORDERS_SERVICE_SOURCE = `// Order-lifecycle domain logic. The core guarantees: (1) placing an order captures an IMMUTABLE SNAPSHOT of its
// line items + total — later price changes cannot alter a placed order; (2) the total is the EXACT sum of the
// snapshot line subtotals in INTEGER MINOR UNITS (paise/cents), so money never drifts; and (3) status moves
// placed → paid → shipped → delivered along allowed transitions only, with cancel permitted until it ships.
// In-memory here; swap the Map for your database, keeping the same method contracts.

export interface OrderItem {
  productId: string;
  name: string;
  unitPriceMinor: number; // integer minor units, frozen at placement
  qty: number;
  subtotalMinor: number;  // unitPriceMinor * qty, frozen at placement
}

export type OrderStatus = 'placed' | 'paid' | 'shipped' | 'delivered' | 'cancelled';

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];   // immutable snapshot
  totalMinor: number;   // immutable total = sum of subtotals
  status: OrderStatus;
  placedAt: string;
  updatedAt: string;
  history: Array<{ status: OrderStatus; at: string }>;
}

// Allowed forward transitions. 'cancelled' is handled separately (allowed only before shipping).
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  placed: ['paid'],
  paid: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

let counter = 0;
function nextId(now: Date): string {
  counter += 1;
  return 'ord_' + now.getTime().toString(36) + '_' + counter.toString(36);
}

export class OrderService {
  private orders = new Map<string, Order>();

  /**
   * Place an order from a list of line items. Captures an IMMUTABLE SNAPSHOT: each item's unit price and
   * subtotal are frozen now, and the order total is the EXACT sum of subtotals. Rejects an empty order.
   */
  place(userId: string, items: Array<{ productId: string; name?: string; unitPriceMinor: number; qty: number }>, now: Date = new Date()): Order {
    const user = String(userId ?? '').trim();
    if (!user) throw new Error('userId is required');
    if (!Array.isArray(items) || items.length === 0) throw new Error('an order needs at least one item');
    const snapshot: OrderItem[] = items.map((raw) => {
      const productId = String(raw?.productId ?? '').trim();
      if (!productId) throw new Error('each item needs a productId');
      const unit = Math.floor(Number(raw?.unitPriceMinor));
      if (!Number.isFinite(unit) || unit < 0) throw new Error('unitPriceMinor must be a non-negative integer');
      const qty = Math.floor(Number(raw?.qty));
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('qty must be at least 1');
      return { productId, name: String(raw?.name ?? productId), unitPriceMinor: unit, qty, subtotalMinor: unit * qty };
    });
    const totalMinor = snapshot.reduce((s, it) => s + it.subtotalMinor, 0);
    const iso = now.toISOString();
    const order: Order = {
      id: nextId(now),
      userId: user,
      items: snapshot,
      totalMinor,
      status: 'placed',
      placedAt: iso,
      updatedAt: iso,
      history: [{ status: 'placed', at: iso }],
    };
    this.orders.set(order.id, order);
    // Return a deep-ish copy so callers cannot mutate the stored snapshot.
    return this.get(order.id) as Order;
  }

  get(id: string): Order | undefined {
    const o = this.orders.get(String(id ?? '').trim());
    if (!o) return undefined;
    return { ...o, items: o.items.map((i) => ({ ...i })), history: o.history.map((h) => ({ ...h })) };
  }

  /** Advance the status along the allowed machine. Throws (→ 409 at the route) on an illegal transition. */
  transition(id: string, to: OrderStatus, now: Date = new Date()): Order {
    const order = this.orders.get(String(id ?? '').trim());
    if (!order) throw new Error('order not found');
    if (!NEXT[order.status].includes(to)) {
      throw new Error('illegal transition: ' + order.status + ' -> ' + to);
    }
    order.status = to;
    order.updatedAt = now.toISOString();
    order.history.push({ status: to, at: order.updatedAt });
    return this.get(id) as Order;
  }

  /** Cancel an order — allowed only BEFORE it ships (placed or paid). A shipped/delivered order cannot cancel. */
  cancel(id: string, now: Date = new Date()): Order {
    const order = this.orders.get(String(id ?? '').trim());
    if (!order) throw new Error('order not found');
    if (order.status !== 'placed' && order.status !== 'paid') {
      throw new Error('cannot cancel an order that is ' + order.status);
    }
    order.status = 'cancelled';
    order.updatedAt = now.toISOString();
    order.history.push({ status: 'cancelled', at: order.updatedAt });
    return this.get(id) as Order;
  }

  /** A user's orders, newest first. */
  listForUser(userId: string): Order[] {
    const user = String(userId ?? '').trim();
    return [...this.orders.values()]
      .filter((o) => o.userId === user)
      .sort((a, b) => String(b.placedAt).localeCompare(String(a.placedAt)))
      .map((o) => ({ ...o, items: o.items.map((i) => ({ ...i })), history: o.history.map((h) => ({ ...h })) }));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const orders = new OrderService();
`;

export const ORDERS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { orders, type OrderStatus } from './orderService';

// REST endpoints for orders. Mount with: app.use('/api/orders', orderRouter).
// In production take the userId from the auth session, not the body.
export const orderRouter = Router();

// Place an order. { userId, items: [{ productId, name?, unitPriceMinor, qty }] }.
orderRouter.post('/', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { userId?: unknown; items?: unknown };
  try {
    const items = Array.isArray(body.items) ? (body.items as Array<{ productId: string; name?: string; unitPriceMinor: number; qty: number }>) : [];
    return res.status(201).json(orders.place(String(body.userId ?? ''), items));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// A user's orders.
orderRouter.get('/', (req: Request, res: Response) => {
  const userId = String(req.query.userId ?? '').trim();
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  return res.status(200).json(orders.listForUser(userId));
});

// One order.
orderRouter.get('/:id', (req: Request, res: Response) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  return res.status(200).json(order);
});

// Advance status. { status } (paid | shipped | delivered). 409 on an illegal transition.
orderRouter.patch('/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    return res.status(200).json(orders.transition(req.params.id, String(body.status ?? '') as OrderStatus));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'order not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});

// Cancel (allowed only before shipping). 409 once shipped/delivered.
orderRouter.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    return res.status(200).json(orders.cancel(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'order not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});
`;

const ORDERS_README = `# Orders (ecommerce lifecycle)

A real order-lifecycle backend (checkout → fulfillment). The core guarantees: placing an order captures an
**immutable snapshot** of its line items and total (a later catalog price change can **never** alter a placed
order's total), the total is the **exact sum** of the snapshot subtotals in **integer minor units** (paise /
cents), and status moves \`placed → paid → shipped → delivered\` along **allowed transitions only** — with
**cancel** permitted until it ships. Files:

- \`orderService.ts\` — the domain logic (\`OrderService\` + an \`orders\` singleton). Dependency-free. In-memory;
  swap the Map for your DB. \`get\`/\`listForUser\` return copies so the stored snapshot can't be mutated.
- \`routes.ts\` — REST endpoints. Mount:

\`\`\`ts
import { orderRouter } from './server/orders/routes';
app.use('/api/orders', orderRouter);
\`\`\`

Endpoints (take the userId from the auth session in production):
- \`POST  /api/orders\` \`{ userId, items:[{productId,name?,unitPriceMinor,qty}] }\` → place (immutable snapshot).
- \`GET   /api/orders?userId=<id>\` → the user's orders, newest first.
- \`GET   /api/orders/:id\` → one order (**404** if unknown).
- \`PATCH /api/orders/:id/status\` \`{ status }\` → advance (**409** on an illegal transition).
- \`POST  /api/orders/:id/cancel\` → cancel (**409** once shipped/delivered).

Pairs with \`generate_cart\` (build the item list), \`generate_inventory\` (reserve stock) and
\`generate_payment\` (charge the \`totalMinor\`).
`;

export interface OrdersConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Orders (ecommerce lifecycle) starter wired under server/orders/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is ORDER IMMUTABILITY + a STATUS STATE-MACHINE: place() captures an IMMUTABLE ' +
  'SNAPSHOT of the line items and freezes each subtotal + the order total (EXACT sum in integer minor units), ' +
  'so a later catalog price change can never alter a placed order; get()/listForUser() return copies so the ' +
  'snapshot cannot be mutated; transition() advances placed → paid → shipped → delivered along allowed ' +
  'transitions only (illegal jump throws → 409); cancel() is allowed only before shipping (placed/paid) and ' +
  '409s once shipped/delivered. routes.ts exposes POST /api/orders ({userId, items}), GET /api/orders ' +
  '(?userId), GET /api/orders/:id (404), PATCH /api/orders/:id/status ({status}, 409) and POST ' +
  '/api/orders/:id/cancel (409). Mount at app.use("/api/orders", orderRouter); take userId from the auth ' +
  'session in production. Pairs with generate_cart, generate_inventory and generate_payment. In-memory by ' +
  'default — swap the Map for your DB.';

export function generateOrdersIntegration(): OrdersConfig {
  return {
    files: {
      'server/orders/orderService.ts': ORDERS_SERVICE_SOURCE,
      'server/orders/routes.ts': ORDERS_ROUTES_SOURCE,
      'server/orders/README.md': ORDERS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
