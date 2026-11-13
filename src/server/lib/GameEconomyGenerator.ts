// Tycoon economy core — the money half of every shop / farm / restaurant / business game.
//
// WHY THIS IS A RECIPE AND NOT LEFT TO THE MODEL. A management game is "a till, a stock room and a price",
// and every first implementation of that gets the same few things wrong. Each one is specific and invisible
// on review, which is exactly the class the other game recipes (combat, controller, shell) were written for:
//
//   • MONEY AS FLOATS. 0.1 + 0.2 drifts, a thousand sales later the till is 3 paise out and "cash === price"
//     comparisons fail. Money here is an INTEGER number of minor units (paise), and every amount is checked.
//   • CASH GOING NEGATIVE. A purchase that "mostly" checks the balance lets two quick taps both pass. Every
//     spend is ONE atomic check-and-debit, and a rejected spend changes nothing.
//   • CHARGING FOR GOODS THAT CAN NEVER ARRIVE. An order placed with a full stock room takes the money and
//     delivers nothing. An order is refused BEFORE it is paid when it cannot be stored.
//   • A RETRIED TAP BUYING TWICE. A double-clicked "Order" button, or a retry after a lag spike, debits twice.
//     An order carries a request id; the same id again returns the first order and charges nothing.
//   • A PRICE THAT DOES NOTHING. If the customer buys the same amount at 1x and at 3x the price, the whole
//     pricing screen is decoration. Demand falls smoothly as price rises past the fair price, reaches zero at
//     the markup ceiling, and never goes NaN or negative.
//   • STOCK THAT GOES NEGATIVE, or sells that were never on the shelf. Shelf and stock room are separate, a
//     take returns what it really took, and nothing is sold that is not on the shelf.
//   • OFFLINE MONEY FROM NOTHING. "Earnings while away" is the most abused number in an idle game. Here it is
//     capped in time, discounted, limited to the stock that was actually on the shelf, and charged the rent
//     for the days that passed — so being away is never better than playing.
//   • A CORRUPT OR EDITED SAVE. A save is parsed, every number is checked, unknown products are dropped and
//     stock is clamped to capacity. A bad save yields a fresh game, never a thrown error or NaN money.
//
// Everything is PURE (no DOM, no three.js, no import from another game layer) and SEEDED, so a run replays
// identically and the rules are provable by executing them rather than reading them. It works in a 2D game and
// in the 3D shell alike: the 3D layer only DRAWS customers and calls `sell`; this decides what it is worth.
//
// PURE builder → the caller writes the files.

export interface GameEconomyResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const MONEY = String.raw`/**
 * Money is an INTEGER number of minor units (paise). Floats drift (0.1 + 0.2), and a till that is a few paise
 * out after a thousand sales is a bug no player can explain. Every amount that enters the economy goes through
 * toMinor / clampMoney, so a NaN, a negative or a fractional value can never reach the balance.
 */
export const MAX_MONEY = 9_000_000_000_000; // far below 2^53, so integer arithmetic stays exact

/** A whole number of minor units, clamped to [0, MAX_MONEY]. NaN, Infinity and negatives become 0. */
export function clampMoney(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.min(MAX_MONEY, Math.max(0, Math.floor(n)));
}

/** Rupees (or dollars) to minor units. toMinor(1.15) is 115, not 114.99999999999999. */
export function toMinor(major: number): number {
  if (typeof major !== 'number' || !Number.isFinite(major)) return 0;
  return clampMoney(Math.round(major * 100));
}

/** Minor units to a display string with Indian digit grouping: 12345678 -> ₹1,23,456.78 (no .00 on whole rupees). */
export function fmtMoney(minor: number, symbol: string = '₹'): string {
  const m = clampMoney(minor);
  const rupees = Math.floor(m / 100);
  const paise = m % 100;
  const digits = String(rupees);
  let grouped = digits;
  if (digits.length > 3) {
    const head = digits.slice(0, digits.length - 3);
    const tail = digits.slice(digits.length - 3);
    const parts: string[] = [];
    for (let i = head.length; i > 0; i -= 2) parts.unshift(head.slice(Math.max(0, i - 2), i));
    grouped = parts.join(',') + ',' + tail;
  }
  return symbol + grouped + (paise ? '.' + String(paise).padStart(2, '0') : '');
}

/** Clamp a number to a whole value in [min, max]; anything that is not a finite number becomes fallback. */
export function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** A small seeded generator (mulberry32). The state is one uint32, so it is saved and replays identically. */
export class Rng {
  private s: number;
  constructor(seed: number = 1) { this.s = (Math.floor(Number.isFinite(seed) ? seed : 1) >>> 0) || 1; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  get state(): number { return this.s; }
  set state(v: number) { this.s = (Math.floor(Number.isFinite(v) ? v : 1) >>> 0) || 1; }
}
`;

