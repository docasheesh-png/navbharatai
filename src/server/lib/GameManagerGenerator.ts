// Tycoon part 3 — the MANAGEMENT SCREEN: the panel where the player runs the shop.
//
// Parts 1 and 2 are headless. A tycoon game is played mostly on THIS screen: how much cash, what is on the
// shelves, what to order, what to charge, who to hire, what to upgrade. It is a React panel (the stack the kit is
// written for) over a pure view-model, so every number and every disabled button is computed in one place that
// the tests execute, and the component is a thin skin on it.
//
// WHY THIS IS A RECIPE AND NOT LEFT TO THE MODEL. A management screen is where "looks done, does nothing" lives:
//
//   • A BUTTON THAT DOES NOTHING. Every button here calls ONE action on the economy or the shop, and a source
//     guard in the tests fails if an onClick exists that does not. No console.log wiring, no decorative buttons.
//   • A BUTTON THAT LIES. "Order" enabled when the cash is short, or when the stock room cannot hold it, then
//     silently fails. Whether an action is possible and why not come from the SAME function the action itself
//     runs, so what the button says and what happens cannot drift apart.
//   • A NUMBER THAT IS NEVER REFRESHED. The panel re-reads the economy on a short timer and stops on unmount.
//   • A FAILURE THAT SAYS NOTHING. A refused action returns a sentence that names the number ("Not enough cash —
//     this costs ₹3,600 and you have ₹1,200"), and the panel shows it.
//   • A TAB FOR SOMETHING THAT IS NOT THERE. The Staff tab exists only when the game has the shop simulation to
//     hire into; it is never an empty promise.
//
// The panel shows what exists today: overview, stock, staff and upgrades. Missions and rewards are NOT here yet
// and the panel does not pretend otherwise.
//
// PURE builder → the caller writes the files.

