/**
 * THE CHARACTER CUSTOMIZER A USER'S GAME GETS WHEN THEY ASK FOR ONE (admin 2026-11-21: "character customization screen
 * banao — par user agar bole to! ham sirf ek game nahi bana rahe, user ke liye game builder bana rahe hai! user jo chahe
 * change bol sakta hai, unexpected!!").
 *
 * Not a NavBharatAI screen: a recipe (run_recipe generate_character_customizer) that writes ONE framework-free module into
 * the user's game, on request only. It works on ANY model the game loaded — a library character, the user's own .glb, a
 * code-built figure — because it discovers the parts itself (every named material → a colour, every mesh node → a show/
 * hide toggle) instead of assuming a fixed skeleton. Size, a pose/animation picker when the model has roles, colour
 * presets, reset, and the player's choice saved per character (localStorage) and re-applied on the next visit. Every label
 * can be given in the user's language; anything the panel does not cover is added to the same module, never refused.
 * PURE generator: no I/O, no model call.
 */
export const CHARACTER_CUSTOMIZER_PATH = 'src/game/three/characterCustomizer.ts';

const MODULE = String.raw`// Character customizer — written by NavBharatAI on request. Works on any loaded model: library, your own .glb, or code-built.
// openCharacterCustomizer(handle, { id: 'player' }) shows the panel; applyLook(handle, loadLook('player')) re-applies a saved look.
// Add controls freely: every change goes through applyLook, so a new control only needs to write into the look.
import * as THREE from 'three';

export interface CustomizableHandle { root: THREE.Object3D; play?(role: string, fadeSeconds?: number): boolean }
export interface CharacterLook { colors: Record<string, string>; hidden: string[]; scale: number; role?: string }
export interface CustomizerLabels { title: string; colours: string; parts: string; size: string; pose: string; reset: string; done: string }
export interface CustomizerOptions {
  /** One saved look per id ('player', 'hero-2'…). */
  id: string;
  /** Animation roles the model can play (from the library entry or your own list). Empty → no pose picker. */
  roles?: string[];
  /** Ready-made colours per material name, e.g. { Clothes: ['#d62828', '#f4a261'] }. Skin and Hair get sensible defaults. */
  presets?: Record<string, string[]>;
  /** Labels in the player's language. */
  labels?: Partial<CustomizerLabels>;
  /** Where the panel goes (default: document.body). */
  container?: HTMLElement;
  /** Called on every change, e.g. to update a preview camera or a server profile. */
  onChange?(look: CharacterLook): void;
}

const DEFAULT_LABELS: CustomizerLabels = { title: 'Customize', colours: 'Colours', parts: 'Parts', size: 'Size', pose: 'Pose', reset: 'Reset', done: 'Done' };
const DEFAULT_PRESETS: Record<string, string[]> = {
  Skin: ['#f1c27d', '#e0ac69', '#c68642', '#a0663a', '#8d5524', '#5c3a21'],
  Hair: ['#111111', '#3b2a20', '#6b4423', '#a67b5b', '#d8c3a5', '#b55239'],
};
const MAX_COLOURS = 12;
const MAX_PARTS = 16;
const KEY = (id: string) => 'nb-character-look:' + id;

interface Part { name: string; color: string }
/** The parts a player can change, discovered from the model itself: named materials and mesh nodes. */
export function partsOf(root: THREE.Object3D): { materials: Part[]; meshes: string[] } {
  const materials = new Map<string, string>(); const meshes = new Set<string>();
  root.traverse((n: THREE.Object3D) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (n.name) meshes.add(n.name);
    for (const m of ([] as THREE.Material[]).concat(mesh.material ?? [])) {
      const c = (m as THREE.MeshStandardMaterial).color;
      if (m.name && c && !materials.has(m.name)) materials.set(m.name, '#' + c.getHexString());
    }
  });
  return { materials: [...materials].slice(0, MAX_COLOURS).map(([name, color]) => ({ name, color })), meshes: [...meshes].slice(0, MAX_PARTS) };
}

/** Apply a look. Materials are cloned once per mesh first, so recolouring one character never recolours another. */
export function applyLook(handle: CustomizableHandle, look: Partial<CharacterLook> | null | undefined): void {
  if (!look) return;
  handle.root.traverse((n: THREE.Object3D) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.userData.nbOwnMaterials) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone();
      mesh.userData.nbOwnMaterials = true;
    }
    for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
      const wanted = look.colors?.[m.name];
      const c = (m as THREE.MeshStandardMaterial).color;
      if (wanted && c && /^#[0-9a-f]{6}$/i.test(wanted)) c.set(wanted);
    }
    if (n.name) n.visible = !(look.hidden ?? []).includes(n.name);
  });
  if (typeof look.scale === 'number' && Number.isFinite(look.scale)) handle.root.scale.setScalar(Math.min(2, Math.max(0.3, look.scale)));
  if (look.role) handle.play?.(look.role);
}

export function loadLook(id: string): CharacterLook | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY(id));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && v.colors && typeof v.colors === 'object' && Array.isArray(v.hidden) ? v as CharacterLook : null;
  } catch { return null; }
}
export function saveLook(id: string, look: CharacterLook): void {
  try { globalThis.localStorage?.setItem(KEY(id), JSON.stringify(look)); } catch { /* storage full or blocked: the look still applies now */ }
}

/** Show the panel. Returns close() and the current look. Opening twice closes the first panel. */
export function openCharacterCustomizer(handle: CustomizableHandle, options: CustomizerOptions): { close(): void; look(): CharacterLook } {
  const labels = { ...DEFAULT_LABELS, ...(options.labels ?? {}) };
  const found = partsOf(handle.root);
  const original: CharacterLook = { colors: Object.fromEntries(found.materials.map(p => [p.name, p.color])), hidden: [], scale: handle.root.scale.x || 1 };
  let look: CharacterLook = { ...original, colors: { ...original.colors }, ...(loadLook(options.id) ?? {}) };
  const commit = () => { applyLook(handle, look); saveLook(options.id, look); options.onChange?.(look); };

  const host = options.container ?? document.body;
  host.querySelector?.('[data-nb-customizer]')?.remove();
  const el = (tag: string, text?: string) => { const e = document.createElement(tag); if (text) e.textContent = text; return e; };
  const panel = el('div');
  panel.setAttribute('data-nb-customizer', options.id);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', labels.title);
  Object.assign(panel.style, { position: 'fixed', right: '12px', top: '12px', bottom: '12px', width: 'min(320px, calc(100vw - 24px))', overflow: 'auto',
    background: 'rgba(20,22,28,0.92)', color: '#fff', font: '14px system-ui, sans-serif', padding: '14px', borderRadius: '14px', zIndex: '1000' });
  panel.appendChild(el('h2', labels.title));

  if (found.materials.length) {
    panel.appendChild(el('h3', labels.colours));
    for (const part of found.materials) {
      const row = el('label'); row.style.display = 'block'; row.style.margin = '8px 0';
      row.appendChild(el('span', part.name + ' '));
      const input = el('input') as HTMLInputElement;
      input.type = 'color'; input.value = look.colors[part.name] ?? part.color; input.setAttribute('aria-label', part.name);
      input.addEventListener('input', () => { look = { ...look, colors: { ...look.colors, [part.name]: input.value } }; commit(); });
      row.appendChild(input);
      for (const swatch of options.presets?.[part.name] ?? DEFAULT_PRESETS[part.name] ?? []) {
        const b = el('button') as HTMLButtonElement;
        b.type = 'button'; b.setAttribute('aria-label', part.name + ' ' + swatch);
        Object.assign(b.style, { width: '22px', height: '22px', margin: '0 2px', borderRadius: '50%', border: '1px solid #fff', background: swatch });
        b.addEventListener('click', () => { input.value = swatch; look = { ...look, colors: { ...look.colors, [part.name]: swatch } }; commit(); });
        row.appendChild(b);
      }
      panel.appendChild(row);
    }
  }
  if (found.meshes.length > 1) {
    panel.appendChild(el('h3', labels.parts));
    for (const name of found.meshes) {
      const row = el('label'); row.style.display = 'block';
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox'; box.checked = !look.hidden.includes(name);
      box.addEventListener('change', () => { look = { ...look, hidden: box.checked ? look.hidden.filter(h => h !== name) : [...look.hidden, name] }; commit(); });
      row.appendChild(box); row.appendChild(el('span', ' ' + name));
      panel.appendChild(row);
    }
  }
  panel.appendChild(el('h3', labels.size));
  const size = el('input') as HTMLInputElement;
  size.type = 'range'; size.min = '0.5'; size.max = '1.5'; size.step = '0.05'; size.value = String(look.scale); size.setAttribute('aria-label', labels.size);
  size.addEventListener('input', () => { look = { ...look, scale: Number(size.value) }; commit(); });
  panel.appendChild(size);
  if (options.roles?.length && handle.play) {
    panel.appendChild(el('h3', labels.pose));
    const pick = el('select') as HTMLSelectElement; pick.setAttribute('aria-label', labels.pose);
    for (const r of options.roles) { const o = el('option', r) as HTMLOptionElement; o.value = r; pick.appendChild(o); }
    if (look.role) pick.value = look.role;
    pick.addEventListener('change', () => { look = { ...look, role: pick.value }; commit(); });
    panel.appendChild(pick);
  }
  const buttons = el('div'); buttons.style.marginTop = '14px';
  const reset = el('button', labels.reset) as HTMLButtonElement; reset.type = 'button';
  reset.addEventListener('click', () => { look = { ...original, colors: { ...original.colors } }; commit(); close(); openCharacterCustomizer(handle, options); });
  const done = el('button', labels.done) as HTMLButtonElement; done.type = 'button';
  done.addEventListener('click', () => close());
  buttons.appendChild(reset); buttons.appendChild(done); panel.appendChild(buttons);
  host.appendChild(panel);
  applyLook(handle, look);
  function close() { panel.remove(); }
  return { close, look: () => look };
}
`;

