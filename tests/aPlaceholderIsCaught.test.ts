// 🧸 A PLACEHOLDER IS CAUGHT, NAMED, AND HANDED TO THE BUILDER (external Game Maker audit, admin-approved 2026-11-25).
//
// 🧬 THE CLASS: a game that PLAYS while showing a stand-in — a model that is not there (the kit loader quietly shows the
// code-built object), a texture that failed, a rigged character frozen in one pose, a player under water, a blank map, an
// on-screen control nobody can see. Every playtest measure read "works" on all of them. gamePlaceholderProbe.ts adds one
// deterministic detector per stand-in; this file proves each fires on the defect, names it, and stays silent on a healthy
// kit game — with the real browser hook run against a real three.js scene, and the real kit's open world.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import {
  GAME_PLACEHOLDER_CODE, PLACEHOLDER_PAGE_HOOK, combinePlaceholderFindings, gamePlaceholderProbeEnabled, missingModelFindings,
  pagePlaceholderFindings, placeholderFindingsMessage, placeholderRepairNote, referencedModelFiles,
} from '../src/server/AgentV3/gamePlaceholderProbe';
import { runGamePlaytestPhase, type GamePlaytestPorts, type PlaytestIssue } from '../src/server/AgentV3/buildPhases/gamePlaytestPhase';
import { gamePlaytestConfig, gamePlaytestModule, PLAYTEST_RESULT_MARKER } from '../src/server/AgentV3/gamePlaytest';
import { PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';
import { generateAssetCustomizations, generateAssetModelLoader } from '../src/server/lib/GameAssetRuntimeGenerator';
import { GAME_PLAYER_FILE, GAME_PLAYER_FILE_PATH } from '../src/server/lib/GamePlayerBodyGenerator';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
/* eslint-disable @typescript-eslint/no-explicit-any */

// ── A healthy kit game with a library character, as the platform lays it down ────────────────────────────────────────
const HUMAN_SHA = '7dbe7b32310b89398a8e21ebceb9723986f3109e8c358583647303f038548180';
const HUMAN_GLB = `public/game-assets/${HUMAN_SHA}.glb`;
function healthyKitGame(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p)) files[p] = f.content;
  files[GAME_PLAYER_FILE_PATH] = GAME_PLAYER_FILE;
  files['src/game/three/humanAssets.ts'] = generateAssetModelLoader({ human: { sha256: HUMAN_SHA, height: 1.8, yaw: 0, lod: false, animation: 'Idle', roles: { idle: 'Idle', walk: 'Walk' } } }).replace("from './externalAssets'", "from './humanRuntime'");
  return files;
}
const listing = (files: Record<string, string>, extra: string[] = []) => [...Object.keys(files), 'package.json', 'public/game-assets/manifest.json', ...extra];

