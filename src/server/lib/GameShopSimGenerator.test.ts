import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameShopSim, GAME_SHOPSIM_MODULES } from './GameShopSimGenerator';
import { generateGameEconomy } from './GameEconomyGenerator';

/**
 * THESE TESTS RUN THE GENERATED CODE — the economy core and the shop simulation together, exactly as a game
 * holds them. The rule that matters most here is CONSERVATION: every unit is on the shelf, in the stock room,
 * in a customer's hand, or sold — never lost and never invented — across thousands of customers.
 */
const shopFiles = generateGameShopSim().files;
const econFiles = generateGameEconomy().files;
const everything: Record<string, string> = { ...econFiles, ...shopFiles };

/** Compile and load every module of both layers, resolving relative imports by folder. */
function loadAll(files: Record<string, string> = everything): Record<string, Record<string, any>> {
  const cache: Record<string, Record<string, any>> = {};
  const resolve = (from: string, spec: string): string => {
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    return parts.join('/') + '.ts';
  };
  const load = (path: string): Record<string, any> => {
    if (cache[path]) return cache[path];
    const source = files[path];
    expect(source, path + ' was not emitted').toBeTruthy();
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, any> = {};
    cache[path] = exports;
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', js)(exports, (id: string) => load(resolve(path, id)));
    return exports;
  };
  for (const p of Object.keys(files)) load(p);
  return cache;
}

const mods = loadAll();
const { Economy } = mods['src/game/economy/economy.ts'];
const { toMinor } = mods['src/game/economy/money.ts'];
const { Grid, findPath } = mods['src/game/shop/grid.ts'];
const { ShopSim } = mods['src/game/shop/shopsim.ts'];

const PRODUCTS = [
  { id: 'atta', name: 'Atta', cost: toMinor(180), price: toMinor(230), shelfCapacity: 12, demand: 2 },
  { id: 'oil', name: 'Oil', cost: toMinor(140), price: toMinor(175), shelfCapacity: 10 },
];

/** A 12 x 8 shop: door left, exit right, one wall of shelves, two counters. */
const LAYOUT = {
  width: 12, height: 8, entrance: { x: 0, y: 4 }, exit: { x: 11, y: 4 }, backroom: { x: 1, y: 0 },
  blocked: [{ x: 4, y: 1 }, { x: 5, y: 1 }, { x: 8, y: 1 }, { x: 9, y: 1 }],
  shelves: [{ productId: 'atta', stand: { x: 4, y: 2 } }, { productId: 'oil', stand: { x: 8, y: 2 } }],
  checkouts: [
    { cashier: { x: 6, y: 6 }, queue: [{ x: 6, y: 5 }, { x: 6, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 4 }] },
    { cashier: { x: 10, y: 6 }, queue: [{ x: 10, y: 5 }, { x: 10, y: 4 }, { x: 9, y: 4 }, { x: 8, y: 4 }] },
  ],
};

function build(opts: { seed?: number; arrivals?: number; stockBoth?: number; sim?: Record<string, unknown>; layout?: any; econ?: Record<string, unknown> } = {}) {
  const economy = new Economy({
    products: PRODUCTS, seed: opts.seed ?? 3, startCash: toMinor(100000), autoCustomers: false,
    baseArrivalsPerMinute: opts.arrivals ?? 20, ...(opts.econ ?? {}),
  });
  const stock = opts.stockBoth ?? 12;
  for (const p of PRODUCTS) { economy.inventory.receive(p.id, stock); economy.restockShelf(p.id); }
  const events: Array<[string, any]> = [];
  const shop = new ShopSim(economy, opts.layout ?? LAYOUT, { seed: opts.seed ?? 3, onEvent: (n: string, p: any) => events.push([n, p]), ...(opts.sim ?? {}) });
  return { economy, shop, events };
}

const total = (e: any, sold: number, shop: any) =>
  PRODUCTS.reduce((t, p) => t + e.inventory.onShelf(p.id) + e.inventory.inBackroom(p.id), 0) + shop.inHand() + sold;

const run = (shop: any, economy: any, seconds: number, step = 0.1) => { for (let t = 0; t < seconds; t += step) { economy.tick(step); shop.update(step); } };

