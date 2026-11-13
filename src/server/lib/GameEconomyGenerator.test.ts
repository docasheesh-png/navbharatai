import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameEconomy, GAME_ECONOMY_MODULES } from './GameEconomyGenerator';

/**
 * THESE TESTS RUN THE GENERATED CODE.
 *
 * The economy is pure arithmetic, so its rules are PROVEN by executing the emitted modules rather than matched
 * as text. A string match for "spend" passes on a till that goes negative; a test that spends more than the
 * balance and checks the balance did not move does not.
 */
const all = generateGameEconomy();

/** Compile every emitted module and load them as one tiny CommonJS registry, resolving './x' between them. */
function loadAll(files: Record<string, string> = all.files): Record<string, any> {
  const cache: Record<string, any> = {};
  const byName: Record<string, string> = {};
  for (const path of Object.keys(files)) byName[(path.split('/').pop() ?? '').replace(/\.ts$/, '')] = path;
  const load = (name: string): any => {
    if (cache[name]) return cache[name];
    const source = files[byName[name]];
    expect(source, name + ' was not emitted').toBeTruthy();
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, unknown> = {};
    cache[name] = exports;
    const req = (id: string) => load(id.replace(/^\.\//, ''));
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', js)(exports, req);
    return exports;
  };
  const out: Record<string, any> = {};
  for (const n of Object.keys(byName)) out[n] = load(n);
  return out;
}

const m = loadAll();
const { toMinor, clampMoney, fmtMoney, MAX_MONEY, Rng } = m.money;
const { Ledger } = m.ledger;
const { Inventory } = m.inventory;
const { demandFactor, MAX_DEMAND } = m.pricing;
const { OrderBook } = m.orders;
const { Upgrades, DEFAULT_UPGRADES } = m.upgrades;
const { Economy, OFFLINE_CAP_SECONDS } = m.economy;

const PRODUCTS = [
  { id: 'atta', name: 'Atta', cost: toMinor(180), price: toMinor(230), shelfCapacity: 12, demand: 2 },
  { id: 'oil', name: 'Oil', cost: toMinor(140), price: toMinor(175), shelfCapacity: 10 },
];
const cfg = (over: Record<string, unknown> = {}) => ({ products: PRODUCTS, seed: 7, startCash: toMinor(5000), ...over });
const stocked = (over: Record<string, unknown> = {}) => {
  const e = new Economy(cfg(over));
  for (const p of PRODUCTS) { e.inventory.receive(p.id, 40); e.restockShelf(p.id); }
  return e;
};

describe('money — integers, never floats', () => {
  it('converts without the float drift that makes a till a few paise out', () => {
    expect(toMinor(1.15)).toBe(115);
    expect(toMinor(0.1) + toMinor(0.2)).toBe(toMinor(0.3));
    expect(toMinor(19.99)).toBe(1999);
  });

  it('turns NaN, Infinity, negatives and fractions into a safe whole number', () => {
    for (const bad of [NaN, Infinity, -Infinity, -5, undefined, null, '12']) expect(clampMoney(bad as number)).toBe(0);
    expect(clampMoney(12.9)).toBe(12);
    expect(clampMoney(MAX_MONEY * 10)).toBe(MAX_MONEY);
  });

  it('formats with Indian digit grouping and drops .00 on whole rupees', () => {
    expect(fmtMoney(0)).toBe('₹0');
    expect(fmtMoney(99900)).toBe('₹999');
    expect(fmtMoney(100000)).toBe('₹1,000');
    expect(fmtMoney(5000000)).toBe('₹50,000');
    expect(fmtMoney(10000000)).toBe('₹1,00,000');
    expect(fmtMoney(12345678)).toBe('₹1,23,456.78');
    expect(fmtMoney(5, '$')).toBe('$0.05');
  });

  it('the seeded generator replays identically and its state round-trips', () => {
    const a = new Rng(42); const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    const c = new Rng(1); c.next(); const saved = c.state; const next = c.next();
    const d = new Rng(99); d.state = saved;
    expect(d.next()).toBe(next);
  });
});

describe('ledger — one atomic check-and-debit', () => {
  it('a spend larger than the balance changes NOTHING', () => {
    const l = new Ledger(100);
    expect(l.spend(150, 'x')).toBe(false);
    expect(l.cash).toBe(100);
  });

  it('two quick taps cannot both pass a balance check', () => {
    const l = new Ledger(100);
    expect([l.spend(70, 'a'), l.spend(70, 'b')]).toEqual([true, false]);
    expect(l.cash).toBe(30);
  });

  it('refuses NaN, negative and fractional amounts and never credits them', () => {
    const l = new Ledger(100);
    for (const bad of [NaN, -5, 1.5, Infinity]) expect(l.spend(bad, 'x')).toBe(false);
    expect(l.earn(NaN, 'x')).toBe(0);
    expect(l.earn(-50, 'x')).toBe(0);
    expect(l.cash).toBe(100);
  });

  it('cannot exceed the money ceiling', () => {
    const l = new Ledger(MAX_MONEY - 5);
    expect(l.earn(100, 'x')).toBe(5);
    expect(l.cash).toBe(MAX_MONEY);
  });

  it('keeps a bounded log and bounded reasons however long it runs', () => {
    const l = new Ledger(0, 50);
    for (let i = 0; i < 1000; i++) l.earn(1, 'r' + i);
    expect(l.recent(10_000).length).toBeLessThanOrEqual(50);
    expect(Object.keys(l.snapshot().totals).length).toBeLessThanOrEqual(65);
    expect(l.cash).toBe(1000);
  });

  it('restores a corrupt snapshot to safe numbers', () => {
    const l = new Ledger(0);
    l.restore({ cash: NaN, totals: { a: 'x', b: 5.7, c: Infinity } });
    expect(l.cash).toBe(0);
    expect(l.snapshot().totals).toEqual({ b: 5 });
    l.restore(null);
    expect(l.cash).toBe(0);
  });
});

describe('inventory — shelf and stock room, never negative, never over capacity', () => {
  it('a delivery lands in the stock room and only up to its capacity', () => {
    const inv = new Inventory(PRODUCTS);
    expect(inv.receive('atta', 1000)).toBe(inv.backCap('atta'));
    expect(inv.inBackroom('atta')).toBe(48);
    expect(inv.receive('atta', 5)).toBe(0);
  });

  it('customers can only take what is ON THE SHELF', () => {
    const inv = new Inventory(PRODUCTS);
    inv.receive('atta', 30);
    expect(inv.take('atta', 5)).toBe(0); // in the stock room, not on the shelf
    expect(inv.restockShelf('atta')).toBe(12);
    expect(inv.take('atta', 100)).toBe(12);
    expect(inv.onShelf('atta')).toBe(0);
    expect(inv.take('atta', 1)).toBe(0);
  });

  it('refuses unknown products and nonsense quantities', () => {
    const inv = new Inventory(PRODUCTS);
    expect(inv.receive('ghost', 5)).toBe(0);
    expect(inv.receive('atta', NaN)).toBe(0);
    expect(inv.receive('atta', -3)).toBe(0);
    expect(inv.take('atta', -1)).toBe(0);
  });

  it('the shelf-space upgrade raises capacity and never lowers it below base', () => {
    const inv = new Inventory(PRODUCTS);
    inv.setCapacityMultiplier(1.5);
    expect(inv.shelfCap('atta')).toBe(18);
    inv.setCapacityMultiplier(0.1);
    expect(inv.shelfCap('atta')).toBe(12);
    inv.setCapacityMultiplier(NaN);
    expect(inv.shelfCap('atta')).toBe(12);
  });

  it('a restored count is clamped to capacity and unknown products are dropped', () => {
    const inv = new Inventory(PRODUCTS);
    inv.restore({ shelf: { atta: 9999, ghost: 5, oil: -4 }, back: { atta: NaN } });
    expect(inv.onShelf('atta')).toBe(12);
    expect(inv.onShelf('oil')).toBe(0);
    expect(inv.inBackroom('atta')).toBe(0);
    expect(inv.has('ghost')).toBe(false);
  });
});

describe('pricing — the price screen is a real decision', () => {
  it('demand is exactly 1.0 at the fair price', () => {
    expect(demandFactor(230, 230)).toBeCloseTo(1, 10);
  });

  it('a higher price NEVER sells more — sweep from free to 4x', () => {
    let prev = Infinity;
    for (let p = 0; p <= 920; p += 5) {
      const f = demandFactor(p, 230);
      expect(f, 'price ' + p).toBeLessThanOrEqual(prev + 1e-12);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(MAX_DEMAND);
      prev = f;
    }
  });

  it('is zero at and beyond the markup ceiling, and a giveaway is capped', () => {
    expect(demandFactor(690, 230)).toBe(0);
    expect(demandFactor(5000, 230)).toBe(0);
    expect(demandFactor(0, 230)).toBe(MAX_DEMAND);
    expect(demandFactor(1, 230)).toBe(MAX_DEMAND);
  });

  it('is continuous at the ceiling — no cliff a player can feel', () => {
    expect(demandFactor(689, 230)).toBeLessThan(0.01);
  });

  it('never returns NaN for bad input', () => {
    for (const [p, f] of [[NaN, 230], [230, NaN], [230, 0], [230, -5], [-1, 230], [Infinity, 230], [230, Infinity]]) {
      const v = demandFactor(p, f);
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0);
    }
  });
});

describe('orders — never charge for goods that cannot arrive, never charge twice', () => {
  const setup = (cash = 100_000_000) => {
    const inv = new Inventory(PRODUCTS);
    const ledger = new Ledger(cash);
    const book = new OrderBook(30);
    return { inv, ledger, book };
  };

  it('is REFUSED BEFORE payment when the stock room cannot hold it', () => {
    const { inv, ledger, book } = setup();
    const r = book.place(inv, ledger, 'atta', 49);
    expect(r).toEqual({ ok: false, reason: 'no_space' });
    expect(ledger.cash).toBe(100_000_000);
    expect(book.list().length).toBe(0);
  });

  it('counts what is already on the way when checking space', () => {
    const { inv, ledger, book } = setup();
    expect(book.place(inv, ledger, 'atta', 40).ok).toBe(true);
    const second = book.place(inv, ledger, 'atta', 9);
    expect(second).toEqual({ ok: false, reason: 'no_space' });
    expect(book.place(inv, ledger, 'atta', 8).ok).toBe(true);
  });

  it('the same requestId returns the first order and charges NOTHING more', () => {
    const { inv, ledger, book } = setup();
    const a = book.place(inv, ledger, 'atta', 10, 'tap-1');
    const cashAfterFirst = ledger.cash;
    const b = book.place(inv, ledger, 'atta', 10, 'tap-1');
    expect(a.ok && !a.duplicate).toBe(true);
    expect(b.ok && b.duplicate).toBe(true);
    expect(ledger.cash).toBe(cashAfterFirst);
    expect(book.list().length).toBe(1);
  });

  it('a different requestId is a different order', () => {
    const { inv, ledger, book } = setup();
    book.place(inv, ledger, 'atta', 5, 'a');
    book.place(inv, ledger, 'atta', 5, 'b');
    expect(book.list().length).toBe(2);
  });

  it('cannot_afford takes no money and queues nothing', () => {
    const { inv, ledger, book } = setup(100);
    expect(book.place(inv, ledger, 'atta', 10)).toEqual({ ok: false, reason: 'cannot_afford' });
    expect(ledger.cash).toBe(100);
    expect(book.list().length).toBe(0);
  });

  it('rejects unknown products and bad quantities', () => {
    const { inv, ledger, book } = setup();
    expect(book.place(inv, ledger, 'ghost', 1)).toEqual({ ok: false, reason: 'unknown_product' });
    for (const q of [0, -1, 1.5, NaN, 5000]) expect(book.place(inv, ledger, 'atta', q)).toEqual({ ok: false, reason: 'bad_quantity' });
    expect(ledger.cash).toBe(100_000_000);
  });

  it('delivers after the lead time into the stock room and keeps what did not fit', () => {
    const { inv, ledger, book } = setup();
    book.place(inv, ledger, 'oil', 10);
    expect(book.tick(29, inv)).toEqual([]);
    expect(inv.inBackroom('oil')).toBe(0);
    const done = book.tick(2, inv);
    expect(done.length).toBe(1);
    expect(done[0].accepted).toBe(10);
    expect(inv.inBackroom('oil')).toBe(10);
    expect(book.list().length).toBe(0);
  });

  it('a bulk order costs less per unit, and the quote is the charge', () => {
    const { book } = setup();
    expect(book.quote(100, 10)).toBe(1000);
    expect(book.quote(100, 50)).toBe(4750);
    expect(book.quote(100, 100)).toBe(9000);
    const inv = new Inventory([{ ...PRODUCTS[0], backroomCapacity: 500 }]);
    const ledger = new Ledger(10_000_000);
    book.place(inv, ledger, 'atta', 100);
    expect(10_000_000 - ledger.cash).toBe(book.quote(PRODUCTS[0].cost, 100));
  });

  it('ignores a NaN or negative step', () => {
    const { inv, ledger, book } = setup();
    book.place(inv, ledger, 'oil', 5);
    expect(book.tick(NaN, inv)).toEqual([]);
    expect(book.tick(-10, inv)).toEqual([]);
    expect(book.list()[0].eta).toBe(30);
  });

  it('restoring never re-charges and drops orders for unknown products', () => {
    const { inv, ledger, book } = setup();
    book.place(inv, ledger, 'oil', 5);
    const snap = JSON.parse(JSON.stringify(book.snapshot()));
    snap.pending.push({ id: 9, productId: 'ghost', qty: 5, paid: 1, eta: 5 });
    const cash = ledger.cash;
    const fresh = new OrderBook(30);
    fresh.restore(snap, inv);
    expect(fresh.list().length).toBe(1);
    expect(ledger.cash).toBe(cash);
  });
});

describe('upgrades — each level costs more, and a rejected buy changes nothing', () => {
  it('cost grows every level and a maxed upgrade has no next cost', () => {
    const u = new Upgrades(DEFAULT_UPGRADES);
    const l = new Ledger(1e12);
    let prev = 0;
    for (let i = 0; i < 8; i++) {
      const c = u.nextCost('shelf_space');
      expect(c).toBeGreaterThan(prev);
      prev = c;
      expect(u.buy('shelf_space', l).ok).toBe(true);
    }
    expect(u.nextCost('shelf_space')).toBeNull();
  });

  it('a maxed upgrade is NOT charged again', () => {
    const u = new Upgrades([{ id: 'x', name: 'x', baseCost: 100, maxLevel: 1, base: 1, step: 1 }]);
    const l = new Ledger(10000);
    expect(u.buy('x', l).ok).toBe(true);
    const cash = l.cash;
    expect(u.buy('x', l)).toEqual({ ok: false, reason: 'maxed' });
    expect(l.cash).toBe(cash);
    expect(u.level('x')).toBe(1);
  });

  it('cannot_afford changes neither cash nor level', () => {
    const u = new Upgrades(DEFAULT_UPGRADES);
    const l = new Ledger(10);
    expect(u.buy('foot_traffic', l)).toEqual({ ok: false, reason: 'cannot_afford' });
    expect(l.cash).toBe(10);
    expect(u.level('foot_traffic')).toBe(0);
    expect(u.buy('nope', l)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('effect is base + level x step and 1 for an unknown upgrade', () => {
    const u = new Upgrades(DEFAULT_UPGRADES);
    const l = new Ledger(1e12);
    u.buy('shelf_space', l); u.buy('shelf_space', l);
    expect(u.effect('shelf_space')).toBeCloseTo(1.5, 10);
    expect(u.effect('nope')).toBe(1);
  });
});

describe('economy — selling', () => {
  it('sells only what is on the shelf, at the current price, into integer cash', () => {
    const e = stocked();
    const before = e.ledger.cash;
    const r = e.sell('atta', 3);
    expect(r.sold).toBe(3);
    expect(r.revenue).toBe(toMinor(230) * 3);
    expect(e.ledger.cash - before).toBe(r.revenue);
    expect(Number.isInteger(e.ledger.cash)).toBe(true);
  });

  it('sells nothing it does not have, and nothing that is only in the stock room', () => {
    const e = new Economy(cfg());
    e.inventory.receive('atta', 10);
    expect(e.sell('atta', 1)).toEqual({ sold: 0, revenue: 0, productId: 'atta' });
    expect(e.sell('ghost', 1).sold).toBe(0);
  });

  it('a price change changes the revenue per unit', () => {
    const e = stocked();
    expect(e.setPrice('atta', toMinor(260))).toBe(toMinor(260));
    expect(e.sell('atta', 1).revenue).toBe(toMinor(260));
  });

  it('clamps a price to the markup ceiling and to non-negative', () => {
    const e = stocked();
    expect(e.setPrice('atta', toMinor(100000))).toBe(toMinor(230) * 3);
    expect(e.setPrice('atta', -50)).toBe(0);
    expect(e.setPrice('ghost', 5)).toBe(0);
  });
});

describe('economy — customers decide', () => {
  const unitsAfter = (price: number, customers: number) => {
    const e = stocked({ autoCustomers: false });
    e.setPrice('atta', price);
    e.setPrice('oil', toMinor(175));
    let atta = 0;
    for (let i = 0; i < customers; i++) {
      for (const p of PRODUCTS) { e.inventory.receive(p.id, 40); e.restockShelf(p.id); }
      const r = e.serveCustomer();
      if (r && r.productId === 'atta') atta += r.sold;
    }
    return atta;
  };

  it('raising the price sells FEWER units — the pricing screen is a decision', () => {
    const cheap = unitsAfter(toMinor(200), 600);
    const fair = unitsAfter(toMinor(230), 600);
    const dear = unitsAfter(toMinor(400), 600);
    expect(cheap).toBeGreaterThan(fair);
    expect(fair).toBeGreaterThan(dear);
  });

  it('at the markup ceiling nobody buys that product', () => {
    expect(unitsAfter(toMinor(230) * 3, 300)).toBe(0);
  });

  it('is deterministic — the same seed replays the same customers', () => {
    const run = () => {
      const e = stocked({ autoCustomers: false, seed: 11 });
      const log: string[] = [];
      for (let i = 0; i < 60; i++) { const r = e.serveCustomer(); log.push(r ? r.productId : '-'); }
      return log.join(',');
    };
    expect(run()).toBe(run());
  });

  it('an empty shelf loses the customer and costs reputation, and says why', () => {
    const events: Array<[string, Record<string, unknown>]> = [];
    const e = new Economy(cfg({ onEvent: (n: string, p: Record<string, unknown>) => events.push([n, p]) }));
    const rep = e.reputation;
    expect(e.serveCustomer()).toBeNull();
    expect(e.reputation).toBeLessThan(rep);
    expect(events.find(([n]) => n === 'CUSTOMER_LEFT')?.[1]).toEqual({ why: 'empty' });
  });

  it('reputation stays inside 0..1 however many customers are lost or served', () => {
    const e = new Economy(cfg({ autoCustomers: false }));
    for (let i = 0; i < 500; i++) e.serveCustomer();
    expect(e.reputation).toBe(0);
    const s = stocked({ autoCustomers: false });
    for (let i = 0; i < 400; i++) { for (const p of PRODUCTS) { s.inventory.receive(p.id, 40); s.restockShelf(p.id); } s.serveCustomer(); }
    expect(s.reputation).toBeLessThanOrEqual(1);
    expect(s.reputation).toBeGreaterThan(0.5);
  });
});

describe('economy — time, days and money', () => {
  it('automatic customers bring real sales as time passes', () => {
    const e = stocked();
    const before = e.ledger.cash;
    for (let i = 0; i < 600; i++) e.tick(0.1);
    expect(e.ledger.cash).toBeGreaterThan(before);
  });

  it('ignores a NaN, negative or zero step and clamps a huge one', () => {
    const e = stocked();
    const snap = JSON.stringify(e.serialize());
    e.tick(NaN); e.tick(-5); e.tick(0);
    expect(JSON.stringify(e.serialize())).toBe(snap);
    e.tick(1e9); // one clamped step, not a billion customers
    expect(e.day).toBe(1);
  });

  it('ends the day, pays rent and wages, and reports an honest profit', () => {
    const events: Array<[string, any]> = [];
    const e = stocked({ autoCustomers: false, dayLength: 60, rentPerDay: toMinor(200), wagePerDay: toMinor(100), onEvent: (n: string, p: any) => events.push([n, p]) });
    e.setStaff(2);
    e.sell('atta', 4);
    const cash = e.ledger.cash;
    for (let i = 0; i < 13; i++) e.tick(5);
    const end = events.find(([n]) => n === 'DAY_ENDED')![1];
    expect(e.day).toBe(2);
    expect(end.expenses).toBe(toMinor(400));
    expect(end.revenue).toBe(toMinor(230) * 4);
    expect(end.cogs).toBe(toMinor(180) * 4);
    expect(end.profit).toBe(end.revenue - end.cogs - end.expenses);
    expect(e.ledger.cash).toBe(cash - toMinor(400));
  });

  it('what cannot be paid becomes DEBT (cash never negative) and is repaid first', () => {
    const e = new Economy(cfg({ autoCustomers: false, dayLength: 10, startCash: toMinor(50), rentPerDay: toMinor(200) }));
    e.tick(5); e.tick(5);
    expect(e.ledger.cash).toBe(0);
    expect(e.debt).toBe(toMinor(150));
    e.ledger.earn(toMinor(1000), 'gift');
    e.tick(5); e.tick(5);
    expect(e.debt).toBe(0);
    expect(e.ledger.cash).toBeGreaterThanOrEqual(0);
    expect(e.ledger.cash).toBe(toMinor(1000) - toMinor(150) - toMinor(200));
  });

  it('a listener that throws cannot corrupt the till', () => {
    const e = stocked({ onEvent: () => { throw new Error('boom'); } });
    expect(() => e.sell('atta', 1)).not.toThrow();
    expect(e.inventory.onShelf('atta')).toBe(11);
  });

  it('a double-tapped order button buys once', () => {
    const e = new Economy(cfg());
    const cash = e.ledger.cash;
    const a = e.order('atta', 20, 'click-1');
    const b = e.order('atta', 20, 'click-1');
    expect(a.ok && b.ok && b.duplicate).toBe(true);
    expect(cash - e.ledger.cash).toBe(toMinor(180) * 20);
  });

  it('upgrades take effect: shelf space, foot traffic and delivery speed', () => {
    const e = new Economy(cfg({ startCash: toMinor(1_000_000) }));
    const cap = e.inventory.shelfCap('atta');
    const rate = e.arrivalsPerMinute();
    expect(e.buyUpgrade('shelf_space').ok).toBe(true);
    expect(e.buyUpgrade('foot_traffic').ok).toBe(true);
    expect(e.buyUpgrade('fast_delivery').ok).toBe(true);
    expect(e.inventory.shelfCap('atta')).toBeGreaterThan(cap);
    expect(e.arrivalsPerMinute()).toBeGreaterThan(rate);
    e.order('oil', 5);
    expect(e.orders.list()[0].eta).toBeLessThan(30);
  });
});

describe('economy — offline earnings are never free money', () => {
  const trained = () => {
    const e = stocked({ dayLength: 60, rentPerDay: toMinor(100), baseArrivalsPerMinute: 30 });
    for (let day = 0; day < 3; day++) {
      for (const p of PRODUCTS) { e.inventory.receive(p.id, 48); e.restockShelf(p.id); }
      for (let i = 0; i < 600; i++) e.tick(0.1);
    }
    for (const p of PRODUCTS) { e.inventory.receive(p.id, 48); e.restockShelf(p.id); }
    return e;
  };

  it('earns something, but only from stock that was really on the shelf', () => {
    const e = trained();
    const shelf = e.inventory.shelfTotal();
    const r = e.simulateOffline(OFFLINE_CAP_SECONDS);
    expect(r.units).toBeGreaterThan(0);
    expect(r.units).toBeLessThanOrEqual(shelf);
    expect(r.revenue).toBeGreaterThan(0);
  });

  it('is capped at 8 hours: a week away earns the same as eight hours', () => {
    const a = trained(); const b = trained();
    const eight = a.simulateOffline(OFFLINE_CAP_SECONDS);
    const week = b.simulateOffline(7 * 24 * 3600);
    expect(week.capped).toBe(true);
    expect(eight.capped).toBe(false);
    expect(week.simulatedSeconds).toBe(OFFLINE_CAP_SECONDS);
    expect(week.revenue).toBe(eight.revenue);
  });

  it('charges the rent for the days that passed', () => {
    const e = trained();
    const r = e.simulateOffline(600);
    expect(r.expenses).toBe(toMinor(100) * 10);
  });

  it('bad away-times earn nothing', () => {
    const e = trained();
    for (const bad of [NaN, -100, 0, Infinity, undefined]) {
      const before = e.ledger.cash;
      const r = e.simulateOffline(bad as number);
      expect(r.revenue).toBe(0);
      expect(e.ledger.cash).toBe(before);
    }
  });
});

describe('economy — saves are validated, never trusted', () => {
  it('a save round-trips through JSON to an identical game', () => {
    const e = stocked({ dayLength: 60, rentPerDay: toMinor(50) });
    e.setStaff(2); e.setPrice('atta', toMinor(250)); e.order('oil', 10, 'r');
    for (let i = 0; i < 400; i++) e.tick(0.1);
    const saved = JSON.parse(JSON.stringify(e.serialize()));
    const { economy: loaded } = Economy.restore(saved, cfg({ dayLength: 60, rentPerDay: toMinor(50) }));
    expect(JSON.stringify(loaded.serialize())).toBe(JSON.stringify(e.serialize()));
    expect(loaded.ledger.cash).toBe(e.ledger.cash);
    expect(loaded.priceOf('atta')).toBe(toMinor(250));
  });

  it('a restored game continues exactly like the original (the generator state is saved)', () => {
    const a = stocked({ autoCustomers: false });
    for (let i = 0; i < 10; i++) a.serveCustomer();
    const { economy: b } = Economy.restore(JSON.parse(JSON.stringify(a.serialize())), cfg({ autoCustomers: false }));
    const run = (e: any) => Array.from({ length: 20 }, () => { const r = e.serveCustomer(); return r ? r.productId : '-'; }).join(',');
    expect(run(b)).toBe(run(a));
  });

  it('corrupt or hostile saves never throw and never produce NaN', () => {
    const bad: unknown[] = [null, undefined, 'x', 5, [], {}, { v: 2 }, { v: 1 },
      { v: 1, ledger: { cash: NaN }, day: 'a', dayClock: Infinity, staff: -9, debt: -1, rep: 99, acc: NaN, rng: NaN, savedAt: 'x',
        inventory: { shelf: { atta: NaN, ghost: 5 }, back: { oil: 1e99 } }, orders: { pending: [{ productId: 'atta', qty: NaN, eta: NaN }, 7, null] },
        upgrades: { shelf_space: 1e9, ghost: 4 }, prices: { atta: NaN, oil: -5 }, rate: { atta: -1, oil: Infinity } }];
    for (const raw of bad) {
      let e: any;
      expect(() => { e = Economy.restore(raw, cfg(), 1e12).economy; }).not.toThrow();
      const s = JSON.stringify(e.serialize());
      expect(s).not.toContain('null'); // JSON.stringify turns NaN into null
      expect(Number.isFinite(e.ledger.cash)).toBe(true);
      expect(e.reputation).toBeGreaterThanOrEqual(0);
      expect(e.reputation).toBeLessThanOrEqual(1);
      expect(e.inventory.onShelf('atta')).toBeLessThanOrEqual(e.inventory.shelfCap('atta'));
      for (let i = 0; i < 50; i++) e.tick(0.5);
      expect(Number.isFinite(e.ledger.cash)).toBe(true);
    }
  });

  it('unknown products in a save are dropped, known ones kept', () => {
    const e = stocked();
    const saved = JSON.parse(JSON.stringify(e.serialize()));
    saved.inventory.shelf.ghost = 7;
    const { economy } = Economy.restore(saved, cfg({ products: [PRODUCTS[0]] }));
    expect(economy.inventory.has('ghost')).toBe(false);
    expect(economy.inventory.onShelf('atta')).toBe(12);
  });

  it('works out time away from the saved time, and a clock that went backwards earns nothing', () => {
    const e = stocked({ dayLength: 60, baseArrivalsPerMinute: 30 });
    for (let day = 0; day < 2; day++) { for (const p of PRODUCTS) { e.inventory.receive(p.id, 48); e.restockShelf(p.id); } for (let i = 0; i < 600; i++) e.tick(0.1); }
    for (const p of PRODUCTS) { e.inventory.receive(p.id, 48); e.restockShelf(p.id); }
    const saved = JSON.parse(JSON.stringify(e.serialize(1_000_000)));
    const later = Economy.restore(saved, cfg({ dayLength: 60, baseArrivalsPerMinute: 30 }), 1_000_000 + 3600 * 1000);
    expect(later.offline!.simulatedSeconds).toBe(3600);
    expect(later.offline!.revenue).toBeGreaterThan(0);
    const back = Economy.restore(saved, cfg({ dayLength: 60, baseArrivalsPerMinute: 30 }), 1_000_000 - 3600 * 1000);
    expect(back.offline!.revenue).toBe(0);
    const none = Economy.restore(saved, cfg({ dayLength: 60, baseArrivalsPerMinute: 30 }));
    expect(none.offline).toBeNull();
  });
});

describe('the emitted kit', () => {
  it('declares exactly the modules it emits, and has no dependency', () => {
    const names = Object.keys(all.files).map((f) => (f.split('/').pop() ?? '').replace(/\.ts$/, '')).sort();
    expect(names).toEqual([...GAME_ECONOMY_MODULES].sort());
    expect(all.dependencies).toEqual([]);
  });

  it('imports nothing outside its own folder — it works in a 2D game and the 3D shell alike', () => {
    for (const [path, src] of Object.entries(all.files)) {
      for (const m of src.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        expect(m[1].startsWith('./'), path + ' imports ' + m[1]).toBe(true);
        const target = 'src/game/economy/' + m[1].slice(2) + '.ts';
        expect(Object.keys(all.files), path + ' imports ' + m[1]).toContain(target);
      }
    }
  });

  it('every subset a builder may ask for is import-closed and loads', () => {
    for (const include of [['pricing'], ['money'], ['inventory'], ['orders'], ['upgrades'], ['ledger'], ['economy'], ['nonsense']]) {
      const files = generateGameEconomy(include).files;
      for (const [path, src] of Object.entries(files)) {
        for (const m of src.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
          expect(Object.keys(files), include + ': ' + path + ' imports ' + m[1]).toContain('src/game/economy/' + m[1].slice(2) + '.ts');
        }
      }
      expect(() => loadAll(files)).not.toThrow();
    }
  });

  it('every emitted file parses as real TypeScript (a stray backtick would truncate it silently)', () => {
    for (const [path, src] of Object.entries(all.files)) {
      const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')), path).toEqual([]);
    }
  });

  it('type-checks under strict, noUnusedLocals and noUnusedParameters — the flags a real app is built with', () => {
    const options: ts.CompilerOptions = {
      strict: true, noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true, noEmit: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts'], skipLibCheck: true, isolatedModules: true,
    };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    const exists = host.fileExists.bind(host);
    const mem = new Map(Object.entries(all.files).map(([p, c]) => ['/virtual/' + p, c]));
    const isDir = host.directoryExists?.bind(host);
    host.directoryExists = (d) => [...mem.keys()].some((k) => k.startsWith(d.endsWith('/') ? d : d + '/')) || (isDir ? isDir(d) : false);
    host.fileExists = (f) => mem.has(f) || exists(f);
    host.readFile = (f) => mem.get(f) ?? read(f);
    host.getSourceFile = (f, lang) => {
      const text = mem.get(f) ?? read(f);
      return text === undefined ? undefined : ts.createSourceFile(f, text, lang, true);
    };
    const program = ts.createProgram([...mem.keys()], options, host);
    const errors = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(errors).toEqual([]);
  });

  it('the instructions example uses names the kit really exports', () => {
    for (const name of ['Economy', 'toMinor', 'fmtMoney', 'order', 'restockShelf', 'setPrice', 'serveCustomer', 'serialize', 'restore']) {
      expect(all.instructions).toContain(name);
    }
    const index = all.files['src/game/economy/index.ts'];
    for (const name of ['Economy', 'toMinor', 'fmtMoney', 'demandFactor', 'Ledger', 'Inventory', 'OrderBook', 'Upgrades']) {
      expect(index).toContain(name);
    }
  });
});

describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');
  const prompt = readFileSync(join(__dirname, '../AgentV3/systemPrompt.ts'), 'utf8');
  const layers = readFileSync(join(__dirname, './gameRecipeLayers.ts'), 'utf8');
  const knowledge = readFileSync(join(__dirname, '../AppContext/AppKnowledgeBase.ts'), 'utf8');

  it('is registered as a definition, in BOTH exposed lists, and in the recipe map', () => {
    expect(catalog).toContain("name: 'generate_game_economy'");
    expect(catalog.match(/^ {2}'generate_game_economy',$/gm)?.length).toBe(2);
    expect(layers).toContain('generate_game_economy: generateGameEconomy');
  });

  it('the dispatcher handles it and writes the files', () => {
    expect(dispatcher).toContain("case 'generate_game_economy': {");
    expect(dispatcher).toContain('generateGameEconomy(gecInclude)');
  });

  it('the architect prompt tells the builder when to reach for it', () => {
    expect(prompt).toContain('run_recipe({ name: "generate_game_economy" })');
  });

  it('the description names the rules so the model does not reimplement them badly', () => {
    const at = catalog.indexOf("name: 'generate_game_economy'");
    const def = catalog.slice(at, at + 3000);
    for (const word of ['INTEGER', 'atomic', 'BEFORE it is paid', 'request id', 'ON THE SHELF', 'offline']) expect(def, word).toContain(word);
  });

  it('every AI can explain it, honestly (AppKnowledgeBase)', () => {
    expect(knowledge).toContain('generate_game_economy');
    expect(knowledge).toContain('Honest limits: this is the money half only');
  });
});
