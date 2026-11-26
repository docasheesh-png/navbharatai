// ONLINE ROYALE (admin 2026-11-25, "sab karo"): the first real online match — a REAL in-process HTTP server, the
// REAL upgrade handler and match service, and 2–4 REAL WebSocket clients playing through the wire protocol.
// Only two things are substituted: the clock (so a three-minute match runs in milliseconds) and the store lookup
// (Firestore is not reachable in a test; the production verifier is the store's own getWebApp + canAccessNavData).
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { RoyaleMatchService, QUEUE_FILL_MS, LONE_WAIT_MS, RECONNECT_GRACE_MS, TICK_MS, type ServiceOptions } from '../src/server/lib/royaleOnline/matchService';
import { createRoyaleUpgradeHandler, ROYALE_WS_PATH, MAX_CONNECTS_PER_ADDRESS_PER_MIN, type AppVerdict } from '../src/server/lib/royaleOnline/royaleWs';

type Msg = Record<string, any>;
class Client {
  inbox: Msg[] = [];
  closed: { code: number } | null = null;
  private waiters: Array<() => void> = [];
  private pings = 0;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => { this.inbox.push(JSON.parse(d.toString())); this.wake(); });
    ws.on('close', (code) => { this.closed = { code }; this.wake(); });
    ws.on('error', () => { /* close follows */ });
  }
  private wake() { const w = this.waiters; this.waiters = []; for (const f of w) f(); }
  send(m: Msg) { this.ws.send(JSON.stringify(m)); }
  /** The newest message of a type matching `pred`, waiting for it if needed. */
  async next(t: string, pred: (m: Msg) => boolean = () => true, timeoutMs = 3000): Promise<Msg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = [...this.inbox].reverse().find((m) => m.t === t && pred(m));
      if (found) return found;
      if (this.closed) throw new Error('closed (' + this.closed.code + ') while waiting for ' + t + '; inbox: ' + JSON.stringify(this.inbox.slice(-3)));
      if (Date.now() > deadline) throw new Error('timed out waiting for ' + t + '; inbox: ' + JSON.stringify(this.inbox.slice(-3)));
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 50); });
    }
  }
  has(t: string, pred: (m: Msg) => boolean = () => true) { return this.inbox.some((m) => m.t === t && pred(m)); }
  /** One WebSocket is ordered and the server handles each frame synchronously: a pong means every earlier frame was applied. */
  async sync() { const id = ++this.pings; this.send({ t: 'ping', id }); await this.next('pong', (m) => m.id === id); }
  async waitClosed() { for (let i = 0; i < 60 && !this.closed; i++) await new Promise((r) => setTimeout(r, 50)); return this.closed; }
}

const START = Date.parse('2026-11-25T10:00:00Z');
let server: Server | null = null;
let handler: ReturnType<typeof createRoyaleUpgradeHandler> | null = null;
const clients: Client[] = [];

