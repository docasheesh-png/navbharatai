// A KIT FILE FROM AN OLDER VERSION IS RECOGNISED — AND BROUGHT UP TO DATE ONLY WHEN NOBODY TOUCHED IT (Q-863, found
// by build 46e2d74b; admin 2026-10-12: "game wali rows bhi aap hi karo").
//
// Since 2026-10-11 (#3677) the kit's camera.ts imports `vehicleAt` from objects.ts, and Game.ts imports
// `watchVehicles` and `isVehicle`. Every game built before that holds the OLD objects.ts — the real one is the
// fixture below — and recipe writes never overwrote, so an edit turn that laid the new camera.ts or Game.ts
// beside it handed over code with 7 compile errors (measured below with the TypeScript compiler).
//
// THE CLASS: a project holding an older kit version, and nothing able to tell it from somebody's edit. Now
// `gameKitHistory.ts` holds the hash of every version a recipe ever wrote (backfilled from git, 79 versions of 37
// files), and a file is judged by its bytes: an older kit version nobody edited is brought up to date; anything
// else is kept, and the tool result names what the new code needs from it. The same history lets
// `platformAuthored` stop grading an old project's untouched kit as the user's code.
import { describe, it, expect, afterAll } from 'vitest';
import ts from 'typescript';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  GAME_RECIPES, recipeFilePool, planKitLayers, exportedNames, importedNames, isKnownKitVersion, staleKitReason,
  kitRefreshable, kitVersionNote, type LayerFile,
} from '../src/server/lib/gameRecipeLayers';
import { GAME_KIT_HISTORY } from '../src/server/lib/gameKitHistory';
import { isPlatformSeededFile, _resetPlatformSeededIndex } from '../src/server/AgentV3/platformAuthored';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

