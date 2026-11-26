/**
 * failedbr #2523 (2026-11-25, "a simple playable shooting game"): the game kit was laid down before the first model call,
 * and the very first write-time typecheck already reported 4 errors, none of them in a file the builder wrote:
 *   src/game/play/playerBody.ts(473)       'HumanoidAction' is not assignable to 'PlayerMove' ('bat')
 *   src/game/three/externalAssets.ts(186)  'Uint8Array<ArrayBufferLike>' is not assignable to 'BufferSource'
 *   src/game/three/externalAssets.ts(265)  'ArrayBufferLike' is not assignable to 'string | ArrayBuffer'
 *   src/game/controls.test.ts(6)           Cannot find module 'vitest'
 * The builder of the follow-up build spent turns casting them away. Compiling the whole kit as a real generated app (the
 * scaffold's own tsconfig, three@0.180 with its types, TypeScript 5.9) found three more of the same class in kit files
 * that other games get: RacingRoadGame.tsx (a failed result's `reason` unreachable without strictNullChecks),
 * openWorld.ts (`taken.some` typed its entries without their `box`) and worldLayer.ts (`follow` not narrowed).
 *
 * THE CLASS: the kit was never typechecked as a whole. `theKitCompilesUnderAStrictApp` compiles every kit file but keeps
 * only the unused-declaration codes, and it compiles under `strict` while the scaffold tsconfig is NOT strict, so every
 * real type error passed. This census compiles every file any game recipe writes, plus the model-loader runtime, under
 * BOTH the scaffold's own compiler options and strict, and fails on ANY diagnostic. `three` has no types in this repo, so
 * only its "no declaration" diagnostics are excused — everything else a generated game would see is in scope.
 */
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { generateGameAssetRuntime } from '../src/server/lib/GameAssetRuntimeGenerator';
import { GAME_WORLD_LAYER } from '../src/server/lib/GameWorldLayerGenerator';
import { tsconfig as scaffoldTsconfig } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

const REPO_MODULES = resolve(__dirname, '..', 'node_modules');
const RUNTIME_PATH = 'src/game/three/externalAssets.ts';

// Under strict, every callback over a `three` object (traverse, materials…) is an implicit any here only because `three`
// has no types in this repo; the scratch app with @types/three@0.180 compiles them clean. Nothing else is excused.
const UNTYPED_THREE_UNDER_STRICT = new Set([7006, 7031]);

/** `three` (and its addons) has no type package in this repo: its "not found / no declaration" codes are not the kit's. */
function excused(d: ts.Diagnostic, strict: boolean): boolean {
  if (strict && UNTYPED_THREE_UNDER_STRICT.has(d.code)) return true;
  if (d.code !== 2307 && d.code !== 7016) return false;
  return /['"]three(?:\/[^'"]*)?['"]/.test(ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

function writeKit(): { dir: string; paths: string[] } {
  const dir = makeTempDir('nbai-kit-app-');
  const files = new Map<string, string>();
  for (const [p, f] of recipeFilePool()) files.set(p, f.content);
  files.set(RUNTIME_PATH, generateGameAssetRuntime());
  // What Vite's own vite-env.d.ts gives the app: import.meta.glob and import.meta.env.
  files.set('src/vite-env.d.ts', `/// <reference path="${join(REPO_MODULES, 'vite', 'client.d.ts')}" />\n`);
  const paths: string[] = [];
  for (const [p, content] of files) {
    if (!/\.(?:ts|tsx)$/.test(p)) continue;
    const abs = join(dir, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    paths.push(abs);
  }
  return { dir, paths };
}

function diagnostics(dir: string, paths: string[], strict: boolean): string[] {
  const parsed = ts.parseJsonConfigFileContent(JSON.parse(scaffoldTsconfig), ts.sys, dir);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    ...(strict ? { strict: true } : {}),
    noEmit: true,
    // The scaffold's own `@/*` path stays; every bare package resolves from this repo's node_modules, the way the app's own
    // node_modules would serve it — a type package before the package itself, as TypeScript looks them up.
    paths: { ...(parsed.options.paths ?? {}), '*': [`${REPO_MODULES}/@types/*`, `${REPO_MODULES}/*`] },
    typeRoots: [join(REPO_MODULES, '@types')],
    types: [],
  };
  const program = ts.createProgram(paths, options);
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file && d.file.fileName.startsWith(dir) && !excused(d, strict))
    .map((d) => {
      const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
      return `${d.file!.fileName.slice(dir.length + 1)}:${line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    });
}

describe('the whole game kit typechecks in the app it ships to (failedbr #2523)', () => {
  const kit = writeKit();

  it('writes every kit file, the model-loader runtime included', () => {
    expect(kit.paths.length).toBeGreaterThan(100);
    expect(kit.paths.some((p) => p.endsWith(RUNTIME_PATH))).toBe(true);
  });

  it('no diagnostic under the scaffold tsconfig (not strict — what every generated game compiles with)', () => {
    expect(diagnostics(kit.dir, kit.paths, false)).toEqual([]);
  }, 180_000);

  it('no diagnostic under strict (a user who turns strict on inherits a clean kit)', () => {
    expect(diagnostics(kit.dir, kit.paths, true)).toEqual([]);
  }, 180_000);
});

// Two of #2523's class this repo's compiler cannot see, so they are held by their shape (each proven by reversion):
// · the ArrayBuffer refusals appear only in TypeScript 5.9's lib.dom (this repo pins ~5.8; a generated app installs the
//   newest 5.x), so the runtime must hand digest and the glTF parser an exact ArrayBuffer, never a Uint8Array or its .buffer;
// · worldLayer's `follow` error needs three's real types, so the narrowing must sit in the one expression that reads it.
describe('what the census cannot compile here is held by its shape (failedbr #2523)', () => {
  it('the model-loader runtime gives digest and parseAsync an exact ArrayBuffer', () => {
    const runtime = generateGameAssetRuntime();
    const digests = [...runtime.matchAll(/crypto\.subtle\.digest\(\s*'[^']+'\s*,\s*([^)]*)\)/g)].map((m) => m[1].trim());
    expect(digests.length).toBeGreaterThan(0);
    for (const arg of digests) expect(arg.startsWith('exactBuffer(')).toBe(true);
    expect(runtime).not.toMatch(/parseAsync\(\s*[\w.]+\.buffer\b/);
  });
  it('the world layer narrows `follow` where it reads it', () => {
    expect(GAME_WORLD_LAYER).toMatch(/\(typeof follow === 'function' \? follow\(\) : follow\) \?\? null/);
  });
});
