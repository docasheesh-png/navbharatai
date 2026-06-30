import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceMemory, extractFacts, getWorkspaceMemory, _clearWorkspaceMemory, warmIndexFiles } from './WorkspaceMemory';

describe('extractFacts (artifact indexer)', () => {
  it('extracts exported symbols and React components from a tsx file', () => {
    const facts = extractFacts('src/Button.tsx', [
      "import React from 'react';",
      "import { cn } from '../utils';",
      'export function Button() { return <button/>; }',
      'export const PRIMARY = "blue";',
    ].join('\n'));

    const names = facts.symbols.map((s) => s.name);
    expect(names).toContain('Button');
    expect(names).toContain('PRIMARY');
    // Button is PascalCase in a .tsx file → a component.
    expect(facts.components).toContain('Button');
    expect(facts.components).not.toContain('PRIMARY');
    // External dependency (react), local import (../utils) excluded.
    expect(facts.dependencies).toContain('react');
    expect(facts.dependencies).not.toContain('../utils');
  });

  it('detects routes from server and router code', () => {
    const facts = extractFacts('src/server.ts', [
      "app.get('/api/users', handler);",
      "router.post('/api/login', login);",
    ].join('\n'));
    expect(facts.routes).toContain('/api/users');
    expect(facts.routes).toContain('/api/login');
  });

  it('resolves scoped dependency roots', () => {
    const facts = extractFacts('a.ts', "import x from '@scope/pkg/sub';");
    expect(facts.dependencies).toContain('@scope/pkg');
  });
});

describe('WorkspaceMemory', () => {
  it('builds a project graph and re-indexing a file replaces its facts', () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('a.tsx', 'export const Alpha = 1;');
    expect(mem.graph().components).toContain('Alpha');

    // Re-index the same file with different content → old symbol gone.
    mem.indexFile('a.tsx', 'export const Beta = 2;');
    const g = mem.graph();
    expect(g.components).toContain('Beta');
    expect(g.components).not.toContain('Alpha');
    expect(g.files).toEqual(['a.tsx']);
  });

  it('recall finds symbols, files and past errors by relevance', () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('src/UserCard.tsx', 'export function UserCard(){return null;}');
    mem.recordError('TypeError: cannot read property name of undefined', 'src/UserCard.tsx');

    const bySymbol = mem.recall('UserCard');
    expect(bySymbol[0].type).toBe('symbol');
    expect(bySymbol[0].ref).toBe('UserCard');

    const byError = mem.recall('TypeError');
    expect(byError.some((h) => h.type === 'episode')).toBe(true);

    expect(mem.recall('')).toEqual([]);
    expect(mem.recall('nothingmatchesthis')).toEqual([]);
  });

  it('recall matches a MULTI-WORD query by token overlap (not just contiguous substring)', () => {
    const mem = new WorkspaceMemory();
    mem.recordFix('fixed the countdown timer reset bug', 'src/Timer.tsx');
    // The full phrase "countdown timer logic" is not a contiguous substring of the episode,
    // but the shared tokens "countdown" + "timer" should still surface it.
    const hits = mem.recall('countdown timer logic');
    expect(hits.some((h) => h.type === 'episode' && h.ref.includes('countdown timer'))).toBe(true);
  });

  it('recall keeps an EXACT match ranked above a mere token match (phrase bonus dominates BM25)', () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('src/Invoice.tsx', 'export function Invoice(){ return null; }');
    // An episode that merely mentions the word should never outrank the exact-named symbol.
    mem.recordNote('refactored the invoice rendering and invoice totals and invoice export');
    const hits = mem.recall('Invoice');
    expect(hits[0].type).toBe('symbol');
    expect(hits[0].ref).toBe('Invoice');
  });

  it('recall is deterministic (same query → identical ordering)', () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('src/A.tsx', 'export function Alpha(){return null;}');
    mem.recordFix('fixed the alpha timer', 'src/A.tsx');
    mem.recordNote('alpha layout pass');
    const a = mem.recall('alpha').map((h) => h.ref);
    const b = mem.recall('alpha').map((h) => h.ref);
    expect(a).toEqual(b);
  });

  it('recall ranks a RARE discriminating token above a common one (BM25 IDF)', () => {
    const mem = new WorkspaceMemory();
    // "page" is common across the corpus; "stripe" is rare and discriminating.
    mem.recordNote('built the home page layout');
    mem.recordNote('built the about page layout');
    mem.recordNote('built the contact page layout');
    mem.recordFix('wired the stripe page checkout', 'src/Checkout.tsx');
    const hits = mem.recall('stripe page').filter((h) => h.type === 'episode');
    // The episode carrying the rare token "stripe" must rank first, not a generic "page" note.
    expect(hits[0].ref).toContain('stripe');
  });

  it('recall ranks a more RECENT matching episode above an older one at equal relevance', () => {
    const mem = new WorkspaceMemory();
    mem.recordNote('timer feature first pass');
    // Force a later timestamp deterministically by advancing the clock.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 60_000;
      mem.recordNote('timer feature second pass');
    } finally {
      Date.now = realNow;
    }
    const hits = mem.recall('timer').filter((h) => h.type === 'episode');
    expect(hits[0].ref).toContain('second pass'); // newer wins the tie
  });

  it('recall ignores stopwords so the query ranks on the meaningful token', () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('src/Dashboard.tsx', 'export function Dashboard(){ return null; }');
    const hits = mem.recall('please make the Dashboard for me');
    expect(hits[0]?.ref).toBe('Dashboard');
  });

  it('projectMap summarises files, components and recent errors', () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('src/App.tsx', "import react from 'react'; export function App(){return null;}");
    mem.recordError('build failed: missing module');
    const map = mem.projectMap();
    expect(map).toContain('1 files');
    expect(map).toContain('App');
    expect(map).toContain('missing module');
  });
});

