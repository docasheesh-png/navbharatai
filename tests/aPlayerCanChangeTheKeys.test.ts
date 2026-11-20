// KEY REBINDING (admin 2026-11-20 game-gap audit: the keys were fixed — a left-handed player, an AZERTY keyboard, or
// someone who wanted Jump on J could not change them). These run the REAL generated core/keybinds.ts with the REAL
// core/input.ts: a rebind reaches the live Input at once, no action is ever left without a key, the choice survives a
// reload, a corrupt save is ignored, and Escape is never given away.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateGameRuntime, GAME_RUNTIME_MODULES } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const DIR = join(__dirname, `.tmp-keybinds-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let K: any;
let I: any;
const store = new Map<string, string>();

class Target {
  private l = new Map<string, Array<(e: any) => void>>();
  addEventListener(t: string, fn: (e: any) => void) { this.l.set(t, [...(this.l.get(t) ?? []), fn]); }
  removeEventListener(t: string, fn: (e: any) => void) { this.l.set(t, (this.l.get(t) ?? []).filter((f) => f !== fn)); }
  key(type: string, code: string) {
    const e = { code, repeat: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const fn of [...(this.l.get(type) ?? [])]) fn(e);
    return e;
  }
  count(t: string) { return (this.l.get(t) ?? []).length; }
}

beforeAll(async () => {
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const { files } = generateGameRuntime(['keybinds']);
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  K = await import(join(DIR, 'src/game/core/keybinds.ts'));
  I = await import(join(DIR, 'src/game/core/input.ts'));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).localStorage; });
beforeEach(() => store.clear());

describe('key rebinding', () => {
  it('ships in the runtime and brings input.ts with it', () => {
    expect(GAME_RUNTIME_MODULES).toContain('keybinds');
    expect(Object.keys(generateGameRuntime(['keybinds']).files)).toEqual(expect.arrayContaining(['src/game/core/keybinds.ts', 'src/game/core/input.ts']));
  });

  it('a rebind reaches the live Input at once: the new key works, the old one does not', () => {
    const keys = K.loadKeyBindings();
    const t = new Target();
    const input = new I.Input(t, keys);
    t.key('keydown', 'Space');
    expect(input.isDown('jump')).toBe(true);
    t.key('keyup', 'Space');
    input.endFrame();
    expect(K.rebindKey(keys, 'jump', 'KeyJ').ok).toBe(true);
    t.key('keydown', 'KeyJ');
    expect(input.wasPressed('jump')).toBe(true);
    t.key('keyup', 'KeyJ');
    input.endFrame();
    t.key('keydown', 'Space');
    expect(input.isDown('jump')).toBe(false);
    expect(input.isDown('drift')).toBe(true); // Space is still Drift's own key
    // The gamepad and mouse keep theirs.
    expect(keys.jump).toContain('Pad:0');
    expect(keys.attack).toContain('Mouse0');
  });

  it('a key taken from another action is moved, and an action left with no key gets the old one', () => {
    const keys = K.loadKeyBindings();
    // F is Attack's main key; give it to Jump.
    const r = K.rebindKey(keys, 'jump', 'KeyF');
    expect(r.takenFrom).toContain('attack');
    expect(K.primaryKey(keys, 'attack')).toBe('KeyJ'); // attack still has J
    // E is Use's only key: taking it leaves Use empty, so Use gets Jump's old key.
    const before = K.primaryKey(keys, 'sprint');
    const r2 = K.rebindKey(keys, 'sprint', 'KeyE');
    expect(r2.takenFrom).toEqual(['interact']);
    expect(r2.gaveOldKeyTo).toEqual(['interact']);
    expect(K.primaryKey(keys, 'interact')).toBe(before);
    for (const a of K.REBINDABLE_ACTIONS) expect(K.primaryKey(keys, a), a).not.toBe('');
  });

  it('the choice survives a reload; reset forgets it', () => {
    const keys = K.loadKeyBindings();
    K.rebindKey(keys, 'left', 'KeyQ');
    const again = K.loadKeyBindings();
    expect(K.primaryKey(again, 'left')).toBe('KeyQ');
    expect(again.left).toContain('Pad:14');
    K.resetKeyBindings(again);
    expect(K.primaryKey(again, 'left')).toBe('KeyA');
    expect(K.primaryKey(K.loadKeyBindings(), 'left')).toBe('KeyA');
  });

  it('a corrupt or hostile save is ignored, never trusted', () => {
    store.set('nb-game-keys-v1', '{not json');
    expect(K.primaryKey(K.loadKeyBindings(), 'jump')).toBe('Space');
    store.set('nb-game-keys-v1', JSON.stringify({ jump: ['Escape', 42, 'Mouse0', 'KeyZ'], pause: ['KeyP'], left: 'KeyQ' }));
    const keys = K.loadKeyBindings();
    expect(keys.jump.filter((c: string) => !c.startsWith('Pad:'))).toEqual(['KeyZ']);
    expect(keys.pause).toContain('Escape'); // pause is not rebindable
    expect(K.primaryKey(keys, 'left')).toBe('KeyA');
  });

  it('Escape and odd keys are refused; only known actions can be rebound', () => {
    const keys = K.loadKeyBindings();
    expect(K.rebindKey(keys, 'jump', 'Escape').ok).toBe(false);
    expect(K.rebindKey(keys, 'jump', 'MediaPlayPause').ok).toBe(false);
    expect(K.rebindKey(keys, 'pause', 'KeyP').ok).toBe(false);
    expect(K.primaryKey(keys, 'jump')).toBe('Space');
  });

  it('a capture takes the next usable key and consumes it; Escape cancels', () => {
    const t = new Target();
    const got: Array<string | null> = [];
    K.captureKey(t, (c: string | null) => got.push(c));
    const e = t.key('keydown', 'MediaPlayPause'); // not usable: still waiting
    expect(got).toEqual([]);
    expect(e.prevented).toBe(true);
    t.key('keydown', 'KeyK');
    expect(got).toEqual(['KeyK']);
    expect(t.count('keydown')).toBe(0);
    K.captureKey(t, (c: string | null) => got.push(c));
    t.key('keydown', 'Escape');
    expect(got).toEqual(['KeyK', null]);
    const cancel = K.captureKey(t, (c: string | null) => got.push(c));
    cancel();
    cancel();
    expect(got).toEqual(['KeyK', null, null]);
  });

  it('labels keys the way a player reads them', () => {
    expect(['KeyW', 'Digit1', 'ArrowUp', 'ShiftLeft', 'Space', ''].map(K.keyLabel)).toEqual(['W', '1', '↑', 'Shift', 'Space', '—']);
  });

  it('the shell builds its Input on the saved keys and shows Controls in Settings', () => {
    const files = generateGameShell().files;
    const game = files['src/game/Game.ts'];
    expect(game).toMatch(/this\.keys = loadKeyBindings\(\);\s*this\.input = new Input\(this\.canvas, this\.keys\);/);
    const hud = files['src/game/ui/Hud.tsx'];
    expect(hud).toMatch(/<SettingsPanel game=\{game\}/);
    expect(hud).toMatch(/<ControlsSection game=\{game\} \/>/);
    expect(hud).toMatch(/captureKey\(window/);
  });
});
