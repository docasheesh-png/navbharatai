// Restaurant / POS domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the CrmGenerator / HospitalErpGenerator / SchoolErpGenerator / CourierGenerator recipe pattern.
// The real guarantees — the things that make this a genuine feature, not a stub — are:
//   1. TABLE STATE-MACHINE: a table moves free → occupied → billing → free along allowed transitions only;
//      you cannot seat an already-occupied table, and an invalid jump is rejected.
//   2. KOT (kitchen order ticket) LIFECYCLE: an order's status moves placed → preparing → served → closed;
//      items can only be added while the order is open (placed/preparing).
//   3. EXACT GST BILL: the bill total is computed EXACTLY from the line items — subtotal, CGST + SGST at the
//      configured rate, and grand total — so the arithmetic is never wrong.
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const RESTAURANT_SERVICE_SOURCE = `// Restaurant / POS domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) A table's status follows an allowed STATE-MACHINE (free → occupied → billing → free).
//  2) An order (KOT) has a lifecycle; items are added only while it is open.
//  3) The GST bill (subtotal + CGST + SGST + total) is computed EXACTLY from the line items.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.

export type TableStatus = 'free' | 'occupied' | 'billing';
export type OrderStatus = 'placed' | 'preparing' | 'served' | 'closed';

export interface MenuItem {
  id: string;
  name: string;
  price: number;       // in the smallest currency unit is fine too; kept as a number
  category?: string;
  gstRatePct?: number; // per-item override; else the order/default rate is used
}

export interface Table {
  id: string;
  label: string;       // e.g. "T1"
  seats: number;
  status: TableStatus;
}

export interface OrderLine {
  menuItemId: string;
  name: string;
  qty: number;
  unitPrice: number;
  gstRatePct: number;
}

export interface Order {
  id: string;
  tableId: string;
  status: OrderStatus;
  lines: OrderLine[];
  createdAt: number;
}

export interface Bill {
  orderId: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  total: number;
  lines: Array<OrderLine & { lineTotal: number }>;
}

const TABLE_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  free: ['occupied'],
  occupied: ['billing', 'free'],   // free = walked out / order cancelled
  billing: ['free'],
};
const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ['preparing', 'served', 'closed'],
  preparing: ['served', 'closed'],
  served: ['closed'],
  closed: [],
};

export class InvalidTransitionError extends Error {
  constructor(kind: string, from: string, to: string) {
    super(\`Invalid \${kind} transition \${from} → \${to}\`);
    this.name = 'InvalidTransitionError';
  }
}
export class OrderClosedError extends Error {
  constructor() { super('Cannot add items to an order that is served or closed'); this.name = 'OrderClosedError'; }
}

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export class RestaurantService {
  private menu = new Map<string, MenuItem>();
  private tables = new Map<string, Table>();
  private orders = new Map<string, Order>();
  /** Default GST rate (%) when a menu item has no override. Split evenly into CGST + SGST. */
  defaultGstRatePct = 5;

  // ---- Menu ----
  addMenuItem(data: { name: string; price: number; category?: string; gstRatePct?: number }): MenuItem {
    if (!data.name?.trim()) throw new Error('Menu item name is required');
    if (!(data.price >= 0)) throw new Error('Menu item price must be >= 0');
    const item: MenuItem = { id: nextId('itm'), name: data.name.trim(), price: data.price, category: data.category, gstRatePct: data.gstRatePct };
    this.menu.set(item.id, item);
    return item;
  }
  listMenu(): MenuItem[] { return [...this.menu.values()]; }

  // ---- Tables (state-machine) ----
  addTable(data: { label: string; seats: number }): Table {
    const t: Table = { id: nextId('tbl'), label: data.label, seats: data.seats, status: 'free' };
    this.tables.set(t.id, t);
    return t;
  }
  private moveTable(t: Table, to: TableStatus): void {
    if (!(TABLE_TRANSITIONS[t.status] ?? []).includes(to)) throw new InvalidTransitionError('table', t.status, to);
    t.status = to;
  }
  listTables(): Table[] { return [...this.tables.values()]; }

  // ---- Orders (KOT) ----
  openOrder(tableId: string): Order {
    const t = this.tables.get(tableId);
    if (!t) throw new Error(\`Unknown table \${tableId}\`);
    this.moveTable(t, 'occupied');   // rejects seating an already-occupied/billing table
    const order: Order = { id: nextId('ord'), tableId, status: 'placed', lines: [], createdAt: Date.now() };
    this.orders.set(order.id, order);
    return order;
  }

  addLine(orderId: string, menuItemId: string, qty: number): Order {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(\`Unknown order \${orderId}\`);
    if (order.status === 'served' || order.status === 'closed') throw new OrderClosedError();
    const item = this.menu.get(menuItemId);
    if (!item) throw new Error(\`Unknown menu item \${menuItemId}\`);
    if (!(qty > 0)) throw new Error('qty must be > 0');
    const gstRatePct = item.gstRatePct ?? this.defaultGstRatePct;
    const existing = order.lines.find((l) => l.menuItemId === menuItemId);
    if (existing) existing.qty += qty;
    else order.lines.push({ menuItemId, name: item.name, qty, unitPrice: item.price, gstRatePct });
    return order;
  }

  setOrderStatus(orderId: string, to: OrderStatus): Order {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(\`Unknown order \${orderId}\`);
    if (!(ORDER_TRANSITIONS[order.status] ?? []).includes(to)) throw new InvalidTransitionError('order', order.status, to);
    order.status = to;
    return order;
  }

  // ---- Billing (exact GST) ----
  bill(orderId: string): Bill {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(\`Unknown order \${orderId}\`);
    const t = this.tables.get(order.tableId);
    if (t) this.moveTable(t, 'billing');   // occupied → billing (rejects billing a free table)
    let subtotal = 0, cgst = 0, sgst = 0;
    const lines = order.lines.map((l) => {
      const lineTotal = round2(l.unitPrice * l.qty);
      const lineGst = round2(lineTotal * (l.gstRatePct / 100));
      subtotal += lineTotal;
      cgst += lineGst / 2;
      sgst += lineGst / 2;
      return { ...l, lineTotal };
    });
    subtotal = round2(subtotal);
    cgst = round2(cgst);
    sgst = round2(sgst);
    return { orderId, subtotal, cgst, sgst, total: round2(subtotal + cgst + sgst), lines };
  }

  closeOrder(orderId: string): Order {
    const order = this.setOrderStatus(orderId, 'closed');
    const t = this.tables.get(order.tableId);
    if (t) this.moveTable(t, 'free');   // billing → free (table available again)
    return order;
  }

  getOrder(orderId: string): Order | undefined { return this.orders.get(orderId); }
}

export const restaurant = new RestaurantService();
`;

