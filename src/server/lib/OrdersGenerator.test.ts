import { describe, it, expect, afterAll } from 'vitest';

import { generateOrdersIntegration, ORDERS_SERVICE_SOURCE } from './OrdersGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateOrdersIntegration (wiring)', () => {
  it('emits the order service, routes and README', () => {
    const out = generateOrdersIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/orders/orderService.ts');
    expect(paths).toContain('server/orders/routes.ts');
    expect(paths).toContain('server/orders/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/orders/routes.ts']).toContain('export const orderRouter');
    expect(out.files['server/orders/routes.ts']).toContain('/cancel');
  });
});

// Materialize + execute the emitted domain logic — the immutable-snapshot + exact-total + state-machine rules
// are real business rules, verified against the actual emitted code.
describe('emitted OrderService — immutable snapshot + exact total + status machine (real logic)', () => {
  const emitted = emitModule('orders', ORDERS_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  type OrderStatus = 'placed' | 'paid' | 'shipped' | 'delivered' | 'cancelled';
  interface OrderItem { productId: string; name: string; unitPriceMinor: number; qty: number; subtotalMinor: number }
  interface Order { id: string; userId: string; items: OrderItem[]; totalMinor: number; status: OrderStatus; placedAt: string; updatedAt: string; history: Array<{ status: OrderStatus; at: string }> }
  interface Service {
    place(userId: string, items: Array<{ productId: string; name?: string; unitPriceMinor: number; qty: number }>, now?: Date): Order;
    get(id: string): Order | undefined;
    transition(id: string, to: OrderStatus, now?: Date): Order;
    cancel(id: string, now?: Date): Order;
    listForUser(userId: string): Order[];
  }
  interface Emitted { OrderService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('places an order with an EXACT total = sum of frozen subtotals', async () => {
    const { OrderService } = await load();
    const svc = new OrderService();
    const o = svc.place('u1', [
      { productId: 'a', name: 'A', unitPriceMinor: 1999, qty: 3 }, // 5997
      { productId: 'b', name: 'B', unitPriceMinor: 1050, qty: 2 }, // 2100
    ]);
    expect(o.status).toBe('placed');
    expect(o.items[0].subtotalMinor).toBe(5997);
    expect(o.items[1].subtotalMinor).toBe(2100);
    expect(o.totalMinor).toBe(8097);
    expect(o.items.reduce((s, i) => s + i.subtotalMinor, 0)).toBe(o.totalMinor);
    expect(() => svc.place('u1', [])).toThrow(/at least one item/);
    expect(() => svc.place('u1', [{ productId: 'x', unitPriceMinor: 100, qty: 0 }])).toThrow(/qty must be at least 1/);
  });

  it('THE INVARIANT: a placed order snapshot is immutable — external mutation cannot change the stored total', async () => {
    const { OrderService } = await load();
    const svc = new OrderService();
    const o = svc.place('u2', [{ productId: 'a', name: 'A', unitPriceMinor: 500, qty: 2 }]);
    const originalTotal = o.totalMinor; // 1000
    // Try to tamper with the returned object.
    o.items[0].unitPriceMinor = 999999;
    o.items[0].subtotalMinor = 999999;
    o.totalMinor = 999999;
    // Re-fetch from the store — the snapshot must be untouched.
    const fresh = svc.get(o.id) as Order;
    expect(fresh.totalMinor).toBe(originalTotal);
    expect(fresh.items[0].unitPriceMinor).toBe(500);
    expect(fresh.items[0].subtotalMinor).toBe(1000);
  });

  it('advances placed → paid → shipped → delivered and rejects illegal jumps (409)', async () => {
    const { OrderService } = await load();
    const svc = new OrderService();
    const o = svc.place('u3', [{ productId: 'a', unitPriceMinor: 100, qty: 1 }]);
    expect(() => svc.transition(o.id, 'shipped')).toThrow(/illegal transition/); // can't skip paid
    expect(svc.transition(o.id, 'paid').status).toBe('paid');
    expect(svc.transition(o.id, 'shipped').status).toBe('shipped');
    expect(svc.transition(o.id, 'delivered').status).toBe('delivered');
    expect(() => svc.transition(o.id, 'paid')).toThrow(/illegal transition/); // no going back
    expect(() => svc.transition('nope', 'paid')).toThrow(/order not found/);
    // history records each step
    const fresh = svc.get(o.id) as Order;
    expect(fresh.history.map((h) => h.status)).toEqual(['placed', 'paid', 'shipped', 'delivered']);
  });

  it('cancel is allowed before shipping and rejected once shipped (409)', async () => {
    const { OrderService } = await load();
    const svc = new OrderService();
    const a = svc.place('u4', [{ productId: 'a', unitPriceMinor: 100, qty: 1 }]);
    expect(svc.cancel(a.id).status).toBe('cancelled'); // from placed → ok
    expect(() => svc.transition(a.id, 'paid')).toThrow(/illegal transition/); // cancelled is terminal

    const b = svc.place('u4', [{ productId: 'b', unitPriceMinor: 100, qty: 1 }]);
    svc.transition(b.id, 'paid');
    expect(svc.cancel(b.id).status).toBe('cancelled'); // from paid → still ok

    const c = svc.place('u4', [{ productId: 'c', unitPriceMinor: 100, qty: 1 }]);
    svc.transition(c.id, 'paid');
    svc.transition(c.id, 'shipped');
    expect(() => svc.cancel(c.id)).toThrow(/cannot cancel an order that is shipped/);
  });

  it('listForUser returns a user orders newest-first and isolates users', async () => {
    const { OrderService } = await load();
    const svc = new OrderService();
    svc.place('alice', [{ productId: 'a', unitPriceMinor: 100, qty: 1 }], new Date('2026-01-01T00:00:00Z'));
    svc.place('alice', [{ productId: 'b', unitPriceMinor: 200, qty: 1 }], new Date('2026-02-01T00:00:00Z'));
    svc.place('bob', [{ productId: 'c', unitPriceMinor: 300, qty: 1 }]);
    const aliceOrders = svc.listForUser('alice');
    expect(aliceOrders.length).toBe(2);
    expect(aliceOrders[0].placedAt >= aliceOrders[1].placedAt).toBe(true); // newest first
    expect(svc.listForUser('bob').length).toBe(1); // isolated
  });
});