const LEDGER = String.raw`import { MAX_MONEY, clampMoney } from './money';

export interface LedgerEntry { seq: number; delta: number; reason: string; balance: number }

const MAX_REASONS = 64;

/**
 * The till. ONE atomic check-and-debit: spend() either takes the whole amount or changes nothing, so two quick
 * taps cannot both pass a balance check and leave the cash negative. The log is a bounded ring (a long session
 * must not grow memory without limit); the per-reason totals are bounded too.
 */
export class Ledger {
  private _cash: number;
  private seq = 0;
  private log: LedgerEntry[] = [];
  private totals: Record<string, number> = {};

  constructor(startCash: number = 0, private readonly logCap: number = 200) {
    this._cash = clampMoney(startCash);
  }

  get cash(): number { return this._cash; }
  canAfford(amount: number): boolean { return Number.isInteger(amount) && amount >= 0 && amount <= this._cash; }

  /** Credit money. Returns what was really credited (0 for an invalid amount). */
  earn(amount: number, reason: string): number {
    const a = clampMoney(amount);
    if (a <= 0) return 0;
    const credited = Math.min(a, MAX_MONEY - this._cash);
    this._cash += credited;
    this.record(credited, reason);
    return credited;
  }

  /** Debit money. true = the whole amount was taken; false = nothing changed. Zero is a successful no-op. */
  spend(amount: number, reason: string): boolean {
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return false;
    if (amount === 0) return true;
    if (amount > this._cash) return false;
    this._cash -= amount;
    this.record(-amount, reason);
    return true;
  }

  /** Net money for a reason since the start (earned minus spent). */
  totalFor(reason: string): number { return this.totals[reason] ?? 0; }
  recent(n: number = 20): LedgerEntry[] { return this.log.slice(-Math.max(0, Math.floor(n))); }

  private record(delta: number, reason: string): void {
    const key = reason in this.totals || Object.keys(this.totals).length < MAX_REASONS ? reason : 'other';
    this.totals[key] = (this.totals[key] ?? 0) + delta;
    this.log.push({ seq: ++this.seq, delta, reason: key, balance: this._cash });
    if (this.log.length > this.logCap) this.log.splice(0, this.log.length - this.logCap);
  }

  /** Only the balance and the totals are saved — the log is a convenience, not state. */
  snapshot(): { cash: number; totals: Record<string, number> } {
    return { cash: this._cash, totals: { ...this.totals } };
  }

  restore(raw: unknown): void {
    const r = (raw && typeof raw === 'object' ? raw : {}) as { cash?: unknown; totals?: unknown };
    this._cash = clampMoney(typeof r.cash === 'number' ? r.cash : 0);
    this.totals = {};
    if (r.totals && typeof r.totals === 'object') {
      for (const [k, v] of Object.entries(r.totals as Record<string, unknown>).slice(0, MAX_REASONS)) {
        if (typeof v === 'number' && Number.isFinite(v)) this.totals[String(k).slice(0, 40)] = Math.trunc(v);
      }
    }
    this.log = [];
  }
}
`;

const INVENTORY = String.raw`import { clampInt, clampMoney } from './money';

export interface ProductDef {
  id: string;
  name: string;
  /** What one unit costs to buy wholesale, in minor units. */
  cost: number;
  /** The FAIR price: customers' demand is 1.0 here. Also the default selling price. */
  price: number;
  /** Units the shelf holds. */
  shelfCapacity: number;
  /** Units the stock room holds. Defaults to four shelves' worth. */
  backroomCapacity?: number;
  /** How much customers want it, relative to the other products. Defaults to 1. */
  demand?: number;
}

/**
 * Shelf and stock room are SEPARATE counts, because they are separate things in a shop: customers can only buy
 * what is ON THE SHELF, and a delivery lands in the stock room. Every method returns what it REALLY did, so a
 * caller never assumes a full shelf took the whole batch, and no count can go negative or over capacity.
 */
export class Inventory {
  private shelf = new Map<string, number>();
  private back = new Map<string, number>();
  private defs = new Map<string, ProductDef>();
  /** Raised by the shelf-space upgrade: 1 = base capacity. */
  private capacityMult = 1;

  constructor(defs: ProductDef[]) {
    for (const d of defs) {
      const id = String(d.id);
      if (!id || this.defs.has(id)) continue;
      this.defs.set(id, {
        ...d,
        id,
        cost: clampMoney(d.cost),
        price: clampMoney(d.price),
        shelfCapacity: clampInt(d.shelfCapacity, 1, 100000, 10),
        backroomCapacity: clampInt(d.backroomCapacity ?? d.shelfCapacity * 4, 1, 1000000, 40),
        demand: typeof d.demand === 'number' && d.demand > 0 && Number.isFinite(d.demand) ? d.demand : 1,
      });
      this.shelf.set(id, 0);
      this.back.set(id, 0);
    }
  }

  ids(): string[] { return Array.from(this.defs.keys()); }
  has(id: string): boolean { return this.defs.has(id); }
  def(id: string): ProductDef | undefined { return this.defs.get(id); }

  setCapacityMultiplier(m: number): void {
    this.capacityMult = typeof m === 'number' && Number.isFinite(m) && m >= 1 ? Math.min(m, 100) : 1;
  }
  shelfCap(id: string): number { const d = this.defs.get(id); return d ? Math.floor(d.shelfCapacity * this.capacityMult) : 0; }
  backCap(id: string): number { const d = this.defs.get(id); return d ? Math.floor((d.backroomCapacity ?? 0) * this.capacityMult) : 0; }

  onShelf(id: string): number { return this.shelf.get(id) ?? 0; }
  inBackroom(id: string): number { return this.back.get(id) ?? 0; }
  backroomSpace(id: string): number { return Math.max(0, this.backCap(id) - this.inBackroom(id)); }
  shelfSpace(id: string): number { return Math.max(0, this.shelfCap(id) - this.onShelf(id)); }

  /** A delivery arrives in the stock room. Returns how many units fitted (the rest are not accepted). */
  receive(id: string, qty: number): number {
    if (!this.defs.has(id)) return 0;
    const n = Math.min(clampInt(qty, 0, 1_000_000, 0), this.backroomSpace(id));
    this.back.set(id, this.inBackroom(id) + n);
    return n;
  }

  /** Move stock from the room to the shelf. Without qty it fills the shelf. Returns units moved. */
  restockShelf(id: string, qty?: number): number {
    if (!this.defs.has(id)) return 0;
    const want = qty === undefined ? Number.MAX_SAFE_INTEGER : clampInt(qty, 0, 1_000_000, 0);
    const n = Math.min(want, this.shelfSpace(id), this.inBackroom(id));
    if (n <= 0) return 0;
    this.back.set(id, this.inBackroom(id) - n);
    this.shelf.set(id, this.onShelf(id) + n);
    return n;
  }

  /** A customer takes units off the shelf. Returns what was REALLY taken, never more than is there. */
  take(id: string, qty: number): number {
    if (!this.defs.has(id)) return 0;
    const n = Math.min(clampInt(qty, 0, 1_000_000, 0), this.onShelf(id));
    this.shelf.set(id, this.onShelf(id) - n);
    return n;
  }

  /** Units on shelves across all products. */
  shelfTotal(): number { let t = 0; for (const v of this.shelf.values()) t += v; return t; }

  snapshot(): { shelf: Record<string, number>; back: Record<string, number> } {
    return { shelf: Object.fromEntries(this.shelf), back: Object.fromEntries(this.back) };
  }

  /** Unknown products are dropped and counts are clamped to capacity. Never throws. */
  restore(raw: unknown): void {
    const r = (raw && typeof raw === 'object' ? raw : {}) as { shelf?: Record<string, unknown>; back?: Record<string, unknown> };
    for (const id of this.defs.keys()) {
      this.back.set(id, clampInt(r.back?.[id], 0, this.backCap(id), 0));
      this.shelf.set(id, clampInt(r.shelf?.[id], 0, this.shelfCap(id), 0));
    }
  }
}
`;