async function harness(opts: { service?: ServiceOptions; enabled?: boolean; verify?: (app: string, access: string | null) => AppVerdict; perClientAddress?: boolean } = {}) {
  const clock = { now: START };
  const service = new RoyaleMatchService({ now: () => clock.now, ...opts.service });
  handler = createRoyaleUpgradeHandler({
    service,
    verifyApp: async (app, access) => (opts.verify ?? ((a) => (a === 'store-app' || a === 'other-app' ? 'ok' : 'missing')))(app, access),
    enabled: () => opts.enabled ?? true,
    now: () => clock.now,
    // Every test client is 127.0.0.1; the per-address limit has its own test that uses the real address.
    ...(opts.perClientAddress === false ? {} : { addressKey: (req) => String(req.headers['x-client'] ?? 'x') }),
  });
  server = createServer((_q, r) => { r.statusCode = 404; r.end(); });
  server.on('upgrade', (req, socket, head) => { if (!handler!(req, socket, head)) socket.destroy(); });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  let n = 0;
  const open = async (query: string): Promise<Client> => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + ROYALE_WS_PATH + '?' + query, { headers: { 'x-client': 'c' + (++n) } });
    const c = new Client(ws); clients.push(c);
    await new Promise<void>((resolve) => { ws.once('open', () => resolve()); ws.once('error', () => resolve()); ws.once('close', () => resolve()); });
    return c;
  };
  const join = async (app = 'store-app') => { const c = await open('app=' + app); await c.next('welcome'); return c; };
  /** Advance the server clock in ticks. */
  const run = (ms: number) => { for (let t = 0; t < ms; t += TICK_MS) { clock.now += TICK_MS; service.tick(); } };
  /** Walk to (x, z) at 10 m/s in 1 m steps every 100 ms (10 moves/s, like a real client's ~15), each confirmed by the server before time moves on. */
  const walk = async (c: Client, x: number, z: number) => {
    const me = (await c.next('welcome')).you;
    const room = service.roomOf(me)!;
    let p = room.players.find((q) => q.id === me)!;
    for (let guard = 0; guard < 400; guard++) {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.01) return;
      const step = Math.min(1, d);
      c.send({ t: 'move', x: p.x + (dx / d) * step, z: p.z + (dz / d) * step, yaw: Math.atan2(dx, dz), seq: guard + 1 });
      await c.sync();
      run(2 * TICK_MS);
      p = room.players.find((q) => q.id === me)!;
    }
    throw new Error('walk did not arrive');
  };
  return { clock, service, open, join, run, walk };
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  handler?.close(); handler = null;
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

describe('a full online match, played over real sockets, ends with one winner', () => {
  it('three players queue, the match starts, one eliminates the others, everyone gets the SAME single result, and queue-again works', async () => {
    const h = await harness({ service: { botsAllowed: false } });
    const [a, b, c] = [await h.join(), await h.join(), await h.join()];
    for (const x of [a, b, c]) { x.send({ t: 'queue' }); await x.sync(); }
    expect((await c.next('queued')).waiting).toBe(3);
    h.run(QUEUE_FILL_MS);
    const start = await a.next('start');
    expect(start.players).toHaveLength(3);
    expect(start.players.every((p: Msg) => p.bot === false)).toBe(true);
    const id = async (x: Client) => (await x.next('welcome')).you;
    const [ida, idb, idc] = [await id(a), await id(b), await id(c)];
    const room = h.service.roomOf(ida)!;

    // B walks up beside A (A spawns at 0,32), and A shoots B down: 34 damage a shot, three shots.
    await h.walk(b, 8, 32);
    for (let i = 0; i < 3; i++) { a.send({ t: 'fire', yaw: Math.atan2(8, 0) }); await a.sync(); h.run(300); }
    expect(room.players.find((p) => p.id === idb)!.alive).toBe(false);
    expect((await a.next('shot')).hit).toBe(idb);

    // C comes round the cover block in the middle and A finishes the match.
    await h.walk(c, -8, -20);
    await h.walk(c, -8, 22);
    const yaw = Math.atan2(-8 - 0, 22 - 32);
    for (let i = 0; i < 3; i++) { a.send({ t: 'fire', yaw }); await a.sync(); h.run(300); }

    const ends = await Promise.all([a, b, c].map((x) => x.next('end')));
    for (const e of ends) { expect(e.winner).toBe(ida); expect(e.room).toBe(start.room); }
    expect(ends[0].places.map((p: Msg) => p.place)).toEqual([1, 2, 3]);
    expect(ends[0].places.map((p: Msg) => p.id)).toEqual([ida, idc, idb]);
    expect(ends[0].you).toMatchObject({ id: ida, place: 1, kills: 2 });
    expect(ends[2].you).toMatchObject({ id: idc, place: 2, cause: 'Player 1' });

    // The result is recorded exactly once, however long the clock runs on.
    h.run(5000);
    expect(h.service.counters.resultsRecorded).toBe(1);
    expect(a.inbox.filter((m) => m.t === 'end')).toHaveLength(1);

    // Queue again: the same connection goes straight back into the queue.
    a.send({ t: 'queue' }); await a.sync();
    expect((await a.next('queued')).waiting).toBe(1);
  });

  it('four players start at once, without waiting for the timer', async () => {
    const h = await harness();
    const four = [await h.join(), await h.join(), await h.join(), await h.join()];
    for (const x of four) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(TICK_MS);
    for (const x of four) expect((await x.next('start')).players.filter((p: Msg) => !p.bot)).toHaveLength(4);
  });

  it('a lone player gets a real match after the wait, with every bot LABELLED a bot — never passed off as a person', async () => {
    const h = await harness();
    const a = await h.join();
    a.send({ t: 'queue' }); await a.sync();
    h.run(LONE_WAIT_MS - 1000);
    expect(a.has('start')).toBe(false);
    h.run(2000);
    const start = await a.next('start');
    expect(start.players.map((p: Msg) => [p.name, p.bot])).toEqual([['Player 1', false], ['Bot 1', true], ['Bot 2', true], ['Bot 3', true]]);
  });

  it('a match nobody fights still ends — the server zone closes and one player is the winner', async () => {
    const h = await harness({ service: { botsAllowed: false } });
    const [a, b] = [await h.join(), await h.join()];
    for (const x of [a, b]) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(QUEUE_FILL_MS);
    await a.next('start');
    h.run(200_000);
    const [ea, eb] = [await a.next('end'), await b.next('end')];
    expect(ea.winner).toBe(eb.winner);
    expect(ea.places.filter((p: Msg) => p.place === 1)).toHaveLength(1);
    expect(h.service.counters.resultsRecorded).toBe(1);
  }, 20_000);
});

