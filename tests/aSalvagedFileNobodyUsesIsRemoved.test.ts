/**
 * AUTOPSY f496c75b (open since 2026-09-30): the fast lane's salvaged `types.ts` and `MathUtils.ts`,
 * importing each other, shipped as dead code after the full builder built a different structure.
 *
 * Now a salvaged file no other file refers to is removed, a pair that only refer to each other goes
 * together, and the app's own production build must pass without them or every file is written back.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deadSalvagedFiles, referenceName, removeDeadSalvage, MAX_DEAD_SALVAGE } from '../src/server/AgentV3/deadSalvage';

const project = (): Record<string, string> => ({
  'index.html': '<script type="module" src="/src/main.ts"></script>',
  'package.json': '{"devDependencies":{"@types/node":"1"},"scripts":{"build":"vite build"}}',
  'src/main.ts': "import { Game } from './game/Game';\nnew Game();",
  'src/game/Game.ts': "import { clamp } from './math';\nexport class Game {}",
  'src/game/math.ts': 'export const clamp = (x: number) => x;',
  // Salvaged by the fast lane and never wired in: they only name each other.
  'src/types.ts': "import { lerp } from './MathUtils';\nexport type V = number;",
  'src/MathUtils.ts': "import type { V } from './types';\nexport const lerp = (a: V) => a;",
});

describe('which salvaged files are dead', () => {
  it('the autopsy pair, which only name each other, are dead together', () => {
    expect(deadSalvagedFiles(['src/types.ts', 'src/MathUtils.ts', 'src/game/math.ts'], project())).toEqual(['src/MathUtils.ts', 'src/types.ts']);
  });

  it('a salvaged file the app imports lives, and so does what it imports', () => {
    const files = project();
    files['src/main.ts'] += "\nimport { lerp } from './MathUtils';";
    expect(deadSalvagedFiles(['src/types.ts', 'src/MathUtils.ts'], files)).toEqual([]);
  });

  it('"@types/…" in package.json does not keep a file called types alive, but a path does', () => {
    expect(deadSalvagedFiles(['src/types.ts'], { ...project(), 'src/MathUtils.ts': '' })).toEqual(['src/types.ts']);
    expect(deadSalvagedFiles(['src/types.ts'], { ...project(), 'src/MathUtils.ts': '', 'src/x.ts': 'await import("./types.ts")' })).toEqual([]);
  });

  it('only salvaged files, never an entry, a config or a framework-routed file', () => {
    const files = { ...project(), 'src/pages/About.tsx': 'x', 'vite.config.ts': 'x', 'src/App.tsx': 'x' };
    expect(deadSalvagedFiles(['src/pages/About.tsx', 'vite.config.ts', 'src/App.tsx', 'src/main.ts'], files)).toEqual([]);
    expect(deadSalvagedFiles([], files)).toEqual([]);
  });

  it('an index file is named by its folder', () => {
    expect(referenceName('src/utils/index.ts')).toBe('utils');
    expect(referenceName('src/MathUtils.ts')).toBe('MathUtils');
  });

  it('a set larger than the cap is treated as a wrong analysis, and nothing is removed', () => {
    const files: Record<string, string> = {};
    const paths = Array.from({ length: MAX_DEAD_SALVAGE + 1 }, (_, i) => `src/dead${i}.ts`);
    for (const p of paths) files[p] = 'export {}';
    expect(deadSalvagedFiles(paths, files)).toEqual([]);
  });
});

describe('the removal is verified and undone when the build disagrees', () => {
  const files = project();
  const dead = ['src/MathUtils.ts', 'src/types.ts'];

  it('removed when the production build passes', async () => {
    const cmds: string[] = [];
    const out = await removeDeadSalvage(dead, files, true, {
      run: async (c) => { cmds.push(c); return { exitCode: 0, stdout: '', stderr: '' }; },
      write: async () => { throw new Error('must not write back'); },
    });
    expect(out).toEqual({ status: 'removed', removed: dead });
    expect(cmds[0]).toBe("rm -f 'src/MathUtils.ts' 'src/types.ts'");
    expect(cmds[1]).toContain('npm run build');
  });

  it('every file is written back when the build fails', async () => {
    const written: Record<string, string> = {};
    const out = await removeDeadSalvage(dead, files, true, {
      run: async (c) => ({ exitCode: c.includes('npm run build') ? 1 : 0, stdout: '', stderr: '' }),
      write: async (p, c) => { written[p] = c; },
    });
    expect(out.status).toBe('reverted');
    expect(written).toEqual({ 'src/MathUtils.ts': files['src/MathUtils.ts'], 'src/types.ts': files['src/types.ts'] });
  });

  it('nothing is touched without a build script to prove it, or for an unsafe path', async () => {
    const io = { run: async () => { throw new Error('must not run'); }, write: async () => {} };
    expect((await removeDeadSalvage(dead, files, false, io)).status).toBe('skipped');
    expect((await removeDeadSalvage(["src/a'; rm -rf /'.ts"], { "src/a'; rm -rf /'.ts": 'x' }, true, io)).status).toBe('skipped');
  });
});

describe('the wiring', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
  it('the salvage handoff records the paths and the end-of-build pass removes, forgets and reports', () => {
    expect(route).toContain('salvagedThisBuild.push(...sb.salvagedPaths);');
    expect(route).toMatch(/deadSalvagedFiles\(salvagedThisBuild, integrityFiles\)/);
    expect(route).toMatch(/deletedThisBuild\.push\(\.\.\.outcome\.removed\)/);
    expect(route).toContain("'DEAD_SALVAGE_REMOVED'");
  });
});

describe('the contract file is a leaf: no value import of another app file (the cycle in f496c75b)', () => {
  it('a relative import becomes type-only; a package import is kept; a side-effect import of an app file goes', async () => {
    const { contractImport } = await import('../src/server/AgentV3/SimpleBuilder');
    expect(contractImport("import { lerp } from './MathUtils'")).toBe("import type { lerp } from './MathUtils';");
    expect(contractImport("import { type A, b } from './a';")).toBe("import type { A, b } from './a';");
    expect(contractImport("import Foo, { a } from '../x';")).toBe("import type Foo from '../x';\nimport type { a } from '../x';");
    expect(contractImport("import type { A } from './a'")).toBe("import type { A } from './a';");
    expect(contractImport("import './styles.css'")).toBeNull();
    expect(contractImport("import { useState } from 'react'")).toBe("import { useState } from 'react';");
  });

  it('the written types module carries no value import of an app file', async () => {
    const { contractModule } = await import('../src/server/AgentV3/SimpleBuilder');
    const mod = contractModule("import { lerp } from './MathUtils';\nexport interface V { x: number }\nexport type L = typeof lerp;")!;
    expect(mod.source).toContain("import type { lerp } from './MathUtils';");
    expect(mod.source).not.toMatch(/^import \{/m);
  });
});
