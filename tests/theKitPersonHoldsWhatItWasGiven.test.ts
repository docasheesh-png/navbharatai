// ✋ THE KIT PERSON HOLDS WHAT IT WAS GIVEN (build report #2535, Kadam 1/2, 2026-11-26).
//
// "hero ke haath me ek badi gun banao" was reported done, and nothing was in the hand. One of the causes, found here:
// PLAYER.holds was read ONLY inside the model-character path (createPlayerCharacter → mount). With the kit person — the
// default body — applyPlayerChoice returned at `if (!asksForModel(choice)) return person;` and the gun was dropped without a
// word. The sibling: a model that could not load falls back to the kit person, and its holds were dropped the same way.
//
// THE CLASS: "a body path that silently ignores PLAYER.holds". One implementation now (holdChosen) for every body, and a
// live record (window.__nbHeld) that is written only once an item is really in a hand — what the playtest reads to prove it.
// Runs the REAL generated kit headless.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_PLAYER_BODY_PATH, GAME_PLAYER_BODY } from '../src/server/lib/GamePlayerBodyGenerator';

const DIR = join(__dirname, `.tmp-kit-person-holds-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let PB: any; let CH: any; let HU: any;
beforeAll(async () => {
  (globalThis as any).window = globalThis;
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  PB = await import(join(DIR, GAME_PLAYER_BODY_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  HU = await import(join(DIR, 'src/game/three/humanoid.ts'));
}, 120_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).__nbHeld; });

const game = () => {
  const player = new CH.CharacterController({});
  const hero = HU.createHumanoid({ height: 1.75 });
  player.object.add(hero.root);
  return { player, hero, ctx: { player, hero } };
};
const gun = () => { const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 2))); return { root, source: 'model', update() {}, dispose() {} }; };
const settle = () => new Promise((r) => setTimeout(r, 0));
const under = (o: any, ancestor: any): boolean => { for (let p = o?.parent; p; p = p.parent) if (p === ancestor) return true; return false; };
const held = () => ((globalThis as any).__nbHeld ? (globalThis as any).__nbHeld() : []);

describe('✋ PLAYER.holds with the kit person (the default body)', () => {
  it('the real BR2535 shape — holds with no model — puts the gun in the right hand, at a hand-held size, and records it', async () => {
    const g = game(); const item = gun();
    const body = PB.applyPlayerChoice(g.ctx, { holds: { right: 'rifle' } }, async () => ({ loadRequestedAsset: async () => item }));
    await settle(); await settle();
    expect(under(item.root, g.hero.joints.rightHand)).toBe(true);
    const size = new THREE.Box3().setFromObject(item.root).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.9);       // about a third of 1.75 m, not the 2 m it came in at
    expect(held()).toEqual([{ side: 'right', subject: 'rifle' }]);
    body.dispose();
    expect(item.root.parent).toBe(null);
    expect(held()).toEqual([]);
  });
  it('the left hand too', async () => {
    const g = game(); const item = gun();
    const body = PB.applyPlayerChoice(g.ctx, { holds: { left: 'shield' } }, async () => ({ loadRequestedAsset: async () => item }));
    await settle(); await settle();
    expect(under(item.root, g.hero.joints.leftHand)).toBe(true);
    body.dispose();
  });
  it('an item that is not a saved model is said, and never recorded as held', async () => {
    const g = game();
    const body = PB.applyPlayerChoice(g.ctx, { holds: { right: 'rifle' } }, async () => ({ loadRequestedAsset: async (_s: string, none: () => any) => none() }));
    await settle(); await settle();
    expect(g.hero.joints.rightHand.children.length).toBe(0);
    expect(held()).toEqual([]);
    body.dispose();
  });
  it('a model that could not load falls back to the kit person — and the kit person holds what the model would have', async () => {
    const g = game(); const item = gun();
    const body = PB.applyPlayerChoice(g.ctx, { model: 'knight', holds: { right: 'rifle' } }, async () => ({ loadRequestedAsset: async (s: string, none: () => any) => (s === 'rifle' ? item : none()) }));
    await settle(); await settle(); await settle();
    expect(under(item.root, g.hero.joints.rightHand)).toBe(true);
    expect(held()).toEqual([{ side: 'right', subject: 'rifle' }]);
    body.dispose();
    expect(held()).toEqual([]);
  });
});

describe('census: every body path goes through the one hold loader', () => {
  it('loadRequestedAsset for a held item is called in exactly one place (holdChosen)', () => {
    const fn = GAME_PLAYER_BODY.slice(GAME_PLAYER_BODY.indexOf('function holdChosen('));
    expect(fn.length).toBeGreaterThan(0);
    const holdsReads = GAME_PLAYER_BODY.match(/choice\?\.holds\?\.\[side\]/g) ?? [];
    expect(holdsReads.length, 'a second copy of the holds loop — route it through holdChosen').toBe(2);   // the typeof check and the read, both in holdChosen
    expect(GAME_PLAYER_BODY).not.toMatch(/if \(!asksForModel\(choice\)\) return person;/);
  });
});
