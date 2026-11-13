// Tycoon part 2 — the PEOPLE of a shop: customers who walk, pick, queue and pay, and staff who serve and restock.
//
// Part 1 (`generate_game_economy`) decides what everything is worth. This decides who is where and when a till
// rings: a customer enters, walks to the shelf of the product they chose, takes it, joins the shortest queue,
// waits (and leaves if the wait is too long) and pays at a counter that a cashier — or the player — is serving;
// a stocker carries units from the stock room to the shelves. It is a SIMULATION on a grid with no drawing in it:
// the game reads `snapshot()` each frame and draws a person where the sim says they are (three.js, canvas or DOM
// — it does not matter), and calls `update(dt)` from the fixed step.
//
// WHY THIS IS A RECIPE AND NOT LEFT TO THE MODEL. People in a shop go wrong in specific, well-known ways, each
// invisible in a demo and ruinous in a long session:
//
//   • UNITS THAT VANISH OR APPEAR. A customer who picks the last item and then walks off the map, or abandons a
//     queue holding an item that is never returned, makes stock disappear. Every unit has exactly one place: on
//     the shelf, in the stock room, in a customer's hand, or sold. Picking TAKES it off the shelf at that moment
//     (so two customers cannot both pick the last unit), and an abandoned or refused cart is PUT BACK. The tests
//     prove the total is conserved across thousands of customers.
//   • PAYING WITHOUT A TILL. Money is taken at the counter by whoever serves it and never before; with nobody
//     serving, the queue builds, patience runs out, the customers leave and the shop's reputation pays for it.
//   • STUCK PEOPLE. A path that does not exist, a shelf behind a wall, a queue that is full: each becomes a
//     customer who leaves (and is counted), never one frozen in a doorway for ever. Layouts are checked up
//     front, and the unreachable cell is NAMED.
//   • AN UNBOUNDED CROWD. Customers on the floor are capped, the path search is capped, the queue length is
//     capped and the grid is capped, so a long session or a hostile layout cannot grow without limit.
//   • TWO STAFF DOING ONE JOB. A stocker claims a product before walking to it, so two stockers do not both
//     fetch the same shelf while another stays empty.
//   • A RANDOM THAT CANNOT BE REPLAYED. Everything is seeded; the same seed and the same inputs replay the same
//     shop, which is what makes the rules provable by running them.
//
// PURE — no I/O, no DOM, no three.js. It imports the economy layer (the addMissing-layer step brings it).

export interface GameShopSimResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const GRID = String.raw`export interface Cell { x: number; y: number }

/** A grid this big is plenty for a shop and keeps every search cheap. */
export const MAX_GRID = 64;

function whole(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Walkable cells and walls. Cells are integers; anything outside the grid is a wall. */
export class Grid {
  readonly width: number;
  readonly height: number;
  private walls = new Set<number>();

  constructor(width: number, height: number, blocked: readonly Cell[] = []) {
    this.width = whole(width, 1, MAX_GRID, 1);
    this.height = whole(height, 1, MAX_GRID, 1);
    for (const c of blocked) if (this.inside(c)) this.walls.add(this.key(c));
  }

  inside(c: Cell): boolean {
    return !!c && Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < this.width && c.y < this.height;
  }
  key(c: Cell): number { return c.y * this.width + c.x; }
  blocked(c: Cell): boolean { return !this.inside(c) || this.walls.has(this.key(c)); }
  walkable(c: Cell): boolean { return !this.blocked(c); }
}

/** A tiny binary min-heap. Ties break by insertion order, so the same grid always yields the same path. */
class Heap {
  private a: Array<{ f: number; n: number; k: number }> = [];
  private n = 0;
  get size(): number { return this.a.length; }
  push(f: number, k: number): void {
    const item = { f, n: this.n++, k };
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.k;
  }
  private less(x: { f: number; n: number }, y: { f: number; n: number }): boolean { return x.f < y.f || (x.f === y.f && x.n < y.n); }
}

/**
 * The shortest 4-direction route from one cell to another, as the cells to step through (the start is not
 * included, the goal is). [] when you are already there; null when there is no route, when either end is a wall
 * or outside the grid, or when the search would need more than maxExpand cells — a bound, so one impossible
 * request can never freeze a frame.
 */
export function findPath(grid: Grid, from: Cell, to: Cell, maxExpand: number = 4096): Cell[] | null {
  if (!grid.walkable(from) || !grid.walkable(to)) return null;
  const start = grid.key(from);
  const goal = grid.key(to);
  if (start === goal) return [];
  const w = grid.width;
  const came = new Map<number, number>();
  const cost = new Map<number, number>([[start, 0]]);
  const open = new Heap();
  open.push(Math.abs(from.x - to.x) + Math.abs(from.y - to.y), start);
  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) {
      const out: Cell[] = [];
      for (let k = goal; k !== start; k = came.get(k)!) out.push({ x: k % w, y: Math.floor(k / w) });
      return out.reverse();
    }
    if (++expanded > maxExpand) return null;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    const g = (cost.get(cur) ?? 0) + 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: cx + dx, y: cy + dy };
      if (!grid.walkable(next)) continue;
      const nk = grid.key(next);
      if (g < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, g);
        came.set(nk, cur);
        open.push(g + Math.abs(next.x - to.x) + Math.abs(next.y - to.y), nk);
      }
    }
  }
  return null;
}
`;