describe('getWorkspaceMemory registry', () => {
  beforeEach(() => _clearWorkspaceMemory());

  it('returns the same memory per workspace id and isolates different ids', () => {
    const a1 = getWorkspaceMemory('ws-a');
    a1.indexFile('x.ts', 'export const X = 1;');
    const a2 = getWorkspaceMemory('ws-a');
    expect(a2.graph().symbols.map((s) => s.name)).toContain('X');

    const b = getWorkspaceMemory('ws-b');
    expect(b.graph().files).toEqual([]);
  });
});

describe('warmIndexFiles (edit-session resume pre-indexing)', () => {
  it('indexes code files from the tree into a cold memory so recall works', async () => {
    const mem = new WorkspaceMemory();
    const files: Record<string, string> = {
      'src/Login.tsx': 'export function Login(){ return null; }',
      'src/utils.ts': 'export const helper = 1;',
      'README.md': '# docs',          // not code → skipped
      'package.json': '{"name":"x"}', // not code → skipped
    };
    const indexed = await warmIndexFiles(mem, Object.keys(files), (p) => Promise.resolve(files[p]));

    expect(indexed).toContain('src/Login.tsx');
    expect(indexed).toContain('src/utils.ts');
    expect(indexed).not.toContain('README.md');
    expect(indexed).not.toContain('package.json');
    // recall now resolves the existing component without the agent re-reading it.
    expect(mem.recall('Login')[0]?.ref).toBe('Login');
  });

  it('does NOT re-read files already in the graph (warm memory ⇒ zero reads)', async () => {
    const mem = new WorkspaceMemory();
    mem.indexFile('src/A.tsx', 'export function A(){ return null; }');
    const reads: string[] = [];
    const indexed = await warmIndexFiles(mem, ['src/A.tsx'], (p) => { reads.push(p); return Promise.resolve('x'); });

    expect(reads).toEqual([]);      // already known → not read again
    expect(indexed).toEqual([]);
  });

  it('respects the file-count cap', async () => {
    const mem = new WorkspaceMemory();
    const tree = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
    const indexed = await warmIndexFiles(mem, tree, () => Promise.resolve('export const z = 1;'), { maxFiles: 3 });
    expect(indexed.length).toBe(3);
  });

  it('skips files larger than the byte cap', async () => {
    const mem = new WorkspaceMemory();
    const big = 'x'.repeat(1000);
    const indexed = await warmIndexFiles(mem, ['src/big.ts'], () => Promise.resolve(big), { maxBytes: 100 });
    expect(indexed).toEqual([]);
  });

  it('never throws when a file read fails — just skips it', async () => {
    const mem = new WorkspaceMemory();
    const indexed = await warmIndexFiles(mem, ['src/ok.ts', 'src/bad.ts'], (p) => {
      if (p === 'src/bad.ts') return Promise.reject(new Error('ENOENT'));
      return Promise.resolve('export const ok = 1;');
    });
    expect(indexed).toEqual(['src/ok.ts']);
  });
});