const PRICING = String.raw`/** The most a very cheap price can lift demand — a giveaway does not make everyone in the village buy ten. */
export const MAX_DEMAND = 1.5;

/** Past this multiple of the fair price nobody buys. */
export const DEFAULT_MARKUP_CEILING = 3;

/**
 * How much customers want a product at this price, relative to the fair price: 1.0 AT the fair price, more when
 * it is cheaper (capped), less as it climbs, and 0 at the markup ceiling. Smooth and never NaN or negative, so
 * the pricing screen is a real decision: raise the price and you sell fewer, lower it and you sell more.
 *
 * Non-increasing in price — a higher price never sells MORE. Locked by a sweep in the tests.
 */
export function demandFactor(
  price: number,
  fairPrice: number,
  elasticity: number = 1.6,
  markupCeiling: number = DEFAULT_MARKUP_CEILING,
): number {
  if (typeof price !== 'number' || typeof fairPrice !== 'number') return 0;
  if (!Number.isFinite(price) || !Number.isFinite(fairPrice) || fairPrice <= 0 || price < 0) return 0;
  const ceiling = Number.isFinite(markupCeiling) && markupCeiling > 1 ? markupCeiling : DEFAULT_MARKUP_CEILING;
  const e = Number.isFinite(elasticity) && elasticity > 0 ? elasticity : 1.6;
  const r = price / fairPrice;
  if (r <= 0) return MAX_DEMAND;
  if (r >= ceiling) return 0;
  let f = Math.pow(r, -e);
  if (r > 1) f *= 1 - (r - 1) / (ceiling - 1);
  return Math.max(0, Math.min(MAX_DEMAND, f));
}
`;

const ORDERS = String.raw`import type { Inventory } from './inventory';
import type { Ledger } from './ledger';
import { clampInt, clampMoney } from './money';

export interface PendingOrder { id: number; productId: string; qty: number; paid: number; eta: number }
export interface BulkTier { minQty: number; discount: number }
export type OrderResult =
  | { ok: true; order: PendingOrder; duplicate: boolean }
  | { ok: false; reason: 'unknown_product' | 'bad_quantity' | 'too_many_orders' | 'no_space' | 'cannot_afford' };

export const DEFAULT_BULK_TIERS: readonly BulkTier[] = [
  { minQty: 100, discount: 0.1 },
  { minQty: 50, discount: 0.05 },
];

const MAX_ORDER_QTY = 1000;
const REQUEST_MEMORY = 64;

/**
 * Wholesale orders: pay now, delivered after a lead time into the stock room.
 *
 *  - REFUSED BEFORE IT IS PAID when the stock room cannot hold it (counting what is already on the way) —
 *    taking money for goods that can never arrive is the bug, not the refusal.
 *  - IDEMPOTENT: the same requestId returns the first order and charges nothing, so a double tap or a retry
 *    after a lag spike cannot buy twice.
 *  - The price comes from the SERVER of this class (quote), never from the caller.
 */
export class OrderBook {
  private pending: PendingOrder[] = [];
  private nextId = 1;
  private seen = new Map<string, PendingOrder>();
  /** Multiplier on lead time: the fast-delivery upgrade lowers it. */
  private leadMult = 1;

  constructor(
    private readonly leadTime: number = 30,
    private readonly maxPending: number = 20,
    private readonly tiers: readonly BulkTier[] = DEFAULT_BULK_TIERS,
  ) {}

  setLeadMultiplier(m: number): void { this.leadMult = typeof m === 'number' && Number.isFinite(m) ? Math.min(1, Math.max(0.1, m)) : 1; }
  pendingFor(productId: string): number { let t = 0; for (const o of this.pending) if (o.productId === productId) t += o.qty; return t; }
  list(): readonly PendingOrder[] { return this.pending; }

  /** What qty units cost, with the best bulk discount that applies. Integer minor units. */
  quote(unitCost: number, qty: number): number {
    const q = clampInt(qty, 0, MAX_ORDER_QTY, 0);
    let discount = 0;
    for (const t of this.tiers) if (q >= t.minQty && t.discount > discount) discount = t.discount;
    return clampMoney(Math.round(clampMoney(unitCost) * q * (1 - discount)));
  }

  place(inv: Inventory, ledger: Ledger, productId: string, qty: number, requestId?: string): OrderResult {
    if (requestId !== undefined) {
      const prior = this.seen.get(requestId);
      if (prior) return { ok: true, order: prior, duplicate: true };
    }
    const def = inv.def(productId);
    if (!def) return { ok: false, reason: 'unknown_product' };
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_ORDER_QTY) return { ok: false, reason: 'bad_quantity' };
    if (this.pending.length >= this.maxPending) return { ok: false, reason: 'too_many_orders' };
    if (qty > inv.backroomSpace(productId) - this.pendingFor(productId)) return { ok: false, reason: 'no_space' };
    const total = this.quote(def.cost, qty);
    if (!ledger.spend(total, 'restock')) return { ok: false, reason: 'cannot_afford' };
    const order: PendingOrder = { id: this.nextId++, productId, qty, paid: total, eta: Math.max(1, this.leadTime * this.leadMult) };
    this.pending.push(order);
    if (requestId !== undefined) {
      this.seen.set(requestId, order);
      if (this.seen.size > REQUEST_MEMORY) this.seen.delete(this.seen.keys().next().value as string);
    }
    return { ok: true, order, duplicate: false };
  }

  /** Advance time; returns the orders delivered this step and how many units each really fitted. */
  tick(dt: number, inv: Inventory): Array<{ order: PendingOrder; accepted: number }> {
    const step = typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? Math.min(dt, 3600) : 0;
    const done: Array<{ order: PendingOrder; accepted: number }> = [];
    if (step === 0) return done;
    const rest: PendingOrder[] = [];
    for (const o of this.pending) {
      o.eta -= step;
      if (o.eta <= 0) done.push({ order: o, accepted: inv.receive(o.productId, o.qty) });
      else rest.push(o);
    }
    this.pending = rest;
    return done;
  }

  snapshot(): { next: number; pending: PendingOrder[] } {
    return { next: this.nextId, pending: this.pending.map((o) => ({ ...o })) };
  }

  /** Orders for unknown products are dropped; numbers are clamped. A restored order is never re-charged. */
  restore(raw: unknown, inv: Inventory): void {
    const r = (raw && typeof raw === 'object' ? raw : {}) as { next?: unknown; pending?: unknown };
    this.nextId = clampInt(r.next, 1, 1_000_000_000, 1);
    this.pending = [];
    this.seen.clear();
    if (!Array.isArray(r.pending)) return;
    for (const p of r.pending.slice(0, this.maxPending)) {
      const o = (p && typeof p === 'object' ? p : {}) as Partial<PendingOrder>;
      const id = typeof o.productId === 'string' ? o.productId : '';
      if (!inv.has(id)) continue;
      this.pending.push({
        id: clampInt(o.id, 1, 1_000_000_000, this.nextId++),
        productId: id,
        qty: clampInt(o.qty, 1, MAX_ORDER_QTY, 1),
        paid: clampMoney(typeof o.paid === 'number' ? o.paid : 0),
        eta: typeof o.eta === 'number' && Number.isFinite(o.eta) ? Math.min(3600, Math.max(0.1, o.eta)) : 1,
      });
    }
  }
}
`;

