import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateGameManager, GAME_MANAGER_MODULES } from './GameManagerGenerator';
import { generateGameShopSim } from './GameShopSimGenerator';
import { generateGameEconomy } from './GameEconomyGenerator';

/**
 * THESE TESTS RUN THE GENERATED CODE — economy, shop people and the management screen together.
 *
 * The panel is exercised WITHOUT a browser: React is replaced by a tiny stand-in (state is a plain value, effects
 * do nothing, JSX makes plain objects), the component function is CALLED, and the resulting tree is walked — so a
 * test can find the "Order 25" button, press it, and check that the cash really moved. A button that does nothing,
 * or one that is enabled when its action would fail, shows up here as a failing test, not as a player's complaint.
 */
const managerFiles = generateGameManager().files;
const shopFiles = generateGameShopSim().files;
const econFiles = generateGameEconomy().files;
const everything: Record<string, string> = { ...econFiles, ...shopFiles, ...managerFiles };

interface El { type: unknown; props: Record<string, any>; key?: unknown }
const Fragment = Symbol('Fragment');
const jsxRuntime = { jsx: (type: unknown, props: Record<string, any>, key?: unknown): El => ({ type, props: props ?? {}, key }), jsxs: (type: unknown, props: Record<string, any>, key?: unknown): El => ({ type, props: props ?? {}, key }), Fragment };
const reactStub = { useState: (init: any) => { const v = typeof init === 'function' ? init() : init; return [v, () => {}]; }, useEffect: () => {} };

function loadAll(files: Record<string, string> = everything): Record<string, Record<string, any>> {
  const cache: Record<string, Record<string, any>> = {};
  const resolve = (from: string, spec: string): string => {
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    const base = parts.join('/');
    return [base + '.ts', base + '.tsx', base + '/index.ts'].find((c) => c in files) ?? base + '.ts';
  };
  const load = (path: string): Record<string, any> => {
    if (cache[path]) return cache[path];
    const source = files[path];
    expect(source, path + ' was not emitted').toBeTruthy();
    const js = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports: Record<string, any> = {};
    cache[path] = exports;
    const req = (id: string): any => {
      if (id === 'react') return reactStub;
      if (id === 'react/jsx-runtime') return jsxRuntime;
      return load(resolve(path, id));
    };
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', js)(exports, req);
    return exports;
  };
  for (const p of Object.keys(files)) load(p);
  return cache;
}

const mods = loadAll();
const { Economy } = mods['src/game/economy/economy.ts'];
const { toMinor } = mods['src/game/economy/money.ts'];
const { ShopSim } = mods['src/game/shop/shopsim.ts'];
const view = mods['src/game/manager/view.ts'];
const { ManagerPanel } = mods['src/game/manager/ManagerPanel.tsx'];

const PRODUCTS = [
  { id: 'atta', name: 'Atta', cost: toMinor(180), price: toMinor(230), shelfCapacity: 12, demand: 2 },
  { id: 'oil', name: 'Oil', cost: toMinor(140), price: toMinor(175), shelfCapacity: 10 },
];
const LAYOUT = {
  width: 12, height: 8, entrance: { x: 0, y: 4 }, exit: { x: 11, y: 4 }, backroom: { x: 1, y: 0 },
  blocked: [{ x: 4, y: 1 }, { x: 5, y: 1 }, { x: 8, y: 1 }, { x: 9, y: 1 }],
  shelves: [{ productId: 'atta', stand: { x: 4, y: 2 } }, { productId: 'oil', stand: { x: 8, y: 2 } }],
  checkouts: [
    { cashier: { x: 6, y: 6 }, queue: [{ x: 6, y: 5 }, { x: 6, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 4 }] },
    { cashier: { x: 10, y: 6 }, queue: [{ x: 10, y: 5 }, { x: 10, y: 4 }, { x: 9, y: 4 }, { x: 8, y: 4 }] },
  ],
};
const make = (cash = 100000, withShop = true, extra: Record<string, unknown> = {}) => {
  const economy = new Economy({ products: PRODUCTS, seed: 4, startCash: toMinor(cash), autoCustomers: false, wagePerDay: toMinor(150), rentPerDay: toMinor(200), dayLength: 60, ...extra });
  const shop = withShop ? new ShopSim(economy, LAYOUT, { seed: 4 }) : undefined;
  return { economy, shop };
};

