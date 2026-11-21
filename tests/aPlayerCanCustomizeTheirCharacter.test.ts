/**
 * Admin 2026-11-21: "character customization screen banao — par user agar bole to! ham sirf ek game nahi bana rahe, user
 * ke liye game builder bana rahe hai! user jo chahe change bol sakta hai, unexpected!!". A recipe writes a panel into the
 * USER'S game on request; it discovers the parts of ANY model (no fixed skeleton), and every control really changes the
 * model. The generated module is compiled with esbuild and run here with real three.js objects and a minimal DOM.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { transform } from 'esbuild';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { generateCharacterCustomizer, CHARACTER_CUSTOMIZER_PATH } from '../src/server/lib/CharacterCustomizerGenerator';
import { RECIPE_TOOLS, isRecipeName, recipeListing, defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

// ── a minimal DOM: just what the panel touches ──
class FakeEl {
  style: Record<string, string> = {}; children: FakeEl[] = []; attrs: Record<string, string> = {}; listeners: Record<string, (() => void)[]> = {};
  textContent = ''; value = ''; type = ''; checked = false; min = ''; max = ''; step = ''; parent: FakeEl | null = null;
  constructor(public tag: string) {}
  appendChild(c: FakeEl) { c.parent = this; this.children.push(c); return c; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(t: string, f: () => void) { (this.listeners[t] ??= []).push(f); }
  fire(t: string) { for (const f of this.listeners[t] ?? []) f(); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  querySelector(sel: string): FakeEl | null { const m = /\[([\w-]+)\]/.exec(sel); for (const c of this.all()) if (m && m[1] in c.attrs) return c; return null; }
  all(): FakeEl[] { return this.children.flatMap(c => [c, ...c.all()]); }
}
const store = new Map<string, string>();
type Mod = typeof import('./fixtures/characterCustomizerTypes');
let mod: Mod;
let tempDir = '';
afterAll(() => { if (tempDir) rmSync(tempDir, { recursive: true, force: true }); });

beforeAll(async () => {
  (globalThis as Record<string, unknown>).document = { body: new FakeEl('body'), createElement: (t: string) => new FakeEl(t) };
  (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const src = generateCharacterCustomizer().files[CHARACTER_CUSTOMIZER_PATH];
  const js = (await transform(src, { loader: 'ts', format: 'esm' })).code
    .replace(/from ['"]three['"]/, `from ${JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve('three')).href)}`);
  tempDir = mkdtempSync(join(tmpdir(), 'nb-cc-'));
  const file = join(tempDir, 'characterCustomizer.mjs');
  writeFileSync(file, js);
  mod = await import(pathToFileURL(file).href) as Mod;
});

/** A character as a game would have it: two meshes sharing named materials (as a library model does), plus a hood. */
function character() {
  const skin = new THREE.MeshStandardMaterial({ color: '#f1c27d' }); skin.name = 'Skin';
  const clothes = new THREE.MeshStandardMaterial({ color: '#ffffff' }); clothes.name = 'Clothes';
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(), [skin, clothes]); body.name = 'Body';
  const hood = new THREE.Mesh(new THREE.BoxGeometry(), clothes); hood.name = 'Hood';
  root.add(body, hood);
  const played: string[] = [];
  return { handle: { root, play: (r: string) => { played.push(r); return true; } }, skin, clothes, body, hood, played };
}

describe('a character customization panel, written into the user\'s game when they ask', () => {
  it('is a recipe the builder can run, offered only on request, writing one module', () => {
    expect(isRecipeName('generate_character_customizer')).toBe(true);
    expect(RECIPE_TOOLS).toContain('generate_character_customizer');
    const def = defaultToolCatalog().find(t => t.name === 'generate_character_customizer')!;
    expect(def.description).toMatch(/Only on request/);
    expect(def.description).toMatch(/when that is what the user MEANS, whatever the language/);
    expect(recipeListing('generate_character_customizer')).toMatch(/ANY loaded model/);
    const out = generateCharacterCustomizer();
    expect(Object.keys(out.files)).toEqual(['src/game/three/characterCustomizer.ts']);
    expect(out.instructions).toMatch(/applyLook\(handle, loadLook\('player'\)\)/);
    expect(out.instructions).toMatch(/never refuse it and never fake it/);
  });

  it('finds the parts of whatever model it is given: named materials and mesh nodes', () => {
    const { handle } = character();
    expect(mod.partsOf(handle.root)).toEqual({ materials: [{ name: 'Skin', color: '#f1c27d' }, { name: 'Clothes', color: '#ffffff' }], meshes: ['Body', 'Hood'] });
  });

  it('a look recolours, hides and resizes THIS character only — materials are cloned, never shared with another character', () => {
    const a = character(); const b = character();
    b.body.material = a.body.material; b.hood.material = a.hood.material; // two characters loaded from one model share materials
    mod.applyLook(a.handle, { colors: { Clothes: '#d62828' }, hidden: ['Hood'], scale: 1.2, role: 'wave' });
    const aClothes = (a.body.material as THREE.MeshStandardMaterial[])[1];
    expect('#' + aClothes.color.getHexString()).toBe('#d62828');
    expect('#' + (b.body.material as THREE.MeshStandardMaterial[])[1].color.getHexString()).toBe('#ffffff');
    expect(a.hood.visible).toBe(false);
    expect(a.handle.root.scale.x).toBeCloseTo(1.2);
    expect(a.played).toEqual(['wave']);
  });

  it('the panel builds a control for every part, a control really changes the model, and the look is saved and comes back', () => {
    store.clear();
    const c = character();
    const panel = mod.openCharacterCustomizer(c.handle, { id: 'player', roles: ['idle', 'wave'], labels: { title: 'Apna character' } });
    const root = (document.body as unknown as FakeEl).children[0];
    expect(root.attrs['aria-label']).toBe('Apna character');
    const inputs = root.all().filter(e => e.tag === 'input');
    expect(inputs.filter(i => i.type === 'color').map(i => i.attrs['aria-label'])).toEqual(['Skin', 'Clothes']);
    expect(inputs.filter(i => i.type === 'checkbox')).toHaveLength(2);
    expect(root.all().some(e => e.tag === 'select')).toBe(true);
    const clothes = inputs.find(i => i.attrs['aria-label'] === 'Clothes')!;
    clothes.value = '#2a9d8f'; clothes.fire('input');
    expect('#' + (c.body.material as THREE.MeshStandardMaterial[])[1].color.getHexString()).toBe('#2a9d8f');
    const skinSwatch = root.all().find(e => e.tag === 'button' && e.attrs['aria-label'] === 'Skin #8d5524')!;
    skinSwatch.fire('click');
    expect('#' + (c.body.material as THREE.MeshStandardMaterial[])[0].color.getHexString()).toBe('#8d5524');
    panel.close();
    expect((document.body as unknown as FakeEl).children).toHaveLength(0);
    const fresh = character();
    mod.applyLook(fresh.handle, mod.loadLook('player'));
    expect('#' + (fresh.body.material as THREE.MeshStandardMaterial[])[1].color.getHexString()).toBe('#2a9d8f');
  });

  it('a broken saved look is ignored instead of breaking the game', () => {
    store.set('nb-character-look:player', '{not json');
    expect(mod.loadLook('player')).toBeNull();
    store.set('nb-character-look:player', JSON.stringify({ colors: 5 }));
    expect(mod.loadLook('player')).toBeNull();
  });
});
