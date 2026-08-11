import { describe, it, expect, afterAll } from 'vitest';

import { generateCartIntegration, CART_SERVICE_SOURCE } from './CartGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateCartIntegration (wiring)', () => {
  it('emits the cart service, routes and README', () => {
    const out = generateCartIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/cart/cartService.ts');
    expect(paths).toContain('server/cart/routes.ts');
    expect(paths).toContain('server/cart/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/cart/routes.ts']).toContain('export const cartRouter');
    expect(out.files['server/cart/routes.ts']).toContain('/items');
  });
});

// Materialize + execute the emitted domain logic — the merge + exact-total + non-negative rules are real
// business rules, verified against the actual emitted code.
describe('emitted CartService — merge quantities + exact total + non-negative (real logic)', () => {
  const emitted = emitModule('cart', CART_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  interface CartLine { productId: string; name: string; unitPriceMinor: number; qty: number }
  interface CartView { userId: string; lines: CartLine[]; itemCount: number; totalMinor: number }
  interface Service {
    add(userId: string, item: { productId: string; name: string; unitPriceMinor: number }, qty?: number): CartLine;
    setQty(userId: string, productId: string, qty: number): CartLine | null;
    remove(userId: string, productId: string): boolean;
    clear(userId: string): void;
    view(userId: string): CartView;
  }
  interface Emitted { CartService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('adding the same product MERGES into one line (never a duplicate)', async () => {
    const { CartService } = await load();
    const svc = new CartService();
    svc.add('u1', { productId: 'p1', name: 'Shirt', unitPriceMinor: 49900 }, 2);
    svc.add('u1', { productId: 'p1', name: 'Shirt', unitPriceMinor: 49900 }, 3);
    const v = svc.view('u1');
    expect(v.lines.length).toBe(1);       // ONE line, not two
    expect(v.lines[0].qty).toBe(5);       // 2 + 3 merged
    expect(v.itemCount).toBe(5);
  });

  it('THE INVARIANT: total is always the exact sum of unitPrice * qty (integer minor units, no drift)', async () => {
    const { CartService } = await load();
    const svc = new CartService();
    svc.add('u2', { productId: 'a', name: 'A', unitPriceMinor: 1999 }, 3); // 5997
    svc.add('u2', { productId: 'b', name: 'B', unitPriceMinor: 1050 }, 2); // 2100
    svc.add('u2', { productId: 'a', name: 'A', unitPriceMinor: 1999 }, 1); // a -> qty 4 => 7996
    const v = svc.view('u2');
    // exact: 1999*4 + 1050*2 = 7996 + 2100 = 10096
    expect(v.totalMinor).toBe(10096);
    expect(v.itemCount).toBe(6);
    // recompute the invariant directly from the lines
    const recomputed = v.lines.reduce((s, l) => s + l.unitPriceMinor * l.qty, 0);
    expect(recomputed).toBe(v.totalMinor);
  });

  it('setQty sets the absolute quantity; 0 or negative REMOVES the line (never negative)', async () => {
    const { CartService } = await load();
    const svc = new CartService();
    svc.add('u3', { productId: 'p', name: 'P', unitPriceMinor: 500 }, 4);
    expect(svc.setQty('u3', 'p', 2)?.qty).toBe(2);
    expect(svc.view('u3').totalMinor).toBe(1000);
    // setting to 0 removes the line
    expect(svc.setQty('u3', 'p', 0)).toBeNull();
    expect(svc.view('u3').lines.length).toBe(0);
    // a negative quantity also just removes (never stored as negative)
    svc.add('u3', { productId: 'q', name: 'Q', unitPriceMinor: 300 }, 1);
    expect(svc.setQty('u3', 'q', -5)).toBeNull();
    expect(svc.view('u3').itemCount).toBe(0);
  });

  it('validates input and unknown-line cases', async () => {
    const { CartService } = await load();
    const svc = new CartService();
    expect(() => svc.add('u4', { productId: '', name: 'X', unitPriceMinor: 100 })).toThrow(/productId is required/);
    expect(() => svc.add('u4', { productId: 'p', name: 'X', unitPriceMinor: -1 })).toThrow(/non-negative/);
    expect(() => svc.add('u4', { productId: 'p', name: 'X', unitPriceMinor: 100 }, 0)).toThrow(/at least 1/);
    expect(() => svc.setQty('u4', 'missing', 3)).toThrow(/product not in cart/);
    expect(() => svc.view('')).toThrow(/userId is required/);
  });

  it('remove and clear work; carts are isolated per user', async () => {
    const { CartService } = await load();
    const svc = new CartService();
    svc.add('alice', { productId: 'p', name: 'P', unitPriceMinor: 100 }, 1);
    svc.add('bob', { productId: 'p', name: 'P', unitPriceMinor: 100 }, 9);
    expect(svc.view('alice').itemCount).toBe(1);
    expect(svc.view('bob').itemCount).toBe(9); // isolated
    expect(svc.remove('alice', 'p')).toBe(true);
    expect(svc.remove('alice', 'p')).toBe(false); // already gone
    expect(svc.view('alice').lines.length).toBe(0);
    svc.clear('bob');
    expect(svc.view('bob').lines.length).toBe(0);
  });
});
