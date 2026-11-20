// 🔴 failedbr #2478 (2026-11-20, "make a bgmi for me"): the seeded kit's Hud.tsx holds
// `onClick={() => inventory.use(it.id)}` — a METHOD named `use`. The Rules-of-Hooks analyzer read the last segment
// of every callee, so it reported "1 React Rules-of-Hooks violation (crash at runtime): use@src/game/ui/Hud.tsx:407",
// and the builder spent ~15 minutes renaming keys and methods to escape a crash that could not happen, until the
// 25-minute cap stopped the build. The CLASS: a member call counts as a hook only on a PascalCase namespace
// (React.useState, React.use), exactly as eslint-plugin-react-hooks counts it.
import { describe, it, expect } from 'vitest';
import { analyzeHooksRules } from '../src/server/AgentV3/HooksRulesAnalysis';

const HUD = `import { inventory } from '../core/inventory';
export function Hud({ items, open }: { items: { id: string }[]; open: boolean }) {
  if (!open) return null;
  return <ul>{items.map((it) => <li key={it.id}><button onClick={() => inventory.use(it.id)}>use</button></li>)}</ul>;
}
`;

describe('a method named use is not a hook', () => {
  it("the report's exact shape — inventory.use inside a callback after an early return — is clean", async () => {
    const r = await analyzeHooksRules({ 'src/game/ui/Hud.tsx': HUD });
    expect(r.violations).toEqual([]);
  });

  it('lower-case objects never make a hook (this.useX, store.useThing, cache.use)', async () => {
    const src = `export function A({ x }: { x: boolean }) {
  if (x) { store.useThing(); cache.use(1); }
  return null;
}
class B { m() { if (Math.random()) this.useCache(); } }`;
    expect((await analyzeHooksRules({ 'src/A.tsx': src })).violations).toEqual([]);
  });

  it('a real hook on the React namespace is still caught, as is a bare one', async () => {
    const src = `import React, { use, useState } from 'react';
export function C({ x, p }: { x: boolean; p: Promise<number> }) {
  if (x) { React.useState(0); }
  if (x) { use(p); }
  if (x) { useState(1); }
  return null;
}`;
    const r = await analyzeHooksRules({ 'src/C.tsx': src });
    expect(r.violations.map((v) => v.hook).sort()).toEqual(['use', 'useState', 'useState']);
  });
});
