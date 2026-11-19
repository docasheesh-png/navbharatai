// CRAFTING TAKES ALL OR NOTHING (admin 2026-11-19 game-gap audit, P2 crafting). These run the REAL generated
// core/crafting.ts, core/inventory.ts and ui/Hud.tsx: a recipe needs every ingredient, crafting takes them all and puts
// the result in the bag, a missing ingredient takes nothing, and a full stack gives everything back.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';

const DIR = join(__dirname, `.tmp-craft-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let CR: any; let INV: any; let EV: any; let HUD: any;

beforeAll(async () => {
  (globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  (globalThis as any).document = { createElement: () => ({ style: {}, getContext: () => null }), addEventListener() {}, removeEventListener() {} };
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  CR = await import(join(DIR, 'src/game/core/crafting.ts'));
  INV = await import(join(DIR, 'src/game/core/inventory.ts'));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  HUD = await import(join(DIR, 'src/game/ui/Hud.tsx'));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); for (const k of ['localStorage', 'window', 'document']) delete (globalThis as any)[k]; });
beforeEach(() => {
  INV.inventory.clear();
  INV.inventory.define({ wood: { name: 'Wood' }, iron: { name: 'Iron' }, sword: { name: 'Sword', max: 1 } });
  CR.crafting.define([{ id: 'sword', name: 'Sword', needs: { wood: 2, iron: 3 }, makes: { item: 'sword', count: 1 } }, { id: 'planks', name: 'Planks', needs: { wood: 1 }, makes: { item: 'plank', count: 4 } }]);
});

describe('🛠️ crafting', () => {
  it('🔴 a missing ingredient takes nothing; with everything, the ingredients go and the result is in the bag', () => {
    INV.inventory.add('wood', 2); INV.inventory.add('iron', 1);
    expect(CR.crafting.canCraft('sword')).toBe(false);
    expect(CR.crafting.missing('sword')).toEqual([{ item: 'iron', need: 3, have: 1 }]);
    expect(CR.crafting.craft('sword')).toBe(false);
    expect(INV.inventory.count('wood')).toBe(2);
    expect(INV.inventory.count('iron')).toBe(1);
    INV.inventory.add('iron', 2);
    const heard: any[] = [];
    const off = EV.events.on('ITEM_CRAFTED', (p: any) => heard.push(p));
    expect(CR.crafting.craft('sword')).toBe(true);
    expect(INV.inventory.count('wood')).toBe(0);
    expect(INV.inventory.count('iron')).toBe(0);
    expect(INV.inventory.count('sword')).toBe(1);
    expect(heard).toEqual([{ id: 'sword', item: 'sword', count: 1 }]);
    off();
  });
  it('a result with no room in the bag gives every ingredient back', () => {
    INV.inventory.add('sword', 1);   // a sword stack holds one
    INV.inventory.add('wood', 2); INV.inventory.add('iron', 3);
    expect(CR.crafting.craft('sword')).toBe(false);
    expect(INV.inventory.count('wood')).toBe(2);
    expect(INV.inventory.count('iron')).toBe(3);
  });
  it('makes several at once; unknown recipes are refused', () => {
    INV.inventory.add('wood', 1);
    expect(CR.crafting.craft('planks')).toBe(true);
    expect(INV.inventory.count('plank')).toBe(4);
    expect(CR.crafting.craft('nope')).toBe(false);
  });
  it('the bag screen lists each recipe with what it needs, and Craft only works when it can', () => {
    INV.inventory.add('wood', 1);
    const html = renderToStaticMarkup(createElement(HUD.InventoryPanel, { onBack: () => {} }));
    expect(html).toContain('aria-label="Make"');
    expect(html).toContain('Wood 1/2 · Iron 0/3');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Craft<\/button>/);
    expect(html).toMatch(/<button type="button"(?![^>]*disabled)[^>]*>Craft<\/button>/);   // planks can be made
  });
});
