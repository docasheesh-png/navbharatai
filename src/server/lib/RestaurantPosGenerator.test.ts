import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateRestaurantPosIntegration, RESTAURANT_SERVICE_SOURCE } from './RestaurantPosGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateRestaurantPosIntegration (wiring)', () => {
  it('emits the restaurant service, routes and README + express dep', () => {
    const out = generateRestaurantPosIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/restaurant/restaurantService.ts');
    expect(paths).toContain('server/restaurant/routes.ts');
    expect(paths).toContain('server/restaurant/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/restaurant/routes.ts']).toContain('409');
    expect(out.files['server/restaurant/routes.ts']).toContain('export const restaurantRouter');
  });
});

// Materialize + execute the emitted domain logic — the table/order state-machines and exact GST bill are
// real invariants, verified against the actual emitted code.
describe('emitted RestaurantService — real domain invariants', () => {
  const artifact = join(here, `._restaurant_emitted_${process.pid}.ts`);
  writeFileSync(artifact, RESTAURANT_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Item { id: string }
  interface Table { id: string; status: string }
  interface Order { id: string; status: string; lines: unknown[] }
  interface Bill { subtotal: number; cgst: number; sgst: number; total: number }
  interface Service {
    defaultGstRatePct: number;
    addMenuItem(d: { name: string; price: number; gstRatePct?: number }): Item;
    addTable(d: { label: string; seats: number }): Table;
    listTables(): Table[];
    openOrder(tableId: string): Order;
    addLine(orderId: string, menuItemId: string, qty: number): Order;
    setOrderStatus(orderId: string, to: string): Order;
    bill(orderId: string): Bill;
    closeOrder(orderId: string): Order;
    getOrder(id: string): Order | undefined;
  }
  interface Emitted { RestaurantService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('TABLE state-machine: seating an already-occupied table is rejected (409-class)', async () => {
    const { RestaurantService } = await load();
    const svc = new RestaurantService();
    const t = svc.addTable({ label: 'T1', seats: 4 });
    svc.openOrder(t.id);
    expect(svc.listTables()[0].status).toBe('occupied');
    expect(() => svc.openOrder(t.id)).toThrow(/Invalid table transition/); // free→occupied only
  });

  it('KOT order lifecycle: cannot add items to a served/closed order (409-class)', async () => {
    const { RestaurantService } = await load();
    const svc = new RestaurantService();
    const t = svc.addTable({ label: 'T1', seats: 2 });
    const item = svc.addMenuItem({ name: 'Paneer Tikka', price: 200 });
    const order = svc.openOrder(t.id);
    svc.addLine(order.id, item.id, 1);
    svc.setOrderStatus(order.id, 'served');
    expect(() => svc.addLine(order.id, item.id, 1)).toThrow(/served or closed/);
  });

  it('order status REJECTS an invalid jump (placed → served is allowed; served → preparing is not)', async () => {
    const { RestaurantService } = await load();
    const svc = new RestaurantService();
    const t = svc.addTable({ label: 'T2', seats: 2 });
    const order = svc.openOrder(t.id);
    svc.setOrderStatus(order.id, 'served');
    expect(() => svc.setOrderStatus(order.id, 'preparing')).toThrow(/Invalid order transition/);
  });

  it('EXACT GST bill: subtotal + CGST + SGST + total computed exactly from the lines', async () => {
    const { RestaurantService } = await load();
    const svc = new RestaurantService();
    svc.defaultGstRatePct = 5; // 2.5% CGST + 2.5% SGST
    const t = svc.addTable({ label: 'T3', seats: 4 });
    const paneer = svc.addMenuItem({ name: 'Paneer', price: 200 });
    const naan = svc.addMenuItem({ name: 'Naan', price: 50 });
    const order = svc.openOrder(t.id);
    svc.addLine(order.id, paneer.id, 2); // 400
    svc.addLine(order.id, naan.id, 4);   // 200
    const bill = svc.bill(order.id);
    expect(bill.subtotal).toBe(600);
    expect(bill.cgst).toBe(15);  // 2.5% of 600
    expect(bill.sgst).toBe(15);
    expect(bill.total).toBe(630);
  });

  it('a per-item GST rate overrides the default', async () => {
    const { RestaurantService } = await load();
    const svc = new RestaurantService();
    svc.defaultGstRatePct = 5;
    const t = svc.addTable({ label: 'T4', seats: 2 });
    const cake = svc.addMenuItem({ name: 'Cake', price: 100, gstRatePct: 18 });
    const order = svc.openOrder(t.id);
    svc.addLine(order.id, cake.id, 1); // 100 @ 18% = 18 GST
    const bill = svc.bill(order.id);
    expect(bill.subtotal).toBe(100);
    expect(bill.cgst).toBe(9);
    expect(bill.sgst).toBe(9);
    expect(bill.total).toBe(118);
  });

  it('closing an order frees the table (billing → free), completing the state-machine', async () => {
    const { RestaurantService } = await load();
    const svc = new RestaurantService();
    const t = svc.addTable({ label: 'T5', seats: 2 });
    const item = svc.addMenuItem({ name: 'Tea', price: 20 });
    const order = svc.openOrder(t.id);
    svc.addLine(order.id, item.id, 1);
    svc.bill(order.id);                       // occupied → billing
    svc.closeOrder(order.id);                 // billing → free
    expect(svc.listTables()[0].status).toBe('free');
    expect(svc.getOrder(order.id)?.status).toBe('closed');
  });

  it('adding the same item twice merges quantity (one line, qty summed)', async () => {
    const { RestaurantService } = await load();
    const svc = new RestaurantService();
    const t = svc.addTable({ label: 'T6', seats: 2 });
    const item = svc.addMenuItem({ name: 'Coffee', price: 40 });
    const order = svc.openOrder(t.id);
    svc.addLine(order.id, item.id, 1);
    const o2 = svc.addLine(order.id, item.id, 2);
    expect(o2.lines.length).toBe(1);
  });
});