const UPGRADES = String.raw`import type { Ledger } from './ledger';
import { clampInt, clampMoney, MAX_MONEY } from './money';

export interface UpgradeDef {
  id: string;
  name: string;
  /** Cost of level 1, in minor units. */
  baseCost: number;
  /** Each next level costs this many times the last (default 1.6). */
  growth?: number;
  maxLevel: number;
  /** The effect value at level 0, and what each level adds. */
  base: number;
  step: number;
}

/** The three upgrades every shop game wants. The game may pass its own list instead. */
export const DEFAULT_UPGRADES: readonly UpgradeDef[] = [
  { id: 'shelf_space', name: 'Bigger shelves', baseCost: 500_00, growth: 1.7, maxLevel: 8, base: 1, step: 0.25 },
  { id: 'foot_traffic', name: 'Better location & signboard', baseCost: 800_00, growth: 1.8, maxLevel: 8, base: 1, step: 0.15 },
  { id: 'fast_delivery', name: 'Faster supplier', baseCost: 600_00, growth: 1.7, maxLevel: 5, base: 1, step: -0.12 },
];

export type BuyResult = { ok: true; level: number; paid: number } | { ok: false; reason: 'unknown' | 'maxed' | 'cannot_afford' };

/**
 * Each level costs a growing amount; buying is ONE atomic check-and-debit, so a rejected purchase changes
 * nothing, and a maxed upgrade cannot be bought (or charged for) again.
 */
export class Upgrades {
  private defs = new Map<string, UpgradeDef>();
  private lv = new Map<string, number>();

  constructor(defs: readonly UpgradeDef[] = DEFAULT_UPGRADES) {
    for (const d of defs) {
      if (!d.id || this.defs.has(d.id)) continue;
      this.defs.set(d.id, { ...d, growth: d.growth && d.growth >= 1 && Number.isFinite(d.growth) ? d.growth : 1.6, maxLevel: clampInt(d.maxLevel, 1, 100, 1) });
      this.lv.set(d.id, 0);
    }
  }

  ids(): string[] { return Array.from(this.defs.keys()); }
  def(id: string): UpgradeDef | undefined { return this.defs.get(id); }
  level(id: string): number { return this.lv.get(id) ?? 0; }

  /** Cost of the NEXT level, or null when maxed or unknown. */
  nextCost(id: string): number | null {
    const d = this.defs.get(id);
    if (!d) return null;
    const l = this.level(id);
    if (l >= d.maxLevel) return null;
    return Math.min(MAX_MONEY, clampMoney(Math.round(d.baseCost * Math.pow(d.growth ?? 1.6, l))));
  }

  /** The effect value now: base + level * step. 1 for an unknown upgrade, so a missing one is a no-op. */
  effect(id: string): number {
    const d = this.defs.get(id);
    return d ? d.base + this.level(id) * d.step : 1;
  }

  buy(id: string, ledger: Ledger): BuyResult {
    const d = this.defs.get(id);
    if (!d) return { ok: false, reason: 'unknown' };
    const cost = this.nextCost(id);
    if (cost === null) return { ok: false, reason: 'maxed' };
    if (!ledger.spend(cost, 'upgrade:' + id)) return { ok: false, reason: 'cannot_afford' };
    const level = this.level(id) + 1;
    this.lv.set(id, level);
    return { ok: true, level, paid: cost };
  }

  snapshot(): Record<string, number> { return Object.fromEntries(this.lv); }

  restore(raw: unknown): void {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    for (const [id, d] of this.defs) this.lv.set(id, clampInt(r[id], 0, d.maxLevel, 0));
  }
}
`;