const SHOP = String.raw`import type { Economy } from '../economy/economy';
import { Rng } from '../economy/money';
import { Grid, findPath, MAX_GRID, type Cell } from './grid';

export interface ShelfSpot {
  productId: string;
  /** The walkable cell a customer stands on to take this product (the shelf itself may be a wall). */
  stand: Cell;
}
export interface CheckoutSpot {
  /** Where the cashier stands. */
  cashier: Cell;
  /** The waiting line, front first. Its length is how many customers this counter can hold. */
  queue: Cell[];
}
export interface ShopLayout {
  width: number;
  height: number;
  blocked?: Cell[];
  entrance: Cell;
  exit: Cell;
  /** Where the stocker waits and picks up stock. */
  backroom: Cell;
  shelves: ShelfSpot[];
  checkouts: CheckoutSpot[];
}

export type Role = 'cashier' | 'stocker';
export type CustomerState = 'walking_to_shelf' | 'picking' | 'walking_to_queue' | 'queueing' | 'leaving';
export type StaffState = 'idle' | 'walking_to_shelf' | 'restocking' | 'walking_back';

export interface Person { x: number; y: number }
export interface CustomerView extends Person { id: number; state: CustomerState; productId: string; carrying: boolean }
export interface StaffView extends Person { id: number; role: Role; state: StaffState }
export interface ShopStats { served: number; abandoned: number; turnedAway: number; floorFull: number; averageWaitSeconds: number }

export interface ShopSimOptions {
  seed?: number;
  /** Cells per second a person walks. */
  speed?: number;
  /** Seconds a customer looks at the shelf before taking the item. */
  pickSeconds?: number;
  /** Seconds the cashier (or the player) needs to ring one customer up. */
  serviceSeconds?: number;
  /** Seconds a stocker takes to fill one shelf. */
  restockSeconds?: number;
  /** Seconds a customer will wait in a queue before leaving. */
  patienceSeconds?: number;
  /** Most customers on the floor at once. */
  maxCustomers?: number;
  /** Called for CUSTOMER_ENTERED, CUSTOMER_PICKED, CUSTOMER_PAID, CUSTOMER_ABANDONED, CUSTOMER_LEFT, STAFF_HIRED, STAFF_FIRED, SHELF_FILLED. */
  onEvent?: (name: string, payload: Record<string, unknown>) => void;
}

interface Customer extends Person {
  id: number; state: CustomerState; productId: string; carrying: boolean;
  path: Cell[]; timer: number; wait: number; patience: number; checkout: number; target: Cell | null;
}
interface Staff extends Person {
  id: number; role: Role; state: StaffState; path: Cell[]; timer: number; productId: string; checkout: number;
}
interface Counter { spot: CheckoutSpot; line: Customer[]; service: number }

const MAX_QUEUE = 12;
const MAX_STAFF = 20;
const MAX_STEP = 0.25;
const MAX_SUBSTEPS = 20;
const REPATHS_PER_STEP = 8;

const cell = (c: Cell): Cell => ({ x: Math.round(c?.x ?? 0), y: Math.round(c?.y ?? 0) });
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Move along a path at speed (cells per second). true when the path is finished. */
function walk(p: Person & { path: Cell[] }, dt: number, speed: number): boolean {
  let budget = speed * dt;
  while (p.path.length > 0 && budget > 0) {
    const t = p.path[0];
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) { p.x = t.x; p.y = t.y; p.path.shift(); budget -= d; }
    else { p.x += (dx / d) * budget; p.y += (dy / d) * budget; budget = 0; }
  }
  return p.path.length === 0;
}

/**
 * The people of the shop. update(dt) from the FIXED step; snapshot() to draw; the game calls hire / fire for
 * staff and setPlayerAt(counterIndex) while the player stands at a counter. The economy it drives must be built
 * with autoCustomers: false — this brings the customers, and two sources would double the crowd.
 *
 * Every unit has exactly one place: shelf, stock room, a customer's hand, or sold. Picking TAKES the unit off
 * the shelf at that moment, so two customers cannot both take the last one; an abandoned or refused cart is put
 * back. Money moves only at a counter, when someone is serving it.
 */
export class ShopSim {
  readonly grid: Grid;
  readonly layout: ShopLayout;
  private rng: Rng;
  private opt: Required<Omit<ShopSimOptions, 'onEvent'>> & { onEvent?: ShopSimOptions['onEvent'] };
  private customers: Customer[] = [];
  private staff: Staff[] = [];
  private counters: Counter[];
  private nextId = 1;
  private arrivalAcc = 0;
  private playerAt: number | null = null;
  private claimed = new Set<string>();
  private _stats = { served: 0, abandoned: 0, turnedAway: 0, floorFull: 0, waitTotal: 0 };

  constructor(readonly economy: Economy, layout: ShopLayout, options: ShopSimOptions = {}) {
    const blocked = Array.isArray(layout?.blocked) ? layout.blocked.map(cell) : [];
    this.grid = new Grid(layout?.width, layout?.height, blocked);
    this.layout = {
      width: this.grid.width, height: this.grid.height, blocked,
      entrance: cell(layout?.entrance), exit: cell(layout?.exit), backroom: cell(layout?.backroom),
      shelves: (Array.isArray(layout?.shelves) ? layout.shelves : [])
        .filter((s) => s && typeof s.productId === 'string' && s.stand).map((s) => ({ productId: s.productId, stand: cell(s.stand) })),
      checkouts: (Array.isArray(layout?.checkouts) ? layout.checkouts : [])
        .filter((c) => c && c.cashier && Array.isArray(c.queue)).slice(0, 8)
        .map((c) => ({ cashier: cell(c.cashier), queue: c.queue.slice(0, MAX_QUEUE).map(cell) })),
    };
    this.counters = this.layout.checkouts.map((spot) => ({ spot, line: [], service: 0 }));
    this.rng = new Rng(options.seed ?? 1);
    this.opt = {
      seed: options.seed ?? 1,
      speed: num(options.speed, 0.5, 20, 2.5),
      pickSeconds: num(options.pickSeconds, 0, 30, 1),
      serviceSeconds: num(options.serviceSeconds, 0.2, 120, 3),
      restockSeconds: num(options.restockSeconds, 0.2, 120, 2),
      patienceSeconds: num(options.patienceSeconds, 5, 3600, 40),
      maxCustomers: Math.floor(num(options.maxCustomers, 1, 200, 30)),
      onEvent: options.onEvent,
    };
  }

  /**
   * What is wrong with this layout, in words, or [] when it works: a product with no shelf, a cell that is a wall
   * or off the grid, a shelf no customer can reach from the door, a counter with no way to the exit, no counter
   * at all. Run it once when the layout is made — it names the cell, so the fix is obvious.
   */
  problems(): string[] {
    const out: string[] = [];
    const g = this.grid;
    const L = this.layout;
    const must = (name: string, c: Cell): boolean => {
      if (g.walkable(c)) return true;
      out.push(name + ' (' + c.x + ',' + c.y + ') is a wall or outside the ' + g.width + 'x' + g.height + ' grid');
      return false;
    };
    const reach = (name: string, from: Cell, to: Cell): void => {
      if (g.walkable(from) && g.walkable(to) && findPath(g, from, to) === null) out.push(name + ': no walkable route from (' + from.x + ',' + from.y + ') to (' + to.x + ',' + to.y + ')');
    };
    must('entrance', L.entrance); must('exit', L.exit); must('backroom', L.backroom);
    if (L.checkouts.length === 0) out.push('there is no checkout counter, so nobody can ever pay');
    for (const id of this.economy.inventory.ids()) {
      if (!L.shelves.some((s) => s.productId === id)) out.push('product "' + id + '" has no shelf, so no customer can ever pick it');
    }
    for (const s of L.shelves) {
      if (!this.economy.inventory.has(s.productId)) out.push('a shelf is set for unknown product "' + s.productId + '"');
      if (must('shelf "' + s.productId + '" stand cell', s.stand)) reach('shelf "' + s.productId + '"', L.entrance, s.stand);
    }
    L.checkouts.forEach((c, i) => {
      must('checkout ' + i + ' cashier cell', c.cashier);
      if (c.queue.length === 0) out.push('checkout ' + i + ' has no queue cells');
      c.queue.forEach((q, j) => { if (must('checkout ' + i + ' queue cell ' + j, q)) { reach('checkout ' + i + ' queue ' + j, L.entrance, q); reach('checkout ' + i + ' queue ' + j + ' to the exit', q, L.exit); } });
    });
    reach('shelves back to the stock room', L.backroom, L.shelves[0]?.stand ?? L.backroom);
    return out;
  }

  // ---- staff ----------------------------------------------------------------------------------------------------

  /** Hire one. The wage is the economy's (it charges rent and wages per staff member at the end of each day). */
  hire(role: Role): number | null {
    if (role !== 'cashier' && role !== 'stocker') return null;
    if (this.staff.length >= MAX_STAFF) return null;
    if (role === 'cashier' && this.staff.filter((s) => s.role === 'cashier').length >= this.counters.length) return null;
    const free = this.counters.findIndex((_, i) => !this.staff.some((s) => s.role === 'cashier' && s.checkout === i));
    const post = role === 'cashier' ? this.layout.checkouts[free].cashier : this.layout.backroom;
    const s: Staff = { id: this.nextId++, role, state: 'idle', x: post.x, y: post.y, path: [], timer: 0, productId: '', checkout: role === 'cashier' ? free : -1 };
    this.staff.push(s);
    this.economy.setStaff(this.staff.length);
    this.emit('STAFF_HIRED', { id: s.id, role });
    return s.id;
  }

  fire(id: number): boolean {
    const i = this.staff.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const [gone] = this.staff.splice(i, 1);
    if (gone.productId) this.claimed.delete(gone.productId);
    this.economy.setStaff(this.staff.length);
    this.emit('STAFF_FIRED', { id, role: gone.role });
    return true;
  }

  staffCount(role?: Role): number { return role ? this.staff.filter((s) => s.role === role).length : this.staff.length; }

  /** The player stands at counter i (or null when they step away). While they do, they serve it. */
  setPlayerAt(counter: number | null): void {
    this.playerAt = counter !== null && Number.isInteger(counter) && counter >= 0 && counter < this.counters.length ? counter : null;
  }

  // ---- the loop -------------------------------------------------------------------------------------------------

  /** Advance by dt seconds. Safe with any dt: NaN, negative and zero do nothing; a long one is split into steps. */
  update(dt: number): void {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return;
    let left = Math.min(dt, MAX_STEP * MAX_SUBSTEPS);
    while (left > 1e-9) {
      const step = Math.min(left, MAX_STEP);
      left -= step;
      this.step(step);
    }
  }

  private step(dt: number): void {
    this.spawn(dt);
    let repaths = REPATHS_PER_STEP;
    for (const c of this.customers) repaths = this.moveCustomer(c, dt, repaths);
    this.customers = this.customers.filter((c) => c.state !== ('gone' as CustomerState));
    this.serveCounters(dt);
    for (const s of this.staff) this.moveStaff(s, dt);
  }

  private spawn(dt: number): void {
    this.arrivalAcc += (dt * this.economy.arrivalsPerMinute()) / 60;
    let guard = 0;
    while (this.arrivalAcc >= 1 && guard++ < 10) {
      this.arrivalAcc -= 1;
      if (this.customers.length >= this.opt.maxCustomers) { this._stats.floorFull++; continue; }
      const productId = this.economy.chooseProduct();
      if (productId === null) continue; // they looked and left; the economy has already counted it
      const shelf = this.layout.shelves.find((s) => s.productId === productId);
      const path = shelf ? findPath(this.grid, this.layout.entrance, shelf.stand) : null;
      if (!shelf || path === null) { this._stats.turnedAway++; this.emit('CUSTOMER_LEFT', { why: 'no_route', productId }); continue; }
      const e = this.layout.entrance;
      const c: Customer = {
        id: this.nextId++, state: 'walking_to_shelf', productId, carrying: false, x: e.x, y: e.y, path,
        timer: 0, wait: 0, patience: this.opt.patienceSeconds * (0.7 + this.rng.next() * 0.6), checkout: -1, target: null,
      };
      this.customers.push(c);
      this.emit('CUSTOMER_ENTERED', { id: c.id, productId });
    }
    if (this.arrivalAcc > 10) this.arrivalAcc = 0;
  }

  private moveCustomer(c: Customer, dt: number, repaths: number): number {
    switch (c.state) {
      case 'walking_to_shelf':
        if (walk(c, dt, this.opt.speed)) { c.state = 'picking'; c.timer = this.opt.pickSeconds; }
        break;
      case 'picking': {
        c.timer -= dt;
        if (c.timer > 0) break;
        if (this.economy.inventory.take(c.productId, 1) < 1) { this.refuse(c, 'empty'); break; }
        c.carrying = true;
        this.emit('CUSTOMER_PICKED', { id: c.id, productId: c.productId });
        const lane = this.shortestLine();
        if (lane < 0) { this.refuse(c, 'queue'); break; }
        c.checkout = lane;
        this.counters[lane].line.push(c);
        c.state = 'walking_to_queue';
        break;
      }
      case 'walking_to_queue':
      case 'queueing': {
        const line = this.counters[c.checkout].line;
        const slot = this.counters[c.checkout].spot.queue[Math.min(line.indexOf(c), this.counters[c.checkout].spot.queue.length - 1)];
        if (!c.target || c.target.x !== slot.x || c.target.y !== slot.y) {
          if (repaths <= 0) break;
          repaths--;
          const route = findPath(this.grid, cell(c), slot);
          if (route === null) { this.abandon(c, 'no_route'); break; }
          c.path = route;
          c.target = slot;
        }
        const arrived = walk(c, dt, this.opt.speed);
        c.state = arrived ? 'queueing' : 'walking_to_queue';
        c.wait += dt;
        if (c.wait > c.patience) this.abandon(c, 'patience');
        break;
      }
      case 'leaving':
        if (walk(c, dt, this.opt.speed)) c.state = 'gone' as CustomerState;
        break;
    }
    return repaths;
  }

  /** The counter with room and the fewest people, or -1 when every line is full. */
  private shortestLine(): number {
    let best = -1;
    this.counters.forEach((k, i) => {
      if (k.line.length >= k.spot.queue.length) return;
      if (best < 0 || k.line.length < this.counters[best].line.length) best = i;
    });
    return best;
  }

  /** Walk off with whatever is in hand put back. Nothing is lost: a unit is on the shelf, in a hand, or sold. */
  private refuse(c: Customer, why: 'empty' | 'queue'): void {
    if (c.carrying) { this.economy.inventory.putBack(c.productId, 1); c.carrying = false; }
    this._stats.turnedAway++;
    this.economy.lose(why);
    this.emit('CUSTOMER_LEFT', { id: c.id, why, productId: c.productId });
    this.sendOut(c);
  }

  private abandon(c: Customer, why: 'patience' | 'no_route'): void {
    const line = this.counters[c.checkout].line;
    const i = line.indexOf(c);
    if (i >= 0) line.splice(i, 1);
    if (c.carrying) { this.economy.inventory.putBack(c.productId, 1); c.carrying = false; }
    this._stats.abandoned++;
    this.economy.lose('queue');
    this.emit('CUSTOMER_ABANDONED', { id: c.id, why, productId: c.productId, waited: c.wait });
    this.sendOut(c);
  }

  private sendOut(c: Customer): void {
    const route = findPath(this.grid, cell(c), this.layout.exit);
    c.checkout = -1; c.target = null;
    if (route === null) { c.state = 'gone' as CustomerState; return; }
    c.path = route; c.state = 'leaving';
  }

  private serveCounters(dt: number): void {
    this.counters.forEach((k, i) => {
      const front = k.line[0];
      const served = this.staff.some((s) => s.role === 'cashier' && s.checkout === i) || this.playerAt === i;
      if (!front || front.state !== 'queueing' || !served) { if (!front || front.state !== 'queueing') k.service = 0; return; }
      k.service += dt;
      if (k.service < this.opt.serviceSeconds) return;
      k.service = 0;
      k.line.shift();
      front.carrying = false;
      const sale = this.economy.settle(front.productId, 1);
      this._stats.served++;
      this._stats.waitTotal += front.wait;
      this.emit('CUSTOMER_PAID', { id: front.id, productId: front.productId, revenue: sale.revenue, waited: front.wait });
      this.sendOut(front);
    });
  }

  private moveStaff(s: Staff, dt: number): void {
    if (s.role !== 'stocker') return;
    const inv = this.economy.inventory;
    switch (s.state) {
      case 'idle': {
        let pick = '';
        let worst = 0.5;
        for (const id of inv.ids()) {
          if (this.claimed.has(id) || inv.inBackroom(id) < 1 || inv.shelfSpace(id) < 1) continue;
          const fill = inv.onShelf(id) / Math.max(1, inv.shelfCap(id));
          if (fill < worst) { worst = fill; pick = id; }
        }
        const shelf = pick ? this.layout.shelves.find((x) => x.productId === pick) : undefined;
        const route = shelf ? findPath(this.grid, cell(s), shelf.stand) : null;
        if (!pick || !shelf || route === null) break;
        this.claimed.add(pick);
        s.productId = pick; s.path = route; s.state = 'walking_to_shelf';
        break;
      }
      case 'walking_to_shelf':
        if (walk(s, dt, this.opt.speed)) { s.state = 'restocking'; s.timer = this.opt.restockSeconds; }
        break;
      case 'restocking': {
        s.timer -= dt;
        if (s.timer > 0) break;
        const moved = this.economy.restockShelf(s.productId);
        this.claimed.delete(s.productId);
        this.emit('SHELF_FILLED', { staff: s.id, productId: s.productId, moved });
        s.productId = '';
        const back = findPath(this.grid, cell(s), this.layout.backroom);
        s.path = back ?? []; s.state = 'walking_back';
        break;
      }
      case 'walking_back':
        if (walk(s, dt, this.opt.speed)) s.state = 'idle';
        break;
    }
  }

  // ---- reading --------------------------------------------------------------------------------------------------

  /** Everyone, where they are now — the game draws from this each frame. Copies; nothing here can change the sim. */
  snapshot(): { customers: CustomerView[]; staff: StaffView[]; lines: number[] } {
    return {
      customers: this.customers.map((c) => ({ id: c.id, x: c.x, y: c.y, state: c.state, productId: c.productId, carrying: c.carrying })),
      staff: this.staff.map((s) => ({ id: s.id, x: s.x, y: s.y, role: s.role, state: s.state })),
      lines: this.counters.map((k) => k.line.length),
    };
  }

  /** Units customers are holding right now (taken off the shelf, not yet paid for or put back). */
  inHand(productId?: string): number {
    return this.customers.filter((c) => c.carrying && (productId === undefined || c.productId === productId)).length;
  }

  stats(): ShopStats {
    const s = this._stats;
    return { served: s.served, abandoned: s.abandoned, turnedAway: s.turnedAway, floorFull: s.floorFull, averageWaitSeconds: s.served > 0 ? s.waitTotal / s.served : 0 };
  }

  private emit(name: string, payload: Record<string, unknown>): void {
    try { this.opt.onEvent?.(name, payload); } catch { /* a listener's bug must not corrupt the shop */ }
  }
}

export { MAX_GRID };
`;

