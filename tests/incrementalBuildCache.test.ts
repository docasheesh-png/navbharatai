import { describe, it, expect } from 'vitest';
import {
  hashContent,
  hashFiles,
  diffHashes,
  buildImportGraph,
  impactedFiles,
} from '../src/server/AppMakerLab/IncrementalBuildCache';

/** P-BRE.2 — incremental build cache (pure core). */

describe('IncrementalBuildCache — hashing', () => {
  it('hashContent is deterministic + content-sensitive', () => {
    expect(hashContent('a')).toBe(hashContent('a'));
    expect(hashContent('a')).not.toBe(hashContent('b'));
    expect(hashContent('a')).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
  it('hashFiles maps each file', () => {
    const h = hashFiles({ 'a.ts': 'x', 'b.ts': 'y' });
    expect(Object.keys(h).sort()).toEqual(['a.ts', 'b.ts']);
  });
});

describe('IncrementalBuildCache — diffHashes', () => {
  it('classifies added / changed / removed / unchanged', () => {
    const prev = hashFiles({ 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' });
    const curr = hashFiles({ 'a.ts': '1', 'b.ts': 'CHANGED', 'd.ts': '4' });
    const diff = diffHashes(prev, curr);
    expect(diff.unchanged).toEqual(['a.ts']);
    expect(diff.changed).toEqual(['b.ts']);
    expect(diff.added).toEqual(['d.ts']);
    expect(diff.removed).toEqual(['c.ts']);
  });
  it('treats a null previous map as all-added', () => {
    const diff = diffHashes(null, hashFiles({ 'a.ts': '1' }));
    expect(diff.added).toEqual(['a.ts']);
    expect(diff.unchanged).toEqual([]);
  });
});

describe('IncrementalBuildCache — import graph + impact', () => {
  const files = {
    'src/util.ts': 'export const x = 1;',
    'src/service.ts': "import { x } from './util';\nexport const y = x;",
    'src/App.tsx': "import { y } from './service';\nexport default function App(){ return y; }",
    'src/other.ts': "export const z = 2;",
  };

  it('builds a reverse (dependents) graph from relative imports', () => {
    const g = buildImportGraph(files);
    expect(g['src/util.ts']).toEqual(['src/service.ts']); // service imports util
    expect(g['src/service.ts']).toEqual(['src/App.tsx']); // App imports service
    expect(g['src/other.ts']).toBeUndefined(); // nothing imports other
  });

  it('impactedFiles includes transitive dependents of a change', () => {
    const g = buildImportGraph(files);
    // Changing util impacts util → service → App.
    expect(impactedFiles(['src/util.ts'], g)).toEqual(['src/App.tsx', 'src/service.ts', 'src/util.ts']);
    // Changing an unimported file impacts only itself.
    expect(impactedFiles(['src/other.ts'], g)).toEqual(['src/other.ts']);
  });

  it('ignores bare/external imports (no false edges)', () => {
    const g = buildImportGraph({ 'a.ts': "import React from 'react';" });
    expect(Object.keys(g)).toEqual([]);
  });
});
