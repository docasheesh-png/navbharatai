/**
 * 🔴 AUTOPSY 57875eb3 (2026-09-17) — THE CONTRACT WAS A PARAGRAPH, SO EVERY FILE GUESSED WHERE IT LIVED.
 *
 * The fast lane designed a shared contract (`enum GameStatus`, `interface PlayerProps`, …) and handed
 * it to eleven isolated per-file calls as PROSE. Nothing said where those symbols lived, because they
 * lived nowhere — the manifest planned no file for them. The generated files then imported the same
 * contract from `../types/game`, `../types/note`, `./types/game` and `./App`, and one re-declared the
 * interfaces inline. None of those modules existed, `tsc` failed on file one, and the repair pass that
 * followed is where the build spent twenty-seven minutes.
 *
 * The 50/50 law: fixing the repair is half. The other half is that the repair was needed at all.
 * These tests pin the upstream fix — the contract becomes a REAL file, written first, named in every
 * prompt with the exact import specifier — and pin what it must not do.
 */
import { describe, it, expect } from 'vitest';
import {
  contractModule, topLevelStatements, contractFilePath, contractImportSpecifier,
  frameworkSupportsContractFile, contractFileEnabled, contractBlock, fileUserPrompt, repairUserPrompt,
  runSimpleBuild, type SimpleFileSpec,
} from '../src/server/AgentV3/SimpleBuilder';
import type { OneShotFile } from '../src/server/AgentV3/OneShotBuilder';

/** The contract the real build designed (trimmed), exactly as the model returned it — fenced. */
const REPORT_CONTRACT = [
  '```typescript',
  'export enum GameStatus {',
  '  MENU = "MENU",',
  '  PLAYING = "PLAYING",',
  '  GAME_OVER = "GAME_OVER"',
  '}',
  '',
  'export enum RoadDirection {',
  '  STRAIGHT = 0,',
  '  LEFT = -1,',
  '  RIGHT = 1',
  '}',
  '',
  'export type GameConfig = {',
  '  width: number;',
  '  height: number;',
  '  fps: number;',
  '  speed: number;',
  '};',
  '',
  'export interface CarProps {',
  '  x: number;',
  '  y: number;',
  '  width: number;',
  '  height: number;',
  '  color: string;',
  '}',
  '',
  'export interface PlayerProps extends CarProps {',
  '  isPlayer: boolean;',
  '  speed: number;',
  '  onMoveLeft: () => void;',
  '  onMoveRight: () => void;',
  '}',
  '```',
].join('\n');

