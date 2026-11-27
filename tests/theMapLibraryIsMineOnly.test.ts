// 📚 THE MAP LIBRARY (admin 2026-11-27, wave 2 part 2): a person saves a map from the build's map card, lists their maps, uses one in a
// game by name and deletes one — and nobody else can see, use or delete it. Through the REAL routes on a real HTTP server (only the token
// check is replaced: the caller's uid comes from a test header), the REAL store (its in-memory form under VITEST), and the REAL
// ToolDispatcher for "use it in a new game". The plan is checked against the planner's own kinds; sizes are bounded.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseToken: async (req: { headers: Record<string, string | undefined> }) => req.headers['x-test-uid'] || null,
  rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { registerMapLibraryRoutes } from '../src/server/routes/mapLibrary';
import { _resetSavedMapMemory, listSavedMaps, MAX_MAPS_PER_USER, saveMap } from '../src/server/lib/mapLibraryStore';
import { savedMapNamed } from '../src/server/lib/athreeMap/savedMapRequest';
import { useSavedMapPrompt, MAP_CELL } from '../src/lib/mapPreview';
import { parseLibraryList, parseLibraryMap } from '../src/lib/mapLibraryClient';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { readMapPlanFromConfig } from '../src/server/lib/athreeMap/mapPlanData';

vi.setConfig({ testTimeout: 180000 });

const plan = {
  areaKm2: 16, sideKm: 4, archetype: 'island', boundary: 'mountains', water: { sea: true, rivers: 0, lakes: 0, ponds: 2, canals: 0 },
  roadStyle: 'organic', density: 'normal', region: null, gameType: 'shooter', timeOfDay: null, hours: null, seed: 31337, profile: 'open-world',
};
const preview = { v: 1, width: 8, height: 8, cells: MAP_CELL.grass.repeat(60) + MAP_CELL.road.repeat(4), sideMeters: 4000, mode: 'bounded', seed: 31337, boundary: 'mountains', spawn: { u: 0.5, v: 0.5 }, counts: { roadCells: 4, ponds: 0, plots: 0 } };

let server: Server; let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerMapLibraryRoutes(app);
  server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => _resetSavedMapMemory());

const call = (method: string, path: string, uid: string | null, body?: unknown) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-test-uid': uid } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

describe('save, list, delete — only for the signed-in owner', () => {
  it('a signed-out caller gets 401 on every route', async () => {
    expect((await call('GET', '/api/map-library', null)).status).toBe(401);
    expect((await call('POST', '/api/map-library', null, { name: 'x', plan, preview })).status).toBe(401);
    expect((await call('DELETE', '/api/map-library/' + 'a'.repeat(24), null)).status).toBe(401);
  });

  it('A saves; A lists it (with its picture, without any uid); B sees nothing', async () => {
    const r = await call('POST', '/api/map-library', 'alice', { name: 'Ganga Nagar', plan, preview });
    expect(r.status).toBe(200);
    const saved = parseLibraryMap((await r.json()).map);
    expect(saved?.name).toBe('Ganga Nagar');
    const list = await (await call('GET', '/api/map-library', 'alice')).json();
    expect(JSON.stringify(list)).not.toContain('alice');
    const maps = parseLibraryList(list)!;
    expect(maps.map((m) => m.name)).toEqual(['Ganga Nagar']);
    expect(maps[0].plan.seed).toBe(31337);
    expect(maps[0].preview?.cells).toBe(preview.cells);
    expect(parseLibraryList(await (await call('GET', '/api/map-library', 'bob')).json())).toEqual([]);
  });

  it('🔒 IDOR: B cannot delete A\'s map (404, exactly like a missing one), and it is still there; A can', async () => {
    const id = parseLibraryMap((await (await call('POST', '/api/map-library', 'alice', { name: 'Ganga Nagar', plan, preview })).json()).map)!.id;
    const byBob = await call('DELETE', `/api/map-library/${id}`, 'bob');
    const missing = await call('DELETE', `/api/map-library/${'b'.repeat(24)}`, 'bob');
    expect(byBob.status).toBe(404);
    expect(await byBob.json()).toEqual(await missing.json());
    expect((await listSavedMaps('alice')).length).toBe(1);
    expect((await call('DELETE', `/api/map-library/${id}`, 'alice')).status).toBe(200);
    expect((await listSavedMaps('alice')).length).toBe(0);
  });

  it('the plan and the picture are checked; the name is bounded; a name in use is refused, not overwritten', async () => {
    expect((await call('POST', '/api/map-library', 'alice', { name: 'x', plan: { ...plan, archetype: 'moon' }, preview })).status).toBe(400);
    expect((await call('POST', '/api/map-library', 'alice', { name: 'x', plan, preview: { ...preview, cells: 'zz' } })).status).toBe(400);
    expect((await call('POST', '/api/map-library', 'alice', { name: 'x'.repeat(61), plan, preview })).status).toBe(400);
    expect((await call('POST', '/api/map-library', 'alice', { name: '   ', plan, preview })).status).toBe(400);
    expect((await call('POST', '/api/map-library', 'alice', { name: 'Ganga Nagar', plan, preview })).status).toBe(200);
    const again = await call('POST', '/api/map-library', 'alice', { name: 'ganga nagar', plan: { ...plan, seed: 1 }, preview });
    expect(again.status).toBe(409);
    expect((await listSavedMaps('alice'))[0].plan.seed).toBe(31337);
  });

  it(`at most ${MAX_MAPS_PER_USER} maps per account`, async () => {
    for (let i = 0; i < MAX_MAPS_PER_USER; i++) expect((await saveMap('carol', { name: `Map ${i}`, plan, preview: null }, i)).ok).toBe(true);
    const over = await saveMap('carol', { name: 'One more', plan, preview: null });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.status).toBe(409);
  });
});

