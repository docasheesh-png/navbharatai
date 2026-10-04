// CHANGE ENGINE slice 4 (2026-10-04) — before a standard or deep edit, the builder is told which files the
// request plainly names and which files import them, from the app's own import graph.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeImpactSet, renderImpactForBuilder, nameWords } from '../src/server/AgentV3/changeEngine/impactSet';
import { beginChange } from '../src/server/AgentV3/changeEngine/changeSession';
import { __resetEngineeringMemoryCache } from '../src/server/AgentV3/changeEngine/engineeringMemoryStore';
import type { ProjectGraph } from '../src/server/AgentV3/WorkspaceMemory';

const graph: ProjectGraph = {
  files: [
    'src/App.tsx', 'src/main.tsx', 'src/index.css', 'src/pages/CartPage.tsx', 'src/pages/Home.tsx',
    'src/components/CartItem.tsx', 'src/components/Header.tsx', 'src/lib/api.ts', 'src/pages/Orders.tsx',
    'src/pages/Login.tsx', 'src/lib/supabase.ts', 'src/components/Footer.tsx',
  ],
  symbols: [], components: [], routes: [], dependencies: [], references: {},
  imports: {
    'src/main.tsx': ['./App'],
    'src/App.tsx': ['./pages/CartPage', './pages/Home', './pages/Orders', './pages/Login', './components/Header'],
    'src/pages/CartPage.tsx': ['../components/CartItem', '../lib/api'],
    'src/pages/Orders.tsx': ['../lib/api'],
    'src/pages/Login.tsx': ['../lib/supabase'],
  },
};

describe('impact set', () => {
  it('splits file names into words', () => {
    expect(nameWords('src/pages/CartPage.tsx')).toEqual(['cart', 'page']);
  });

  it('a coupon on the cart page names the cart files and what imports them', () => {
    const s = computeImpactSet('add a coupon code box on the cart page', graph, ['feature']);
    expect(s.seeds).toEqual(['src/components/CartItem.tsx', 'src/pages/CartPage.tsx']);
    expect(s.dependents).toEqual(['src/App.tsx', 'src/main.tsx']);
  });

  it('a plural in the request finds the singular file ("orders" → Orders, "carts" → Cart)', () => {
    expect(computeImpactSet('show past orders', graph, ['feature']).seeds).toContain('src/pages/Orders.tsx');
  });

  it('a change KIND reaches its conventional files even when no file is named', () => {
    const s = computeImpactSet('add google login', graph, ['integration']);
    expect(s.seeds).toEqual(expect.arrayContaining(['src/pages/Login.tsx', 'src/lib/supabase.ts', 'src/lib/api.ts']));
  });

  it('names nothing when the request names nothing — never a guess', () => {
    expect(computeImpactSet('make it better', graph, ['local'])).toEqual({ seeds: [], dependents: [] });
    expect(computeImpactSet('anything', null, ['local'])).toEqual({ seeds: [], dependents: [] });
    expect(renderImpactForBuilder({ seeds: [], dependents: [] })).toBe('');
  });

  it('a request that matches half the app named nothing in particular', () => {
    const wide: ProjectGraph = { ...graph, files: graph.files.map((f) => f.replace(/[^/]+$/, 'ThemeWidget$&')) };
    expect(computeImpactSet('change the theme widget', wide, ['cross-cutting']).seeds).toEqual([]);
  });

  it('the builder sees it on a standard edit, fenced as data — and not on a micro edit', async () => {
    __resetEngineeringMemoryCache();
    const std = await beginChange({ workspaceId: 'imp1', prompt: 'add a coupon code box on the cart page', isEdit: true, requested: [], graph });
    expect(std.builderBlock).toMatch(/<<<UNTRUSTED_EXTERNAL_DATA[\s\S]*LIKELY AFFECTED FILES[\s\S]*src\/pages\/CartPage\.tsx/);
    expect(std.reportLine).toMatch(/impact 2 file\(s\) \+ 2 dependent\(s\)/);
    const micro = await beginChange({ workspaceId: 'imp2', prompt: 'make the cart button blue', isEdit: true, requested: [], graph });
    expect(micro.builderBlock).not.toMatch(/LIKELY AFFECTED FILES/);
    const fresh = await beginChange({ workspaceId: 'imp3', prompt: 'add a coupon code box on the cart page', isEdit: false, requested: [], graph });
    expect(fresh.builderBlock).not.toMatch(/LIKELY AFFECTED FILES/);
  });

  it('the route hands the live import graph to the engine', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toMatch(/graph: ctxMem\.graph\(\),/);
  });
});
