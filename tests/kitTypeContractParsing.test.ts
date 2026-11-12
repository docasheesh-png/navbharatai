import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';
import {
  extractExportedDeclaration, kitTypeContract, KIT_CONTRACT_FILES, KIT_CONTRACT_HEADING, KIT_CONTRACT_NAMES,
} from '../src/server/lib/kitTypeContract';

vi.mock('typescript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('typescript')>();
  return { ...actual, createSourceFile: vi.fn(actual.createSourceFile) };
});
beforeEach(() => { vi.mocked(ts.createSourceFile).mockClear(); });

const objectFile = 'src/game/three/objects.ts';
const names = ['createRoad', 'createHouse', 'createTree', 'createMountain'];
const source = `
export function createRoad(x: number): number;
export function createRoad(x: string): string;
export function createRoad(x: number | string): number | string { return x; }
export function createHouse(): { rooms: number } { return { rooms: 2 }; }
export function createTree() { return { leaves: true }; }
export function* createMountain(): Generator<number> { yield 1; }
`;

function referenceSection(file: string, text: string, selectedNames: readonly string[]): string {
  // The unchanged public API parses independently for every callable, exactly as before batching.
  const declarations = selectedNames.map((name) => extractExportedDeclaration(text, name)).filter(Boolean);
  if (!declarations.length) return '';
  return (`// ${file}\n${declarations.join('\n\n')}`).split('\n').map((line) => line ? `  ${line}` : line).join('\n');
}

describe('kit contract parsing reuses only the current immutable source snapshot', () => {
  it('matches independent extraction byte for byte with one identical parser invocation for four callables', () => {
    const expected = `${KIT_CONTRACT_HEADING}\n${referenceSection(objectFile, source, names)}`;
    expect(ts.createSourceFile).toHaveBeenCalledTimes(4);
    vi.mocked(ts.createSourceFile).mockClear();
    expect(kitTypeContract({ [objectFile]: source })).toBe(expected);
    expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
    expect(ts.createSourceFile).toHaveBeenCalledWith('kit.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  });

  it('does not retain ASTs across calls or reuse an earlier source after an edit', () => {
    const first = kitTypeContract({ [objectFile]: source });
    expect(kitTypeContract({ [objectFile]: source })).toBe(first);
    const changed = source.replace('rooms: number', 'rooms: string');
    expect(kitTypeContract({ [objectFile]: changed })).toContain('rooms: string');
    expect(ts.createSourceFile).toHaveBeenCalledTimes(3);
  });

  it('keeps malformed source unquoted and does not parse regex-only type declarations', () => {
    expect(kitTypeContract({ [objectFile]: 'export function createRoad(: {' })).toBe('');
    expect(ts.createSourceFile).toHaveBeenCalledTimes(1);
    vi.mocked(ts.createSourceFile).mockClear();
    // No callable names are selected for this file, so its interface-only contract needs no AST.
    expect(kitTypeContract({ 'src/game/Game.ts': 'export interface GameContext { scene: unknown; }\nexport interface GameOptions { name: string; }' })).toContain('scene: unknown;');
    expect(ts.createSourceFile).not.toHaveBeenCalled();
  });

  it('matches every real recipe contract byte for byte, including both recipes that embed it', () => {
    // Read the existing selection policy rather than keep a second hand-maintained name inventory.
    // Completeness assertions fail if its syntax changes instead of silently checking fewer names.
    const implementation = readFileSync(new URL('../src/server/lib/kitTypeContract.ts', import.meta.url), 'utf8');
    const entries = [...implementation.matchAll(/\{ file: '([^']+)', names: \[([^\]]+)\] \}/g)].map((match) => ({
      file: match[1], names: [...match[2].matchAll(/'([^']+)'/g)].map((name) => name[1]),
    }));
    expect(entries.map((entry) => entry.file)).toEqual(KIT_CONTRACT_FILES);
    expect(entries.flatMap((entry) => entry.names)).toEqual(KIT_CONTRACT_NAMES);
    for (const [name, generate] of Object.entries(GAME_RECIPES)) {
      const recipe = generate() as ReturnType<typeof generate> & { instructions?: string };
      const sections = entries.flatMap((entry) => {
        const text = recipe.files[entry.file];
        return text ? [referenceSection(entry.file, text, entry.names)].filter(Boolean) : [];
      });
      const expected = sections.length ? `${KIT_CONTRACT_HEADING}\n${sections.join('\n\n')}` : '';
      expect(kitTypeContract(recipe.files)).toBe(expected);
      if (name === 'generate_game_3d' || name === 'generate_game_shell') {
        expect(expected).not.toBe('');
        expect(recipe.instructions).toContain(expected);
      }
    }
  });
});