/** objects.ts exactly as every game built 2026-10-05 … 2026-10-11 holds it (the version before #3677). */
const OLD_OBJECTS = gunzipSync(readFileSync('tests/fixtures/kitObjectsBefore3677.ts.gz')).toString('utf8');
/** camera.ts as those games hold it — the rig that framed a car from the front. */
const OLD_CAMERA = readFileSync('tests/fixtures/kitCameraBefore3677.ts.txt', 'utf8');
const OBJECTS = 'src/game/three/objects.ts';
const CAMERA = 'src/game/three/camera.ts';
const pool = recipeFilePool();
const kit = (): Record<string, string> => Object.assign({}, ...Object.values(GAME_RECIPES).map((g) => g().files));
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('🔒 the history holds every version, the current one included', () => {
  it('CENSUS: every file every recipe writes NOW is recorded — or run `node scripts/gameKitHistory.mjs`', () => {
    const unrecorded = Object.entries(kit()).filter(([p, c]) => !GAME_KIT_HISTORY[p]?.includes(sha(c))).map(([p]) => p);
    expect(unrecorded, 'a game generator changed without its output being recorded — run `node scripts/gameKitHistory.mjs` and commit src/server/lib/gameKitHistory.ts').toEqual([]);
  });

  it('the versions the reported games hold are in it (the backfill reached them)', () => {
    expect(isKnownKitVersion(OBJECTS, OLD_OBJECTS)).toBe(true);
    expect(isKnownKitVersion(CAMERA, OLD_CAMERA)).toBe(true);
    expect(GAME_KIT_HISTORY[OBJECTS].length).toBeGreaterThanOrEqual(11);
  });

  it('one changed byte is somebody\'s edit', () => {
    expect(isKnownKitVersion(OBJECTS, `${OLD_OBJECTS} `)).toBe(false);
    expect(isKnownKitVersion('src/game/mine.ts', OLD_OBJECTS)).toBe(false);
  });

  it('the script reads exactly the generators GAME_RECIPES is built from', () => {
    const script = readFileSync('scripts/gameKitHistory.mjs', 'utf8');
    const listed = [...script.slice(script.indexOf('const GENERATORS = ['), script.indexOf('].map(')).matchAll(/'(\w+Generator)'/g)].map((m) => m[1]).sort();
    const layers = readFileSync('src/server/lib/gameRecipeLayers.ts', 'utf8');
    const used = [...layers.matchAll(/from '\.\/(\w+Generator)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(used);
  });
});

describe('the kit as an older project holds it — measured with the TypeScript compiler', () => {
  const DIR = join(__dirname, `.tmp-kit-skew-${process.pid}`);
  afterAll(() => rmSync(DIR, { recursive: true, force: true }));
  const shim = (sources: string[]) => {
    const names = new Set<string>();
    for (const s of sources) for (const m of s.matchAll(/THREE\.([A-Za-z_]\w*)/g)) names.add(m[1]);
    return `declare module 'three' {\n${[...names].map((n) => `  export const ${n}: any;\n  export type ${n}<A = any, B = any, C = any, D = any> = any;`).join('\n')}\n}\n`;
  };
  const diagnostics = (files: Record<string, string>): Set<string> => {
    rmSync(DIR, { recursive: true, force: true });
    const all = { ...files, 'three-shim.d.ts': shim(Object.values(files)) };
    for (const [p, c] of Object.entries(all)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
    const program = ts.createProgram(Object.keys(all).map((p) => join(DIR, p)), {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'], jsx: ts.JsxEmit.ReactJSX, strict: true, isolatedModules: true,
      allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, types: [],
    });
    return new Set(ts.getPreEmitDiagnostics(program).filter((d) => d.file).map((d) => `${d.file!.fileName.replace(`${DIR}/`, '')} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`));
  };
  const current = (() => { const k = kit(); delete k['src/game/controls.test.ts']; return k; })();
  let baseline: Set<string> | null = null;
  const added = (files: Record<string, string>) => { baseline ??= diagnostics(current); return [...diagnostics(files)].filter((d) => !baseline!.has(d)); };

  it('the old objects.ts beside the new camera.ts and Game.ts does NOT compile — the defect', () => {
    const errors = added({ ...current, [OBJECTS]: OLD_OBJECTS });
    expect(errors.join('\n')).toContain("Game.ts TS2305 Module '\"./three/objects\"' has no exported member 'watchVehicles'");
    expect(errors.join('\n')).toContain("camera.ts TS2724 '\"./objects\"' has no exported member named 'vehicleAt'");
  }, 60_000);

  it('🔒 after the shell recipe runs on that project, it compiles exactly like the current kit', async () => {
    const { act, d } = dispatcher({ ...current, [OBJECTS]: OLD_OBJECTS, [CAMERA]: OLD_CAMERA }, ['src/game/Game.ts']);
    const res = String((await d.dispatch({ id: 't1', name: 'generate_game_shell', input: {} }, 'architect')).content);
    expect(act.files.get(OBJECTS)).toBe(pool.get(OBJECTS)!.content);
    expect(act.files.get(CAMERA)).toBe(pool.get(CAMERA)!.content);
    expect(res).toContain('KIT FILES BROUGHT UP TO DATE');
    const files = Object.fromEntries([...act.files].filter(([p]) => p in current));
    expect(added(files)).toEqual([]);
  }, 60_000);
});

// ── The dispatcher, end to end ─────────────────────────────────────────────────────────────────────────────
class Act implements ActuatorPort {
  files = new Map<string, string>();
  reads: string[] = [];
  async readFile(_w: string, p: string) { this.reads.push(p); const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
}
function dispatcher(files: Record<string, string> = {}, without: string[] = []) {
  const act = new Act();
  for (const [p, c] of Object.entries(files)) if (!without.includes(p)) act.files.set(p, c);
  act.files.set('package.json', JSON.stringify({ name: 'g', dependencies: { three: '0.170.0' }, devDependencies: { '@types/three': '0.170.0', vitest: '^3.2.4' } }));
  const stream = new AgentEventStream();
  return { act, d: new ToolDispatcher(act, 'ws-kit-skew', new WorkspaceState(stream), stream) };
}

describe('the dispatcher brings an untouched older kit file up to date, and never anybody\'s own', () => {
  it('re-running generate_game_3d on an older game updates the files nobody edited', async () => {
    const { act, d } = dispatcher({ ...kit(), [OBJECTS]: OLD_OBJECTS, [CAMERA]: OLD_CAMERA });
    const res = String((await d.dispatch({ id: 't1', name: 'generate_game_3d', input: {} }, 'architect')).content);
    expect(res).toContain(`Updated ${CAMERA}`);
    expect(res).toContain(`Updated ${OBJECTS}`);
    expect(res).toMatch(/KIT FILES BROUGHT UP TO DATE: .*camera\.ts/);
    expect(act.files.get(CAMERA)).toBe(pool.get(CAMERA)!.content);
  });

  it('🔒 an EDITED kit file is never replaced — the result names exactly what the new code needs from it', async () => {
    const edited = `${OLD_OBJECTS}\n// my own tweak\n`;
    const { act, d } = dispatcher({ ...kit(), [OBJECTS]: edited }, ['src/game/Game.ts', CAMERA]);
    const res = String((await d.dispatch({ id: 't1', name: 'generate_game_shell', input: {} }, 'architect')).content);
    expect(act.files.get(OBJECTS)).toBe(edited);
    expect(res).toContain('KIT VERSION MISMATCH');
    expect(res).toContain(`src/game/Game.ts imports watchVehicles, isVehicle from ${OBJECTS}`);
    expect(res).toContain(`${CAMERA} imports vehicleAt, isVehicle from ${OBJECTS}`);
    expect(res).toContain('it is not a version the kit ever wrote (somebody changed it), so it was NOT replaced');
  });

  it('an edited file the recipe itself writes is kept, and the line says why', async () => {
    const edited = `${OLD_CAMERA}// tuned the follow distance\n`;
    const { act, d } = dispatcher({ ...kit(), [CAMERA]: edited });
    const res = String((await d.dispatch({ id: 't1', name: 'generate_game_3d', input: {} }, 'architect')).content);
    expect(act.files.get(CAMERA)).toBe(edited);
    expect(res).toContain(`skipped existing ${CAMERA} — it is not the current kit version (somebody changed it)`);
  });

  it('a fresh game build reads none of the kit files it has just written (the seed stays fast)', async () => {
    const { act, d } = dispatcher();
    await d.dispatch({ id: 't1', name: 'generate_game_runtime', input: {} }, 'architect');
    await d.dispatch({ id: 't2', name: 'generate_game_3d', input: {} }, 'architect');
    act.reads = [];
    await d.dispatch({ id: 't3', name: 'generate_game_shell', input: {} }, 'architect');
    const shellOwn = new Set(Object.keys(GAME_RECIPES.generate_game_shell().files));
    expect(act.reads.filter((p) => p !== 'package.json' && !shellOwn.has(p))).toEqual([]);
  });
});

describe('platformAuthored knows an older kit version is still our kit', () => {
  it('byte-exact old kit is ours; one changed byte is the user\'s', () => {
    _resetPlatformSeededIndex();
    expect(isPlatformSeededFile(OBJECTS, OLD_OBJECTS)).toBe(true);
    expect(isPlatformSeededFile(OBJECTS, `${OLD_OBJECTS}\n`)).toBe(false);
  });
});

describe('the planner (pure)', () => {
  const P = (entries: Record<string, string>): Map<string, LayerFile> => new Map(Object.entries(entries).map(([p, c]) => [p, { recipe: 'r', content: c }]));
  const fakePool = P({
    'g/a.ts': "import { x, y } from './b';\nexport const a = x + y;\n",
    'g/b.ts': "import { z } from './c';\nexport const x = 1;\nexport const y = z;\n",
    'g/c.ts': 'export const z = 2;\n',
  });
  const written = { 'g/a.ts': fakePool.get('g/a.ts')!.content };
  const OLD_B = 'export const x = 1;\n'; // an older b.ts: no y, no import of c
  const known = (old: string) => (_p: string, cur: string, next: string) => (cur === old ? staleBy(cur, next) : 'edited');
  const staleBy = (cur: string, next: string) => { const o = exportedNames(cur)!; const n = exportedNames(next)!; return [...o].every((k) => n.has(k)) ? null : 'drops-names'; };

  it('an older version nobody edited is refreshed, and what the new version imports comes with it', () => {
    const plan = planKitLayers(written, new Set(['g/a.ts', 'g/b.ts']), new Map([['g/b.ts', OLD_B]]), fakePool, known(OLD_B));
    expect([...plan.refresh.keys()]).toEqual(['g/b.ts']);
    expect([...plan.add.keys()]).toEqual(['g/c.ts']);
    expect(plan.kept).toEqual([]);
  });

  it('an edited one is kept, with the names the importer needs and it lacks', () => {
    const plan = planKitLayers(written, new Set(['g/b.ts']), new Map([['g/b.ts', OLD_B]]), fakePool, () => 'edited');
    expect(plan.refresh.size).toBe(0);
    expect(plan.kept).toEqual([{ path: 'g/b.ts', importer: 'g/a.ts', missing: ['y'], reason: 'edited' }]);
  });

  it('an edited one that still has every name it is asked for is left alone, and nothing is said', () => {
    const plan = planKitLayers(written, new Set(['g/b.ts']), new Map([['g/b.ts', 'export const x = 3, y = 4;\nexport { x as x2 };\nexport const y = 0;\n']]), fakePool, () => 'edited');
    expect(plan.kept).toEqual([]);
  });

  it('an older version the current one would take a name from is kept (drops-names)', () => {
    const old = 'export const x = 1;\nexport const gone = 0;\n';
    const plan = planKitLayers(written, new Set(['g/b.ts']), new Map([['g/b.ts', old]]), fakePool, known(old));
    expect(plan.refresh.size).toBe(0);
    expect(plan.kept[0]).toMatchObject({ path: 'g/b.ts', reason: 'drops-names', missing: ['y'] });
  });

  it('a present file it was not given is asked for; an unreadable one is left alone', () => {
    expect(planKitLayers(written, new Set(['g/b.ts']), new Map(), fakePool).unread).toEqual(['g/b.ts']);
    const plan = planKitLayers(written, new Set(['g/b.ts']), new Map([['g/b.ts', null]]), fakePool);
    expect([plan.unread, plan.refresh.size, plan.kept, plan.add.size]).toEqual([[], 0, [], 0]);
  });

  it('a current file is followed, so an older file behind it is still reached', () => {
    const OLD_C = 'export const z = 0;\nexport const w = 1;\n';
    const plan = planKitLayers(written, new Set(['g/b.ts', 'g/c.ts']), new Map([['g/b.ts', fakePool.get('g/b.ts')!.content], ['g/c.ts', OLD_C]]), fakePool, () => 'edited');
    expect(plan.unread).toEqual([]);
    expect(plan.kept).toEqual([]); // c still exports z — nothing breaks, nothing said
  });

  it('reads named imports and exports the way TypeScript does', () => {
    expect(importedNames("import { a, b as c, type D } from './m';\nimport x from './m';\nexport { e } from './m';", './m')).toEqual(['a', 'b', 'D', 'e']);
    expect([...exportedNames('export function f() {}\nexport class K {}\nexport type T = 1;\nconst q = 1;\nexport { q as Q, type T as U };\nexport default 1;')!].sort())
      .toEqual(['K', 'Q', 'T', 'U', 'default', 'f']);
    expect(exportedNames("export * from './x';")).toBeNull();
  });

  it('every older version of every kit file keeps the names the current one exports — so each is refreshable', () => {
    expect(staleKitReason(OBJECTS, OLD_OBJECTS, pool.get(OBJECTS)!.content)).toBeNull();
    expect(kitRefreshable(CAMERA, OLD_CAMERA, pool.get(CAMERA)!.content)).toBe(true);
    expect(kitRefreshable(CAMERA, pool.get(CAMERA)!.content, pool.get(CAMERA)!.content)).toBe(false);
  });

  it('the note says nothing when there is nothing to say', () => {
    expect(kitVersionNote([], [], [])).toBe('');
  });
});