export function generateCharacterCustomizer(): { files: Record<string, string>; instructions: string } {
  return {
    files: { [CHARACTER_CUSTOMIZER_PATH]: MODULE },
    instructions:
      `Wrote ${CHARACTER_CUSTOMIZER_PATH} — a character customization panel for ANY loaded model (library, the user's own .glb, or code-built): ` +
      `it finds the model's named materials (colour pickers with presets) and mesh parts (show/hide), plus size, a pose picker when roles are given, ` +
      `reset and done; the player's look is saved per id and re-applied. WIRE IT: import { openCharacterCustomizer, applyLook, loadLook } from './three/characterCustomizer' ` +
      `(adjust the path); right after the character loads call applyLook(handle, loadLook('player')); add a visible "Customize" button (menu or pause screen) that calls ` +
      `openCharacterCustomizer(handle, { id: 'player', roles: <the model's role names, e.g. Object.keys(roles)>, labels: <every label in the user's language> }). ` +
      `For several characters, use one id each. Library characters name their parts plainly (Skin, Hair, Eyes, Clothes; Head, Hood…). ` +
      `If the user wants something the panel does not cover (a name field, outfits, accessories, a turntable preview, a server-saved profile), ADD it to this same module ` +
      `— every change goes through applyLook — never refuse it and never fake it.`,
  };
}
