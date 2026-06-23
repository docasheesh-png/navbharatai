import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceMemory, extractFacts, getWorkspaceMemory, _clearWorkspaceMemory } from './WorkspaceMemory';

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