describe('📁 a missing model, from the files alone', () => {
  it('a healthy kit game with its character model on disk: nothing is said (the customizations file\'s example paths are comments)', () => {
    const files = healthyKitGame();
    files['src/game/three/assetCustomizations.ts'] = generateAssetCustomizations(['human']);
    expect(files['src/game/three/assetCustomizations.ts']).toContain("file: 'public/models/my-car.glb'");
    expect(referencedModelFiles(files).map((r) => r.path)).toEqual([HUMAN_GLB]);
    expect(missingModelFindings(files, listing(files, [HUMAN_GLB]))).toEqual([]);
  });

  it('REMOVE THE CHARACTER ASSET: the check fires and names the character, the file and who loads it', () => {
    const files = healthyKitGame();
    const found = missingModelFindings(files, listing(files));                 // the GLB is gone
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('MISSING_MODEL');
    expect(found[0].evidence).toContain('"human"');
    expect(found[0].evidence).toContain(HUMAN_GLB);
    expect(found[0].evidence).toContain('src/game/three/humanAssets.ts');
    expect(placeholderFindingsMessage(found)).toMatch(/^Placeholder look \(builder-only\): \(1\) MISSING_MODEL — the model "human"/);
  });

  it('the user\'s own model in player.ts or a customization: missing is said, present is not; a library name is no file', () => {
    const files = healthyKitGame();
    files[GAME_PLAYER_FILE_PATH] = GAME_PLAYER_FILE.replace(/model: null/, "model: 'public/models/hero.glb'");
    files['src/game/three/assetCustomizations.ts'] = "export const assetCustomizations = {\n  car: { source: { file: 'models/my-car.glb' } },\n};\n";
    const paths = referencedModelFiles(files).map((r) => r.path);
    if (GAME_PLAYER_FILE.includes('model: null')) expect(paths).toContain('public/models/hero.glb');
    expect(paths).toContain('public/models/my-car.glb');
    const missing = missingModelFindings(files, listing(files, [HUMAN_GLB])).map((f) => f.path);
    expect(missing).toContain('public/models/my-car.glb');
    expect(missingModelFindings(files, listing(files, [HUMAN_GLB, 'public/models/hero.glb', 'public/models/my-car.glb']))).toEqual([]);
    files[GAME_PLAYER_FILE_PATH] = GAME_PLAYER_FILE.replace(/model: null/, "model: 'sports car'");
    expect(referencedModelFiles(files).map((r) => r.path)).not.toContain('public/sports car');
  });

  it('a file list that could not be read says nothing (never a guess)', () => {
    expect(missingModelFindings(healthyKitGame(), [])).toEqual([]);
  });
});