describe('grid and pathfinding', () => {
  const g = new Grid(6, 5, [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }]);

  it('finds the shortest route and excludes the start, includes the goal', () => {
    const open = new Grid(5, 5);
    const p = findPath(open, { x: 0, y: 0 }, { x: 3, y: 0 })!;
    expect(p).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  });

  it('goes AROUND a wall', () => {
    const p = findPath(g, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(p[p.length - 1]).toEqual({ x: 4, y: 0 });
    expect(p.every((c: any) => g.walkable(c))).toBe(true);
    expect(p.some((c: any) => c.y === 4)).toBe(true);
  });

  it('moves one orthogonal step at a time — never cuts a corner', () => {
    const p = findPath(g, { x: 0, y: 0 }, { x: 5, y: 0 })!;
    let prev = { x: 0, y: 0 };
    for (const c of p) { expect(Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y)).toBe(1); prev = c; }
  });

  it('is [] when already there, and null for a wall, outside the grid or a sealed room', () => {
    expect(findPath(g, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual([]);
    expect(findPath(g, { x: 0, y: 0 }, { x: 2, y: 1 })).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, { x: 99, y: 0 })).toBeNull();
    expect(findPath(g, { x: -1, y: 0 }, { x: 0, y: 0 })).toBeNull();
    const sealed = new Grid(5, 5, [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    expect(findPath(sealed, { x: 0, y: 0 }, { x: 4, y: 4 })).toBeNull();
  });

  it('the same grid always gives the same path', () => {
    const a = JSON.stringify(findPath(g, { x: 0, y: 0 }, { x: 5, y: 4 }));
    for (let i = 0; i < 5; i++) expect(JSON.stringify(findPath(g, { x: 0, y: 0 }, { x: 5, y: 4 }))).toBe(a);
  });

  it('is BOUNDED: one impossible request on the biggest grid cannot freeze a frame', () => {
    const wall: any[] = [];
    for (let y = 0; y < 64; y++) wall.push({ x: 32, y });
    const big = new Grid(64, 64, wall);
    const t = Date.now();
    expect(findPath(big, { x: 0, y: 0 }, { x: 63, y: 63 })).toBeNull();
    expect(Date.now() - t).toBeLessThan(1000);
    expect(findPath(big, { x: 0, y: 0 }, { x: 63, y: 63 }, 10)).toBeNull();
  });

  it('caps the grid size and treats bad numbers as 1', () => {
    expect(new Grid(10_000, 10_000).width).toBe(64);
    expect(new Grid(NaN, -5).width).toBe(1);
    expect(new Grid(NaN, -5).height).toBe(1);
  });
});

describe('layout problems are NAMED, not discovered as a frozen customer', () => {
  it('a good layout has none', () => {
    const { shop } = build();
    expect(shop.problems()).toEqual([]);
  });

  it('names a product with no shelf, a missing counter and a shelf behind a wall', () => {
    const noShelf = build({ layout: { ...LAYOUT, shelves: [LAYOUT.shelves[0]] } }).shop.problems();
    expect(noShelf.join('\n')).toContain('product "oil" has no shelf');
    const noCounter = build({ layout: { ...LAYOUT, checkouts: [] } }).shop.problems();
    expect(noCounter.join('\n')).toContain('no checkout counter');
    const sealed = build({ layout: { ...LAYOUT, blocked: [...LAYOUT.blocked, { x: 3, y: 2 }, { x: 4, y: 3 }, { x: 5, y: 2 }, { x: 4, y: 1 }] } }).shop.problems();
    expect(sealed.join('\n')).toContain('shelf "atta"');
  });

  it('names a cell that is a wall or off the grid', () => {
    const p = build({ layout: { ...LAYOUT, entrance: { x: 99, y: 0 } } }).shop.problems();
    expect(p.join('\n')).toContain('entrance (99,0)');
  });

  it('a hostile layout never throws', () => {
    for (const layout of [null, undefined, {}, { width: NaN }, { shelves: 5, checkouts: 'x' }, { checkouts: [{ cashier: null, queue: 7 }] }]) {
      expect(() => { const { shop } = build({ layout }); shop.update(1); shop.problems(); shop.snapshot(); }).not.toThrow();
    }
  });
});

describe('conservation — a unit is never lost and never invented', () => {
  it('holds across a long shift with a cashier, a stocker and orders', () => {
    const { economy, shop } = build({ arrivals: 40, stockBoth: 30 });
    shop.hire('cashier'); shop.hire('cashier'); shop.hire('stocker');
    const start = total(economy, 0, shop);
    let sold = 0;
    for (let t = 0; t < 3000; t += 0.1) {
      economy.tick(0.1); shop.update(0.1);
      if (Math.round(t * 10) % 600 === 0) { economy.order('atta', 20); }
    }
    sold = shop.stats().served;
    expect(sold).toBeGreaterThan(50);
    const delivered = economy.ledger.totalFor('restock') / -1; // money spent on orders
    expect(delivered).toBeGreaterThan(0);
    // units now = start + delivered units - sold
    const unitsOrdered = Math.round(Math.abs(economy.ledger.totalFor('restock')) / economy.inventory.def('atta').cost);
    expect(total(economy, sold, shop)).toBeGreaterThanOrEqual(start);
    expect(total(economy, sold, shop)).toBeLessThanOrEqual(start + unitsOrdered);
  });

  it('holds exactly when there are no orders: shelf + stock room + hands + sold = what we started with', () => {
    const { economy, shop } = build({ arrivals: 60, stockBoth: 40 });
    shop.hire('cashier'); shop.hire('stocker');
    const start = total(economy, 0, shop);
    for (let i = 0; i < 20_000; i++) {
      economy.tick(0.1); shop.update(0.1);
      if (i % 500 === 0) expect(total(economy, shop.stats().served, shop), 'at step ' + i).toBe(start);
    }
    expect(total(economy, shop.stats().served, shop)).toBe(start);
    expect(shop.stats().served).toBeGreaterThan(20);
  });

  it('holds when customers ABANDON the queue (nobody is serving)', () => {
    const { economy, shop } = build({ arrivals: 60, stockBoth: 40, sim: { patienceSeconds: 5 } });
    const start = total(economy, 0, shop);
    run(shop, economy, 600);
    expect(shop.stats().abandoned).toBeGreaterThan(5);
    expect(shop.stats().served).toBe(0);
    expect(total(economy, 0, shop)).toBe(start);
  });

  it('the last unit cannot be taken by two customers', () => {
    const { economy, shop } = build({ arrivals: 120, stockBoth: 1 });
    shop.hire('cashier');
    run(shop, economy, 300);
    for (const p of PRODUCTS) {
      expect(economy.inventory.onShelf(p.id)).toBeGreaterThanOrEqual(0);
      expect(economy.inventory.inBackroom(p.id)).toBeGreaterThanOrEqual(0);
    }
    expect(shop.stats().served).toBeLessThanOrEqual(PRODUCTS.length);
  });
});

describe('money moves only at a counter', () => {
  it('with nobody serving, no sale is made and customers give up', () => {
    const { economy, shop, events } = build({ arrivals: 30, sim: { patienceSeconds: 5 } });
    const cash = economy.ledger.cash;
    run(shop, economy, 300);
    expect(economy.ledger.cash).toBe(cash);
    expect(events.some(([n]) => n === 'CUSTOMER_PAID')).toBe(false);
    expect(events.some(([n]) => n === 'CUSTOMER_ABANDONED')).toBe(true);
  });

  it('a cashier brings real revenue, and the till gets exactly price x sales', () => {
    const { economy, shop } = build({ arrivals: 20, stockBoth: 40 });
    shop.hire('cashier');
    const cash = economy.ledger.cash;
    run(shop, economy, 300);
    const served = shop.stats().served;
    expect(served).toBeGreaterThan(10);
    expect(economy.ledger.cash - cash).toBe(economy.ledger.totalFor('sale'));
    expect(economy.ledger.totalFor('sale')).toBeGreaterThanOrEqual(served * toMinor(175));
  });

  it('the player serves a counter only while standing at it', () => {
    const { economy, shop } = build({ arrivals: 20, stockBoth: 40 });
    run(shop, economy, 120);
    expect(shop.stats().served).toBe(0);
    shop.setPlayerAt(0); shop.setPlayerAt(1);
    run(shop, economy, 120);
    expect(shop.stats().served).toBeGreaterThan(0);
    const before = shop.stats().served;
    shop.setPlayerAt(null);
    run(shop, economy, 20);
    expect(shop.stats().served).toBeLessThanOrEqual(before + 2);
  });

  it('a bad counter index for setPlayerAt is ignored', () => {
    const { shop } = build();
    for (const bad of [-1, 99, NaN, 1.5, undefined, 'x']) expect(() => shop.setPlayerAt(bad as any)).not.toThrow();
  });
});

describe('staff', () => {
  it('hiring sets the economy staff count (so wages are charged) and firing lowers it', () => {
    const { economy, shop } = build();
    const a = shop.hire('cashier')!; shop.hire('stocker');
    expect(economy.staff).toBe(2);
    expect(shop.fire(a)).toBe(true);
    expect(economy.staff).toBe(1);
    expect(shop.fire(a)).toBe(false);
  });

  it('refuses a third cashier when there are two counters, and bad roles', () => {
    const { shop } = build();
    expect(shop.hire('cashier')).not.toBeNull();
    expect(shop.hire('cashier')).not.toBeNull();
    expect(shop.hire('cashier')).toBeNull();
    expect(shop.hire('janitor' as any)).toBeNull();
  });

  it('a stocker refills a shelf from the stock room; without one the shelf stays empty', () => {
    const empty = (hire: boolean) => {
      const { economy, shop } = build({ arrivals: 0, stockBoth: 0 });
      economy.inventory.receive('atta', 30);
      if (hire) shop.hire('stocker');
      run(shop, economy, 60);
      return economy.inventory.onShelf('atta');
    };
    expect(empty(false)).toBe(0);
    expect(empty(true)).toBe(12);
  });

  it('two stockers do not both fetch the same shelf', () => {
    const { economy, shop, events } = build({ arrivals: 0, stockBoth: 0 });
    economy.inventory.receive('atta', 30);
    shop.hire('stocker'); shop.hire('stocker');
    run(shop, economy, 3);
    const walking = shop.snapshot().staff.filter((s: any) => s.state === 'walking_to_shelf' || s.state === 'restocking');
    expect(walking.length).toBe(1);
    run(shop, economy, 60);
    expect(events.filter(([n, p]) => n === 'SHELF_FILLED' && p.moved > 0).length).toBe(1);
  });

  it('staff are capped', () => {
    const { shop } = build();
    let hired = 0;
    for (let i = 0; i < 100; i++) if (shop.hire('stocker') !== null) hired++;
    expect(hired).toBe(20);
  });
});

describe('the crowd and the queue are bounded', () => {
  it('never exceeds maxCustomers, and counts the ones turned away at the door', () => {
    const { economy, shop } = build({ arrivals: 600, stockBoth: 40, sim: { maxCustomers: 5, patienceSeconds: 600 } });
    for (let i = 0; i < 600; i++) { economy.tick(0.1); shop.update(0.1); expect(shop.snapshot().customers.length).toBeLessThanOrEqual(5); }
    expect(shop.stats().floorFull).toBeGreaterThan(0);
  });

  it('a full queue turns the customer away and puts the item back', () => {
    const { economy, shop, events } = build({ arrivals: 120, stockBoth: 40, sim: { patienceSeconds: 600 } });
    const start = total(economy, 0, shop);
    run(shop, economy, 200);
    const lines = shop.snapshot().lines;
    for (const n of lines) expect(n).toBeLessThanOrEqual(4);
    expect(events.some(([n, p]) => n === 'CUSTOMER_LEFT' && p.why === 'queue')).toBe(true);
    expect(total(economy, 0, shop)).toBe(start);
  });

  it('a long session keeps the customer list small once the shop is served', () => {
    const { economy, shop } = build({ arrivals: 30, stockBoth: 40 });
    shop.hire('cashier'); shop.hire('cashier'); shop.hire('stocker');
    for (let i = 0; i < 36_000; i++) { economy.tick(0.1); shop.update(0.1); if (i % 100 === 0) economy.order('atta', 10); }
    expect(shop.snapshot().customers.length).toBeLessThanOrEqual(30);
  });
});

describe('people really move through the shop', () => {
  it('a customer walks from the door to the shelf, the counter and the exit, in that order', () => {
    const { economy, shop, events } = build({ arrivals: 6, stockBoth: 40 });
    shop.hire('cashier');
    const seen = new Set<string>();
    let first: number | null = null;
    for (let i = 0; i < 3000; i++) {
      economy.tick(0.1); shop.update(0.1);
      for (const c of shop.snapshot().customers) {
        if (first === null) first = c.id;
        if (c.id === first) seen.add(c.state);
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining(['walking_to_shelf', 'picking', 'walking_to_queue', 'queueing', 'leaving']));
    expect(events.some(([n]) => n === 'CUSTOMER_PAID')).toBe(true);
  });

  it('positions stay inside the grid and on walkable ground', () => {
    const { economy, shop } = build({ arrivals: 60, stockBoth: 40 });
    shop.hire('cashier'); shop.hire('stocker');
    for (let i = 0; i < 3000; i++) {
      economy.tick(0.1); shop.update(0.1);
      for (const p of [...shop.snapshot().customers, ...shop.snapshot().staff]) {
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(11);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(7);
        expect(shop.grid.walkable({ x: Math.round(p.x), y: Math.round(p.y) })).toBe(true);
      }
    }
  });

  it('is deterministic — the same seed replays the same shop', () => {
    const go = () => {
      const { economy, shop } = build({ seed: 21, arrivals: 30, stockBoth: 30 });
      shop.hire('cashier'); shop.hire('stocker');
      run(shop, economy, 400);
      return JSON.stringify([shop.stats(), economy.ledger.cash, shop.snapshot()]);
    };
    expect(go()).toBe(go());
  });

  it('update ignores a NaN, negative or zero step and splits a long one', () => {
    const { economy, shop } = build({ arrivals: 30 });
    const snap = JSON.stringify(shop.snapshot());
    shop.update(NaN); shop.update(-3); shop.update(0);
    expect(JSON.stringify(shop.snapshot())).toBe(snap);
    expect(() => shop.update(1e9)).not.toThrow();
    expect(economy.ledger.cash).toBeGreaterThan(0);
  });

  it('a listener that throws cannot corrupt the shop', () => {
    const { economy, shop } = build({ arrivals: 60, stockBoth: 40, sim: { onEvent: () => { throw new Error('boom'); } } });
    shop.hire('cashier');
    expect(() => run(shop, economy, 120)).not.toThrow();
    expect(shop.stats().served).toBeGreaterThan(0);
  });
});

describe('the economy methods the people use', () => {
  it('chooseProduct decides without selling; serveCustomer is chooseProduct + sell', () => {
    const e = new Economy({ products: PRODUCTS, seed: 5, autoCustomers: false });
    e.inventory.receive('atta', 12); e.restockShelf('atta');
    const id = e.chooseProduct();
    expect(['atta', null]).toContain(id);
    expect(e.inventory.onShelf('atta')).toBe(12);
    const a = new Economy({ products: PRODUCTS, seed: 5, autoCustomers: false });
    const b = new Economy({ products: PRODUCTS, seed: 5, autoCustomers: false });
    for (const x of [a, b]) { x.inventory.receive('atta', 12); x.restockShelf('atta'); }
    for (let i = 0; i < 40; i++) {
      const r1 = a.serveCustomer();
      const pick = b.chooseProduct();
      const r2 = pick === null ? null : b.sell(pick, 1);
      expect(r2 ? r2.revenue : null).toBe(r1 ? r1.revenue : null);
    }
  });

  it('settle pays for units already taken, and putBack never loses a unit', () => {
    const e = new Economy({ products: PRODUCTS, seed: 5, autoCustomers: false });
    e.inventory.receive('atta', 12); e.restockShelf('atta');
    expect(e.inventory.take('atta', 2)).toBe(2);
    const cash = e.ledger.cash;
    expect(e.settle('atta', 1).revenue).toBe(toMinor(230));
    expect(e.ledger.cash - cash).toBe(toMinor(230));
    e.inventory.putBack('atta', 1);
    expect(e.inventory.onShelf('atta') + e.inventory.inBackroom('atta')).toBe(11);
    e.restockShelf('atta');
    // shelf full AND stock room full: a returned unit still has a place
    e.inventory.receive('atta', 1000);
    const units = () => e.inventory.onShelf('atta') + e.inventory.inBackroom('atta');
    const before = units();
    expect(e.inventory.putBack('atta', 3)).toBe(3);
    expect(units()).toBe(before + 3);
  });

  it('lose() lowers reputation and records the lost customer', () => {
    const e = new Economy({ products: PRODUCTS, seed: 5, autoCustomers: false });
    const rep = e.reputation;
    e.lose('queue');
    expect(e.reputation).toBeLessThan(rep);
    for (let i = 0; i < 500; i++) e.lose('empty');
    expect(e.reputation).toBe(0);
  });
});

describe('the emitted kit', () => {
  it('declares exactly the modules it emits, has no dependency, and imports only itself or the economy layer', () => {
    const names = Object.keys(shopFiles).map((f) => (f.split('/').pop() ?? '').replace(/\.ts$/, '')).sort();
    expect(names).toEqual([...GAME_SHOPSIM_MODULES].sort());
    expect(generateGameShopSim().dependencies).toEqual([]);
    for (const [path, src] of Object.entries(shopFiles)) {
      for (const m of src.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        expect(/^\.\/|^\.\.\/economy\//.test(m[1]), path + ' imports ' + m[1]).toBe(true);
      }
    }
  });

  it('every subset is import-closed once the layers it needs are added', () => {
    for (const include of [['grid'], ['shopsim'], ['index'], ['nonsense']]) {
      const files = { ...generateGameShopSim(include).files, ...econFiles };
      expect(() => loadAll(files)).not.toThrow();
    }
  });

  it('every file parses as real TypeScript', () => {
    for (const [path, src] of Object.entries(shopFiles)) {
      const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
      const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')), path).toEqual([]);
    }
  });

  it('type-checks under strict, noUnusedLocals and noUnusedParameters together with the economy', () => {
    const options: ts.CompilerOptions = {
      strict: true, noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true, noEmit: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts'], skipLibCheck: true, isolatedModules: true,
    };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    const exists = host.fileExists.bind(host);
    const isDir = host.directoryExists?.bind(host);
    const mem = new Map(Object.entries(everything).map(([p, c]) => ['/virtual/' + p, c]));
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
});

describe('the builder can really call this', () => {
  const catalog = readFileSync(join(__dirname, '../AgentV3/ToolCatalog.ts'), 'utf8');
  const dispatcher = readFileSync(join(__dirname, '../AgentV3/ToolDispatcher.ts'), 'utf8');
  const prompt = readFileSync(join(__dirname, '../AgentV3/systemPrompt.ts'), 'utf8');
  const layers = readFileSync(join(__dirname, './gameRecipeLayers.ts'), 'utf8');
  const knowledge = readFileSync(join(__dirname, '../AppContext/AppKnowledgeBase.ts'), 'utf8');

  it('is registered as a definition, in BOTH exposed lists, and in the recipe map', () => {
    expect(catalog).toContain("name: 'generate_game_shopsim'");
    expect(catalog.match(/^ {2}'generate_game_shopsim',$/gm)?.length).toBe(2);
    expect(layers).toContain('generate_game_shopsim: generateGameShopSim');
  });

  it('the dispatcher handles it and writes the files', () => {
    expect(dispatcher).toContain("case 'generate_game_shopsim': {");
    expect(dispatcher).toContain('generateGameShopSim(gssInclude)');
  });

  it('the architect prompt tells the builder when to reach for it', () => {
    expect(prompt).toContain('run_recipe({ name: "generate_game_shopsim" })');
  });

  it('the description names the rules, and every AI can explain it honestly', () => {
    const at = catalog.indexOf("name: 'generate_game_shopsim'");
    const def = catalog.slice(at, at + 3000);
    for (const word of ['ONE place', 'counter', 'problems()', 'snapshot']) expect(def, word).toContain(word);
    expect(knowledge).toContain('generate_game_shopsim');
  });
});