// ---- walking the component tree without a browser ---------------------------------------------------------------
const walkEl = (n: any, visit: (el: El) => void): void => {
  if (n === null || n === undefined || typeof n === 'boolean' || typeof n === 'string' || typeof n === 'number') return;
  if (Array.isArray(n)) { n.forEach((c) => walkEl(c, visit)); return; }
  visit(n);
  walkEl(n.props?.children, visit);
};
const render = (props: Record<string, any>): El => ManagerPanel(props);
const textOf = (root: El): string => {
  const out: string[] = [];
  const grab = (n: any): void => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(grab); return; }
    grab(n.props?.children);
  };
  grab(root);
  // Children are joined as they are written (JSX keeps literal spaces inside its strings), so the text reads as a player sees it.
  return out.join('').replace(/\s+/g, ' ');
};
const buttons = (root: El): El[] => { const out: El[] = []; walkEl(root, (e) => { if (e.type === 'button') out.push(e); }); return out; };
const buttonText = (b: El): string => textOf(b);
const find = (root: El, label: RegExp): El => {
  const hit = buttons(root).find((b) => label.test(String(b.props['aria-label'] ?? '') + ' ' + buttonText(b)));
  expect(hit, 'no button matching ' + label).toBeTruthy();
  return hit!;
};

describe('which tabs the game can honestly show', () => {
  it('Staff exists only when there is a shop floor to hire into', () => {
    const { shop } = make();
    expect(view.availableTabs(shop)).toEqual(['overview', 'stock', 'staff', 'upgrades']);
    expect(view.availableTabs(undefined)).toEqual(['overview', 'stock', 'upgrades']);
  });

  it('the rendered tab bar matches', () => {
    const a = make();
    const withStaff = buttons(render({ economy: a.economy, shop: a.shop })).filter((b) => b.props.role === 'tab').map(buttonText);
    expect(withStaff).toEqual(['Overview', 'Stock', 'Staff', 'Upgrades']);
    const b = make(100000, false);
    const without = buttons(render({ economy: b.economy })).filter((x) => x.props.role === 'tab').map(buttonText);
    expect(without).toEqual(['Overview', 'Stock', 'Upgrades']);
  });
});

describe('a button never lies — what it says matches what happens', () => {
  it('canOrder says yes exactly when the economy would take the order, across cash and stock levels', () => {
    for (const cash of [0, 50, 500, 3000, 10_000, 1_000_000]) {
      for (const stock of [0, 20, 48]) {
        for (const qty of [1, 10, 25, 50, 100]) {
          const { economy } = make(cash);
          economy.inventory.receive('atta', stock);
          const can = view.canOrder(economy, 'atta', qty);
          const result = economy.order('atta', qty, 'probe');
          expect(can.ok, 'cash ' + cash + ', stock ' + stock + ', qty ' + qty + ': ' + can.why).toBe(result.ok);
          if (!can.ok) expect(can.why.length).toBeGreaterThan(5);
        }
      }
    }
  });

  it('the cash reason names both numbers', () => {
    const { economy } = make(10);
    const can = view.canOrder(economy, 'atta', 25);
    expect(can.ok).toBe(false);
    expect(can.why).toContain('Not enough cash');
    expect(can.why).toContain('₹4,500');
    expect(can.why).toContain('₹10');
  });

  it('counts orders already on the way when it says the stock room is full', () => {
    const { economy } = make(1_000_000);
    economy.order('atta', 48, 'a');
    const can = view.canOrder(economy, 'atta', 10);
    expect(can.ok).toBe(false);
    expect(can.why).toContain('stock room');
  });

  it('canRestock matches restockShelf, and canBuyUpgrade matches buyUpgrade', () => {
    for (const stock of [0, 5, 40]) {
      const { economy } = make();
      economy.inventory.receive('atta', stock);
      const can = view.canRestock(economy, 'atta');
      expect(can.ok).toBe(economy.restockShelf('atta') > 0);
    }
    // A FULL shelf with stock still in the room: the button must say no, not offer to move nothing.
    const full = make().economy;
    full.inventory.receive('atta', 40);
    full.restockShelf('atta');
    expect(full.inventory.inBackroom('atta')).toBeGreaterThan(0);
    const fullCan = view.canRestock(full, 'atta');
    expect(fullCan.ok).toBe(false);
    expect(fullCan.why).toContain('already full');
    expect(full.restockShelf('atta')).toBe(0);
    for (const cash of [0, 100, 1000, 100000]) {
      const { economy } = make(cash);
      for (const id of economy.upgrades.ids()) {
        const can = view.canBuyUpgrade(economy, id);
        expect(can.ok, id + ' with ' + cash).toBe(economy.buyUpgrade(id).ok);
      }
    }
  });

  it('a maxed upgrade says so and cannot be bought', () => {
    const { economy } = make(1e9);
    for (let i = 0; i < 20; i++) economy.buyUpgrade('fast_delivery');
    const row = view.upgradeRows(economy).find((r: any) => r.id === 'fast_delivery');
    expect(row.nextCost).toBeNull();
    expect(row.can).toEqual({ ok: false, why: 'Already at the highest level.' });
  });

  it('hiring is refused with a reason when there is no shop, no counter free or too many staff', () => {
    const none = make(100000, false);
    expect(view.canHire(none.economy, none.shop, 'stocker').why).toContain('no shop floor');
    const { economy, shop } = make();
    shop.hire('cashier'); shop.hire('cashier');
    expect(view.canHire(economy, shop, 'cashier').why).toContain('counter');
    expect(view.canHire(economy, shop, 'stocker').ok).toBe(true);
    expect(view.canHire(economy, shop, 'stocker').why).toContain('₹150 a day');
  });
});