describe('contractModule — the paragraph becomes a module', () => {
  it('keeps every enum, interface and type of the report\'s contract, exported, fences gone', () => {
    const mod = contractModule(REPORT_CONTRACT);
    expect(mod).not.toBeNull();
    expect(mod!.symbols).toEqual(['GameStatus', 'RoadDirection', 'GameConfig', 'CarProps', 'PlayerProps']);
    expect(mod!.source).not.toContain('```');
    expect(mod!.source).toContain('export enum GameStatus {');
    expect(mod!.source).toContain('export interface PlayerProps extends CarProps {');
    expect(mod!.source).toContain('export type GameConfig = {');
    // Enum member values survive intact — a runtime enum is why this is a .ts module, not a .d.ts.
    expect(mod!.source).toContain('GAME_OVER = "GAME_OVER"');
  });

  it('adds `export` where the contract left it out, strips `declare`, demotes `const enum`', () => {
    const mod = contractModule([
      'enum Kind { A, B }',
      'declare interface Shape { id: string }',
      'export const enum Mode { On, Off }',
      'type Id = string;',
    ].join('\n'))!;
    expect(mod.source).toContain('export enum Kind { A, B }');
    expect(mod.source).toContain('export interface Shape { id: string }');
    expect(mod.source).toContain('export enum Mode { On, Off }'); // isolatedModules cannot import an ambient const enum
    expect(mod.source).not.toContain('const enum');
    expect(mod.source).not.toContain('declare ');
    expect(mod.source).toContain('export type Id = string;');
  });

  it('⚠️ DROPS bodiless function signatures — valid in a declaration, a compile error in a module', () => {
    const mod = contractModule([
      'export interface PlayerState { url: string }',
      'export function extractEmbedUrl(url: string): string',
      'declare function parse(x: string): number;',
      'const DEFAULTS: PlayerState;',
    ].join('\n'))!;
    expect(mod.symbols).toEqual(['PlayerState']);
    expect(mod.source).not.toContain('extractEmbedUrl');
    expect(mod.source).not.toContain('parse(');
    expect(mod.source).not.toContain('DEFAULTS');
  });

  it('a contract with nothing to export yields NO file — today\'s behaviour exactly', () => {
    expect(contractModule('')).toBeNull();
    expect(contractModule(undefined)).toBeNull();
    expect(contractModule('export function only(x: string): string')).toBeNull();
    expect(contractModule('// nothing here\n```ts\n```')).toBeNull();
  });

  it('a duplicate declaration keeps the first — two would be a compile error', () => {
    const mod = contractModule('interface A { x: 1 }\ninterface A { x: 2 }')!;
    expect(mod.symbols).toEqual(['A']);
    expect(mod.source).toContain('x: 1');
    expect(mod.source).not.toContain('x: 2');
  });

  it('a contract using the React namespace gets a type-only import, once, unless it imported react itself', () => {
    const a = contractModule('interface P { children: React.ReactNode }')!;
    expect(a.source).toContain("import type * as React from 'react';");
    expect(a.source.split("from 'react'").length - 1).toBe(1);
    const b = contractModule("import type { ReactNode } from 'react';\ninterface P { children: ReactNode }")!;
    expect(b.source).toContain("import type { ReactNode } from 'react';");
    expect(b.source).not.toContain('import type * as React');
    const c = contractModule('interface P { x: number }')!;
    expect(c.source).not.toContain('react');
  });

  it('type aliases that span lines, unions without semicolons, and nested braces all survive', () => {
    const mod = contractModule([
      'type Status =',
      "  | 'idle'",
      "  | 'busy'",
      'interface Nested { a: { b: { c: string } }; fn: (x: string) => void }',
      'type Fn = (a: number, b: number) => { sum: number };',
    ].join('\n'))!;
    expect(mod.symbols).toEqual(['Status', 'Nested', 'Fn']);
    expect(mod.source).toContain("| 'busy'");
    expect(mod.source).toContain('export interface Nested { a: { b: { c: string } }; fn: (x: string) => void }');
  });

  it('topLevelStatements ignores braces and semicolons inside strings and comments', () => {
    const st = topLevelStatements([
      '// a comment with a { brace; and a ;',
      "enum E { A = '}', B = ';' }",
      '/* a; block { comment */ interface I { s: string }',
    ].join('\n'));
    expect(st).toEqual(["enum E { A = '}', B = ';' }", 'interface I { s: string }']);
  });
});

describe('where it lives and how it is imported', () => {
  const src: SimpleFileSpec[] = [{ path: 'src/App.tsx', purpose: 'root' }, { path: 'src/Game.tsx', purpose: 'loop' }];

  it('beside the sources under src/, else at the root', () => {
    expect(contractFilePath(src)).toBe('src/types.ts');
    expect(contractFilePath([{ path: 'app/page.tsx', purpose: 'p' }])).toBe('types.ts');
  });

  it('the specifier is relative to the IMPORTING file, without an extension', () => {
    expect(contractImportSpecifier('src/Game.tsx', 'src/types.ts')).toBe('./types');
    expect(contractImportSpecifier('src/components/Car.tsx', 'src/types.ts')).toBe('../types');
    expect(contractImportSpecifier('app/page.tsx', 'types.ts')).toBe('../types');
    expect(contractImportSpecifier('main.ts', 'types.ts')).toBe('./types');
  });

  it('only for a bundler / TypeScript framework — unknown means NO file, never a file that cannot load', () => {
    for (const fw of ['vite-react', 'react', 'nextjs', 'nuxt', 'sveltekit', 'astro', 'angular', 'typescript']) {
      expect(frameworkSupportsContractFile(fw), fw).toBe(true);
    }
    for (const fw of ['fastapi', 'flask', 'django', 'python', 'rails', 'laravel', 'go', 'spring', '', undefined]) {
      expect(frameworkSupportsContractFile(fw), String(fw)).toBe(false);
    }
  });

  it('the kill switch: `off` restores the prose-only contract, anything else is on', () => {
    expect(contractFileEnabled({})).toBe(true);
    expect(contractFileEnabled({ AGENTV3_CONTRACT_FILE: 'on' })).toBe(true);
    expect(contractFileEnabled({ AGENTV3_CONTRACT_FILE: 'off' })).toBe(false);
    expect(contractFileEnabled({ AGENTV3_CONTRACT_FILE: ' OFF ' })).toBe(false);
  });
});