const ECONOMY = String.raw`import { Inventory, type ProductDef } from './inventory';
import { Ledger } from './ledger';
import { OrderBook, type OrderResult } from './orders';
import { demandFactor, DEFAULT_MARKUP_CEILING } from './pricing';
import { Upgrades, DEFAULT_UPGRADES, type UpgradeDef, type BuyResult } from './upgrades';
import { Rng, clampInt, clampMoney } from './money';

export interface EconomyConfig {
  products: ProductDef[];
  upgrades?: readonly UpgradeDef[];
  seed?: number;
  startCash?: number;
  /** Seconds in one game day. */
  dayLength?: number;
  /** Paid at the end of every day, in minor units. */
  rentPerDay?: number;
  /** Paid per staff member at the end of every day. */
  wagePerDay?: number;
  /** Customers per minute at the start, before upgrades and reputation. */
  baseArrivalsPerMinute?: number;
  /** When true (default) tick() brings abstract customers by itself; set false when the 3D layer spawns real ones and calls serveCustomer / sell. */
  autoCustomers?: boolean;
  /** Called for everything that happened: wire it to the event bus so the UI, sound and effects react. */
  onEvent?: (name: string, payload: Record<string, unknown>) => void;
}

export interface SaleResult { sold: number; revenue: number; productId: string }
export interface DaySummary { day: number; revenue: number; cogs: number; expenses: number; unpaid: number; profit: number; customers: number; lostCustomers: number }
export interface OfflineReport { awaySeconds: number; simulatedSeconds: number; capped: boolean; units: number; revenue: number; expenses: number }

const SAVE_VERSION = 1;
const MAX_CUSTOMERS_PER_TICK = 50;
const MAX_TICK = 5;
export const OFFLINE_CAP_SECONDS = 8 * 3600;
export const OFFLINE_EFFICIENCY = 0.5;

/**
 * The shop, headless. The 3D or 2D layer DRAWS customers and shelves; this decides what everything is worth.
 * Call tick(dt) from the FIXED update, serveCustomer() or sell() when a customer reaches the till, and
 * serialize() into the game's save. Money is integer minor units throughout.
 */
export class Economy {
  readonly ledger: Ledger;
  readonly inventory: Inventory;
  readonly orders: OrderBook;
  readonly upgrades: Upgrades;

  private rng: Rng;
  private prices = new Map<string, number>();
  private soldRate = new Map<string, number>(); // units per second, smoothed day to day
  private unitsToday = new Map<string, number>();
  private arrivalAcc = 0;
  private dayClock = 0;
  private _day = 1;
  private _staff = 0;
  private _debt = 0;
  private _reputation = 0.5;
  private today = { revenue: 0, cogs: 0, customers: 0, lost: 0 };
  private readonly cfg: Required<Omit<EconomyConfig, 'products' | 'upgrades' | 'onEvent'>> & { onEvent?: EconomyConfig['onEvent'] };

  constructor(config: EconomyConfig) {
    this.cfg = {
      seed: config.seed ?? 1,
      startCash: clampMoney(config.startCash ?? 500_00),
      dayLength: config.dayLength && config.dayLength >= 10 ? config.dayLength : 120,
      rentPerDay: clampMoney(config.rentPerDay ?? 0),
      wagePerDay: clampMoney(config.wagePerDay ?? 0),
      baseArrivalsPerMinute: typeof config.baseArrivalsPerMinute === 'number' && config.baseArrivalsPerMinute >= 0 ? Math.min(600, config.baseArrivalsPerMinute) : 6,
      autoCustomers: config.autoCustomers !== false,
      onEvent: config.onEvent,
    };
    this.rng = new Rng(this.cfg.seed);
    this.ledger = new Ledger(this.cfg.startCash);
    this.inventory = new Inventory(config.products);
    this.orders = new OrderBook();
    this.upgrades = new Upgrades(config.upgrades ?? DEFAULT_UPGRADES);
    for (const id of this.inventory.ids()) {
      this.prices.set(id, this.inventory.def(id)!.price);
      this.soldRate.set(id, 0);
      this.unitsToday.set(id, 0);
    }
    this.applyUpgrades();
  }

  get day(): number { return this._day; }
  get staff(): number { return this._staff; }
  get debt(): number { return this._debt; }
  get reputation(): number { return this._reputation; }
  /** Seconds left in the current day. */
  get dayRemaining(): number { return Math.max(0, this.cfg.dayLength - this.dayClock); }

  priceOf(id: string): number { return this.prices.get(id) ?? 0; }

  /** Set a selling price. Clamped to [0, fair price x markup ceiling]. Returns the price really set. */
  setPrice(id: string, price: number): number {
    const def = this.inventory.def(id);
    if (!def) return 0;
    const p = Math.min(clampMoney(price), Math.floor(def.price * DEFAULT_MARKUP_CEILING));
    this.prices.set(id, p);
    return p;
  }

  setStaff(n: number): number { this._staff = clampInt(n, 0, 1000, this._staff); return this._staff; }

  /** Order stock. Pass a requestId from the click so a double tap or a retry cannot buy twice. */
  order(productId: string, qty: number, requestId?: string): OrderResult {
    const r = this.orders.place(this.inventory, this.ledger, productId, qty, requestId);
    if (r.ok && !r.duplicate) this.emit('ORDER_PLACED', { productId, qty, paid: r.order.paid });
    return r;
  }

  buyUpgrade(id: string): BuyResult {
    const r = this.upgrades.buy(id, this.ledger);
    if (r.ok) { this.applyUpgrades(); this.emit('UPGRADE_BOUGHT', { id, level: r.level, paid: r.paid }); }
    return r;
  }

  /** Put stock on the shelf from the stock room. Returns units moved. */
  restockShelf(productId: string, qty?: number): number {
    const n = this.inventory.restockShelf(productId, qty);
    if (n > 0) this.emit('SHELF_RESTOCKED', { productId, moved: n });
    return n;
  }

  /** A customer pays for qty units of a product at the CURRENT price. Sells only what is on the shelf. */
  sell(productId: string, qty: number = 1): SaleResult {
    const def = this.inventory.def(productId);
    if (!def) return { sold: 0, revenue: 0, productId };
    const sold = this.inventory.take(productId, qty);
    if (sold <= 0) return { sold: 0, revenue: 0, productId };
    const revenue = this.ledger.earn(this.priceOf(productId) * sold, 'sale');
    this.today.revenue += revenue;
    this.today.cogs += def.cost * sold;
    this.unitsToday.set(productId, (this.unitsToday.get(productId) ?? 0) + sold);
    this._reputation = Math.min(1, this._reputation + 0.002 * sold);
    this.emit('SALE', { productId, sold, revenue });
    return { sold, revenue, productId };
  }

  /**
   * One customer walks in and decides. They pick a product by how much people want it AT ITS PRICE, among
   * those actually on the shelf; they may still walk out if it is too dear. Returns the sale, or null when
   * they left empty-handed (and says why in the event). Seeded: the same seed replays the same customers.
   */
  serveCustomer(): SaleResult | null {
    this.today.customers++;
    const options: Array<{ id: string; w: number; chance: number }> = [];
    let total = 0;
    for (const id of this.inventory.ids()) {
      if (this.inventory.onShelf(id) <= 0) continue;
      const def = this.inventory.def(id)!;
      const chance = demandFactor(this.priceOf(id), def.price);
      const w = (def.demand ?? 1) * chance;
      if (w > 0) { options.push({ id, w, chance }); total += w; }
    }
    if (total <= 0) {
      const anyStock = this.inventory.shelfTotal() > 0;
      return this.walkOut(anyStock ? 'price' : 'empty');
    }
    let roll = this.rng.next() * total;
    let pick = options[options.length - 1];
    for (const o of options) { roll -= o.w; if (roll <= 0) { pick = o; break; } }
    if (this.rng.next() > Math.min(1, pick.chance)) return this.walkOut('price');
    return this.sell(pick.id, 1);
  }

  private walkOut(why: 'price' | 'empty'): null {
    this.today.lost++;
    this._reputation = Math.max(0, this._reputation - (why === 'empty' ? 0.01 : 0.003));
    this.emit('CUSTOMER_LEFT', { why });
    return null;
  }

  /** Customers per minute right now: base x location upgrade x reputation (0.5x at zero, 1.5x at full). */
  arrivalsPerMinute(): number {
    return this.cfg.baseArrivalsPerMinute * this.upgrades.effect('foot_traffic') * (0.5 + this._reputation);
  }

  /** Advance the shop by dt seconds (use the fixed step). Deliveries land, customers come, days end. */
  tick(dt: number): void {
    const step = typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_TICK) : 0;
    if (step === 0) return;
    for (const d of this.orders.tick(step, this.inventory)) {
      this.emit('ORDER_DELIVERED', { productId: d.order.productId, qty: d.order.qty, accepted: d.accepted });
    }
    if (this.cfg.autoCustomers) {
      this.arrivalAcc += (step * this.arrivalsPerMinute()) / 60;
      let n = 0;
      while (this.arrivalAcc >= 1 && n < MAX_CUSTOMERS_PER_TICK) { this.arrivalAcc -= 1; n++; this.serveCustomer(); }
      if (this.arrivalAcc > MAX_CUSTOMERS_PER_TICK) this.arrivalAcc = 0;
    }
    this.dayClock += step;
    while (this.dayClock >= this.cfg.dayLength) { this.dayClock -= this.cfg.dayLength; this.endDay(); }
  }

  /** Rent and wages for the days that passed. What cannot be paid becomes debt, repaid first from the till. */
  private chargeExpenses(days: number): { due: number; unpaid: number } {
    let due = 0;
    let unpaid = 0;
    for (let i = 0; i < days; i++) {
      const repay = Math.min(this._debt, this.ledger.cash);
      if (repay > 0 && this.ledger.spend(repay, 'debt')) this._debt -= repay;
      const bill = this.cfg.rentPerDay + this.cfg.wagePerDay * this._staff;
      due += bill;
      if (bill > 0 && !this.ledger.spend(bill, 'expenses')) {
        const pay = Math.min(bill, this.ledger.cash);
        if (pay > 0) this.ledger.spend(pay, 'expenses');
        this._debt = clampMoney(this._debt + (bill - pay));
        unpaid += bill - pay;
      }
    }
    return { due, unpaid };
  }

  private endDay(): void {
    const { due, unpaid } = this.chargeExpenses(1);
    const summary: DaySummary = {
      day: this._day,
      revenue: this.today.revenue,
      cogs: this.today.cogs,
      expenses: due,
      unpaid,
      profit: this.today.revenue - this.today.cogs - due,
      customers: this.today.customers,
      lostCustomers: this.today.lost,
    };
    for (const id of this.inventory.ids()) {
      const perSecond = (this.unitsToday.get(id) ?? 0) / this.cfg.dayLength;
      const prior = this.soldRate.get(id) ?? 0;
      this.soldRate.set(id, prior === 0 ? perSecond : (prior + perSecond) / 2);
      this.unitsToday.set(id, 0);
    }
    this.today = { revenue: 0, cogs: 0, customers: 0, lost: 0 };
    this._day++;
    this.emit('DAY_ENDED', { ...summary });
  }

  /**
   * Earnings while the player was away. Deliberately NOT free money: time is capped (8 h), the rate is halved,
   * only stock that was really on the shelf can sell, and the rent for the days that passed is charged — so
   * being away is never better than playing.
   */
  simulateOffline(awaySeconds: number): OfflineReport {
    const away = typeof awaySeconds === 'number' && Number.isFinite(awaySeconds) && awaySeconds > 0 ? awaySeconds : 0;
    const simulated = Math.min(away, OFFLINE_CAP_SECONDS);
    let units = 0;
    let revenue = 0;
    for (const id of this.inventory.ids()) {
      const want = Math.floor((this.soldRate.get(id) ?? 0) * simulated * OFFLINE_EFFICIENCY);
      if (want <= 0) continue;
      const r = this.sell(id, want);
      units += r.sold;
      revenue += r.revenue;
    }
    const days = Math.floor(simulated / this.cfg.dayLength);
    const { due } = this.chargeExpenses(days);
    const report: OfflineReport = { awaySeconds: away, simulatedSeconds: simulated, capped: away > OFFLINE_CAP_SECONDS, units, revenue, expenses: due };
    if (simulated > 0) this.emit('OFFLINE_EARNINGS', { ...report });
    return report;
  }

  /** A JSON-safe snapshot for the game's save. nowMs is stored so the next load can work out time away. */
  serialize(nowMs?: number): Record<string, unknown> {
    return {
      v: SAVE_VERSION,
      savedAt: typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : 0,
      rng: this.rng.state,
      day: this._day,
      dayClock: this.dayClock,
      staff: this._staff,
      debt: this._debt,
      rep: this._reputation,
      acc: this.arrivalAcc,
      ledger: this.ledger.snapshot(),
      inventory: this.inventory.snapshot(),
      orders: this.orders.snapshot(),
      upgrades: this.upgrades.snapshot(),
      prices: Object.fromEntries(this.prices),
      rate: Object.fromEntries(this.soldRate),
    };
  }

  /**
   * Load a save. NEVER throws and never produces NaN money: anything that is not a valid v1 save yields a fresh
   * game, and inside a valid one unknown products are dropped and every number is clamped. When nowMs is given
   * and the save has a time, the away time is simulated (a clock that went backwards counts as zero).
   */
  static restore(raw: unknown, config: EconomyConfig, nowMs?: number): { economy: Economy; offline: OfflineReport | null } {
    const economy = new Economy(config);
    if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== SAVE_VERSION) return { economy, offline: null };
    const s = raw as Record<string, unknown>;
    economy.rng.state = typeof s.rng === 'number' ? s.rng : economy.cfg.seed;
    economy._day = clampInt(s.day, 1, 1_000_000, 1);
    economy.dayClock = typeof s.dayClock === 'number' && Number.isFinite(s.dayClock) ? Math.min(Math.max(0, s.dayClock), economy.cfg.dayLength - 0.001) : 0;
    economy._staff = clampInt(s.staff, 0, 1000, 0);
    economy._debt = clampMoney(typeof s.debt === 'number' ? s.debt : 0);
    economy._reputation = typeof s.rep === 'number' && Number.isFinite(s.rep) ? Math.min(1, Math.max(0, s.rep)) : 0.5;
    economy.arrivalAcc = typeof s.acc === 'number' && Number.isFinite(s.acc) ? Math.min(Math.max(0, s.acc), 1) : 0;
    economy.upgrades.restore(s.upgrades);
    economy.applyUpgrades();
    economy.inventory.restore(s.inventory);
    economy.ledger.restore(s.ledger);
    economy.orders.restore(s.orders, economy.inventory);
    const prices = (s.prices && typeof s.prices === 'object' ? s.prices : {}) as Record<string, unknown>;
    const rate = (s.rate && typeof s.rate === 'object' ? s.rate : {}) as Record<string, unknown>;
    for (const id of economy.inventory.ids()) {
      if (typeof prices[id] === 'number') economy.setPrice(id, prices[id] as number);
      const r = rate[id];
      economy.soldRate.set(id, typeof r === 'number' && Number.isFinite(r) && r >= 0 ? Math.min(r, 100) : 0);
    }
    let offline: OfflineReport | null = null;
    const savedAt = typeof s.savedAt === 'number' ? s.savedAt : 0;
    if (typeof nowMs === 'number' && Number.isFinite(nowMs) && savedAt > 0) {
      offline = economy.simulateOffline(Math.max(0, (nowMs - savedAt) / 1000));
    }
    return { economy, offline };
  }

  private applyUpgrades(): void {
    this.inventory.setCapacityMultiplier(this.upgrades.effect('shelf_space'));
    this.orders.setLeadMultiplier(this.upgrades.effect('fast_delivery'));
  }

  private emit(name: string, payload: Record<string, unknown>): void {
    try { this.cfg.onEvent?.(name, payload); } catch { /* a listener's bug must not corrupt the till */ }
  }
}
`;

