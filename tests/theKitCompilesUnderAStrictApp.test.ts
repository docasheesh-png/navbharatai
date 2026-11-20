/**
 * failedbr #2036 (2026-11-08, a 3D bike game): the app's tsconfig had `noUnusedLocals`/`noUnusedParameters` (Vite's own
 * default), and the last two typecheck runs failed ONLY on our kit — `src/game/ui/touchControls.ts(123,22): error
 * TS6138: Property 'container' is declared but its value is never read` — so the builder looped on a file it did not
 * write until the user stopped it. The 2D world was already compiled under those flags (theTwoDWorldIsOneSeamlessMap);
 * the rest of the kit never was. This census compiles EVERY file any game recipe writes and fails on any
 * unused-declaration diagnostic. Those need no resolved types, so `three` (no @types in this repo) does not matter;
 * every other diagnostic is out of scope here.
 */
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

// TS6133 'x' is declared but its value is never read · TS6138 property … never read · TS6192 all imports unused ·
// TS6196 'x' is declared but never used · TS6198 all destructured elements unused · TS6199 all variables unused ·
// TS6205 all type parameters unused.
const UNUSED = new Set([6133, 6138, 6192, 6196, 6198, 6199, 6205]);

describe('every game-kit file compiles under a strict app tsconfig (noUnusedLocals + noUnusedParameters)', () => {
  it('no unused-declaration diagnostic in any kit file', () => {
    const dir = makeTempDir('nbai-kit-strict-');
    const paths: string[] = [];
    for (const [p, f] of recipeFilePool()) {
      if (!/\.(?:ts|tsx)$/.test(p) || /\.test\.tsx?$/.test(p)) continue;
      const abs = join(dir, p);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
      paths.push(abs);
    }
    expect(paths.length).toBeGreaterThan(20);
    const program = ts.createProgram(paths, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      strict: true, noUnusedLocals: true, noUnusedParameters: true, noEmit: true, skipLibCheck: true, types: [],
    });
    const found = ts.getPreEmitDiagnostics(program)
      .filter((d) => UNUSED.has(d.code) && d.file)
      .map((d) => {
        const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
        return `${d.file!.fileName.slice(dir.length + 1)}:${line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      });
    expect(found).toEqual([]);
  }, 120_000);
});