describe('the prompts name the file — a per-file call can no longer invent a path', () => {
  const manifest: SimpleFileSpec[] = [
    { path: 'src/App.tsx', purpose: 'root' },
    { path: 'src/components/Car.tsx', purpose: 'player car' },
  ];
  const contract = 'export enum GameStatus { MENU, PLAYING }';

  it('the per-file prompt carries the path, the exact specifier for THIS file, and lists the file', () => {
    const p = fileUserPrompt('racing game', manifest[1], manifest, contract, '', 'src/types.ts');
    expect(p).toContain('ALREADY WRITTEN to `src/types.ts`');
    expect(p).toContain('the specifier is `../types`');
    expect(p).toContain('src/types.ts — SHARED CONTRACT (already written)');
    expect(p).toContain('never invent a `types/` folder');
    // The prose contract still travels — the symbols themselves are what the file must use.
    expect(p).toContain('GameStatus');
  });

  it('the repair prompt carries the path too, so a repair does not re-home the symbols', () => {
    const files: OneShotFile[] = [{ path: 'src/App.tsx', content: 'x' }, { path: 'src/types.ts', content: contract }];
    const p = repairUserPrompt('racing game', 'error TS2307: Cannot find module "../types/game"', files, contract, 'contract-full', 'src/types.ts');
    expect(p).toContain('ALREADY WRITTEN to `src/types.ts`');
    expect(p).toContain('relative path from the importing file');
  });

  it('🔒 without a path, both prompts are byte-identical to before', () => {
    const before = fileUserPrompt('app', manifest[0], manifest, contract, '');
    expect(before).not.toContain('ALREADY WRITTEN');
    expect(before).toContain('SHARED CONTRACT — these symbols are FROZEN');
    expect(contractBlock(contract)).toBe(contractBlock(contract, undefined));
    expect(repairUserPrompt('app', 'e', [], contract)).not.toContain('ALREADY WRITTEN');
  });
});