const INDEX = String.raw`export { clampMoney, toMinor, fmtMoney, clampInt, MAX_MONEY, Rng } from './money';
export { Ledger } from './ledger';
export { Inventory, type ProductDef } from './inventory';
export { demandFactor, MAX_DEMAND, DEFAULT_MARKUP_CEILING } from './pricing';
export { OrderBook, DEFAULT_BULK_TIERS, type OrderResult, type PendingOrder, type BulkTier } from './orders';
export { Upgrades, DEFAULT_UPGRADES, type UpgradeDef, type BuyResult } from './upgrades';
export { Economy, OFFLINE_CAP_SECONDS, OFFLINE_EFFICIENCY, type EconomyConfig, type SaleResult, type DaySummary, type OfflineReport } from './economy';
`;

const FILES: Record<string, string> = {
  'src/game/economy/money.ts': MONEY,
  'src/game/economy/ledger.ts': LEDGER,
  'src/game/economy/inventory.ts': INVENTORY,
  'src/game/economy/pricing.ts': PRICING,
  'src/game/economy/orders.ts': ORDERS,
  'src/game/economy/upgrades.ts': UPGRADES,
  'src/game/economy/economy.ts': ECONOMY,
  'src/game/economy/index.ts': INDEX,
};

export const GAME_ECONOMY_MODULES: readonly string[] = ['money', 'ledger', 'inventory', 'pricing', 'orders', 'upgrades', 'economy', 'index'];

