import { describe, it, expect, afterEach } from 'vitest';
import { cleanPurpose, fullDepsContext, parseManifestContract, resolveManifestImport, topoWaves, transitiveImports, validateManifestContract } from './fastLaneV2';
import { runSimpleBuild, manifestSystemPrompt, generationTier } from '../SimpleBuilder';
import type { OneShotFile } from '../OneShotBuilder';

const MANIFEST = [
  'src/types.ts :: shared types :: exports: Task, Filter :: imports: none',
  'src/hooks/useTasks.ts :: task state :: exports: useTasks :: imports: src/types.ts',
  'src/components/TaskList.tsx :: list :: exports: TaskList :: imports: src/types.ts, src/hooks/useTasks.ts',
  'src/App.tsx :: root :: exports: default :: imports: src/components/TaskList, src/hooks/useTasks.ts, src/missing.ts',
  'src/index.css :: styles',
].join('\n');
const PATHS = ['src/types.ts', 'src/hooks/useTasks.ts', 'src/components/TaskList.tsx', 'src/App.tsx', 'src/index.css'];

describe('fast lane v2 — contract parsing + validation', () => {
  it('parses exports/imports and cleans the purpose', () => {
    const c = parseManifestContract(MANIFEST);
    expect(c.get('src/types.ts')).toEqual({ exports: ['Task', 'Filter'], imports: [] });
    expect(c.get('src/components/TaskList.tsx')?.imports).toEqual(['src/types.ts', 'src/hooks/useTasks.ts']);
    expect(cleanPurpose('list :: exports: TaskList :: imports: a.ts')).toBe('list');
  });

  it('resolves loose imports and drops ones outside the plan', () => {
    expect(resolveManifestImport('./src/components/TaskList', PATHS)).toBe('src/components/TaskList.tsx');
    const v = validateManifestContract(PATHS, parseManifestContract(MANIFEST));
    expect(v.imports.get('src/App.tsx')).toEqual(['src/components/TaskList.tsx', 'src/hooks/useTasks.ts']);
    expect(v.dropped).toEqual(['src/App.tsx → src/missing.ts']);
    expect(v.declared).toBe(true);
  });
});

describe('fast lane v2 — topological waves', () => {
  const v = validateManifestContract(PATHS, parseManifestContract(MANIFEST));

  it('every file comes after everything it imports; stylesheets last', () => {
    const waves = topoWaves(PATHS, v.imports, { last: (p) => p.endsWith('.css') });
    expect(waves).toEqual([['src/types.ts'], ['src/hooks/useTasks.ts'], ['src/components/TaskList.tsx'], ['src/App.tsx'], ['src/index.css']]);
  });

  it('breaks a cycle deterministically instead of hanging', () => {
    const imports = new Map([['a.ts', ['b.ts']], ['b.ts', ['a.ts']], ['c.ts', ['a.ts']]]);
    const waves = topoWaves(['a.ts', 'b.ts', 'c.ts'], imports);
    expect(waves.flat().sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(waves.flat().indexOf('c.ts')).toBeGreaterThan(waves.flat().indexOf('a.ts'));
  });

  it('with no declared imports it falls back to the path tiers', () => {
    const waves = topoWaves(PATHS, new Map(), { declared: false, fallbackTier: generationTier, last: (p) => p.endsWith('.css') });
    expect(waves[0]).toContain('src/types.ts');
    expect(waves[waves.length - 1]).toEqual(['src/index.css']);
  });
});

describe('fast lane v2 — full dependency code', () => {
  it('gives the FULL code of transitive imports (nearest first) and signatures for the rest', () => {
    const imports = new Map([['App.tsx', ['List.tsx']], ['List.tsx', ['types.ts']]]);
    expect(transitiveImports('App.tsx', imports)).toEqual(['List.tsx', 'types.ts']);
    const produced = [
      { path: 'types.ts', content: 'export type T = { id: string };' },
      { path: 'List.tsx', content: 'export function List(p: { items: T[] }) { return null }' },
      { path: 'other.ts', content: 'export const other = 1;' },
    ];
    const block = fullDepsContext('App.tsx', produced, imports, 12_000, (rest) => `SURFACE:${rest.map((f) => f.path).join(',')}`);
    expect(block).toContain('<<<FILE List.tsx>>>');
    expect(block).toContain('<<<FILE types.ts>>>');
    expect(block).toContain('SURFACE:other.ts');
  });

  it('respects the cap', () => {
    const imports = new Map([['a', ['b']]]);
    const block = fullDepsContext('a', [{ path: 'b', content: 'x'.repeat(5_000) }], imports, 1_000, (rest) => `SURFACE:${rest.map((f) => f.path).join(',')}`);
    expect(block).not.toContain('<<<FILE b>>>');
    expect(block).toContain('SURFACE:b');
  });
});

describe('fast lane v2 — wired into runSimpleBuild', () => {
  afterEach(() => { delete process.env.AGENTV3_FAST_LANE_V2; delete process.env.AGENTV3_FAST_LANE_MAX_FILES; });

  it('the manifest prompt asks for the contract only when the flag is on', () => {
    expect(manifestSystemPrompt('vite-react')).not.toContain('CONTRACT ON EVERY LINE');
    process.env.AGENTV3_FAST_LANE_V2 = 'on';
    expect(manifestSystemPrompt('vite-react')).toContain('CONTRACT ON EVERY LINE');
  });

  it('a plan above the limit is handed to the full builder', async () => {
    process.env.AGENTV3_FAST_LANE_V2 = 'on';
    process.env.AGENTV3_FAST_LANE_MAX_FILES = '3';
    const r = await runSimpleBuild({
      prompt: 'app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: false,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return MANIFEST;
        return '';
      },
      writeFiles: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toMatch(/manifest_too_large/);
  });

  it('generates in import order and hands each file its imports\' full code', async () => {
    process.env.AGENTV3_FAST_LANE_V2 = 'on';
    const order: string[] = [];
    const sawFullDep: Record<string, boolean> = {};
    let written: OneShotFile[] = [];
    const r = await runSimpleBuild({
      prompt: 'todo app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: false,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return MANIFEST.split('\n').slice(0, 4).join('\n');
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x';
        order.push(path);
        sawFullDep[path] = user.includes('<<<FILE src/hooks/useTasks.ts>>>');
        const body = path === 'src/App.tsx' ? 'export default function App(){return null}' : `export const v${order.length} = 1;`;
        return `<<<FILE ${path}>>>\n${body}\n<<<ENDFILE>>>`;
      },
      writeFiles: async (f: OneShotFile[]) => { written = f; },
    });
    expect(order.indexOf('src/types.ts')).toBeLessThan(order.indexOf('src/hooks/useTasks.ts'));
    expect(order.indexOf('src/hooks/useTasks.ts')).toBeLessThan(order.indexOf('src/components/TaskList.tsx'));
    expect(order.indexOf('src/components/TaskList.tsx')).toBeLessThan(order.indexOf('src/App.tsx'));
    expect(sawFullDep['src/App.tsx']).toBe(true);
    expect(r.ok).toBe(true);
    expect(written.length).toBeGreaterThan(0);
  });
});