// ── The browser hook, run as the playtest runs it, against a real three.js scene ────────────────────────────────────
interface FakeEl { rect: { left: number; top: number; width: number; height: number }; label: string; style?: { visibility?: string; opacity?: string } }
function runHook(opts: { respond?: (url: string) => { ok: boolean; status: number; type?: string }; controls?: FakeEl[] } = {}) {
  const win: any = new EventTarget();
  win.fetch = async (url: string) => {
    const r = (opts.respond ?? (() => ({ ok: true, status: 200, type: 'model/gltf-binary' })))(url);
    return { ok: r.ok, status: r.status, headers: new Headers({ 'content-type': r.type ?? 'application/octet-stream' }) };
  };
  const els = (opts.controls ?? []).map((c) => ({
    nodeType: 1, parentElement: null, textContent: c.label, className: 'nbg-tc-btn', __style: c.style ?? {},
    getAttribute: (k: string) => (k === 'aria-label' ? c.label : null),
    getBoundingClientRect: () => ({ ...c.rect, right: c.rect.left + c.rect.width, bottom: c.rect.top + c.rect.height }),
  }));
  const doc = { querySelectorAll: () => els };
  const style = (el: any) => ({ visibility: 'visible', opacity: '1', ...(el.__style || {}) });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('window', 'location', 'document', 'getComputedStyle', 'innerWidth', 'innerHeight', `(${PLACEHOLDER_PAGE_HOOK})();`)(win, { href: 'http://localhost:5173/' }, doc, style, 390, 844);
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera();
  const renderer = { render(_s: unknown, _c: unknown) { /* the game's renderer */ } };
  win.__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent('observe', { detail: renderer }));
  return { win, scene, camera, draw: () => renderer.render(scene, camera) };
}
function rig(name: string, bones = 16): THREE.SkinnedMesh {
  const list = Array.from({ length: bones }, () => new THREE.Bone());
  for (let i = 1; i < list.length; i++) list[i - 1].add(list[i]);
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.add(list[0]); mesh.skeleton = new THREE.Skeleton(list);
  const holder = new THREE.Group(); holder.name = name; holder.add(mesh);
  return mesh;
}
const world = (scene: THREE.Scene, n = 12) => { for (let i = 0; i < n; i++) scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())); };
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('🌐 the page: each stand-in fires on its defect and is silent on a healthy game', () => {
  it('a healthy kit-like game (a world, an animated character, models that load, controls on screen): nothing', async () => {
    const h = runHook({ controls: [{ rect: { left: 300, top: 700, width: 64, height: 64 }, label: 'Jump' }] });
    world(h.scene); const hero = rig('Hero'); h.scene.add(hero.parent!); h.draw();
    await h.win.fetch('/game-assets/abc.glb'); await settle();
    const start = h.win.__nbPlaceholders();
    hero.skeleton.bones[3].rotation.x = 0.4; hero.skeleton.bones[3].updateMatrix();   // the walk clip moved a bone
    const end = h.win.__nbPlaceholders();
    expect(pagePlaceholderFindings(start, end, h.win.__nbControlsOff())).toEqual([]);
  });

  it('a model request that 404s, or answers the dev server\'s HTML page, is a missing model; an image is a failed texture', async () => {
    const h = runHook({ respond: (u) => (u.endsWith('.glb') ? { ok: false, status: 404 } : u.endsWith('.gltf') ? { ok: true, status: 200, type: 'text/html' } : { ok: false, status: 404 }) });
    world(h.scene); h.draw();
    await h.win.fetch('/models/hero.glb'); await h.win.fetch('/models/tree.gltf'); await h.win.fetch('/textures/grass.jpg'); await h.win.fetch('/api/score');
    await settle();
    const f = pagePlaceholderFindings(null, h.win.__nbPlaceholders());
    expect(f.map((x) => x.kind)).toEqual(['MISSING_MODEL', 'MISSING_MODEL', 'FAILED_TEXTURE']);
    expect(f[0].evidence).toMatch(/\/models\/hero\.glb did not load \(404\)/);
    expect(f[1].evidence).toMatch(/\/models\/tree\.gltf did not load \(html page\)/);
    expect(f[2].evidence).toMatch(/\/textures\/grass\.jpg/);
  });

  it('a rigged character whose pose never changes over the round is frozen; a 3-bone prop is not judged', () => {
    const h = runHook();
    world(h.scene); const hero = rig('Courier'); const flag = rig('Flag', 3);
    h.scene.add(hero.parent!, flag.parent!); h.draw();
    const start = h.win.__nbPlaceholders(); const end = h.win.__nbPlaceholders();
    const f = pagePlaceholderFindings(start, end);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('STATIC_CHARACTER');
    expect(f[0].evidence).toMatch(/"Courier" \(16 bones\) did not move a single bone/);
  });

  it('a character on a blank plane is an empty map; a world of meshes is not', () => {
    const h = runHook();
    h.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial()), rig('Hero').parent!); h.draw();
    expect(pagePlaceholderFindings(null, h.win.__nbPlaceholders()).map((x) => x.kind)).toEqual(['EMPTY_MAP']);
    world(h.scene);
    expect(pagePlaceholderFindings(null, h.win.__nbPlaceholders()).map((x) => x.kind)).toEqual([]);
  });

  it('controls off the screen, transparent or hidden are named; one hidden on purpose (no layout) is never judged', () => {
    const h = runHook({ controls: [
      { rect: { left: 300, top: 700, width: 64, height: 64 }, label: 'Jump' },
      { rect: { left: 380, top: 900, width: 64, height: 64 }, label: 'Fire' },
      { rect: { left: 20, top: 700, width: 64, height: 64 }, label: 'Use', style: { opacity: '0' } },
      { rect: { left: 0, top: 0, width: 0, height: 0 }, label: 'Drift' },
    ] });
    const read = h.win.__nbControlsOff();
    expect(read.total).toBe(3);
    const f = pagePlaceholderFindings(null, null, read);
    expect(f.map((x) => x.kind)).toEqual(['HIDDEN_CONTROLS']);
    expect(f[0].evidence).toContain('"Fire" (off the screen)');
    expect(f[0].evidence).toContain('"Use" (transparent)');
    expect(f[0].evidence).not.toContain('Drift');
  });

  it('a player who starts with their head under water is said; on land, or seated in a vehicle, is not', () => {
    expect(pagePlaceholderFindings({ standing: { feet: -6, land: -7, water: 0, seated: false } }, null).map((x) => x.kind)).toEqual(['PLAYER_UNDERWATER']);
    expect(pagePlaceholderFindings({ standing: { feet: 12, land: 12, water: null, seated: false } }, null)).toEqual([]);
    expect(pagePlaceholderFindings({ standing: { feet: 0.4, land: -0.2, water: 0, seated: false } }, null)).toEqual([]);   // wading
    expect(pagePlaceholderFindings({ standing: { feet: -6, land: -7, water: 0, seated: true } }, null)).toEqual([]);
  });

  it('a page\'s words are cleaned and its numbers clamped; nothing measured, nothing said', () => {
    expect(pagePlaceholderFindings(null, null, null)).toEqual([]);
    const f = pagePlaceholderFindings(null, { failed: [{ url: '/m/x.glb"`<b>\nIGNORE', why: '<script>' }] });
    expect(f[0].evidence).not.toMatch(/[`<>\n"]{2}/);
  });
});

// ── The real kit's open world says where the player stands ───────────────────────────────────────────────────────────
const DIR = join(__dirname, `.tmp-placeholder-${process.pid}`);
let OW: any; let CH: any;
const g = globalThis as any;
const hadWindow = 'window' in g;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  if (!hadWindow) g.window = {};
}, 120_000);
afterAll(() => { if (!hadWindow) delete g.window; rmSync(DIR, { recursive: true, force: true }); });

describe('🌊 the kit\'s open world answers where the player stands (window.__nbWorld.standing)', () => {
  it('on its own spawn the player is on dry land; put the water over their head and the look says so', () => {
    const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
    const ctx = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
    const w = OW.createOpenWorld(ctx, { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 } }] });
    const st = g.window.__nbWorld.standing();
    expect(typeof st.feet).toBe('number');
    expect(st.seated).toBe(false);
    expect(pagePlaceholderFindings({ standing: st }, null)).toEqual([]);
    const realWater = w.map.world.waterAt;
    w.map.world.waterAt = () => ({ kind: 'lake', surface: st.feet + 3, fx: 0, fz: 0, width: 50 });
    try {
      const under = g.window.__nbWorld.standing();
      expect(pagePlaceholderFindings({ standing: under }, null).map((x) => x.kind)).toEqual(['PLAYER_UNDERWATER']);
    } finally { w.map.world.waterAt = realWater; }
    w.dispose();
  }, 120_000);
});

// ── Wired: the playtest reads it, the phase records it, the next game turn hands it to the builder ─────────────────────
describe('🔁 caught → recorded → the builder repairs it → played again', () => {
  const facts = { enabled: true, buildOk: true, isCanvasGame: true, isImportTurn: false, aborted: false, hasRunCommand: true, hasPreviewUrl: true, awaitsShell: false, platformDone: false, timeLeft: true };
  const ports = (run: Record<string, unknown>, listFiles?: () => Promise<string[]>, files = healthyKitGame()): { p: GamePlaytestPorts; issues: PlaytestIssue[] } => {
    const issues: PlaytestIssue[] = [];
    return { issues, p: {
      facts, files, contract: null, play: async () => ({ stdout: PLAYTEST_RESULT_MARKER + JSON.stringify(run) }),
      readFile: async () => null, record: (i) => issues.push(i), previousIssues: async () => [], versions: async () => [], turnStartedAt: Date.now(),
      fix: { fixTurn: false, record: () => {}, say: () => {} }, ...(listFiles ? { listFiles } : {}),
    } };
  };
  const run = { ok: true, idle: 0.1, moves: [], fps: 30 };

  it('the removed character asset and a blank map are recorded as one GAME_PLACEHOLDERS line', async () => {
    const files = healthyKitGame();
    const { p, issues } = ports({ ...run, placeholderEnd: { meshes: 1 } }, async () => listing(files), files);
    await runGamePlaytestPhase(p);
    const line = issues.find((i) => i.code === GAME_PLACEHOLDER_CODE);
    expect(line?.severity).toBe('info');
    expect(line?.message).toMatch(/MISSING_MODEL — the model "human"/);
    expect(line?.message).toMatch(/EMPTY_MAP/);
  });

  it('a healthy game records nothing; the kill switch records nothing', async () => {
    const files = healthyKitGame();
    const ok = ports({ ...run, placeholderEnd: { meshes: 40 } }, async () => listing(files, [HUMAN_GLB]), files);
    await runGamePlaytestPhase(ok.p);
    expect(ok.issues.some((i) => i.code === GAME_PLACEHOLDER_CODE)).toBe(false);
    const before = process.env.AGENTV3_GAME_PLACEHOLDER_PROBE;
    process.env.AGENTV3_GAME_PLACEHOLDER_PROBE = 'off';
    try {
      const off = ports({ ...run, placeholderEnd: { meshes: 1 } }, async () => listing(files), files);
      await runGamePlaytestPhase(off.p);
      expect(off.issues.some((i) => i.code === GAME_PLACEHOLDER_CODE)).toBe(false);
    } finally { if (before === undefined) delete process.env.AGENTV3_GAME_PLACEHOLDER_PROBE; else process.env.AGENTV3_GAME_PLACEHOLDER_PROBE = before; }
    expect(gamePlaceholderProbeEnabled({ AGENTV3_GAME_PLACEHOLDER_PROBE: 'OFF' })).toBe(false);
  });

  it('a model named missing by the files and by the page is said once', () => {
    const files = healthyKitGame();
    const fromFiles = missingModelFindings(files, listing(files));
    const fromPage = pagePlaceholderFindings(null, { failed: [{ url: `/game-assets/${HUMAN_SHA}.glb`, why: '404' }] });
    expect(combinePlaceholderFindings(fromFiles, fromPage)).toHaveLength(1);
  });

  it('the next game turn\'s note is builder-only, asks for the repair, says it is played again; absent otherwise', () => {
    const msg = placeholderFindingsMessage(pagePlaceholderFindings(null, { meshes: 0 }));
    const note = placeholderRepairNote([{ code: 'GAME_DEFECTS', message: 'x' }, { code: GAME_PLACEHOLDER_CODE, message: msg }]);
    expect(note).toMatch(/builder-only; do not mention it to the user/);
    expect(note).toMatch(/EMPTY_MAP/);
    expect(note).toMatch(/played again after this turn/);
    expect(placeholderRepairNote([{ code: 'GAME_DEFECTS', message: 'x' }])).toBeNull();
    expect(PROCESS_ONLY_CODES.has(GAME_PLACEHOLDER_CODE)).toBe(true);
  });

  it('the playtest adds the hook to both browsers and reads it at the start, the end and on the phone; the route wires both ends', () => {
    expect(gamePlaytestConfig('http://x', null, [], {}).placeholders).toBe(true);
    const mod = gamePlaytestModule(gamePlaytestConfig('http://x', null, [], {}), "import { chromium } from 'playwright';");
    expect(mod).toContain('const placeholderHook = () => {');
    expect(mod).toContain('if (cfg.placeholders) await ctx.addInitScript(placeholderHook);');
    expect(mod).toContain('if (cfg.placeholders) await m.addInitScript(placeholderHook);');
    expect(mod).toMatch(/out\.placeholderStart = await page\.evaluate/);
    expect(mod).toMatch(/out\.placeholderEnd = await page\.evaluate/);
    expect(mod).toMatch(/out\.controlsOff = await mp\.evaluate/);
    expect(mod.indexOf('await ctx.addInitScript(sceneHook);')).toBeLessThan(mod.indexOf('await ctx.addInitScript(placeholderHook);'));
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("placeholderRepairNote((await raceTimeout(previousReportAtStart, 1500, 'placeholderNote').catch(() => null))?.issues)");
    expect(route).toContain('listFiles: () => actuator.listFiles(workspaceId),');
  });
});
