// THE PLAYER SEES THE WHOLE MAP (admin 2026-11-22: "jaise PUBG/Free Fire me location map aa jata hai box me corner par — kya
// battle ground game me navigation par tap kar kar pura map aur location dikha sakte hai?" and "yeh sab user ke control me
// rahe, user jo kahe woh ho jaye").
//
// 🧬 THE CLASS: the corner minimap knew only markers within 60 m, so a world of a hundred places and the highways joining them
// was invisible to the player — the map the game had was not the map the player saw, and nothing could open it. The world now
// hands the HUD its places, lands, user maps and roads (ui/worldMap.ts, registered by play/openWorld.ts); the corner map draws
// them and a tap (or M) opens the full map. Runs the REAL generated kit.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { generateOpenWorld, OPEN_WORLD_BRIDGE_PATH, GAME_OPEN_WORLD_STARTER } from '../src/server/lib/GameOpenWorldGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { OPEN_WORLD_HANDOFF } from '../src/server/AgentV3/gameKitSeed';

const DIR = join(__dirname, `.tmp-full-map-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let WM: any; let OW: any; let CH: any; let HUD: any; let EV: any; let SET: any; let STR: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  WM = await import(join(DIR, 'src/game/ui/worldMap.ts'));
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  HUD = await import(join(DIR, 'src/game/ui/Hud.tsx'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  SET = await import(join(DIR, 'src/game/core/settings.ts'));
  STR = await import(join(DIR, 'src/game/core/strings.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
afterEach(() => { WM?.setWorldMapSource(null); WM?.setWaypoint(null); SET?.settings.set({ showMinimap: true }); });

describe('🧮 the map\'s arithmetic', () => {
  it('names come from ids, and are shortened for the corner', () => {
    expect(WM.placeName('old-town')).toBe('Old Town');
    expect(WM.placeName('hill_village2')).toBe('Hill Village 2');
    expect(WM.placeName('mainCity')).toBe('Main City');
    expect(WM.placeName('')).toBe('');
    expect(WM.shortName('Old Town')).toBe('Old Town');
    expect(WM.shortName('A Very Long Place Name', 12)).toBe('A Very Long…');
    expect(WM.formatDistance(84.6)).toBe('85 m');
    expect(WM.formatDistance(1240)).toBe('1.2 km');
    expect(WM.formatDistance(14600)).toBe('15 km');
    expect(WM.formatDistance(Number.NaN)).toBe('0 m');
  });

  it('the user\'s choices are checked: corner, size, names, range and the full map, with honest defaults', () => {
    expect(WM.minimapStyle(undefined, false)).toEqual({ corner: 'left', size: 128, names: true, range: 60, fullMap: false });
    expect(WM.minimapStyle({}, true)).toEqual({ corner: 'left', size: 128, names: true, range: 220, fullMap: true });
    expect(WM.minimapStyle({ corner: 'right', size: 200, names: false, range: 400, fullMap: false }, true)).toEqual({ corner: 'right', size: 200, names: false, range: 400, fullMap: false });
    expect(WM.minimapStyle({ corner: 'middle', size: 9999, range: -5 }, true)).toMatchObject({ corner: 'left', size: 240, range: 20 });
    expect(WM.minimapStyle({ size: 'big', fullMap: true }, false)).toMatchObject({ size: 128, fullMap: true });
  });

  it('the corner map turns with the camera like the markers do, but is never pinned to the edge', () => {
    const view = { x: 0, z: 0, forward: { x: 0, z: 1 } };
    for (const q of [{ x: 0, z: 30 }, { x: -20, z: 10 }, { x: 15, z: -40 }]) {
      const a = WM.cornerPoint(view, q, 60, 128), m = HUD.minimapPoint(view, q, 60, 128);
      expect(a.x).toBeCloseTo(m.x); expect(a.y).toBeCloseTo(m.y);
    }
    expect(WM.cornerPoint(view, { x: 0, z: 30 }, 60, 128)).toEqual({ x: 64, y: 35 });
    const far = WM.cornerPoint(view, { x: 0, z: 600 }, 60, 128);
    expect(far.y).toBeLessThan(-400);                                     // a road far ahead runs off the top, clipped by the circle
    const turned = { x: 0, z: 0, forward: { x: 1, z: 0 } };
    const p = WM.cornerPoint(turned, { x: 30, z: 0 }, 60, 128);
    expect(p.x).toBeCloseTo(64); expect(p.y).toBeLessThan(64);           // ahead of a camera looking +x is up
  });

  it('roads are cut to the view: the piece inside, a road that leaves and comes back is two pieces, a road outside is nothing', () => {
    const box = { minX: -10, minZ: -10, maxX: 10, maxZ: 10 };
    expect(WM.clipSegment({ x: -20, z: 0 }, { x: 20, z: 0 }, box)).toEqual([{ x: -10, z: 0 }, { x: 10, z: 0 }]);
    expect(WM.clipSegment({ x: -20, z: 50 }, { x: 20, z: 50 }, box)).toBeNull();
    expect(WM.clipSegment({ x: 0, z: 0 }, { x: 5, z: 5 }, box)).toEqual([{ x: 0, z: 0 }, { x: 5, z: 5 }]);
    const inOut = WM.clipRoad([{ x: -5, z: 0 }, { x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 5 }, { x: 0, z: 5 }], box);
    expect(inOut).toEqual([[{ x: -5, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }], [{ x: 10, z: 5 }, { x: 0, z: 5 }]]);
    expect(WM.clipRoad([{ x: 100, z: 100 }, { x: 200, z: 100 }], box)).toEqual([]);
    expect(WM.roadsNear([[{ x: -1000, z: 3 }, { x: 1000, z: 3 }], [{ x: 0, z: 900 }, { x: 10, z: 900 }]], { x: 0, z: 0 }, 50)).toEqual([[{ x: -50, z: 3 }, { x: 50, z: 3 }]]);
  });

  it('the full map is north up, its projection goes both ways, zoom keeps the point under the finger, and the world is never lost', () => {
    const b = WM.boundsOf([{ id: 'a', name: 'A', kind: 'city', x: 0, z: 0, radius: 100 }, { id: 'b', name: 'B', kind: 'desert', x: 2000, z: -1000, radius: 300 }], [[{ x: -500, z: 0 }, { x: 0, z: 0 }]], [{ x: 50, z: 50 }], 100);
    expect(b).toEqual({ minX: -600, minZ: -1400, maxX: 2400, maxZ: 200 });
    const w = 800, h = 600;
    const cam = WM.fitCamera(b, w, h);
    const east = WM.worldToMap(cam, w, h, { x: 1000, z: 0 }), north = WM.worldToMap(cam, w, h, { x: 0, z: -1000 }), here = WM.worldToMap(cam, w, h, { x: 0, z: 0 });
    expect(east.x).toBeGreaterThan(here.x); expect(north.y).toBeLessThan(here.y);   // east is right, north (−z) is up
    const q = { x: 123, y: 456 };
    const back = WM.worldToMap(cam, w, h, WM.mapToWorld(cam, w, h, q));
    expect(back.x).toBeCloseTo(q.x); expect(back.y).toBeCloseTo(q.y);
    const anchor = { x: 200, y: 150 };
    const under = WM.mapToWorld(cam, w, h, anchor);
    const zoomed = WM.zoomAt(cam, b, w, h, 2, anchor);
    expect(zoomed.scale).toBeCloseTo(cam.scale * 2);
    const still = WM.mapToWorld(zoomed, w, h, anchor);
    expect(still.x).toBeCloseTo(under.x); expect(still.z).toBeCloseTo(under.z);
    const limits = WM.zoomLimits(b, w, h);
    expect(WM.zoomAt(cam, b, w, h, 1e6, anchor).scale).toBe(limits.max);
    expect(WM.zoomAt(cam, b, w, h, 1e-6, anchor).scale).toBe(limits.min);
    const flung = WM.panBy(cam, b, w, h, 1e7, -1e7);
    expect(flung.cx).toBe(b.minX); expect(flung.cz).toBe(b.maxZ);       // dragged as far as it goes, the world is still in view
    expect(WM.gridStep(1)).toBe(100); expect(WM.gridStep(0.1)).toBe(1000);
  });

  it('a world source is read safely, and only its own cleanup takes it away', () => {
    expect(WM.readWorldMap()).toEqual({ places: [], roads: [], origin: { x: 0, z: 0 }, bounds: null });
    const junk = WM.readWorldMap({ places: () => [null, { id: 'x', x: Number.NaN, z: 0 }, { id: 'ok-place', kind: 'town', x: 1, z: 2 }], roads: () => { throw new Error('boom'); }, origin: () => ({ x: 'no' }) });
    expect(junk.places).toEqual([{ id: 'ok-place', name: 'Ok Place', kind: 'town', x: 1, z: 2, radius: 50, shape: 'circle' }]);
    expect(junk.roads).toEqual([]); expect(junk.origin).toEqual({ x: 0, z: 0 });
    const heard: boolean[] = [];
    const off = EV.events.on('WORLD_MAP_CHANGED', (p: any) => heard.push(p.on));
    const a = { places: () => [] }, b = { places: () => [] };
    const dropA = WM.setWorldMapSource(a);
    WM.setWorldMapSource(b);                       // a remount registered a new world…
    dropA();                                       // …and the old world's cleanup must not wipe it
    expect(WM.worldMapSource()).toBe(b);
    off();
    expect(heard).toEqual([true, true]);
  });

  it('a waypoint is kept in WORLD metres and announced', () => {
    const seen: any[] = [];
    const off = EV.events.on('WAYPOINT_CHANGED', (p: any) => seen.push(p.waypoint));
    WM.setWaypoint({ x: 10, z: -20 });
    expect(WM.getWaypoint()).toEqual({ x: 10, z: -20 });
    WM.setWaypoint({ x: Number.NaN, z: 0 });
    expect(WM.getWaypoint()).toBeNull();
    off();
    expect(seen).toEqual([{ x: 10, z: -20 }, null]);
  });
});

const context = () => {
  const scene = new THREE.Scene();
  const player = new CH.CharacterController({});
  scene.add(player.object);
  return { scene, player, ctx: { scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), player, vehicles: { add: () => undefined, seated: null } } };
};
const small = { traffic: { count: 2 }, people: { count: 2 }, parkedCars: 1 };

describe('🗺️ the open world hands the map its places and roads', () => {
  it('every place, land and user map with its name, every highway, and the origin that turns render positions into WORLD metres', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: [
      { id: 'main-city', kind: 'city', name: 'Mumbai', city: { blocksX: 2, blocksZ: 2, ...small } },
      { id: 'east-block', kind: 'city', joinTo: 'main-city', toward: 'east' },
      { id: 'old-town', kind: 'town', toward: 'east', city: small },
      { id: 'thar', kind: 'desert', toward: 'south', radius: 300 },
      { id: 'my-kan-map', kind: 'custom', model: 'kan', toward: 'west', size: 200 },
    ] });
    const src = WM.worldMapSource();
    expect(src).not.toBeNull();
    const data = WM.readWorldMap();
    const byId = Object.fromEntries(data.places.map((p: any) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual(['east-block', 'main-city', 'my-kan-map', 'old-town', 'thar']);
    expect(byId['main-city']).toMatchObject({ name: 'Mumbai', kind: 'city', shape: 'square' });   // the name the user gave
    expect(byId['east-block'].name).toBe('');                                                    // a tile of Mumbai is not named again
    expect(byId['old-town']).toMatchObject({ name: 'Old Town', kind: 'town' });                  // made from the id
    expect(byId.thar).toMatchObject({ name: 'Thar', kind: 'desert', shape: 'circle', radius: 300 });
    expect(byId['my-kan-map']).toMatchObject({ name: 'My Kan Map', kind: 'custom', radius: 100 });
    // Where the world says they are.
    for (const p of world.places) expect([byId[p.id].x, byId[p.id].z]).toEqual([p.centre.x, p.centre.z]);
    expect([byId.thar.x, byId.thar.z]).toEqual([world.lands[0].centre.x, world.lands[0].centre.z]);
    // The highways are the roads, and there is at least one joining the far places.
    expect(world.highways.length).toBeGreaterThan(0);
    expect(data.roads.length).toBe(world.highways.filter((l: any[]) => l.length > 1).length);
    expect(data.roads[0][0]).toEqual({ x: world.highways[0][0].x, z: world.highways[0][0].z });
    // The player's render position plus the origin is its WORLD position — across an origin shift too.
    const o = data.origin, at = world.playerWorld(), pos = c.player.object.position;
    expect(pos.x + o.x).toBeCloseTo(at.x); expect(pos.z + o.z).toBeCloseTo(at.z);
    expect(o).toEqual({ x: world.map.chunks.origin.x, z: world.map.chunks.origin.z });
    world.dispose();
    expect(WM.worldMapSource()).toBeNull();                                                     // gone with the world
  }, 120_000);
});

describe('🧭 the corner map and the full map in the Hud', () => {
  const view = () => ({ x: 0, z: 0, forward: { x: 0, z: 1 }, facing: 0, markers: [] });
  const fake = (minimap: any) => ({ minimapOption: minimap === undefined ? undefined : minimap !== false, minimapStyle: minimap && typeof minimap === 'object' ? minimap : {}, mapView: view }) as any;

  it('without a world: today\'s markers-only map, not a button', () => {
    const html = renderToStaticMarkup(createElement(HUD.Minimap, { game: fake(true), onOpen: () => undefined }));
    expect(html).toContain('aria-label="Minimap"');
    expect(html).not.toContain('<button');
  });

  it('with a world: a tappable map that opens the full map, in the corner and size the user chose', () => {
    WM.setWorldMapSource({ places: () => [{ id: 'a', name: 'A', kind: 'city', x: 0, z: 0, radius: 100 }] });
    const left = renderToStaticMarkup(createElement(HUD.Minimap, { game: fake(true), onOpen: () => undefined }));
    expect(left).toContain('<button');
    expect(left).toContain('aria-label="' + STR.t('openMap') + '"');
    expect(left).toMatch(/left:max\(12px/);
    const right = renderToStaticMarkup(createElement(HUD.Minimap, { game: fake({ corner: 'right', size: 200 }), onOpen: () => undefined }));
    expect(right).toMatch(/right:max\(12px/);
    expect(right).toContain('width:200px');
    // fullMap: false keeps the corner map small only.
    expect(renderToStaticMarkup(createElement(HUD.Minimap, { game: fake({ fullMap: false }), onOpen: () => undefined }))).not.toContain('<button');
  });

  it('off when the game says so, and when the player hides it in Settings', () => {
    expect(renderToStaticMarkup(createElement(HUD.Minimap, { game: { minimapOption: false } }))).toBe('');
    SET.settings.set({ showMinimap: false });
    expect(renderToStaticMarkup(createElement(HUD.Minimap, { game: fake(true) }))).toBe('');
    expect(SET.sanitizeSettings({ showMinimap: 'no' }).showMinimap).toBe(true);
  });

  it('the full map has its title, a close button, zoom, my position, the hint, and Clear marker once a spot is marked', () => {
    const style = WM.minimapStyle({}, true);
    const html = renderToStaticMarkup(createElement(HUD.FullMap, { game: fake(true), style, onClose: () => undefined }));
    expect(html).toContain('role="dialog"');
    for (const k of ['map', 'close', 'zoomIn', 'zoomOut', 'centreMap', 'mapHint']) expect(html).toContain(STR.t(k));
    expect(html).not.toContain(STR.t('clearMarker'));
    WM.setWaypoint({ x: 5, z: 5 });
    expect(renderToStaticMarkup(createElement(HUD.FullMap, { game: fake(true), style, onClose: () => undefined }))).toContain(STR.t('clearMarker'));
  });

  it('the Hud opens it from the corner map or M, pauses the world while it is open, and Settings has the Minimap switch', () => {
    const hud = generateGameShell().files['src/game/ui/Hud.tsx'];
    expect(hud).toMatch(/const openMap = \(\) => \{ if \(state\.status !== 'playing'\) return; game\.pause\(\); setPanel\('map'\); \}/);
    expect(hud).toMatch(/e\.key === 'm' \|\| e\.key === 'M'/);
    expect(hud).toMatch(/panel === 'map' \? <FullMap game=\{game\} style=\{mapStyle\} onClose=\{closeMap\} \/>/);
    expect(hud).toContain("<Minimap game={game} onOpen={canOpenMap ? openMap : undefined} />");
    expect(hud).toContain("<Toggle label={t('minimap')} on={s.showMinimap}");
  });
});

describe('🗣️ the builder is told the map is the user\'s to shape', () => {
  it('the recipe and the handoff name every control, and the starter takes a map prop', () => {
    const { instructions } = generateOpenWorld();
    for (const said of ["map={{ corner: \\'right\\' }}".replace(/\\/g, ''), 'map={{ size: 200 }}', 'map={{ names: false }}', 'map={{ range: 400 }}', 'map={{ fullMap: false }}', 'map={false}']) expect(instructions).toContain(said);
    expect(instructions).toContain('Never');
    expect(OPEN_WORLD_HANDOFF).toContain('map={false}');
    expect(GAME_OPEN_WORLD_STARTER).toContain('minimap: map,');
    expect(GAME_OPEN_WORLD_STARTER).toMatch(/map\?: MinimapOptions \| boolean;/);
  });
});
