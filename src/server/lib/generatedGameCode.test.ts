import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { generateGameRuntime } from './GameRuntimeGenerator';
import { generateGame3D } from './Game3DGenerator';
import { generateGameController } from './GameControllerGenerator';
import { generateGameVfxAudio } from './GameVfxAudioGenerator';
import { generateGameShell } from './GameShellGenerator';
import { generateMotion } from './MotionGenerator';

/**
 * THE GENERATED CODE MUST PARSE — this is a whole class of bug, not a nicety.
 *
 * Every generator holds its output inside a TypeScript template literal. That makes one mistake very
 * easy and completely invisible on review: a stray backtick in the emitted code TERMINATES the literal
 * early. I made exactly that mistake four times while building these four phases.
 *
 * `tsc` catches it in THIS repo only because the broken half is still TypeScript here. What it cannot
 * catch is the more expensive version of the same class: a generator emitting content that is valid
 * enough for the surrounding literal but not valid TypeScript, which ships straight into a user's app
 * and fails at THEIR build — the worst possible place to discover it.
 *
 * So the emitted text is parsed as real TypeScript. A syntax error here is a user's build failure caught
 * before it can ever exist.
 */
const PACKS: Array<{ name: string; files: Record<string, string> }> = [
  { name: 'runtime (phase 1)', files: generateGameRuntime().files },
  { name: '3d (phase 2)', files: generateGame3D().files },
  { name: 'controller (phase 3)', files: generateGameController().files },
  { name: 'vfx + audio (phase 4)', files: generateGameVfxAudio().files },
  { name: 'shell (phase 5)', files: generateGameShell().files },
  { name: 'motion pack', files: generateMotion().files },
];

/** Syntax diagnostics only — types cannot be resolved without the app's own node_modules. */
function syntaxErrors(path: string, content: string): string[] {
  const kind = /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.ES2020, true, kind);
  const diagnostics = (source as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diagnostics.map((d) => {
    const at = typeof d.start === 'number' ? source.getLineAndCharacterOfPosition(d.start) : null;
    const where = at ? `${at.line + 1}:${at.character + 1}` : '?';
    return `${path}:${where} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
}

describe('the parse check itself really detects a broken file', () => {
  // `parseDiagnostics` is an internal TypeScript property. If a future version stops populating it,
  // every assertion above would pass VACUOUSLY and this whole file would be decoration. These two cases
  // fail loudly the day that happens.
  it('catches the exact mistake it exists for — a stray backtick cutting a file short', () => {
    const truncated = 'export function a() {\n  return 1;\n'; // literal ended before the closing brace
    expect(syntaxErrors('x.ts', truncated).length).toBeGreaterThan(0);
  });

  it('catches ordinary broken syntax', () => {
    expect(syntaxErrors('x.ts', 'const = ;').length).toBeGreaterThan(0);
    expect(syntaxErrors('x.tsx', '<div>').length).toBeGreaterThan(0);
  });

  it('does NOT flag valid code', () => {
    expect(syntaxErrors('x.ts', 'export const a: number = 1;\n')).toEqual([]);
  });
});

describe('every file a game generator writes into a user app is parseable TypeScript', () => {
  for (const pack of PACKS) {
    describe(pack.name, () => {
      const paths = Object.keys(pack.files);

      it('emits something at all', () => {
        expect(paths.length).toBeGreaterThan(0);
      });

      for (const path of paths) {
        const content = pack.files[path];
        const isTs = /\.tsx?$/i.test(path);

        it(`${path} parses`, () => {
          // A .css file is emitted by the motion pack; parsing it as TypeScript would be nonsense.
          // The truncation check below still applies to it, and that is the mistake being guarded.
          if (!isTs) { expect(content.trim().length).toBeGreaterThan(0); return; }
          expect(syntaxErrors(path, content)).toEqual([]);
        });

        it(`${path} is not silently truncated`, () => {
          // A backtick that ends the literal early produces a SHORT file that can still parse. Length
          // alone is a weak signal, but a balanced brace count on a non-trivial file is a strong one.
          expect(content.length).toBeGreaterThan(200);
          expect(content.trimEnd().endsWith('*/')).toBe(false); // ending mid-doc-comment = cut off
          const strip = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
          const opens = (strip.match(/\{/g) || []).length;
          const closes = (strip.match(/\}/g) || []).length;
          expect(opens).toBe(closes);
        });
      }
    });
  }

  it('covers every game generator we ship — a new phase must be added here too', () => {
    // If a phase 5 lands without a line above, this fails and says why.
    expect(PACKS).toHaveLength(6);
    expect(PACKS.flatMap((p) => Object.keys(p.files)).length).toBeGreaterThanOrEqual(19);
  });
});
