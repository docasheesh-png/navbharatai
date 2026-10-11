// A RECIPE'S OWN USAGE EXAMPLE COMPILES (admin 2026-10-11, build 46e2d74b — "racing game me car ulti
// chal rahi hai").
//
// Every game recipe hands the builder an `instructions` text whose code block is the example the model
// copies. Nothing ever compiled those blocks, and the 46e2d74b autopsy found what that let through:
//   • the game shell's example passed `camera: 'thirdPerson'` — not a CameraKind, so it fails tsc with
//     TS2820 — and showed no vehicle at all, so a racing game written from it never called ctx.follow
//     and framed the car from the FRONT (headlights toward the player, LEFT turning it RIGHT);
//   • the 3D layer's example named canvas, car, rider, terrain and buildings without making any of them,
//     recommended a 'third-person' rig with rig.update(playerPos) for a car — the front view again — and
//     leaned the bike RIGHT on LEFT;
//   • the controller's example named terrain, buildings, input and cameraYaw without making them.
// A model cannot follow an example that does not compile; it improvises, and the improvisation is where
// the camera ends up in front of the car.
//
// 🔒 THE CLASS: an example is code, so it is held to what code is held to. Every recipe in GAME_RECIPES
// is either COMPILED here — each fenced block written into a project beside the recipes' real output and
// typechecked the way the app's own tsconfig does it (strict on, as in the strict-trial cohort) — or
// listed in NOT_YET_COMPILED with the reason. A NEW recipe fails until it is one or the other.
//
// `three` has no type package in this repository (the app installs @types/three), so it is declared
// here with every member the kit and the examples touch typed as `any`. What that leaves checked is
// exactly what the examples got wrong: the KIT's own names, options and kinds.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ts from 'typescript';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-recipe-examples-${process.pid}`);

/** Recipes whose examples are fragments that name the GAME's own state — not yet whole modules. */
const NOT_YET_COMPILED: Readonly<Record<string, string>> = {
  generate_game_systems: 'its example names the game\'s own enemies, targets and aim (enemy, targets, aimDir, muzzleWorldPos)',
  generate_game_vfx: 'its example names the game\'s own feel and particle wiring (feel, ParticleSystem use) as a fragment',
};

interface Example { recipe: string; index: number; lang: string; code: string; path: string }

function examplesOf(recipe: string): Example[] {
  const { instructions } = GAME_RECIPES[recipe]() as { instructions?: string };
  return [...String(instructions ?? '').matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m, index) => {
    const lang = m[1] === 'tsx' ? 'tsx' : 'ts';
    return { recipe, index, lang, code: m[2], path: `src/__example_${recipe}_${index}.${lang}` };
  });
}

/** `declare module 'three'` with every THREE.X the given sources use, as both a value and a type. */
function threeShim(sources: string[]): string {
  const names = new Set<string>();
  for (const s of sources) for (const m of s.matchAll(/THREE\.([A-Za-z_]\w*)/g)) names.add(m[1]);
  const members = [...names].sort().map((n) => `  export const ${n}: any;\n  export type ${n}<A = any, B = any, C = any, D = any> = any;`);
  return `declare module 'three' {\n${members.join('\n')}\n}\n`;
}