describe('the rows describe the shop truthfully', () => {
  it('stock rows match the inventory, and the margin goes negative below cost', () => {
    const { economy } = make();
    economy.inventory.receive('atta', 20); economy.restockShelf('atta', 5);
    economy.order('atta', 10, 'x');
    let row = view.stockRows(economy).find((r: any) => r.id === 'atta');
    expect(row).toMatchObject({ shelf: 5, backroom: 15, onTheWay: 10, price: toMinor(230), cost: toMinor(180), margin: toMinor(50) });
    economy.setPrice('atta', toMinor(100));
    row = view.stockRows(economy).find((r: any) => r.id === 'atta');
    expect(row.margin).toBe(toMinor(100) - toMinor(180));
    expect(row.demand).toBe('cheap');
  });

  it('labels what customers think of the price', () => {
    const { economy } = make();
    const label = (p: number) => { economy.setPrice('atta', toMinor(p)); return view.stockRows(economy).find((r: any) => r.id === 'atta').demand; };
    expect(label(150)).toBe('cheap');
    expect(label(230)).toBe('fair');
    expect(label(450)).toBe('dear');
    expect(label(690)).toBe('too dear');
  });

  it('every order size is quoted at the real (bulk) price', () => {
    const { economy } = make();
    const row = view.stockRows(economy).find((r: any) => r.id === 'atta');
    for (const o of row.orders) expect(o.total).toBe(economy.orders.quote(toMinor(180), o.qty));
    expect(row.orders.find((o: any) => o.qty === 100).total).toBeLessThan(100 * toMinor(180));
  });

  it('overview reads the economy, including the daily bill and finished days', () => {
    const { economy, shop } = make();
    shop.hire('stocker');
    let o = view.overview(economy);
    expect(o.cash).toBe(toMinor(100000));
    expect(o.dailyBill).toBe(toMinor(200) + toMinor(150));
    expect(o.days).toEqual([]);
    for (let i = 0; i < 130; i++) economy.tick(1);
    o = view.overview(economy);
    expect(o.days.length).toBe(2);
    expect(o.days[0].day).toBe(1);
    expect(o.day).toBe(3);
  });
});