describe('the server is the authority', () => {
  async function inMatch() {
    const h = await harness({ service: { botsAllowed: false } });
    const [a, b] = [await h.join(), await h.join()];
    for (const x of [a, b]) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(QUEUE_FILL_MS);
    await a.next('start');
    const ida = (await a.next('welcome')).you, idb = (await b.next('welcome')).you;
    return { h, a, b, ida, idb, room: h.service.roomOf(ida)! };
  }

  it('a teleport, a step outside the arena, a step into cover and a garbage position are refused and corrected', async () => {
    const { h, a, ida, room } = await inMatch();
    const me = () => room.players.find((p) => p.id === ida)!;
    h.run(1000);
    a.send({ t: 'move', x: 0, z: 10, yaw: 0, seq: 1 }); await a.sync();
    expect(await a.next('correct')).toMatchObject({ x: 0, z: 32, reason: 'speed' });
    a.send({ t: 'move', x: 'NaN', z: 32, yaw: 0, seq: 2 }); await a.sync();
    expect((await a.next('correct', (m) => m.reason === 'invalid')).z).toBe(32);
    await h.walk(a, 0, 41);
    a.send({ t: 'move', x: 0, z: 41.8, yaw: 0, seq: 3 }); await a.sync();
    expect((await a.next('correct', (m) => m.reason === 'bounds')).z).toBe(41);
    expect(me().z).toBe(41);
    expect(me().rejected).toBe(3);
  });

  it('many tiny moves at ONE instant cannot outrun the speed cap — the allowance is a budget, not per message', async () => {
    const { a, ida, room } = await inMatch();
    for (let i = 1; i <= 20; i++) a.send({ t: 'move', x: 0, z: 32 - 0.5 * i, yaw: 0, seq: i });
    await a.sync();
    const p = room.players.find((q) => q.id === ida)!;
    expect(32 - p.z).toBeLessThanOrEqual(0.75 + 1e-9);
    expect(p.rejected).toBeGreaterThan(15);
  });

  it('cover stops a shot that would otherwise hit', async () => {
    const { h, a, b, ida, idb, room } = await inMatch();
    // B (spawn 32,0) stands south of the block [16,-2,18,6]; A comes to its north side. Line of fire runs through it.
    await h.walk(b, 17, -6);
    await h.walk(a, 20, 32); await h.walk(a, 20, 12); await h.walk(a, 17, 12);
    a.send({ t: 'fire', yaw: Math.atan2(0, -18) }); await a.sync();
    expect((await a.next('shot')).hit).toBeNull();
    expect(room.players.find((p) => p.id === idb)!.hp).toBe(100);
    expect(room.players.find((p) => p.id === ida)!.alive).toBe(true);
  }, 20_000);

  it('a crate goes to ONE player: the second claim on the same crate gets nothing', async () => {
    const { h, a, b, ida, idb, room } = await inMatch();
    await h.walk(b, 14, 10);          // B waits two metres from the armour crate at (14, 8)…
    await h.walk(a, 20, 32); await h.walk(a, 15, 8);  // …A walks onto it first…
    await h.walk(b, 14, 8);           // …then B steps onto the same spot.
    const crate = room.crates.find((c) => c.x === 14 && c.z === 8)!;
    expect(crate.takenBy).toBe(ida);
    expect(room.players.find((p) => p.id === ida)!.armor).toBe(50);
    expect(room.players.find((p) => p.id === idb)!.armor).toBe(0);
    expect(room.feed.filter((l) => l.includes('picked up armour'))).toHaveLength(1);
    h.run(TICK_MS * 2);
    const snap = await b.next('state');
    expect(snap.crates[1]).toBe(false);
  }, 20_000);
});