/** Typecheck these files (paths relative to DIR) and return the diagnostics of the ones asked about. */
function typecheck(files: Record<string, string>, report: string[]): string[] {
  rmSync(DIR, { recursive: true, force: true });
  for (const [p, c] of Object.entries(files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  const program = ts.createProgram(Object.keys(files).map((p) => join(DIR, p)), {
    // The app's own tsconfig (ViteReactProviderContents.ts), with the strict-trial cohort's strict on.
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], jsx: ts.JsxEmit.ReactJSX,
    strict: true, isolatedModules: true, allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, types: [],
  });
  const wanted = new Set(report.map((p) => join(DIR, p)));
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file && wanted.has(d.file.fileName))
    .map((d) => {
      const at = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
      return `${d.file!.fileName.replace(DIR + '/', '')}:${at.line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
}

const kit: Record<string, string> = Object.assign({}, ...Object.values(GAME_RECIPES).map((g) => g().files));
const COMPILED = Object.keys(GAME_RECIPES).filter((r) => !(r in NOT_YET_COMPILED));
let diagnostics: string[] = [];
const all: Example[] = COMPILED.flatMap(examplesOf);

beforeAll(() => {
  const files: Record<string, string> = { ...kit };
  for (const e of all) files[e.path] = e.code;
  files['three-shim.d.ts'] = threeShim(Object.values(files));
  diagnostics = typecheck(files, all.map((e) => e.path));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('every game recipe is either compiled here or listed with its reason', () => {
  it('no recipe is missing from both lists, and nothing listed is stale', () => {
    for (const r of Object.keys(NOT_YET_COMPILED)) expect(Object.keys(GAME_RECIPES), `${r} is listed but no longer a recipe`).toContain(r);
    expect(COMPILED.length + Object.keys(NOT_YET_COMPILED).length).toBe(Object.keys(GAME_RECIPES).length);
  });

  for (const recipe of COMPILED) {
    it(`${recipe} carries at least one code example`, () => {
      expect(examplesOf(recipe).length, `${recipe} has no fenced example to compile`).toBeGreaterThan(0);
    });
  }
});

describe('🔴 every compiled recipe example typechecks against the recipes\' real output', () => {
  for (const recipe of COMPILED) {
    it(`${recipe}: zero errors`, () => {
      const mine = diagnostics.filter((d) => d.includes(`__example_${recipe}_`));
      expect(mine, mine.join('\n')).toEqual([]);
    });
  }
});

describe('the examples teach the camera that sits BEHIND a vehicle', () => {
  const text = (r: string) => examplesOf(r).map((e) => e.code).join('\n');

  it("the shell's example uses a REAL camera kind and calls ctx.follow(car) for the car it drives", () => {
    const shell = text('generate_game_shell');
    expect(shell).not.toContain("'thirdPerson'");
    expect(shell).toContain('ctx.follow(car)');
    expect(shell).toContain('driveVehicle(car, drive, ctx.input.axis(), dt)');
  });

  it("the 3D example frames the car with a 'chase' rig, and never feeds a vehicle to a third-person rig", () => {
    const three = text('generate_game_3d');
    expect(three).toContain("new CameraRig({ kind: 'chase'");
    expect(three).toContain('rig.update(car, dt)');
    expect(three).not.toMatch(/kind: 'third-person'/);
    expect(three).not.toMatch(/rig\.update\(\s*(car|bike|vehicle)[\w.]*position/);
  });

  it('the bike example takes its lean and bars from the raw axis through bike.ride(), never a hand-made sign', () => {
    const three = text('generate_game_3d');
    expect(three).toContain('bike.ride(axis, ride.speed, dt)');
    expect(three).not.toMatch(/bike\.(lean|steer)\(/);
  });
});

describe('the check itself catches the exact defect it exists for', () => {
  it("the shell's OLD example (camera: 'thirdPerson') fails with TS2820", () => {
    const old = "import { GameCanvas } from './game/GameCanvas';\n"
      + "export const A = () => <GameCanvas options={{ lighting: 'sunset', camera: 'thirdPerson' }} />;\n";
    const files: Record<string, string> = { ...kit, 'src/__old.tsx': old };
    files['three-shim.d.ts'] = threeShim(Object.values(files));
    const errs = typecheck(files, ['src/__old.tsx']);
    expect(errs.some((e) => e.includes('TS2820')), errs.join('\n')).toBe(true);
  }, 60_000);

  it("a fragment that names a variable it never made fails (the 3D example's old `car.position.y = …`)", () => {
    const files: Record<string, string> = { ...kit, 'src/__frag.ts': 'car.position.y = 0.03;\nexport {};\n' };
    files['three-shim.d.ts'] = threeShim(Object.values(files));
    const errs = typecheck(files, ['src/__frag.ts']);
    expect(errs.some((e) => e.includes('TS2304')), errs.join('\n')).toBe(true);
  }, 60_000);
});