describe('every action does the real thing and says what happened', () => {
  it('order spends the money once, and a refusal changes nothing', () => {
    const { economy } = make(1_000_000);
    const act = view.createActions(economy);
    const cash = economy.ledger.cash;
    const done = act.order('atta', 25);
    expect(done.ok).toBe(true);
    expect(done.message).toContain('Ordered 25 Atta');
    expect(cash - economy.ledger.cash).toBe(economy.orders.quote(toMinor(180), 25));
    const poor = make(1);
    const refused = view.createActions(poor.economy).order('atta', 25);
    expect(refused.ok).toBe(false);
    expect(poor.economy.ledger.cash).toBe(toMinor(1));
    expect(refused.message).toContain('Not enough cash');
  });

  it('the click id makes a double tap buy once', () => {
    const { economy } = make(1_000_000);
    const act = view.createActions(economy, undefined, () => 'same-click');
    const cash = economy.ledger.cash;
    act.order('atta', 10); act.order('atta', 10);
    expect(cash - economy.ledger.cash).toBe(economy.orders.quote(toMinor(180), 10));
    expect(economy.orders.list().length).toBe(1);
  });

  it('restock, price and upgrade act on the economy', () => {
    const { economy } = make(1_000_000);
    const act = view.createActions(economy);
    economy.inventory.receive('atta', 20);
    expect(act.restock('atta')).toMatchObject({ ok: true });
    expect(economy.inventory.onShelf('atta')).toBe(12);
    expect(act.restock('atta').ok).toBe(false);
    const step = Math.round(toMinor(230) * 0.05);
    act.nudgePrice('atta', 1);
    expect(economy.priceOf('atta')).toBe(toMinor(230) + step);
    act.nudgePrice('atta', -3);
    expect(economy.priceOf('atta')).toBe(toMinor(230) - 2 * step);
    expect(act.setPrice('atta', toMinor(100000)).ok).toBe(true);
    expect(economy.priceOf('atta')).toBe(toMinor(230) * 3);
    expect(act.buyUpgrade('shelf_space')).toMatchObject({ ok: true });
    expect(economy.upgrades.level('shelf_space')).toBe(1);
    expect(act.setPrice('ghost', 5).ok).toBe(false);
    expect(act.nudgePrice('ghost', 1).ok).toBe(false);
  });

  it('actions survive being passed around (no hidden this)', () => {
    const { economy } = make(1_000_000);
    const { nudgePrice, setPrice } = view.createActions(economy);
    expect(() => { nudgePrice('atta', 1); setPrice('atta', 300); }).not.toThrow();
  });

  it('hire and fire go through the shop, and the wage bill follows', () => {
    const { economy, shop } = make();
    const act = view.createActions(economy, shop);
    expect(act.hire('cashier').ok).toBe(true);
    expect(economy.staff).toBe(1);
    const id = shop.snapshot().staff[0].id;
    expect(act.fire(id).ok).toBe(true);
    expect(economy.staff).toBe(0);
    expect(act.fire(id).ok).toBe(false);
    expect(view.createActions(economy).hire('cashier').ok).toBe(false);
  });
});