describe('reconnect and the single result', () => {
  it('a dropped player who comes back inside the grace window gets their place, position and health back', async () => {
    const h = await harness({ service: { botsAllowed: false } });
    const [a, b] = [await h.join(), await h.join()];
    for (const x of [a, b]) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(QUEUE_FILL_MS);
    await a.next('start');
    const welcome = await a.next('welcome');
    await h.walk(a, 4, 30);
    a.ws.close(); await a.waitClosed();
    await new Promise((r) => setTimeout(r, 50));
    h.run(RECONNECT_GRACE_MS - 3000);
    const back = await h.open('app=store-app&resume=' + encodeURIComponent(welcome.token));
    const again = await back.next('welcome');
    expect(again).toMatchObject({ you: welcome.you, resumed: true });
    const start = await back.next('start');
    expect(start.you).toBe(welcome.you);
    const state = await back.next('state');
    const me = state.players.find((p: Msg) => p.id === welcome.you);
    expect(me).toMatchObject({ x: 4, z: 30, alive: true });
    h.run(RECONNECT_GRACE_MS + 2000);
    expect(h.service.roomOf(welcome.you)!.players.find((p) => p.id === welcome.you)!.alive).toBe(true);
  });

  it('a token from another app, or a forged one, resumes nothing', async () => {
    const h = await harness();
    const a = await h.join();
    const token = (await a.next('welcome')).token as string;
    const other = await h.open('app=other-app&resume=' + encodeURIComponent(token));
    expect((await other.next('welcome')).resumed).toBe(false);
    const forged = await h.open('app=store-app&resume=' + encodeURIComponent(token.slice(0, -2) + 'xx'));
    expect((await forged.next('welcome')).resumed).toBe(false);
  });

  it('a player who stays away past the grace forfeits; the match ends ONCE, and coming back late shows that same result', async () => {
    const h = await harness({ service: { botsAllowed: false } });
    const [a, b] = [await h.join(), await h.join()];
    for (const x of [a, b]) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(QUEUE_FILL_MS);
    await b.next('start');
    const wb = await b.next('welcome'), ida = (await a.next('welcome')).you;
    b.ws.close(); await b.waitClosed();
    await new Promise((r) => setTimeout(r, 50));
    h.run(RECONNECT_GRACE_MS + 1000);
    const end = await a.next('end');
    expect(end.winner).toBe(ida);
    expect(end.places[1]).toMatchObject({ id: wb.you, cause: 'left' });
    const late = await h.open('app=store-app&resume=' + encodeURIComponent(wb.token));
    const lateEnd = await late.next('end');
    expect(lateEnd).toMatchObject({ room: end.room, winner: ida, endedAt: end.endedAt });
    h.run(2000);
    expect(h.service.counters.resultsRecorded).toBe(1);
  });
});

describe('a deploy does not leave players staring at a frozen match', () => {
  it('drain tells every connected player the match ended without a result, and records none', async () => {
    const h = await harness({ service: { botsAllowed: false } });
    const [a, b] = [await h.join(), await h.join()];
    for (const x of [a, b]) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(QUEUE_FILL_MS);
    await a.next('start');
    expect(h.service.drain()).toBe(2);
    for (const x of [a, b]) {
      expect((await x.next('unavailable')).reason).toMatch(/restarting/);
      expect((await x.waitClosed())?.code).toBe(4503);
    }
    expect(h.service.counters.resultsRecorded).toBe(0);
    expect(h.service.stats()).toMatchObject({ sessions: 0, rooms: 0, queued: 0 });
  });
});