const INDEX = String.raw`export { Grid, findPath, MAX_GRID, type Cell } from './grid';
export {
  ShopSim,
  type ShopLayout, type ShelfSpot, type CheckoutSpot, type ShopSimOptions, type ShopStats,
  type Role, type CustomerState, type StaffState, type CustomerView, type StaffView,
} from './shopsim';
`;

const FILES: Record<string, string> = {
  'src/game/shop/grid.ts': GRID,
  'src/game/shop/shopsim.ts': SHOP,
  'src/game/shop/index.ts': INDEX,
};

export const GAME_SHOPSIM_MODULES: readonly string[] = ['grid', 'shopsim', 'index'];

/** Generate the shop people simulation. Pure; never throws. */
export function generateGameShopSim(include?: string[]): GameShopSimResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;
  let files: Record<string, string> = { ...FILES };
  if (wanted) {
    const picked: Record<string, string> = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.ts$/i, '').toLowerCase();
      if (wanted.has(base)) picked[path] = content;
    }
    // shopsim.ts imports grid.ts; index.ts imports both.
    if (picked['src/game/shop/index.ts']) files = { ...FILES };
    else if (picked['src/game/shop/shopsim.ts']) files = { 'src/game/shop/grid.ts': GRID, 'src/game/shop/shopsim.ts': SHOP };
    else if (Object.keys(picked).length > 0) files = picked;
  }

  return {
    files,
    dependencies: [], // pure; imports the economy layer, which the missing-layer step brings
    instructions:
      `Added the shop people simulation (${Object.keys(files).length} files under src/game/shop). It needs the economy core (src/game/economy) and brings it if missing.\n` +
      '```ts\n' +
      "import { Economy, toMinor } from './game/economy';\n" +
      "import { ShopSim, type ShopLayout } from './game/shop';\n" +
      '\n' +
      "// autoCustomers: false — ShopSim brings the customers; two sources would double the crowd.\n" +
      'const economy = new Economy({\n' +
      "  autoCustomers: false, startCash: toMinor(5000), wagePerDay: toMinor(150),\n" +
      "  products: [{ id: 'atta', name: 'Atta 5kg', cost: toMinor(180), price: toMinor(230), shelfCapacity: 12 }],\n" +
      '});\n' +
      '\n' +
      "// A 12 x 8 shop. The door is on the left, the exit on the right. A shelf is a wall; 'stand' is where a customer stands to take from it.\n" +
      'const layout: ShopLayout = {\n' +
      '  width: 12, height: 8, entrance: { x: 0, y: 4 }, exit: { x: 11, y: 4 }, backroom: { x: 1, y: 0 },\n' +
      '  blocked: [{ x: 4, y: 1 }, { x: 5, y: 1 }],\n' +
      "  shelves: [{ productId: 'atta', stand: { x: 4, y: 2 } }],\n" +
      '  checkouts: [{ cashier: { x: 9, y: 6 }, queue: [{ x: 9, y: 5 }, { x: 9, y: 4 }, { x: 8, y: 4 }, { x: 7, y: 4 }] }],\n' +
      '};\n' +
      '\n' +
      'export const shop = new ShopSim(economy, layout, { seed: 7 });\n' +
      "export const layoutProblems = shop.problems();   // [] when it works; otherwise it NAMES the wall, shelf or counter that is wrong\n" +
      '\n' +
      "shop.hire('cashier');                            // or shop.setPlayerAt(0) while the player stands at counter 0\n" +
      "shop.hire('stocker');                            // carries units from the stock room to the shelves\n" +
      '\n' +
      '// Every FIXED update — economy.tick still does the day, deliveries and rent:\n' +
      'export function fixedUpdate(dt: number): void {\n' +
      '  economy.tick(dt);\n' +
      '  shop.update(dt);\n' +
      '}\n' +
      '\n' +
      '// Every frame, DRAW from the snapshot (a person is wherever the sim says); never keep positions of your own.\n' +
      'export const people = () => shop.snapshot();   // { customers: [{ x, y, state, carrying }], staff: [...], lines: [2, 0] }\n' +
      '```\n' +
      'THE RULES THESE ENCODE — do not re-implement them by hand:\n' +
      '- Every unit has ONE place: shelf, stock room, a customer\'s hand, or sold. Picking takes it off the shelf at that moment; an abandoned or refused cart is put back. Never decrement stock yourself.\n' +
      '- Money moves only at a counter, when a cashier or the player (setPlayerAt) is serving it. Nobody serving = the queue builds, patience runs out, customers leave and reputation falls.\n' +
      '- Run shop.problems() when the layout is made: a product with no shelf, a shelf behind a wall or a counter with no route to the exit is named, not discovered as a frozen customer.\n' +
      '- The crowd, the queue, the grid (64 x 64) and every path search are capped. Customers on the floor are limited by maxCustomers.\n' +
      '- Draw from snapshot(); the game never stores a person\'s position. Pass the same seed to replay the same shop.\n' +
      '- People are not part of the economy save (the floor starts empty on load) — say so honestly; cash, stock, prices and upgrades are saved by the economy.',
  };
}