describe('"mera \'Ganga Nagar\' map use karo" — the name, spoken of as a map', () => {
  const maps = [{ name: 'Ganga Nagar' }, { name: 'Ganga Nagar 2' }, { name: 'Thar' }];
  it('reads the name back from the Use button\'s own message, and from free words', () => {
    expect(savedMapNamed(useSavedMapPrompt('Ganga Nagar'), maps)?.name).toBe('Ganga Nagar');
    expect(savedMapNamed("mera 'Ganga Nagar' map use karke racing game banao", maps)?.name).toBe('Ganga Nagar');
    expect(savedMapNamed('Ganga Nagar 2 wala map lagao', maps)?.name).toBe('Ganga Nagar 2');
  });
  it('a name without a map, or a map without a saved name, is not a request for a saved map', () => {
    expect(savedMapNamed('Ganga Nagar ki kahani wala game', maps)).toBeNull();
    expect(savedMapNamed('naya map banao', maps)).toBeNull();
    expect(savedMapNamed('Tharu map', maps)).toBeNull();
  });
});

describe('use a saved map in a new game — through the real dispatcher, for the verified owner only', () => {
  class Fake implements ActuatorPort {
    files = new Map<string, string>();
    async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
    async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
    async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
    async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  }
  const build = async (owner: string | null) => {
    process.env.AGENTV3_ATHREE_MAP = 'on';
    const act = new Fake();
    const stream = new AgentEventStream();
    const events: any[] = [];
    stream.subscribe((e) => events.push(e), false);
    const d = new ToolDispatcher(act, 'ws-library', new WorkspaceState(stream), stream);
    d.setLibraryOwner(owner);
    d.setCoverageRequest(useSavedMapPrompt('Ganga Nagar', 'battle-royale'));
    const r = await d.dispatch({ id: 't', name: 'generate_athree_map', input: {} }, 'architect');
    delete process.env.AGENTV3_ATHREE_MAP;
    return { r, act, events };
  };

  it('the owner\'s build stands on the saved plan and seed, and shows its picture', async () => {
    await saveMap('alice', { name: 'Ganga Nagar', plan, preview });
    const { r, act, events } = await build('alice');
    expect(r.is_error).toBeFalsy();
    const written = readMapPlanFromConfig(act.files.get('src/game/athree/config.ts'))!;
    expect(written).toMatchObject({ archetype: 'island', sideKm: 4, boundary: 'mountains', roadStyle: 'organic', seed: 31337 });
    expect(String(r.content)).toMatch(/saved map "Ganga Nagar" was used/);
    const card = events.find((e) => e.type === 'map_preview')?.card;
    expect(card?.title).toBe('Your saved map "Ganga Nagar", from above');
    expect(card?.preview?.seed).toBe(31337);
  });

  it('🔒 another account naming the same map gets a freshly planned map, never Alice\'s', async () => {
    await saveMap('alice', { name: 'Ganga Nagar', plan, preview });
    const { act } = await build('bob');
    expect(readMapPlanFromConfig(act.files.get('src/game/athree/config.ts'))!.seed).not.toBe(31337);
  });
});