/** Generate the tycoon economy core. Pure; never throws. */
export function generateGameEconomy(include?: string[]): GameEconomyResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;

  let files: Record<string, string>;
  if (!wanted) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.ts$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    if (Object.keys(files).length === 0) files = { ...FILES };
    // economy.ts imports every other module; a subset that omits one it needs would not compile.
    if (files['src/game/economy/economy.ts']) files = { ...FILES };
    // Everything imports money.ts.
    files['src/game/economy/money.ts'] = FILES['src/game/economy/money.ts'];
    if (files['src/game/economy/orders.ts'] || files['src/game/economy/upgrades.ts']) {
      files['src/game/economy/ledger.ts'] = FILES['src/game/economy/ledger.ts'];
    }
    if (files['src/game/economy/orders.ts']) files['src/game/economy/inventory.ts'] = FILES['src/game/economy/inventory.ts'];
  }

  return {
    files,
    dependencies: [], // pure arithmetic, no three.js and no import from another game layer
    instructions:
      `Added the tycoon economy core (${Object.keys(files).length} files under src/game/economy). Money is an INTEGER number of minor units (paise).\n` +
      '```ts\n' +
      "import { Economy, toMinor, fmtMoney, type EconomyConfig } from './game/economy';\n" +
      '\n' +
      'const config: EconomyConfig = {\n' +
      '  seed: 7, startCash: toMinor(5000), dayLength: 120, rentPerDay: toMinor(200), wagePerDay: toMinor(150),\n' +
      '  products: [\n' +
      "    { id: 'atta', name: 'Atta 5kg', cost: toMinor(180), price: toMinor(230), shelfCapacity: 12, demand: 2 },\n" +
      "    { id: 'oil', name: 'Mustard oil', cost: toMinor(140), price: toMinor(175), shelfCapacity: 10 },\n" +
      '  ],\n' +
      '  // SALE, DAY_ENDED, ORDER_DELIVERED, CUSTOMER_LEFT… — forward them to the event bus so HUD, sound and effects react.\n' +
      '  onEvent: (name, payload) => { console.debug(name, payload); },\n' +
      '};\n' +
      '\n' +
      "// A save is validated on load: it never throws, and a corrupt one is simply a new game.\n" +
      "const saved: unknown = JSON.parse(localStorage.getItem('economy') ?? 'null');\n" +
      'export const { economy, offline } = Economy.restore(saved, config, Date.now());\n' +
      '\n' +
      '// Buttons. The id comes from the click, so a double tap or a retry cannot buy twice.\n' +
      "const clickId = crypto.randomUUID();\n" +
      "economy.order('atta', 40, clickId);       // refused BEFORE it is paid when the stock room cannot hold it\n" +
      "economy.restockShelf('atta');             // stock room -> shelf (customers only buy what is ON the shelf)\n" +
      "economy.setPrice('atta', toMinor(260));   // a real decision: demand falls as the price rises\n" +
      "economy.buyUpgrade('shelf_space');\n" +
      '\n' +
      '// Every FIXED update. With autoCustomers (default) abstract customers come by themselves; a 3D game with real\n' +
      '// customer NPCs passes autoCustomers: false and calls economy.serveCustomer() / economy.sell(id, qty) at the till.\n' +
      'export function fixedUpdate(dt: number): void {\n' +
      '  economy.tick(dt);\n' +
      '}\n' +
      '\n' +
      "export const cashLabel = (): string => fmtMoney(economy.ledger.cash);   // ₹1,23,456.50\n" +
      "export const save = (): void => localStorage.setItem('economy', JSON.stringify(economy.serialize(Date.now())));\n" +
      '```\n' +
      'THE RULES THESE ENCODE — do not re-implement them by hand:\n' +
      '- Money is INTEGER minor units, never a float. Show it with fmtMoney; convert with toMinor.\n' +
      '- spend() is one atomic check-and-debit and cash never goes negative. A rejected purchase changes nothing.\n' +
      '- An order that the stock room cannot hold is REFUSED BEFORE it is paid. Pass a requestId so a double tap or retry cannot charge twice.\n' +
      '- Customers buy only what is ON THE SHELF; a delivery lands in the stock room; restockShelf moves it. Counts never go negative or over capacity.\n' +
      '- Price matters: demandFactor is 1.0 at the fair price, rises when cheaper (capped), falls as it climbs, and is 0 at 3x. Never NaN.\n' +
      '- Expenses (rent, wages) are charged at the end of each day; what cannot be paid becomes DEBT, repaid first from the till.\n' +
      '- Offline earnings are capped (8 h), halved, limited to real shelf stock and charged the rent for the days away — never free money.\n' +
      '- A save is validated on load: unknown products dropped, numbers clamped, corrupt data = a fresh game.\n' +
      '- This is the money half only. Customers walking, shelves drawn and staff animated belong to the game layer, and call sell / serveCustomer. Tell the user honestly that save data lives on their device and can be edited by a determined player.',
  };
}