export const RESTAURANT_ROUTES_SOURCE = `import { Router } from 'express';
import { restaurant, InvalidTransitionError, OrderClosedError } from './restaurantService';

export const restaurantRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    const out = fn();
    if (out === undefined) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(out);
  } catch (e) {
    if (e instanceof InvalidTransitionError || e instanceof OrderClosedError) { res.status(409).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

restaurantRouter.get('/menu', (_req, res) => handle(res, () => restaurant.listMenu()));
restaurantRouter.post('/menu', (req, res) => handle(res, () => restaurant.addMenuItem(req.body)));
restaurantRouter.get('/tables', (_req, res) => handle(res, () => restaurant.listTables()));
restaurantRouter.post('/tables', (req, res) => handle(res, () => restaurant.addTable(req.body)));

restaurantRouter.post('/orders', (req, res) => handle(res, () => restaurant.openOrder(req.body?.tableId))); // 409 if table occupied
restaurantRouter.get('/orders/:id', (req, res) => handle(res, () => restaurant.getOrder(req.params.id)));
restaurantRouter.post('/orders/:id/lines', (req, res) => handle(res, () => restaurant.addLine(req.params.id, req.body?.menuItemId, Number(req.body?.qty)))); // 409 if order served/closed
restaurantRouter.patch('/orders/:id/status', (req, res) => handle(res, () => restaurant.setOrderStatus(req.params.id, req.body?.status))); // 409 on invalid
restaurantRouter.get('/orders/:id/bill', (req, res) => handle(res, () => restaurant.bill(req.params.id)));  // exact GST bill
restaurantRouter.post('/orders/:id/close', (req, res) => handle(res, () => restaurant.closeOrder(req.params.id)));
`;

export const RESTAURANT_README = `# Restaurant / POS starter

A dependency-free restaurant point-of-sale backend under \`server/restaurant/\`, wired for Express.

## Real guarantees (not a stub)
- **Table state-machine** — a table moves \`free → occupied → billing → free\` along allowed transitions
  only; seating an already-occupied table is rejected (**409**).
- **KOT order lifecycle** — an order moves \`placed → preparing → served → closed\`; items can be added
  only while it is open (placed/preparing); adding to a served/closed order is rejected (**409**).
- **Exact GST bill** — the bill is computed exactly from the line items: subtotal, CGST + SGST (split from
  the per-item or default GST rate) and grand total, all rounded to 2 decimals.

## Endpoints (mount with \`app.use("/api", restaurantRouter)\`)
- \`GET/POST /menu\`, \`GET/POST /tables\`
- \`POST /orders\` (**409** if the table is occupied), \`GET /orders/:id\`, \`POST /orders/:id/lines\`,
  \`PATCH /orders/:id/status\` (**409** on invalid), \`GET /orders/:id/bill\` (exact GST), \`POST /orders/:id/close\`

Set \`restaurant.defaultGstRatePct\` (default 5) or a per-item \`gstRatePct\`. In-memory by default; swap the
Maps in \`restaurantService.ts\` for your DB, keeping the same contracts. Pairs with the auth/payment/notification recipes.
`;

export interface RestaurantPosConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Restaurant / POS starter wired under server/restaurant/ (dependency-free domain logic + an Express router). ' +
  'Three real guarantees: (1) TABLE STATE-MACHINE — free → occupied → billing → free (seating an occupied ' +
  'table rejected, 409); (2) KOT ORDER LIFECYCLE — placed → preparing → served → closed, items added only ' +
  'while open (409 otherwise); (3) EXACT GST BILL — subtotal + CGST + SGST (split from the per-item/default ' +
  'rate) + total, computed exactly. Endpoints: GET/POST /menu, GET/POST /tables, POST /orders, GET ' +
  '/orders/:id, POST /orders/:id/lines, PATCH /orders/:id/status, GET /orders/:id/bill, POST /orders/:id/close. ' +
  'Mount with app.use("/api", restaurantRouter). In-memory by default — swap the Maps for your DB, same ' +
  'contracts. Pairs with the auth/payment/notification recipes. No key.';

export function generateRestaurantPosIntegration(): RestaurantPosConfig {
  return {
    files: {
      'server/restaurant/restaurantService.ts': RESTAURANT_SERVICE_SOURCE,
      'server/restaurant/routes.ts': RESTAURANT_ROUTES_SOURCE,
      'server/restaurant/README.md': RESTAURANT_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