export interface GameManagerResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const VIEW = String.raw`import type { Economy, DaySummary } from '../economy/economy';
import { demandFactor } from '../economy/pricing';
import { fmtMoney, clampMoney } from '../economy/money';
import type { ShopSim, Role } from '../shop/shopsim';

export type Tab = 'overview' | 'stock' | 'staff' | 'upgrades';

/** Whether an action can be done, and if not, WHY — in a sentence that names the number. */
export interface Can { ok: boolean; why: string }
export interface Outcome { ok: boolean; message: string }

export const ORDER_SIZES: readonly number[] = [10, 25, 50, 100];
const YES: Can = { ok: true, why: '' };
const no = (why: string): Can => ({ ok: false, why });

/** The tabs this game can honestly show: Staff needs the shop simulation to hire into. */
export function availableTabs(shop?: ShopSim): Tab[] {
  return shop ? ['overview', 'stock', 'staff', 'upgrades'] : ['overview', 'stock', 'upgrades'];
}

export interface StockRow {
  id: string; name: string;
  shelf: number; shelfCap: number; backroom: number; backroomCap: number; onTheWay: number;
  price: number; fairPrice: number; cost: number;
  /** price - cost, per unit. Negative = you lose money on every sale. */
  margin: number;
  /** How customers feel about the price: 'cheap' sells more, 'fair' is normal, 'dear' sells fewer, 'too dear' sells nothing. */
  demand: 'cheap' | 'fair' | 'dear' | 'too dear';
  orders: Array<{ qty: number; total: number; can: Can }>;
  restock: Can;
  priceStep: number;
}

/** Can this order be placed? The SAME checks the economy runs, in the SAME order, so the button never lies. */
export function canOrder(economy: Economy, productId: string, qty: number): Can {
  const def = economy.inventory.def(productId);
  if (!def) return no('Unknown product.');
  if (!Number.isInteger(qty) || qty < 1) return no('Choose a quantity of at least 1.');
  const room = economy.inventory.backroomSpace(productId) - economy.orders.pendingFor(productId);
  if (qty > room) return no(room <= 0 ? 'The stock room is full for ' + def.name + ' (counting orders on the way).' : 'The stock room has room for only ' + room + ' more ' + def.name + '.');
  if (economy.orders.list().length >= 20) return no('Too many orders are already on the way.');
  const total = economy.orders.quote(def.cost, qty);
  if (total > economy.ledger.cash) return no('Not enough cash — this costs ' + fmtMoney(total) + ' and you have ' + fmtMoney(economy.ledger.cash) + '.');
  return YES;
}

export function canRestock(economy: Economy, productId: string): Can {
  const inv = economy.inventory;
  if (!inv.has(productId)) return no('Unknown product.');
  if (inv.inBackroom(productId) < 1) return no('Nothing in the stock room to put on the shelf — order some first.');
  if (inv.shelfSpace(productId) < 1) return no('The shelf is already full.');
  return YES;
}

function demandLabel(price: number, fair: number): StockRow['demand'] {
  const f = demandFactor(price, fair);
  if (f <= 0) return 'too dear';
  if (f > 1.05) return 'cheap';
  if (f < 0.6) return 'dear';
  return 'fair';
}

export function stockRows(economy: Economy): StockRow[] {
  return economy.inventory.ids().map((id) => {
    const def = economy.inventory.def(id)!;
    const price = economy.priceOf(id);
    return {
      id, name: def.name,
      shelf: economy.inventory.onShelf(id), shelfCap: economy.inventory.shelfCap(id),
      backroom: economy.inventory.inBackroom(id), backroomCap: economy.inventory.backCap(id),
      onTheWay: economy.orders.pendingFor(id),
      price, fairPrice: def.price, cost: def.cost, margin: price - def.cost, demand: demandLabel(price, def.price),
      orders: ORDER_SIZES.map((qty) => ({ qty, total: economy.orders.quote(def.cost, qty), can: canOrder(economy, id, qty) })),
      restock: canRestock(economy, id),
      priceStep: Math.max(100, Math.round(def.price * 0.05)),
    };
  });
}

export interface UpgradeRow { id: string; name: string; level: number; maxLevel: number; effect: number; nextCost: number | null; can: Can }

export function canBuyUpgrade(economy: Economy, id: string): Can {
  const d = economy.upgrades.def(id);
  if (!d) return no('Unknown upgrade.');
  const cost = economy.upgrades.nextCost(id);
  if (cost === null) return no('Already at the highest level.');
  if (cost > economy.ledger.cash) return no('Not enough cash — this costs ' + fmtMoney(cost) + ' and you have ' + fmtMoney(economy.ledger.cash) + '.');
  return YES;
}

export function upgradeRows(economy: Economy): UpgradeRow[] {
  return economy.upgrades.ids().map((id) => {
    const d = economy.upgrades.def(id)!;
    return { id, name: d.name, level: economy.upgrades.level(id), maxLevel: d.maxLevel, effect: economy.upgrades.effect(id), nextCost: economy.upgrades.nextCost(id), can: canBuyUpgrade(economy, id) };
  });
}

export interface Overview {
  cash: number; day: number; dayRemaining: number; reputation: number; debt: number; staff: number;
  customersPerMinute: number; dailyBill: number; days: DaySummary[]; shelfUnits: number; ordersOnTheWay: number;
}

export function overview(economy: Economy): Overview {
  return {
    cash: economy.ledger.cash, day: economy.day, dayRemaining: economy.dayRemaining, reputation: economy.reputation,
    debt: economy.debt, staff: economy.staff, customersPerMinute: economy.arrivalsPerMinute(),
    dailyBill: economy.rentPerDay + economy.wagePerDay * economy.staff, days: economy.history(),
    shelfUnits: economy.inventory.shelfTotal(), ordersOnTheWay: economy.orders.list().length,
  };
}

export function canHire(economy: Economy, shop: ShopSim | undefined, role: Role): Can {
  if (!shop) return no('This game has no shop floor to hire into.');
  if (role === 'cashier' && shop.staffCount('cashier') >= shop.layout.checkouts.length) return no('Every counter already has a cashier.');
  if (shop.staffCount() >= 20) return no('You cannot hire more than 20 staff.');
  const wage = economy.wagePerDay;
  return { ok: true, why: wage > 0 ? 'Costs ' + fmtMoney(wage) + ' a day.' : '' };
}

/**
 * Every button on the panel is ONE of these. Each checks the same "can" the button shows, then does the real thing
 * on the economy or the shop, and returns a sentence for the player. Nothing else changes the shop from the UI.
 */
export interface ManagerActions {
  order(productId: string, qty: number): Outcome;
  restock(productId: string): Outcome;
  setPrice(productId: string, price: number): Outcome;
  nudgePrice(productId: string, steps: number): Outcome;
  buyUpgrade(id: string): Outcome;
  hire(role: Role): Outcome;
  fire(id: number): Outcome;
}

export function createActions(economy: Economy, shop?: ShopSim, requestId: () => string = () => Math.random().toString(36).slice(2) + Date.now().toString(36)): ManagerActions {
  const name = (id: string): string => economy.inventory.def(id)?.name ?? id;

  const setPrice = (productId: string, price: number): Outcome => {
    if (!economy.inventory.has(productId)) return { ok: false, message: 'Unknown product.' };
    const set = economy.setPrice(productId, clampMoney(price));
    return { ok: true, message: name(productId) + ' now sells for ' + fmtMoney(set) + '.' };
  };

  return {
    order(productId, qty) {
      const can = canOrder(economy, productId, qty);
      if (!can.ok) return { ok: false, message: can.why };
      const r = economy.order(productId, qty, requestId());
      return r.ok
        ? { ok: true, message: 'Ordered ' + qty + ' ' + name(productId) + ' for ' + fmtMoney(r.order.paid) + '. It arrives in about ' + Math.ceil(r.order.eta) + ' seconds.' }
        : { ok: false, message: 'The order could not be placed (' + r.reason.replace(/_/g, ' ') + ').' };
    },
    restock(productId) {
      const can = canRestock(economy, productId);
      if (!can.ok) return { ok: false, message: can.why };
      const moved = economy.restockShelf(productId);
      return { ok: moved > 0, message: moved > 0 ? 'Put ' + moved + ' ' + name(productId) + ' on the shelf.' : 'Nothing was moved.' };
    },
    setPrice,
    nudgePrice(productId, steps) {
      const def = economy.inventory.def(productId);
      if (!def) return { ok: false, message: 'Unknown product.' };
      const step = Math.max(100, Math.round(def.price * 0.05));
      return setPrice(productId, economy.priceOf(productId) + Math.trunc(steps) * step);
    },
    buyUpgrade(id) {
      const can = canBuyUpgrade(economy, id);
      if (!can.ok) return { ok: false, message: can.why };
      const r = economy.buyUpgrade(id);
      return r.ok
        ? { ok: true, message: (economy.upgrades.def(id)?.name ?? id) + ' is now level ' + r.level + '. You paid ' + fmtMoney(r.paid) + '.' }
        : { ok: false, message: 'The upgrade could not be bought (' + r.reason.replace(/_/g, ' ') + ').' };
    },
    hire(role) {
      const can = canHire(economy, shop, role);
      if (!can.ok || !shop) return { ok: false, message: can.why };
      const id = shop.hire(role);
      return id === null ? { ok: false, message: 'Could not hire a ' + role + '.' } : { ok: true, message: 'Hired a ' + role + '.' + (can.why ? ' ' + can.why : '') };
    },
    fire(id) {
      if (!shop) return { ok: false, message: 'This game has no shop floor.' };
      return shop.fire(id) ? { ok: true, message: 'That staff member has left.' } : { ok: false, message: 'No such staff member.' };
    },
  };
}
`;

