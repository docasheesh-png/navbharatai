/**
 * 🎬 THE CHARACTER DOES WHAT THE USER ASKS — anything, on the character they chose (admin 2026-11-24: "sadak par padi banduk
 * uthao, ya gate khol kr ghar me ghusna, ya hero khana khaye … navbharatai usi character jo abhi user ne select kiya woh
 * karne lage jo user ne manga hai").
 *
 * Class: an action outside the character's clips was refused ("character ke pas yeh move nahi hai"). An action is now data
 * played on whatever body is shown (play/actions.ts), the kit ships the common ones, and compose_action makes any other one
 * with one model call. These run the REAL kit files on the kit person.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell, GAME_SHELL_MODULES } from '../src/server/lib/GameShellGenerator';
import { GAME_ACTIONS_PATH, LIBRARY_ACTIONS, actionFile, actionKey, validateAction } from '../src/server/lib/GameActionsGenerator';
import { actionPrompt, composeAction, firstJson } from '../src/server/AgentV3/gameAssets/composeAction';
import { ANY_ACTION_NOTE, playerMovesLine } from '../src/server/lib/playerMoves';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-actions-${process.pid}`);
let ACT: any; let HM: any; let EV: any;

beforeAll(async () => {
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameShell()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  // A user's own action, as compose_action writes it.
  const climb = validateAction({ name: 'climb ladder', seconds: 1, keys: [{ t: 0, pose: {} }, { t: 0.5, pose: { rightUpperArm: [-0.2, 1, 0.2] } }, { t: 1, pose: {} }], steps: [{ at: 0.5, do: 'emit', event: 'ladder climbed' }] })!;
  const file = actionFile(climb);
  mkdirSync(dirname(join(DIR, file.path)), { recursive: true });
  writeFileSync(join(DIR, file.path), file.source);
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  HM = await import(join(DIR, 'src/game/three/humanoid.ts'));
  ACT = await import(join(DIR, GAME_ACTIONS_PATH));
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); });

function world() {
  const scene = new THREE.Scene();
  const player = { object: new THREE.Group() };
  scene.add(player.object);
  const hero = HM.createHumanoid({ height: 1.75 });
  player.object.add(hero.root);
  return { ctx: { scene, player, hero } as any, scene, hero };
}
function play(ctx: any, seconds: number) { for (let t = 0; t < seconds; t += 1 / 60) { ctx.hero.update(1 / 60, 0, true); ACT.updateActions(ctx, 1 / 60); } }
function heldBy(item: THREE.Object3D, root: THREE.Object3D) { for (let p: THREE.Object3D | null = item; p; p = p.parent) if (p === root) return true; return false; }

describe('the kit plays any action on the character shown', () => {
  it('🔴 "sadak par padi banduk uthao": the player bends, takes the gun lying nearby and holds it', () => {
    const { ctx, scene, hero } = world();
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5));
    gun.name = 'gun'; gun.userData.pickup = true; gun.position.set(0.8, 0, 0.5);
    scene.add(gun);
    const picked: string[] = [];
    const off = EV.events.on('ITEM_PICKED_UP', (p: { name: string }) => picked.push(p.name));
    expect(ACT.performAction(ctx, 'pick up')).toBe(true);
    let bent = false;
    const rest = hero.joints.spine.quaternion.clone();
    for (let t = 0; t < 1.1; t += 1 / 60) { hero.update(1 / 60, 0, true); ACT.updateActions(ctx, 1 / 60); if (hero.joints.spine.quaternion.angleTo(rest) > 0.2) bent = true; }
    off();
    expect(bent).toBe(true);
    expect(picked).toEqual(['gun']);
    expect(heldBy(gun, hero.root)).toBe(true);
    expect(ACT.heldItem(ctx)).toBe(gun);
  });

  it('🔴 "hero khana khaye": the held food is eaten (ITEM_CONSUMED) and leaves the hand', () => {
    const { ctx, scene } = world();
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.05));
    apple.name = 'apple'; apple.userData.pickup = true; apple.position.set(0.3, 0, 0.3); scene.add(apple);
    ACT.performAction(ctx, 'grab'); play(ctx, 1.1);
    const eaten: string[] = [];
    const off = EV.events.on('ITEM_CONSUMED', (p: { name: string }) => eaten.push(p.name));
    ACT.performAction(ctx, 'eat'); play(ctx, 1.7);
    off();
    expect(eaten).toEqual(['apple']);
    expect(apple.parent).toBeNull();
    expect(ACT.heldItem(ctx)).toBeNull();
  });

  it('🔴 "gate khol kr ghar me ghusna": open reaches a gate the game made (userData.interact) when there is no house door', () => {
    const { ctx, scene } = world();
    const gate = new THREE.Group(); gate.name = 'gate'; gate.position.set(0, 0, 1.2);
    let opened = 0; gate.userData.interact = () => { opened++; };
    scene.add(gate);
    ACT.performAction(ctx, 'open gate'); play(ctx, 0.9);
    expect(opened).toBe(1);
  });

  it('a user\'s own action file is read by itself and plays, emitting its event', () => {
    const { ctx } = world();
    const seen: string[] = [];
    const off = EV.events.on('LADDER_CLIMBED', () => seen.push('climbed'));
    expect(Object.keys(ACT.knownActions())).toContain('climb-ladder');
    expect(ACT.performAction(ctx, 'climb ladder')).toBe(true);
    play(ctx, 1.1); off();
    expect(seen).toEqual(['climbed']);
    expect(ACT.currentAction(ctx)).toBeNull();
  });

  it('an action it does not have is said, not faked', () => {
    const { ctx } = world();
    expect(ACT.performAction(ctx, 'backflip')).toBe(false);
  });

  it('the pose is let go when the action ends: a bone nothing else poses returns to rest', () => {
    const { ctx, hero } = world();
    const rest = hero.joints.neck.quaternion.clone();
    ACT.performAction(ctx, 'bow');
    for (let t = 0; t < 1.3; t += 1 / 60) ACT.updateActions(ctx, 1 / 60);
    ACT.updateActions(ctx, 1 / 60);
    expect(hero.joints.neck.quaternion.angleTo(rest)).toBeLessThan(1e-6);
  });
});

describe('the data is checked, never guessed', () => {
  it('census: every kit action validates to itself and has a unique name', () => {
    const names = new Set<string>();
    for (const a of LIBRARY_ACTIONS) { expect(validateAction(a), a.name).toEqual(a); expect(names.has(a.name)).toBe(false); names.add(a.name); }
  });
  it('unknown limbs, unknown steps and empty plans are dropped or refused', () => {
    expect(validateAction({ name: 'x', keys: [{ t: 0, pose: { tail: [0, 1, 0] } }, { t: 1, pose: {} }] })).toBeNull();
    expect(validateAction({ name: 'x', keys: [{ t: 0, pose: {} }, { t: 1, pose: {} }], steps: [{ at: 0.5, do: 'deleteWorld' }] })).toBeNull();
    expect(validateAction('nope')).toBeNull();
    const v = validateAction({ name: 'Dance Move', seconds: 99, keys: [{ t: 2, pose: { head: [0, 1, 1] } }, { t: -1, pose: {} }] })!;
    expect(v.name).toBe('dance-move'); expect(v.seconds).toBe(6); expect(v.keys.map((k) => k.t)).toEqual([0, 1]);
    expect(actionKey('Open Gate')).toBe('open-door');
  });
});

describe('compose_action: library first, then one model call', () => {
  // 2026-11-26: "climb ladder" joined the move library, so the example of a move the kit LACKS is now juggling.
  it('a kit action asks no model', async () => {
    let asked = 0;
    expect(await composeAction('pick up', '', async () => { asked++; return null; })).toEqual({ kind: 'library', name: 'pick-up' });
    expect(asked).toBe(0);
  });
  it('🔴 an action the kit lacks is designed by the model and written as a file the kit reads', async () => {
    let prompt = '';
    const reply = 'Here: {"name":"juggle","seconds":1,"keys":[{"t":0,"pose":{}},{"t":0.5,"pose":{"leftUpperArm":[0.2,1,0]}},{"t":1,"pose":{}}]} done';
    const made = await composeAction('juggle balls', 'three balls in the air', async (p) => { prompt = p; return { text: reply }; });
    expect(prompt).toMatch(/Action: juggle-balls/);
    expect(made.kind).toBe('made');
    if (made.kind !== 'made') return;
    expect(made.def.name).toBe('juggle-balls');
    expect(made.path).toBe('src/game/actions/juggle-balls.ts');
    expect(made.source).toMatch(/export const ACTION: ActionDef =/);
  });
  it('no answer, or an answer that does not validate, is refused honestly', async () => {
    expect((await composeAction('juggle', '', async () => null)).kind).toBe('refused');
    expect((await composeAction('juggle', '', async () => ({ text: 'I cannot' }))).kind).toBe('refused');
    expect(firstJson('x {"a":{"b":1}} y')).toEqual({ a: { b: 1 } });
    expect(actionPrompt('x', '')).not.toMatch(/undefined/);
  });
});

describe('the builder is told, so it never says "the character lacks this move"', () => {
  it('every moves line says any other action is played or made', () => {
    expect(playerMovesLine(['idle'], ['punch'])).toContain(ANY_ACTION_NOTE);
    expect(playerMovesLine([], [])).toContain(ANY_ACTION_NOTE);
  });
  it('the shell ships actions.ts with Game.ts, says so in its handoff, and the tool is a recipe', async () => {
    const shell = generateGameShell(['game']);
    expect(Object.keys(shell.files)).toContain(GAME_ACTIONS_PATH);
    expect(shell.files['src/game/Game.ts']).toContain('updateActions(this.context, delta);');
    expect(shell.instructions).toMatch(/compose_action/);
    expect(GAME_SHELL_MODULES).toContain('actions');
    const { RECIPE_TOOLS } = await import('../src/server/AgentV3/ToolCatalog');
    expect(RECIPE_TOOLS).toContain('compose_action');
  });
});