describe('quotas, limits and the kill switch', () => {
  it('kill switch off: the socket is told the truth and closed — no session, no room', async () => {
    const h = await harness({ enabled: false });
    const c = await h.open('app=store-app');
    expect((await c.next('unavailable')).reason).toMatch(/switched off/);
    expect((await c.waitClosed())?.code).toBe(4403);
    expect(h.service.stats().sessions).toBe(0);
  });

  it('a game that is not on the store, and a private game without its access capability, are refused honestly', async () => {
    const h = await harness({ verify: (app, access) => (app === 'secret' ? (access === 'cap' ? 'ok' : 'private') : 'missing') });
    expect((await (await h.open('app=nope')).next('unavailable')).reason).toMatch(/App Store/);
    expect((await (await h.open('app=secret')).next('unavailable')).reason).toMatch(/private/);
    expect((await (await h.open('app=secret&access=cap')).next('welcome')).you).toBeTruthy();
  });

  it('the connection cap answers "full" and closes with 4429', async () => {
    const h = await harness({ service: { quotas: { MAX_CONNECTIONS_TOTAL: 2 } } });
    await h.join(); await h.join();
    const third = await h.open('app=store-app');
    expect((await third.next('full')).reason).toMatch(/full/);
    expect((await third.waitClosed())?.code).toBe(4429);
  });

  it("the per-app daily match limit refuses the next match honestly, on the server's clock", async () => {
    const h = await harness({ service: { quotas: { MAX_MATCHES_PER_APP_PER_DAY: 1 }, botsAllowed: false } });
    const four = [await h.join(), await h.join(), await h.join(), await h.join()];
    for (const x of four) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(TICK_MS);
    await four[0].next('start');
    const late = await h.join();
    late.send({ t: 'queue' }); await late.sync();
    expect((await late.next('full')).reason).toMatch(/today's online match limit/);
    const other = await h.join('other-app');
    other.send({ t: 'queue' }); await other.sync();
    expect((await other.next('queued')).waiting).toBe(1); // another app's budget is its own
  });

  it('a flood of messages is dropped past the rate budget, and a sustained flood closes the connection', async () => {
    const h = await harness({ service: { quotas: { MAX_DROPPED: 100 } } });
    const a = await h.join();
    for (let i = 0; i < 300; i++) a.send({ t: 'ping', id: 1000 + i });
    expect((await a.waitClosed())?.code).toBe(4408);
    expect(a.inbox.filter((m) => m.t === 'pong')).toHaveLength(45);
    expect(h.service.counters.droppedMessages).toBeGreaterThan(100);
  });

  it('one address cannot open sockets without limit', async () => {
    const h = await harness({ perClientAddress: false });
    for (let i = 0; i < MAX_CONNECTS_PER_ADDRESS_PER_MIN; i++) { const c = await h.open('app=nope'); await c.waitClosed(); }
    const refused = await h.open('app=store-app');
    expect(refused.inbox).toEqual([]);
    expect(refused.ws.readyState).not.toBe(WebSocket.OPEN);
  }, 20_000);

  it('the room and queue caps hold: a busy app keeps players waiting instead of opening another room', async () => {
    const h = await harness({ service: { quotas: { MAX_ROOMS_PER_APP: 1 } } });
    const first = [await h.join(), await h.join(), await h.join(), await h.join()];
    for (const x of first) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(TICK_MS);
    await first[0].next('start');
    const next = [await h.join(), await h.join(), await h.join(), await h.join()];
    for (const x of next) { x.send({ t: 'queue' }); await x.sync(); }
    h.run(TICK_MS);
    expect((await next[0].next('queued', (m) => m.busy === true)).busy).toBe(true);
    expect(h.service.stats().liveRooms).toBe(1);
  });
});