const PANEL = String.raw`import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Economy } from '../economy/economy';
import { fmtMoney } from '../economy/money';
import type { ShopSim } from '../shop/shopsim';
import { availableTabs, createActions, canHire, overview, stockRows, upgradeRows, type Outcome, type Tab } from './view';

export interface ManagerPanelProps {
  economy: Economy;
  /** Pass the shop simulation to get the Staff tab; without it the tab is not shown. */
  shop?: ShopSim;
  initialTab?: Tab;
  /** Shown as a close button when given. */
  onClose?: () => void;
  /** How often the numbers are re-read, in milliseconds. */
  refreshMs?: number;
  currency?: string;
}

const box: CSSProperties = { background: 'var(--mgr-bg, #ffffff)', color: 'var(--mgr-fg, #17171c)', border: '1px solid var(--mgr-line, #d9dbe3)', borderRadius: 12, padding: 12, fontSize: 14, maxWidth: 560, width: '100%', boxSizing: 'border-box' };
const btn: CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--mgr-line, #c4c7d4)', background: 'var(--mgr-btn, #f1f2f7)', color: 'inherit', cursor: 'pointer', fontSize: 13, minHeight: 36 };
const row: CSSProperties = { display: 'grid', gap: 6, padding: '8px 0', borderTop: '1px solid var(--mgr-line, #e6e8ef)' };
const muted: CSSProperties = { opacity: 0.7, fontSize: 12 };

/** The management screen: Overview, Stock, Staff (when the game has the shop floor) and Upgrades. */
export function ManagerPanel({ economy, shop, initialTab = 'overview', onClose, refreshMs = 250, currency = '₹' }: ManagerPanelProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [, setTick] = useState(0);
  const [note, setNote] = useState<Outcome | null>(null);
  const act = createActions(economy, shop);
  const tabs = availableTabs(shop);
  const money = (n: number): string => fmtMoney(n, currency);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), Math.max(100, refreshMs));
    return () => clearInterval(id);
  }, [refreshMs]);

  const run = (o: Outcome): void => setNote(o);
  const o = overview(economy);

  return (
    <section aria-label="Shop management" style={box}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div role="tablist" aria-label="Management sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ ...btn, fontWeight: tab === t ? 700 : 400, borderColor: tab === t ? 'var(--mgr-accent, #4f46e5)' : undefined }}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {onClose ? <button type="button" aria-label="Close management screen" onClick={() => onClose()} style={btn}>Close</button> : null}
      </div>

      <div role="status" aria-live="polite" style={{ minHeight: 20, margin: '8px 0', color: note && !note.ok ? 'var(--mgr-bad, #b42318)' : 'var(--mgr-good, #067647)', fontSize: 13 }}>{note ? note.message : ''}</div>

      {tab === 'overview' ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 20 }}>
            <span>{money(o.cash)}</span>
            <span style={{ fontSize: 14 }}>Day {o.day} · {Math.ceil(o.dayRemaining)}s left</span>
          </div>
          <div style={muted}>Reputation {Math.round(o.reputation * 100)}% · about {o.customersPerMinute.toFixed(1)} customers a minute · {o.shelfUnits} items on shelves · {o.ordersOnTheWay} orders on the way</div>
          <div style={muted}>Daily bill {money(o.dailyBill)} ({o.staff} staff){o.debt > 0 ? ' · Debt ' + money(o.debt) : ''}</div>
          {o.debt > 0 ? <div style={{ color: 'var(--mgr-bad, #b42318)', fontSize: 13 }}>You owe {money(o.debt)}. It is paid first from your cash at the end of each day.</div> : null}
          <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Recent days</h3>
          {o.days.length === 0 ? <div style={muted}>No day has finished yet.</div> : (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}><th>Day</th><th>Revenue</th><th>Costs</th><th>Profit</th><th>Customers</th></tr></thead>
              <tbody>
                {o.days.slice(-7).reverse().map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td><td>{money(d.revenue)}</td><td>{money(d.cogs + d.expenses)}</td>
                    <td style={{ color: d.profit < 0 ? 'var(--mgr-bad, #b42318)' : undefined }}>{d.profit < 0 ? '-' : ''}{money(Math.abs(d.profit))}</td>
                    <td>{d.customers - d.lostCustomers}/{d.customers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {tab === 'stock' ? (
        <div>
          {stockRows(economy).map((r) => (
            <div key={r.id} style={row}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                <span>{r.name}</span>
                <span>Shelf {r.shelf}/{r.shelfCap} · Room {r.backroom}/{r.backroomCap}{r.onTheWay > 0 ? ' · +' + r.onTheWay + ' coming' : ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={muted}>Price</span>
                <button type="button" aria-label={'Lower the price of ' + r.name} onClick={() => run(act.nudgePrice(r.id, -1))} style={btn}>-</button>
                <strong>{money(r.price)}</strong>
                <button type="button" aria-label={'Raise the price of ' + r.name} onClick={() => run(act.nudgePrice(r.id, 1))} style={btn}>+</button>
                <span style={muted}>cost {money(r.cost)} · {r.margin < 0 ? 'losing ' + money(-r.margin) : 'earn ' + money(r.margin)} each · customers: {r.demand}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={muted}>Order</span>
                {r.orders.map((q) => (
                  <button key={q.qty} type="button" disabled={!q.can.ok} title={q.can.ok ? 'Costs ' + money(q.total) : q.can.why} onClick={() => run(act.order(r.id, q.qty))} style={{ ...btn, opacity: q.can.ok ? 1 : 0.5 }}>
                    {q.qty} · {money(q.total)}
                  </button>
                ))}
                <button type="button" disabled={!r.restock.ok} title={r.restock.why} onClick={() => run(act.restock(r.id))} style={{ ...btn, opacity: r.restock.ok ? 1 : 0.5 }}>Fill shelf</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'staff' && shop ? (
        <div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['cashier', 'stocker'] as const).map((role) => {
              const can = canHire(economy, shop, role);
              return (
                <button key={role} type="button" disabled={!can.ok} title={can.why} onClick={() => run(act.hire(role))} style={{ ...btn, opacity: can.ok ? 1 : 0.5 }}>
                  Hire a {role}{economy.wagePerDay > 0 ? ' · ' + money(economy.wagePerDay) + '/day' : ''}
                </button>
              );
            })}
          </div>
          {shop.snapshot().staff.length === 0 ? <div style={{ ...muted, marginTop: 8 }}>You have no staff. Customers are served only when you stand at a counter.</div> : null}
          {shop.snapshot().staff.map((s) => (
            <div key={s.id} style={{ ...row, gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
              <span>{s.role[0].toUpperCase() + s.role.slice(1)} #{s.id} <span style={muted}>({s.state.replace(/_/g, ' ')})</span></span>
              <button type="button" aria-label={'Let ' + s.role + ' ' + s.id + ' go'} onClick={() => run(act.fire(s.id))} style={btn}>Let go</button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'upgrades' ? (
        <div>
          {upgradeRows(economy).map((u) => (
            <div key={u.id} style={{ ...row, gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
              <span><strong>{u.name}</strong> <span style={muted}>level {u.level}/{u.maxLevel} · now x{u.effect.toFixed(2)}</span></span>
              <button type="button" disabled={!u.can.ok} title={u.can.why} onClick={() => run(act.buyUpgrade(u.id))} style={{ ...btn, opacity: u.can.ok ? 1 : 0.5 }}>
                {u.nextCost === null ? 'Maxed' : 'Buy · ' + money(u.nextCost)}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
`;

