// ONLINE ROYALE, the kit's half (admin 2026-11-25): the EMITTED onlineClient.ts and onlineMatch.ts — the exact text a
// generated game ships — driven against the REAL match server over real sockets. Proves the client says the truth
// when online is not there (never a fake opponent), plays a match through lobby → queue → match → result → queue
// again, interpolates remote players, and resumes after a dropped connection.
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as THREE from 'three';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { GAME_ROYALE_ONLINE_CLIENT, GAME_ROYALE_ONLINE_MATCH } from '../src/server/lib/GameRoyaleGenerator';
import { RoyaleMatchService, QUEUE_FILL_MS, TICK_MS } from '../src/server/lib/royaleOnline/matchService';
import { createRoyaleUpgradeHandler, ROYALE_WS_PATH } from '../src/server/lib/royaleOnline/royaleWs';

function load(source: string, modules: Record<string, unknown> = {}) {
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function('require', 'exports', 'module', out)((n: string) => { if (!(n in modules)) throw new Error('unexpected import ' + n); return modules[n]; }, module.exports, module);
  return module.exports;
}
const kit = load(GAME_ROYALE_ONLINE_CLIENT);

let server: Server | null = null;
let handler: ReturnType<typeof createRoyaleUpgradeHandler> | null = null;
const g = globalThis as Record<string, unknown>;
afterEach(async () => {
  delete g.window; delete g.document;
  handler?.close(); handler = null;
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

async function serve(enabled = true) {
  const clock = { now: Date.parse('2026-11-25T10:00:00Z') };
  const service = new RoyaleMatchService({ now: () => clock.now, botsAllowed: false });
  let n = 0;
  handler = createRoyaleUpgradeHandler({ service, verifyApp: async (app) => (app === 'store-app' ? 'ok' : 'missing'), enabled: () => enabled, now: () => clock.now, addressKey: () => 'k' + (++n) });
  server = createServer();
  server.on('upgrade', (req, socket, head) => { if (!handler!(req, socket, head)) socket.destroy(); });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/store/app';
  const run = (ms: number) => { for (let t = 0; t < ms; t += TICK_MS) { clock.now += TICK_MS; service.tick(); } };
  return { service, base, run };
}
const until = async (ok: () => boolean, what: string) => {
  for (let i = 0; i < 100; i++) { if (ok()) return; await new Promise((r) => setTimeout(r, 30)); }
  throw new Error('never happened: ' + what);
};
const openWs = (url: string) => new WebSocket(url) as never;

describe('the online client tells the truth', () => {
  it('outside the App Store there is no endpoint, and the screen says why — no socket, no opponents', () => {
    g.window = {}; g.document = { baseURI: 'http://127.0.0.1/preview' };
    expect(kit.onlineEndpoint()).toBeNull();
    const views: any[] = [];
    const c = new kit.OnlineClient(kit.onlineEndpoint(), (v: any) => views.push(v), () => { throw new Error('must not dial'); });
    c.connect();
    expect(views.at(-1)).toMatchObject({ phase: 'unavailable', reason: kit.NOT_ON_STORE, start: null });
  });

  it('a store game builds the same-origin wss/ws address, with a private game\'s access capability', () => {
    g.window = { __NBAI_STORE_APP_ID: 'abc', __NBAI_NAVDATA_TOKEN: '123.deadbeef' }; g.document = { baseURI: 'https://navbharatai.com/store/abc' };
    expect(kit.onlineEndpoint()).toBe('wss://navbharatai.com/api/royale-online/ws?app=abc&access=123.deadbeef');
  });

  it('in the Android/iOS app the socket dials the API origin the store wrote into the page, never the phone\'s own shell', () => {
    // The player frame's base is the PARENT page: in the bundled app that is the local shell. Without the store's API
    // origin the socket would dial localhost — the Sonic-on-phones class (tests/webSocketSingleSource.test.ts).
    g.window = { __NBAI_STORE_APP_ID: 'abc', __NBAI_API_ORIGIN: 'https://navbharatai.com' }; g.document = { baseURI: 'https://localhost/' };
    expect(kit.onlineEndpoint()).toBe('wss://navbharatai.com/api/royale-online/ws?app=abc');
    // A malformed origin is ignored rather than trusted.
    g.window = { __NBAI_STORE_APP_ID: 'abc', __NBAI_API_ORIGIN: 'javascript:alert(1)' }; g.document = { baseURI: 'https://navbharatai.com/store' };
    expect(kit.onlineEndpoint()).toBe('wss://navbharatai.com/api/royale-online/ws?app=abc');
  });

  it('with the kill switch off the client shows the server\'s own reason', async () => {
    const s = await serve(false);
    g.window = { __NBAI_STORE_APP_ID: 'store-app' }; g.document = { baseURI: s.base };
    const c = new kit.OnlineClient(kit.onlineEndpoint(), () => {}, openWs);
    c.connect();
    await until(() => c.view.phase === 'unavailable', 'unavailable');
    expect(c.view.reason).toMatch(/switched off/);
    c.close();
  });

  it('a service that cannot be reached is said plainly', async () => {
    g.window = { __NBAI_STORE_APP_ID: 'store-app' }; g.document = { baseURI: 'http://127.0.0.1:1/store' };
    const c = new kit.OnlineClient(kit.onlineEndpoint(), () => {}, openWs);
    c.connect();
    await until(() => c.view.phase === 'unavailable', 'unavailable');
    expect(c.view.reason).toBe(kit.UNREACHABLE);
  });
});

describe('the online client plays a real match', () => {
  it('lobby → queue → match (with interpolated opponents) → reconnect → result → queue again', async () => {
    const s = await serve();
    g.window = { __NBAI_STORE_APP_ID: 'store-app' }; g.document = { baseURI: s.base };
    const a = new kit.OnlineClient(kit.onlineEndpoint(), () => {}, openWs);
    const b = new kit.OnlineClient(kit.onlineEndpoint(), () => {}, openWs);
    a.connect(); b.connect();
    await until(() => a.view.phase === 'lobby' && b.view.phase === 'lobby', 'lobby');
    // One after the other, so A takes seat 1 (spawn 0,32) and B seat 2 (spawn 32,0).
    a.queue();
    await until(() => a.view.phase === 'queued', 'a queued');
    b.queue();
    await until(() => b.view.phase === 'queued' && a.view.waiting === 2, 'queued');
    s.run(QUEUE_FILL_MS);
    await until(() => a.view.phase === 'playing' && b.view.phase === 'playing', 'playing');
    expect(a.view.start.players.map((p: any) => p.bot)).toEqual([false, false]);

    // B walks; A sees B through snapshots, drawn between two of them.
    const room = s.service.roomOf(b.view.you)!;
    s.run(TICK_MS * 2); // the server earns movement credit with time, never ahead of it
    for (let i = 1; i <= 6; i++) { b.move(32 - i, 0, -Math.PI / 2); await until(() => room.players[1].x === 32 - i, 'move ' + i); s.run(TICK_MS * 2); }
    await until(() => a.view.snapshot?.players[1].x === 26, 'snapshot');
    const seen = a.remote(b.view.you, performance.now() + 100);
    expect(seen.x).toBeCloseTo(26, 5);
    const between = a.remote(b.view.you, (a as any).buffer.at(-1).at + 100 - 1);
    expect(between.x).toBeGreaterThanOrEqual(26); expect(between.x).toBeLessThanOrEqual(27);

    // A teleport attempt is corrected by the server.
    b.move(0, 0, 0);
    await until(() => (b as any).correction !== null, 'correction');
    expect(b.takeCorrection()).toEqual({ x: 26, z: 0 });

    // The server drops A's socket; A comes back by itself with its resume token and keeps its place.
    const before = a.view.you;
    ((a as any).socket as WebSocket).terminate();
    await until(() => a.view.phase === 'reconnecting', 'reconnecting');
    await until(() => a.view.phase === 'playing' && (a as any).socket?.readyState === 1, 'resumed');
    expect(a.view.you).toBe(before);

    // A shoots B down (A at 0,32 — B walks next to A first).
    for (let i = 1; i <= 60; i++) {
      const px = room.players[1].x, pz = room.players[1].z;
      const tx = 4, tz = 32, d = Math.hypot(tx - px, tz - pz), step = Math.min(1, d);
      if (d < 0.01) break;
      b.move(px + ((tx - px) / d) * step, pz + ((tz - pz) / d) * step, 0);
      await until(() => Math.hypot(room.players[1].x - px, room.players[1].z - pz) > step / 2, 'walk ' + i); s.run(TICK_MS * 2);
    }
    for (let i = 0; i < 3; i++) {
      const hp = room.players[1].hp;
      a.fire(Math.PI / 2);
      await until(() => room.players[1].hp < hp, 'hit ' + (i + 1));
      s.run(300);
    }
    await until(() => a.view.phase === 'ended' && b.view.phase === 'ended', 'ended');
    expect(a.view.result.winner).toBe(a.view.you);
    expect(b.view.result.you.place).toBe(2);
    expect(s.service.counters.resultsRecorded).toBe(1);

    a.queue();
    await until(() => a.view.phase === 'queued', 'queue again');
    a.close(); b.close();
  }, 30_000);
});

describe('the online match adapter draws what the server says', () => {
  it('sends the player\'s position at a bounded rate, fires along the camera, and moves remote bodies from snapshots', () => {
    const sent: any[] = [];
    const start = { room: 'r1', you: 'me', arenaHalf: 42, cover: [[-6, -14, 6, -12]], crates: [{ x: 14, z: 8, kind: 'armor' }], players: [{ id: 'me', name: 'Player 1', bot: false, x: 0, z: 32 }, { id: 'b1', name: 'Bot 1', bot: true, x: 32, z: 0 }] };
    let remoteX = 32;
    const client = {
      view: { phase: 'playing', start, snapshot: { radius: 30, crates: [false], players: [{ id: 'me', alive: true }, { id: 'b1', alive: true }] } },
      takeCorrection: () => null,
      move: (x: number, z: number, yaw: number) => sent.push(['move', x, z, yaw]),
      fire: (yaw: number) => sent.push(['fire', yaw]),
      remote: () => ({ x: remoteX, z: 0, yaw: 1, alive: true }),
    };
    let disposed = 0;
    class Controller { object = new THREE.Object3D(); reset(x: number, y: number, z: number) { this.object.position.set(x, y, z); } }
    const m = load(GAME_ROYALE_ONLINE_MATCH, {
      three: THREE,
      '../three/world': { createTerrain: () => new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial()) },
      '../three/humanoid': { createHumanoid: () => ({ root: new THREE.Group(), update() {}, dispose() { disposed++; } }) },
    });
    const match = m.createOnlineMatch(client);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), player = new Controller();
    let attack = false;
    const ctx = { scene, camera, player, input: { wasPressed: () => attack } };
    const solids = match.options.setup(ctx);
    expect(player.object.position.z).toBe(32);
    expect(solids.filter((o: THREE.Object3D) => o.name === 'Cover')).toHaveLength(1);
    camera.position.set(0, 1.6, 32); camera.lookAt(0, 1.6, 0); camera.updateMatrixWorld(true);
    for (let i = 0; i < 60; i++) { player.object.position.z -= 0.1; match.options.update(ctx, 1 / 60); }
    const moves = sent.filter((s) => s[0] === 'move');
    expect(moves.length).toBeGreaterThanOrEqual(13); expect(moves.length).toBeLessThanOrEqual(16); // ~15 per second, not 60
    attack = true; remoteX = 20; match.options.update(ctx, 1 / 60);
    const fire = sent.find((s) => s[0] === 'fire');
    expect(Math.abs(Math.abs(fire[1]) - Math.PI)).toBeLessThan(0.01); // looking toward -z
    expect(scene.getObjectByName('Bot 1')!.position.x).toBe(20);
    expect(scene.getObjectByName('Loot crate')!.visible).toBe(false);
    match.dispose(); match.dispose();
    expect(disposed).toBe(1);
  });
});
