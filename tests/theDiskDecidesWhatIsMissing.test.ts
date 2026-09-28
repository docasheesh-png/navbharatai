/**
 * The disk decides what is missing — autopsy 2720e553, 2026-09-27.
 *
 * The fast lane listed the sandbox ONCE, at its start, and cut the list to 80 entries of an unsorted
 * `find` listing. The foundation guard then decided "package.json is missing" from that list and wrote a
 * generic one over the working scaffold file. The build had to restore a plugin that was already
 * installed ("Restored vite-tsconfig-paths@5.1.4 — a rewrite had dropped it, but it was already
 * installed and in use"), and the dev server was started against config files changed seconds earlier.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureViteReactFoundation, foundationFilesStillAbsent } from '../src/server/AgentV3/FrameworkFoundation';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

/** The four files the reported build wrote, as the lane knew them — no config at all. */
const WRITTEN = {
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': "import App from './App';\nimport './index.css';",
  'src/App.tsx': "import { useState } from 'react';\nexport default function App(){ return null; }",
  'src/index.css': ':root{}',
};

describe('the foundation guard asks the disk before it writes', () => {
  it('🔴 the reported case: a stale list says package.json and vite.config.ts are missing; the disk has them', async () => {
    const planned = ensureViteReactFoundation(WRITTEN, { framework: 'vite-react', existingPaths: [] });
    expect(Object.keys(planned.files)).toEqual(expect.arrayContaining(['package.json', 'vite.config.ts']));
    const onDisk = new Set(['package.json', 'vite.config.ts', 'tsconfig.json']);
    const result = await foundationFilesStillAbsent(planned, async (p) => onDisk.has(p));
    expect(result.keptExisting).toEqual(expect.arrayContaining(['package.json', 'vite.config.ts', 'tsconfig.json']));
    expect(result.files['package.json']).toBeUndefined();
    expect(result.files['vite.config.ts']).toBeUndefined();
    expect(result.added).not.toContain('package.json');
  });

  it('a file genuinely absent is still written — the guard is not switched off, it is made exact', async () => {
    const planned = ensureViteReactFoundation(WRITTEN, { framework: 'vite-react', existingPaths: [] });
    const result = await foundationFilesStillAbsent(planned, async () => false);
    expect(Object.keys(result.files)).toEqual(Object.keys(planned.files));
    expect(result.added).toEqual(planned.added);
    expect(result.keptExisting).toEqual([]);
  });

  it('a probe that throws counts as absent — the same answer a missing file gives', async () => {
    const planned = ensureViteReactFoundation(WRITTEN, { framework: 'vite-react', existingPaths: [] });
    const result = await foundationFilesStillAbsent(planned, async () => { throw new Error('sandbox gone'); });
    expect(Object.keys(result.files)).toEqual(Object.keys(planned.files));
  });
});

describe('the route', () => {
  it('🔴 the lane\'s existence list is the whole listing, not the first 80 of an unsorted one', () => {
    const at = route.indexOf('const scaffold = (await actuator.listFiles(workspaceId).catch(() => [] as string[]))');
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at, at + 200)).not.toMatch(/slice\(0, 80\)/);
  });

  it('checks the disk between planning the foundation and writing it', () => {
    const plan = route.indexOf('const planned = ensureViteReactFoundation(Object.fromEntries(writtenFiles)');
    const check = route.indexOf('foundationFilesStillAbsent(planned,', plan);
    const write = route.indexOf("name: 'write_file', input: { path: p, content: c } }", plan);
    expect(plan).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(plan);
    expect(write).toBeGreaterThan(check);
    expect(route.slice(plan, write)).toMatch(/Object\.entries\(foundation\.files\)|FOUNDATION_KEPT_EXISTING/);
  });
});