const INDEX = String.raw`export { ManagerPanel, type ManagerPanelProps } from './ManagerPanel';
export {
  availableTabs, createActions, canOrder, canRestock, canBuyUpgrade, canHire, stockRows, upgradeRows, overview, ORDER_SIZES,
  type Tab, type Can, type Outcome, type ManagerActions, type StockRow, type UpgradeRow, type Overview,
} from './view';
`;

const FILES: Record<string, string> = {
  'src/game/manager/view.ts': VIEW,
  'src/game/manager/ManagerPanel.tsx': PANEL,
  'src/game/manager/index.ts': INDEX,
};

export const GAME_MANAGER_MODULES: readonly string[] = ['view', 'managerpanel', 'index'];

/** Generate the management screen. Pure; never throws. */
export function generateGameManager(include?: string[]): GameManagerResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;
  let files: Record<string, string> = { ...FILES };
  if (wanted) {
    const picked: Record<string, string> = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.tsx?$/i, '').toLowerCase();
      if (wanted.has(base)) picked[path] = content;
    }
    // The panel imports view; index imports both.
    if (picked['src/game/manager/index.ts'] || picked['src/game/manager/ManagerPanel.tsx']) {
      files = picked['src/game/manager/index.ts'] ? { ...FILES } : { 'src/game/manager/view.ts': VIEW, 'src/game/manager/ManagerPanel.tsx': PANEL };
    } else if (Object.keys(picked).length > 0) files = picked;
  }

  return {
    files,
    dependencies: [], // react is already in the project; everything else is pure
    instructions:
      `Added the management screen (${Object.keys(files).length} files under src/game/manager). It needs the economy core and, for the Staff tab, the shop simulation — the missing-layer step brings what it imports.\n` +
      '```tsx\n' +
      "import { useState } from 'react';\n" +
      "import { Economy, toMinor } from './game/economy';\n" +
      "import { ShopSim, type ShopLayout } from './game/shop';\n" +
      "import { ManagerPanel } from './game/manager';\n" +
      '\n' +
      'declare const layout: ShopLayout;   // the shop floor from the shop recipe\n' +
      'const economy = new Economy({\n' +
      "  autoCustomers: false, startCash: toMinor(5000), wagePerDay: toMinor(150),\n" +
      "  products: [{ id: 'atta', name: 'Atta 5kg', cost: toMinor(180), price: toMinor(230), shelfCapacity: 12 }],\n" +
      '});\n' +
      'const shop = new ShopSim(economy, layout);\n' +
      '\n' +
      '// Open it from a button in the HUD. It re-reads the economy by itself and stops when it unmounts.\n' +
      'export function ManagementButton() {\n' +
      '  const [open, setOpen] = useState(false);\n' +
      '  return (\n' +
      '    <>\n' +
      "      <button type=\"button\" onClick={() => setOpen(true)}>Manage shop</button>\n" +
      '      {open ? <ManagerPanel economy={economy} shop={shop} onClose={() => setOpen(false)} /> : null}\n' +
      '    </>\n' +
      '  );\n' +
      '}\n' +
      '```\n' +
      'THE RULES THESE ENCODE — do not re-implement them by hand:\n' +
      '- Every button calls ONE action (createActions): order, restock, price, upgrade, hire, fire. Never wire a button to console.log or to state the economy does not own.\n' +
      '- A button is disabled with a REASON that names the number ("Not enough cash — this costs ₹3,600 and you have ₹1,200"); the reason comes from the same check the action runs, so the button cannot lie.\n' +
      '- Pass shop to get the Staff tab; without it the tab is not shown. Missions and rewards are NOT in this panel — do not add a tab for something that does not exist.\n' +
      '- Style it with the --mgr-* CSS variables (bg, fg, line, btn, accent, good, bad) to match the game; the defaults are readable on light backgrounds.\n' +
      '- The panel is English UI text; if the game needs another language, translate the strings in ManagerPanel.tsx and view.ts together.',
  };
}
