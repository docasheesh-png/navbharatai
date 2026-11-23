// 🏟️ A CRICKET OR FOOTBALL MATCH STANDS ON THE WORLD ONLY WHEN THE USER ASKS (map expansion item 7 — worldVenue.ts and
// sportsWorld.ts). Owner decision: a sports game gets a world around its ground only on request; the match itself (rules,
// ball, players) is unchanged — it stands in ONE group on the venue the world draws. Behind AGENTV3_SPORTS_WORLD, OFF by
// default. The kit runs headless for real; the projects are synthetic.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import ts from 'typescript';
import { recipeFilePool, GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';
import { WORLD_VENUE, WORLD_VENUE_PATH } from '../src/server/lib/GameWorldVenueGenerator';
import { sportsWorldAtTurnStart, matchSportOf, planSportsWorld, isKit3D, WORLD_WISHES } from '../src/server/AgentV3/sportsWorld';
import { sportsWorldEnabled, mapGrowthNote, mapGrowthIntent } from '../src/server/AgentV3/mapGrowthIntent';

const root = join(__dirname, '..');
const DIR = join(__dirname, `.tmp-worldvenue-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let WV: any; let CH: any; let FB: any; let CR: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  writeFileSync(join(DIR, WORLD_VENUE_PATH), WORLD_VENUE);
  WV = await import(join(DIR, WORLD_VENUE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  FB = await import(join(DIR, 'src/game/board/football.ts'));
  CR = await import(join(DIR, 'src/game/board/cricket.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
afterEach(() => { vi.unstubAllEnvs(); });

const tiny = { blocksX: 2, blocksZ: 2, traffic: { count: 0 }, people: { count: 0 }, parkedCars: 0 };
const make = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500); scene.add(camera);
  return { scene, player, camera, vehicles: { add: () => {}, seated: null } } as any;
};
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => { const out: THREE.Object3D[] = []; scene.traverse((o) => { if (o.name === name) out.push(o); }); return out; };
const worldPos = (o: THREE.Object3D): THREE.Vector3 => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

describe('🏟️ the match on the venue (the real kit, headless)', () => {
  it('football: the match group stands on the level pad, and the layout turned by heading meets the goals the world draws', () => {
    const ctx = make();
    const vw = WV.startVenueWorld(ctx, { venue: 'football-field', regions: [{ id: 'home', kind: 'town', city: tiny }, { id: 'ground', kind: 'venue', venue: 'football-field', joinTo: 'home' }], seed: 3 });
    for (let i = 0; i < 3; i++) vw.frame(ctx, 1 / 30);
    expect(vw.venue.venue).toBe('football-field');
    expect(vw.scale).toBeCloseTo(1, 6);
    expect(vw.heading).toBeCloseTo(Math.PI / 2, 9);
    const o = vw.world.map.chunks.origin;
    expect(Math.abs(vw.root.position.y - vw.world.heightAt(vw.root.position.x + o.x, vw.root.position.z + o.z))).toBeLessThan(0.3);
    expect(vw.venue.built).toBe(true);
    // The kit's football layout, as the game uses it, in the match group: its goal mouths are the world's goal posts.
    const pitch = FB.footballLayout({ heading: vw.heading });
    const posts = named(ctx.scene, 'Goal post').map(worldPos);
    expect(posts.length).toBe(4);
    for (const team of ['home', 'away']) {
      for (const post of [pitch.goals[team].leftPost, pitch.goals[team].rightPost]) {
        const at = vw.root.localToWorld(new THREE.Vector3(post.x, 0, post.z));
        const nearest = Math.min(...posts.map((p) => Math.hypot(p.x - at.x, p.z - at.z)));
        expect(nearest).toBeLessThan(0.2);
      }
    }
    vw.dispose();
    expect(vw.root.parent).toBeNull();
  }, 180_000);

  it('cricket: the layout\'s stumps stand on the creases the world draws (heading 0)', () => {
    const ctx = make();
    const vw = WV.startVenueWorld(ctx, { venue: 'cricket-ground', regions: [{ id: 'home', kind: 'town', city: tiny }], seed: 5 });
    for (let i = 0; i < 3; i++) vw.frame(ctx, 1 / 30);
    expect(vw.heading).toBe(0);
    const f = CR.cricketLayout({ heading: vw.heading });
    const creases = named(ctx.scene, 'Bowling crease').map(worldPos);
    expect(creases.length).toBe(2);
    for (const s of [f.strikerStumps, f.bowlerStumps]) {
      const at = vw.root.localToWorld(new THREE.Vector3(s.x, 0, s.z));
      expect(Math.min(...creases.map((c) => Math.hypot(c.x - at.x, c.z - at.z)))).toBeLessThan(0.2);
    }
    vw.dispose();
  }, 180_000);

  it('the places: the game\'s own keep every entry, and the ground is added beside the first only when they have none', () => {
    const own = [{ id: 'a', kind: 'city' }, { id: 'b', kind: 'village' }];
    expect(WV.venueRegions('cricket-ground', own)).toEqual([...own, { id: 'home-ground', kind: 'venue', venue: 'cricket-ground', joinTo: 'a' }]);
    const withGround = [{ id: 'a', kind: 'city' }, { id: 'g', kind: 'venue', venue: 'football-field' }];
    expect(WV.venueRegions('football-field', withGround)).toEqual(withGround);
    expect(WV.venueRegions('football-field', null).map((r: any) => r.id)).toEqual(['home-town', 'home-ground']);
    expect(WV.venueRegions('cricket-ground', [{ id: 'home-ground', kind: 'town' }]).pop().id).toBe('home-ground-2');
  });

  it('no such ground on the world: it throws a reason a person can read (the game keeps its own ground)', () => {
    const ctx = make();
    expect(() => WV.startVenueWorld(ctx, { venue: 'football-field', venueId: 'nowhere', regions: [{ id: 'home', kind: 'town', city: tiny }], seed: 3 })).toThrow(/has no football-field on it/);
  }, 180_000);

  it('worldVenue.ts typechecks under strict against the kit', () => {
    const DIR2 = join(__dirname, `.tmp-worldvenue-tsc-${process.pid}`);
    const files: Record<string, string> = Object.assign({}, ...Object.values(GAME_RECIPES).map((g) => g().files), { [WORLD_VENUE_PATH]: WORLD_VENUE });
    const names = new Set<string>();
    for (const s of Object.values(files)) for (const m of s.matchAll(/THREE\.([A-Za-z_]\w*)/g)) names.add(m[1]);
    files['vite-glob-shim.d.ts'] = 'interface ImportMeta { glob(pattern: string, options?: unknown): Record<string, any> }\n';
    files['three-shim.d.ts'] = `declare module 'three' {\n${[...names].sort().map((n) => `  export const ${n}: any;\n  export type ${n}<A = any, B = any, C = any, D = any> = any;`).join('\n')}\n}\n`;
    try {
      for (const [p, c] of Object.entries(files)) { const f = join(DIR2, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
      const program = ts.createProgram(Object.keys(files).map((p) => join(DIR2, p)), { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], jsx: ts.JsxEmit.ReactJSX, strict: true, isolatedModules: true, allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, types: [] });
      const mine = join(DIR2, WORLD_VENUE_PATH);
      expect(ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName === mine).map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)).toEqual([]);
    } finally { rmSync(DIR2, { recursive: true, force: true }); }
  }, 120_000);

  it('no recipe ships it: a game without the request is exactly as before', () => {
    for (const [, f] of recipeFilePool()) expect(f.content).not.toMatch(/worldVenue/);
    expect(recipeFilePool().has(WORLD_VENUE_PATH)).toBe(false);
  });
});

// ── the platform's step ─────────────────────────────────────────────────────────────────────────────────────────────────
const ON = { AGENTV3_SPORTS_WORLD: 'on' } as NodeJS.ProcessEnv;
const FOOTBALL_GAME = "import { footballLayout, createFootballMatch } from './board';\nexport function setupMatch() { const pitch = footballLayout({ players: 7 }); return { pitch, match: createFootballMatch() }; }\n";
const CRICKET_GAME = "import { createMatch, bowl, cricketLayout } from './board';\nexport function setupMatch() { const f = cricketLayout({}); const match = createMatch({ overs: 2 }); return { f, match }; }\n";
/** A 3D match on the kit: runtime, 3D, shell and the board pack — not the open world's layers. */
function matchProject(game: string | null, extra: Record<string, string> = {}, threeD = true): Map<string, string> {
  const disk = new Map<string, string>();
  for (const [p, f] of recipeFilePool()) {
    if (f.recipe === 'generate_open_world' || f.recipe === 'generate_athree_map') continue;
    if (!threeD && (/^src\/game\/three\//.test(p) || p === 'src/game/Game.ts')) continue;
    disk.set(p, f.content);
  }
  disk.set('src/App.tsx', "import { MatchGame } from './game/MatchGame';\nexport default function App() { return <MatchGame />; }\n");
  if (game) disk.set('src/game/MatchGame.ts', game);
  for (const [p, c] of Object.entries(extra)) disk.set(p, c);
  return disk;
}
function io(disk: Map<string, string>, opts: { prompt?: string; env?: NodeJS.ProcessEnv; failOn?: string; listing?: Record<string, string> } = {}) {
  const writes: Array<[string, string]> = []; const issues: Array<{ code: string }> = [];
  return {
    writes, issues,
    port: {
      prompt: opts.prompt ?? 'ek aur shehar jodo', filesAtTurnStart: opts.listing ?? Object.fromEntries(disk), env: opts.env ?? ON,
      read: async (p: string) => { const c = disk.get(p); if (c === undefined) throw new Error('ENOENT'); return c; },
      write: async (p: string, c: string) => { if (p === opts.failOn) throw new Error('refused'); writes.push([p, c]); disk.set(p, c); },
      record: (i: { code: string }) => { issues.push(i); },
    },
  };
}

describe('🔒 off by default; only on the user\'s request', () => {
  it('the switch: only "on" (1/true/yes)', () => {
    expect(sportsWorldEnabled({})).toBe(false);
    expect(sportsWorldEnabled({ AGENTV3_SPORTS_WORLD: 'off' })).toBe(false);
    for (const v of ['on', '1', 'true', 'YES']) expect(sportsWorldEnabled({ AGENTV3_SPORTS_WORLD: v })).toBe(true);
  });
  it('off: a world wish writes nothing, and the builder is told a world is not available yet (as before)', async () => {
    const disk = matchProject(FOOTBALL_GAME);
    const t = io(disk, { env: {} });
    expect(await sportsWorldAtTurnStart(t.port)).toBe('');
    expect(t.writes).toEqual([]);
    expect(mapGrowthNote('ek aur shehar jodo', { 'src/App.tsx': 'football' })).toMatch(/not available yet/);
  });
  it.each([
    ['ek aur shehar jodo', true], ['map bada karo', true], ['add a city to the map', true], ['सारे शहरों को सड़कों से जोड़ो', true],
    ['football khelna hai', false], ['football game banao', false], ['cricket ground chahiye', false], ['score dikhao', false], ['map bada mat karo', false], ['ground bada karo', false],
  ])('"%s" asks for a world: %s', async (prompt, world) => {
    expect(WORLD_WISHES.has(mapGrowthIntent(prompt).kind)).toBe(world);
    const t = io(matchProject(FOOTBALL_GAME), { prompt });
    const out = await sportsWorldAtTurnStart(t.port);
    expect(out.startsWith('✅ ALREADY DONE BY THE PLATFORM')).toBe(world);
    if (!world) expect(t.writes).toEqual([]);
  });
  it('on: the map note for a sports game points the builder at the platform\'s note', () => {
    vi.stubEnv('AGENTV3_SPORTS_WORLD', 'on');
    const note = mapGrowthNote('ek aur shehar jodo', { 'src/App.tsx': 'cricket' });
    expect(note).toMatch(/→ EDIT\./);
    expect(note).toMatch(/only on request/);
    expect(note).toMatch(/src\/game\/play\/worldVenue\.ts/);
    expect(note).toMatch(/why nothing was added, and then change nothing/);
  });
});

describe('🏟️ the platform adds the venue kit — never the game\'s own code', () => {
  it('football: worldVenue.ts and the open world\'s layers, only files READ as absent; the builder is told the one change', async () => {
    const disk = matchProject(FOOTBALL_GAME);
    const before = new Map(disk);
    const t = io(disk);
    const out = await sportsWorldAtTurnStart(t.port);
    const paths = t.writes.map(([p]) => p);
    expect(paths).toContain(WORLD_VENUE_PATH);
    expect(paths).toContain('src/game/play/worldLayer.ts');
    expect(paths).toContain('src/game/play/openWorld.ts');
    for (const p of paths) expect(before.has(p)).toBe(false);
    expect(disk.get('src/game/MatchGame.ts')).toBe(FOOTBALL_GAME);
    expect(disk.get('src/App.tsx')).toBe(before.get('src/App.tsx'));
    expect(out).toMatch(/startVenueWorld\(ctx, \{ venue: 'football-field' \}\)/);
    expect(out).toMatch(/footballLayout\(\{ heading: venueWorld\.heading \}\)/);
    expect(out).toMatch(/on a throw keep the game exactly as it is now/);
    expect(out).toMatch(/stay EXACTLY as they are/);
    expect(t.issues.map((i) => i.code)).toEqual(['SPORTS_WORLD_ADDED']);
    // Everything written imports only what the project now has.
    for (const p of paths) for (const m of String(disk.get(p)).matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
      const base = p.split('/').slice(0, -1);
      for (const seg of m[1].split('/')) { if (seg === '..') base.pop(); else if (seg !== '.') base.push(seg); }
      expect(['', '.ts', '.tsx', '/index.ts'].some((e) => disk.has(base.join('/') + e)), `${p} → ${m[1]}`).toBe(true);
    }
  });
  it('cricket: the cricket ground, and the stumps stay the game\'s', async () => {
    const t = io(matchProject(CRICKET_GAME), { prompt: 'map bada karo' });
    const out = await sportsWorldAtTurnStart(t.port);
    expect(out).toMatch(/venue: 'cricket-ground'/);
    expect(out).toMatch(/stumps, markers/);
    expect(out).toMatch(/cricketLayout\(\{ heading: venueWorld\.heading \}\)/);
  });
  it('the match already on the world: a place is one more region of world.ts; nothing is written', async () => {
    const onWorld = `${FOOTBALL_GAME}// startVenueWorld(ctx, { venue: 'football-field' })\n`;
    const t = io(matchProject(onWorld, { [WORLD_VENUE_PATH]: WORLD_VENUE }));
    const out = await sportsWorldAtTurnStart(t.port);
    expect(out).toMatch(/ALREADY stands on the world/);
    expect(out).toMatch(/\{ id: 'home-ground', kind: 'venue', venue: 'football-field', joinTo: 'home-town' \}/);
    expect(t.writes).toEqual([]);
  });
  it.each([
    ['a 2D match (no 3D game)', () => matchProject(FOOTBALL_GAME, {}, false), /2D game/],
    ['a different worldVenue.ts already there', () => matchProject(FOOTBALL_GAME, { [WORLD_VENUE_PATH]: 'export const mine = 1;\n' }), /already exists with other content/],
  ])('%s: refused, nothing written, the builder told why', async (_n, project, why) => {
    const t = io((project as () => Map<string, string>)());
    const out = await sportsWorldAtTurnStart(t.port);
    expect(out).toMatch(/the platform did NOT add it/);
    expect(out).toMatch(why as RegExp);
    expect(t.writes).toEqual([]);
    expect(t.issues.map((i) => i.code)).toEqual(['SPORTS_WORLD_NOT_DONE']);
  });
  it('not a match of ours: a Ludo game with the board pack, an open world with a football feature, no sport — nothing', async () => {
    for (const disk of [
      matchProject("import { createLudo } from './board';\nexport const g = createLudo();\n"),
      matchProject(FOOTBALL_GAME, { 'src/game/world.ts': 'export const WORLD = { regions: [] };' }),
      matchProject(`${FOOTBALL_GAME}${CRICKET_GAME.replace(/setupMatch/g, 'setupOther').replace(/^import.*\n/, '')}`),
    ]) {
      const t = io(disk);
      expect(await sportsWorldAtTurnStart(t.port)).toBe('');
      expect(t.writes).toEqual([]);
    }
  });
  it('a file the listing missed but the disk has is never overwritten', async () => {
    const disk = matchProject(FOOTBALL_GAME, { 'src/game/play/worldLayer.ts': '// somebody\'s own\nexport const x = 1;\n' });
    const listing = Object.fromEntries([...disk].filter(([p]) => p !== 'src/game/play/worldLayer.ts'));
    const t = io(disk, { listing });
    expect(await sportsWorldAtTurnStart(t.port)).toMatch(/the platform did NOT add it/);
    expect(t.writes).toEqual([]);
  });
  it('a write that fails: the builder is told nothing was added', async () => {
    const t = io(matchProject(FOOTBALL_GAME), { failOn: WORLD_VENUE_PATH });
    expect(await sportsWorldAtTurnStart(t.port)).toMatch(/could not be written/);
  });
  it('import and module turns: nothing', async () => {
    const t = io(matchProject(FOOTBALL_GAME));
    expect(await sportsWorldAtTurnStart({ ...t.port, skip: true })).toBe('');
    expect(t.writes).toEqual([]);
  });
  it('the sport is read from the game\'s own code, never from the kit (every board pack carries cricket.ts and football.ts)', () => {
    const files = Object.fromEntries(matchProject(null));
    expect(matchSportOf(files)).toBeNull();
    expect(matchSportOf({ ...files, 'src/game/MatchGame.ts': FOOTBALL_GAME })).toBe('football');
    expect(matchSportOf({ ...files, 'src/game/MatchGame.ts': CRICKET_GAME })).toBe('cricket');
    expect(isKit3D(files)).toBe(true);
    expect(planSportsWorld(new Set(), new Map())).toMatchObject({ ok: false, reason: 'unread' });
  });
});

describe('🔌 wired, and documented', () => {
  it('the route runs it at turn start, before the map wishes, skipped on import and module turns', () => {
    const route = readFileSync(join(root, 'src/server/routes/agentv3.ts'), 'utf8');
    const at = route.indexOf('await sportsWorldAtTurnStart({ skip: isImportTurn || !!projectModuleRef');
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at, at + 600)).toContain('preseededGolden.set(p, c)');
  });
  it('the rollout page and the env registry name the switch as OFF', () => {
    expect(readFileSync(join(root, 'docs/MAP_EXPANSION_ROLLOUT.md'), 'utf8')).toMatch(/env `AGENTV3_SPORTS_WORLD=on` \| \*\*off\*\*/);
    expect(readFileSync(join(root, 'docs/claude/ENV_REGISTRY.md'), 'utf8')).toMatch(/### AGENTV3_SPORTS_WORLD \(code default: OFF/);
  });
});