describe('the panel — every button is wired, on the real component', () => {
  it('shows the cash, the day and the reputation on the overview', () => {
    const { economy, shop } = make();
    const text = textOf(render({ economy, shop }));
    expect(text).toContain('₹1,00,000');
    expect(text).toContain('Day 1');
    expect(text).toContain('Reputation 50%');
    expect(text).toContain('No day has finished yet.');
  });

  it('the currency symbol is configurable', () => {
    const { economy } = make();
    expect(textOf(render({ economy, currency: '$' }))).toContain('$1,00,000');
  });

  it('pressing Order really orders; pressing a disabled one is impossible', () => {
    const { economy, shop } = make(1_000_000);
    const tree = render({ economy, shop, initialTab: 'stock' });
    const order25 = buttons(tree).filter((b) => /^25 ·/.test(buttonText(b)))[0];
    expect(order25.props.disabled).toBe(false);
    const cash = economy.ledger.cash;
    order25.props.onClick();
    expect(cash - economy.ledger.cash).toBe(economy.orders.quote(toMinor(180), 25));
    const poor = make(1);
    const poorTree = render({ economy: poor.economy, shop: poor.shop, initialTab: 'stock' });
    const disabled = buttons(poorTree).filter((b) => /^25 ·/.test(buttonText(b)))[0];
    expect(disabled.props.disabled).toBe(true);
    expect(disabled.props.title).toContain('Not enough cash');
  });

  it('Fill shelf, price buttons and Buy upgrade act on the economy', () => {
    const { economy, shop } = make(1_000_000);
    economy.inventory.receive('atta', 12);
    find(render({ economy, shop, initialTab: 'stock' }), /Fill shelf/).props.onClick();
    expect(economy.inventory.onShelf('atta')).toBe(12);
    const before = economy.priceOf('oil');
    find(render({ economy, shop, initialTab: 'stock' }), /Raise the price of Oil/).props.onClick();
    expect(economy.priceOf('oil')).toBeGreaterThan(before);
    find(render({ economy, shop, initialTab: 'stock' }), /Lower the price of Oil/).props.onClick();
    expect(economy.priceOf('oil')).toBe(before);
    find(render({ economy, shop, initialTab: 'upgrades' }), /Bigger shelves/.test('') ? /x/ : /Buy · /).props.onClick();
    expect(economy.upgrades.ids().some((id: string) => economy.upgrades.level(id) === 1)).toBe(true);
  });

  it('Hire and Let go act on the shop', () => {
    const { economy, shop } = make();
    find(render({ economy, shop, initialTab: 'staff' }), /Hire a stocker/).props.onClick();
    expect(shop.staffCount('stocker')).toBe(1);
    find(render({ economy, shop, initialTab: 'staff' }), /Let stocker \d+ go/).props.onClick();
    expect(shop.staffCount()).toBe(0);
    expect(textOf(render({ economy, shop, initialTab: 'staff' }))).toContain('You have no staff');
  });

  it('a debt is shown in words, and so is a loss-making price', () => {
    const { economy, shop } = make(1, true, { startCash: toMinor(1) });
    for (let i = 0; i < 70; i++) economy.tick(1);
    expect(economy.debt).toBeGreaterThan(0);
    expect(textOf(render({ economy, shop }))).toContain('You owe');
    economy.setPrice('atta', toMinor(100));
    expect(textOf(render({ economy, shop, initialTab: 'stock' }))).toContain('losing');
  });

  it('only the Close button closes, and only when asked for', () => {
    const { economy } = make();
    expect(buttons(render({ economy })).some((b) => b.props['aria-label'] === 'Close management screen')).toBe(false);
    let closed = 0;
    find(render({ economy, onClose: () => { closed++; } }), /Close management screen/).props.onClick();
    expect(closed).toBe(1);
  });

  it('NO FAKE BUTTON — every onClick in the source calls an action, switches a tab or closes', () => {
    const src = managerFiles['src/game/manager/ManagerPanel.tsx'];
    const handlers = [...src.matchAll(/onClick=\{([^\n]*?)\}(?: style| disabled| title| aria|>)/g)].map((m) => m[1]);
    expect(handlers.length).toBeGreaterThanOrEqual(9);
    for (const h of handlers) expect(/act\.\w+\(|setTab\(|onClose\(\)/.test(h), 'unwired handler: ' + h).toBe(true);
    expect(src).not.toMatch(/console\.(log|debug)/);
    expect(src.match(/onClick=/g)?.length).toBe(handlers.length);
  });

  it('refreshes on a timer and cleans it up', () => {
    const src = managerFiles['src/game/manager/ManagerPanel.tsx'];
    expect(src).toContain('setInterval(');
    expect(src).toContain('clearInterval(');
  });

  it('UI text is English only', () => {
    for (const src of Object.values(managerFiles)) expect(/[ऀ-ॿ]/.test(src)).toBe(false);
  });
});

describe('the emitted kit', () => {
  it('declares exactly the modules it emits, has no dependency, and imports only itself, react, the economy and the shop', () => {
    const names = Object.keys(managerFiles).map((f) => (f.split('/').pop() ?? '').replace(/\.tsx?$/, '').toLowerCase()).sort();
    expect(names).toEqual([...GAME_MANAGER_MODULES].sort());
    expect(generateGameManager().dependencies).toEqual([]);
    for (const [path, src] of Object.entries(managerFiles)) {
      for (const m of src.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
        expect(/^\.\/|^\.\.\/(economy|shop)\/|^react$/.test(m[1]), path + ' imports ' + m[1]).toBe(true);
      }
    }
  });

  it('every subset loads once the layers it needs are added', () => {
    for (const include of [['view'], ['managerpanel'], ['index'], ['nonsense']]) {
      const files = { ...econFiles, ...shopFiles, ...generateGameManager(include).files };
      expect(() => loadAll(files)).not.toThrow();
    }
  });

  it('every file parses as real TypeScript (a stray backtick would truncate it)', () => {
    for (const [path, src] of Object.entries(managerFiles)) {
      const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')), path).toEqual([]);
    }
  });

  it('type-checks under strict, noUnusedLocals and noUnusedParameters against the real React types', () => {
    const nm = join(process.cwd(), 'node_modules');
    const options: ts.CompilerOptions = {
      strict: true, noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], skipLibCheck: true, isolatedModules: true, types: [],
      baseUrl: '/', paths: { react: [join(nm, '@types/react/index.d.ts')], 'react/jsx-runtime': [join(nm, '@types/react/jsx-runtime.d.ts')] },
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
    const errors = ts.getPreEmitDiagnostics(program).filter((d) => !d.file || d.file.fileName.startsWith('/virtual/')).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
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
    expect(catalog).toContain("name: 'generate_game_manager'");
    expect(catalog.match(/^ {2}'generate_game_manager',$/gm)?.length).toBe(2);
    expect(layers).toContain('generate_game_manager: generateGameManager');
  });

  it('the dispatcher handles it, the prompt names it, the description gives the rules, every AI can explain it', () => {
    expect(dispatcher).toContain("case 'generate_game_manager': {");
    expect(dispatcher).toContain('generateGameManager(gmgInclude)');
    expect(prompt).toContain('run_recipe({ name: "generate_game_manager" })');
    const at = catalog.indexOf("name: 'generate_game_manager'");
    const def = catalog.slice(at, at + 3000);
    for (const word of ['ONE action', 'REASON', 'Staff', 'Missions']) expect(def, word).toContain(word);
    expect(knowledge).toContain('generate_game_manager');
  });
});