describe('runSimpleBuild — the contract file is written FIRST and every file is told about it', () => {
  const REPORT_MANIFEST = [
    'src/main.tsx :: entry point',
    'src/App.tsx :: main game container',
    'src/Game.tsx :: game loop',
    'src/components/Car.tsx :: player car',
  ].join('\n');
  const deps = (over: Partial<Parameters<typeof runSimpleBuild>[0]> = {}) => {
    const written: OneShotFile[] = [];
    const filePrompts: string[] = [];
    const repairArgs: unknown[][] = [];
    const d = {
      prompt: 'Mujhe ek car racing game banakae do', framework: 'vite-react', scaffoldPaths: ['index.html'],
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return REPORT_MANIFEST;
        if (user.includes('Design the shared contract')) return REPORT_CONTRACT;
        filePrompts.push(user);
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nimport { GameStatus } from '${path.includes('components/') ? '../types' : './types'}';\nexport default function X(){return GameStatus.MENU}\n<<<ENDFILE>>>`;
      },
      writeFiles: async (f: OneShotFile[]) => { written.push(...f); },
      repair: async (...args: unknown[]) => { repairArgs.push(args); return []; },
      ...over,
    };
    return { d, written, filePrompts, repairArgs };
  };

  it('writes src/types.ts with the exported contract, before/alongside the generated files', async () => {
    const { d, written, filePrompts } = deps();
    const logs: string[] = [];
    const r = await runSimpleBuild({ ...d, log: (m) => logs.push(m) });
    expect(r.ok).toBe(true);
    const types = written.find((f) => f.path === 'src/types.ts');
    expect(types).toBeTruthy();
    expect(types!.content).toContain('export enum GameStatus');
    expect(types!.content).toContain('export interface PlayerProps extends CarProps');
    // Every generated file was told the path and its own specifier.
    expect(filePrompts.length).toBe(4);
    for (const p of filePrompts) expect(p).toContain('ALREADY WRITTEN to `src/types.ts`');
    expect(filePrompts.some((p) => p.includes('the specifier is `../types`'))).toBe(true);
    expect(filePrompts.some((p) => p.includes('the specifier is `./types`'))).toBe(true);
    expect(logs.some((l) => l.includes('Wrote the shared contract as src/types.ts') && l.includes('5 shared symbol(s)'))).toBe(true);
  });

  it('the contract file is in the dependency context of every later tier (it is a produced file)', async () => {
    const { d, filePrompts } = deps();
    await runSimpleBuild(d);
    // src/App.tsx is a later tier than src/components/Car.tsx; its prompt sees produced files, and the
    // contract module is one of them — its export surface is offered like any sibling's.
    const app = filePrompts.find((p) => /write THIS file in full:\s*\n\s*src\/App\.tsx/.test(p))!;
    expect(app).toContain('src/types.ts');
  });

  it('a repair receives the contract path as its fifth argument', async () => {
    let v = 0;
    const { d, repairArgs } = deps({ verify: async () => (++v === 1 ? { ok: false, errors: 'error TS2307: x' } : { ok: true, errors: '' }) });
    await runSimpleBuild(d);
    expect(repairArgs.length).toBeGreaterThan(0);
    expect(repairArgs[0][4]).toBe('src/types.ts');
    // …and the repair's file dump includes the contract file, so it can be edited like any other.
    expect((repairArgs[0][1] as OneShotFile[]).some((f) => f.path === 'src/types.ts')).toBe(true);
  });

  it('a planned types file at the same path is SUPERSEDED by the contract — not generated twice', async () => {
    const { d, written, filePrompts } = deps({
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return `src/types.ts :: shared types\n${REPORT_MANIFEST}`;
        if (user.includes('Design the shared contract')) return REPORT_CONTRACT;
        filePrompts.push(user);
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nexport default 1\n<<<ENDFILE>>>`;
      },
    });
    await runSimpleBuild(d);
    expect(written.filter((f) => f.path === 'src/types.ts')).toHaveLength(1);
    expect(written.find((f) => f.path === 'src/types.ts')!.content).toContain('export enum GameStatus');
    expect(filePrompts.some((p) => /write THIS file in full:\s*\n\s*src\/types\.ts/.test(p))).toBe(false);
  });

  it('🔒 the contract file never counts toward "did the model generate enough files?"', async () => {
    // One generated file + the contract must NOT pass a minFiles of 2 — the lane would ship a
    // one-file app as if it were two.
    const { d } = deps({
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Game.tsx :: loop';
        if (user.includes('Design the shared contract')) return REPORT_CONTRACT;
        if (/write THIS file in full:\s*\n\s*src\/Game\.tsx/.test(user)) throw new Error('provider down');
        return '<<<FILE src/App.tsx>>>\nexport default 1\n<<<ENDFILE>>>';
      },
    });
    const r = await runSimpleBuild({ ...d, minFiles: 2 });
    expect(r.ok).toBe(false);
  });

  it('🔒 OFF restores the prose-only contract: no file, no path in any prompt', async () => {
    const prev = process.env.AGENTV3_CONTRACT_FILE;
    process.env.AGENTV3_CONTRACT_FILE = 'off';
    try {
      const { d, written, filePrompts } = deps();
      await runSimpleBuild(d);
      expect(written.some((f) => f.path === 'src/types.ts')).toBe(false);
      for (const p of filePrompts) {
        expect(p).not.toContain('ALREADY WRITTEN');
        expect(p).toContain('SHARED CONTRACT — these symbols are FROZEN');
      }
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_CONTRACT_FILE; else process.env.AGENTV3_CONTRACT_FILE = prev;
    }
  });

  it('🔒 a framework the module cannot be right for gets no file (Python)', async () => {
    const { d, written } = deps({ framework: 'fastapi' });
    await runSimpleBuild(d);
    expect(written.some((f) => f.path === 'src/types.ts')).toBe(false);
  });

  it('🔒 a contract with nothing exportable gets no file (today\'s behaviour)', async () => {
    const { d, written, filePrompts } = deps({
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return REPORT_MANIFEST;
        if (user.includes('Design the shared contract')) return 'export function helper(x: string): string';
        filePrompts.push(user);
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nexport default 1\n<<<ENDFILE>>>`;
      },
    });
    await runSimpleBuild(d);
    expect(written.some((f) => f.path === 'src/types.ts')).toBe(false);
    for (const p of filePrompts) expect(p).not.toContain('ALREADY WRITTEN');
  });
});
