// THE PLAYER DOES WHAT THE USER ASKS — any action, on the character the user chose (admin 2026-11-24: "user jo bole, woh
// agar kit me nahi hai, navbharatai ai ko api call kar ke woh bhi bana sake … sadak par padi banduk uthao, ya gate khol kr
// ghar me ghusna, ya hero khana khaye … navbharatai usi character jo abhi user ne select kiya woh karne lage").
//
// The class this kills: a request was turned down because the character had no animation for it ("character ke pas yeh
// move nahi hai"). An action is now DATA — a few key poses (directions for named limbs) and steps (pick up, open, consume,
// drop, emit) — played on whatever body is shown: the kit person, a library model or the user's own model. The kit ships
// the common actions; anything else is made by NavBharatAI (the compose_action recipe, one model call, validated) and
// saved as src/game/actions/<name>.ts, which this file reads by itself.
//
// Pure generator: the kit file is a string. It is copied into every 3D game with the shell (src/game/play/actions.ts).

export const GAME_ACTIONS_PATH = 'src/game/play/actions.ts';
export const GAME_ACTIONS_DIR = 'src/game/actions';

/** The limbs an action can move. Directions are in the character's own frame: +Z forward, +Y up, -X its right. */
export const ACTION_ROLES = ['rightUpperArm', 'rightForeArm', 'leftUpperArm', 'leftForeArm', 'rightUpLeg', 'rightLeg', 'leftUpLeg', 'leftLeg', 'spine', 'head'] as const;
export type ActionRole = typeof ACTION_ROLES[number];
export const ACTION_STEPS = ['pickUp', 'drop', 'open', 'consume', 'emit'] as const;
export type ActionStepKind = typeof ACTION_STEPS[number];

export interface ActionKey { t: number; pose: Partial<Record<ActionRole, [number, number, number]>> }
export interface ActionStep { at: number; do: ActionStepKind; near?: string; event?: string }
export interface ActionDef { name: string; seconds: number; keys: ActionKey[]; steps?: ActionStep[] }

/** 'Pick Up', 'pick_up' → 'pick-up'. */
export function actionSlug(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

const ALIASES: Readonly<Record<string, string>> = {
  pickup: 'pick-up', grab: 'pick-up', take: 'pick-up', 'pick': 'pick-up', 'pick-it-up': 'pick-up',
  open: 'open-door', 'open-gate': 'open-door', gate: 'open-door', door: 'open-door',
  'drink-water': 'drink', 'eat-food': 'eat', food: 'eat', hello: 'wave', hi: 'wave', 'put-down': 'drop',
};
/** The name an action is kept under, aliases resolved. */
export function actionKey(name: string): string {
  const s = actionSlug(name);
  return ALIASES[s] ?? s;
}

const D = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
/** The actions every game has without asking. A user's own file of the same name wins. */
export const LIBRARY_ACTIONS: readonly ActionDef[] = [
  { name: 'pick-up', seconds: 1.0, keys: [
    { t: 0, pose: {} },
    { t: 0.45, pose: { spine: D(0, 0.55, 0.85), rightUpperArm: D(-0.1, -0.7, 0.7), rightForeArm: D(-0.05, -0.9, 0.4) } },
    { t: 1, pose: {} },
  ], steps: [{ at: 0.45, do: 'pickUp' }] },
  { name: 'drop', seconds: 0.7, keys: [
    { t: 0, pose: {} }, { t: 0.5, pose: { spine: D(0, 0.8, 0.6), rightUpperArm: D(-0.1, -0.7, 0.7), rightForeArm: D(0, -0.8, 0.6) } }, { t: 1, pose: {} },
  ], steps: [{ at: 0.5, do: 'drop' }] },
  { name: 'eat', seconds: 1.6, keys: [
    { t: 0, pose: {} },
    { t: 0.25, pose: { rightUpperArm: D(-0.3, -0.2, 0.9), rightForeArm: D(0.4, 0.85, 0.3), head: D(0, 0.85, 0.5) } },
    { t: 0.45, pose: { rightUpperArm: D(-0.3, -0.5, 0.8), rightForeArm: D(0, -0.2, 1) } },
    { t: 0.65, pose: { rightUpperArm: D(-0.3, -0.2, 0.9), rightForeArm: D(0.4, 0.85, 0.3), head: D(0, 0.85, 0.5) } },
    { t: 1, pose: {} },
  ], steps: [{ at: 0.8, do: 'consume' }] },
  { name: 'drink', seconds: 1.4, keys: [
    { t: 0, pose: {} },
    { t: 0.35, pose: { rightUpperArm: D(-0.3, -0.1, 0.95), rightForeArm: D(0.35, 0.9, 0.25), head: D(0, 1, -0.35) } },
    { t: 0.7, pose: { rightUpperArm: D(-0.3, -0.1, 0.95), rightForeArm: D(0.35, 0.9, 0.25), head: D(0, 1, -0.35) } },
    { t: 1, pose: {} },
  ], steps: [{ at: 0.75, do: 'consume' }] },
  { name: 'open-door', seconds: 0.8, keys: [
    { t: 0, pose: {} }, { t: 0.4, pose: { rightUpperArm: D(-0.15, 0.05, 1), rightForeArm: D(-0.1, 0.1, 1), spine: D(0, 0.95, 0.3) } }, { t: 1, pose: {} },
  ], steps: [{ at: 0.4, do: 'open' }] },
  { name: 'wave', seconds: 1.4, keys: [
    { t: 0, pose: {} },
    { t: 0.2, pose: { rightUpperArm: D(-0.9, 0.45, 0.1), rightForeArm: D(-0.3, 1, 0) } },
    { t: 0.4, pose: { rightUpperArm: D(-0.9, 0.45, 0.1), rightForeArm: D(-0.75, 0.7, 0) } },
    { t: 0.6, pose: { rightUpperArm: D(-0.9, 0.45, 0.1), rightForeArm: D(-0.3, 1, 0) } },
    { t: 0.8, pose: { rightUpperArm: D(-0.9, 0.45, 0.1), rightForeArm: D(-0.75, 0.7, 0) } },
    { t: 1, pose: {} },
  ] },
  { name: 'point', seconds: 1.0, keys: [
    { t: 0, pose: {} }, { t: 0.3, pose: { rightUpperArm: D(-0.2, 0.15, 1), rightForeArm: D(-0.2, 0.15, 1) } },
    { t: 0.75, pose: { rightUpperArm: D(-0.2, 0.15, 1), rightForeArm: D(-0.2, 0.15, 1) } }, { t: 1, pose: {} },
  ] },
  { name: 'raise-hands', seconds: 1.2, keys: [
    { t: 0, pose: {} }, { t: 0.3, pose: { rightUpperArm: D(-0.3, 1, 0), rightForeArm: D(-0.1, 1, 0), leftUpperArm: D(0.3, 1, 0), leftForeArm: D(0.1, 1, 0) } },
    { t: 0.75, pose: { rightUpperArm: D(-0.3, 1, 0), rightForeArm: D(-0.1, 1, 0), leftUpperArm: D(0.3, 1, 0), leftForeArm: D(0.1, 1, 0) } }, { t: 1, pose: {} },
  ] },
  { name: 'bow', seconds: 1.2, keys: [
    { t: 0, pose: {} }, { t: 0.4, pose: { spine: D(0, 0.5, 0.87), head: D(0, 0.3, 0.95) } }, { t: 0.7, pose: { spine: D(0, 0.5, 0.87), head: D(0, 0.3, 0.95) } }, { t: 1, pose: {} },
  ] },
];

const ROLE_SET: ReadonlySet<string> = new Set(ACTION_ROLES);
const STEP_SET: ReadonlySet<string> = new Set(ACTION_STEPS);
const finite3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10) && v.some((n) => n !== 0);

/**
 * Keep only a well-formed action (the input is a model's or a builder's). Unknown limbs and steps are dropped; times are
 * clamped and sorted; an action with fewer than two keys or nothing to do is refused (null) — never guessed. PURE.
 */
export function validateAction(raw: unknown, nameHint?: string): ActionDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = actionSlug(typeof r.name === 'string' && r.name.trim() ? r.name : String(nameHint ?? ''));
  if (!name) return null;
  const secondsRaw = typeof r.seconds === 'number' && Number.isFinite(r.seconds) ? r.seconds : 1;
  const seconds = Math.round(Math.min(6, Math.max(0.2, secondsRaw)) * 100) / 100;
  const keys: ActionKey[] = [];
  for (const k of Array.isArray(r.keys) ? r.keys.slice(0, 12) : []) {
    if (!k || typeof k !== 'object') continue;
    const t = (k as { t?: unknown }).t;
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    const poseRaw = (k as { pose?: unknown }).pose;
    const pose: ActionKey['pose'] = {};
    if (poseRaw && typeof poseRaw === 'object') {
      for (const [role, dir] of Object.entries(poseRaw as Record<string, unknown>)) {
        if (ROLE_SET.has(role) && finite3(dir)) pose[role as ActionRole] = [dir[0], dir[1], dir[2]];
      }
    }
    keys.push({ t: Math.min(1, Math.max(0, t)), pose });
  }
  keys.sort((a, b) => a.t - b.t);
  const steps: ActionStep[] = [];
  for (const s of Array.isArray(r.steps) ? r.steps.slice(0, 8) : []) {
    if (!s || typeof s !== 'object') continue;
    const st = s as Record<string, unknown>;
    if (typeof st.do !== 'string' || !STEP_SET.has(st.do)) continue;
    const at = typeof st.at === 'number' && Number.isFinite(st.at) ? Math.min(1, Math.max(0, st.at)) : 0.5;
    const step: ActionStep = { at, do: st.do as ActionStepKind };
    if (typeof st.near === 'string' && st.near.trim()) step.near = st.near.trim().toLowerCase().slice(0, 32);
    if (st.do === 'emit') {
      const ev = typeof st.event === 'string' ? st.event.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40) : '';
      if (!ev) continue;
      step.event = ev;
    }
    steps.push(step);
  }
  const moves = keys.some((k) => Object.keys(k.pose).length > 0);
  if (keys.length < 2 || (!moves && !steps.length)) return null;
  const out: ActionDef = { name, seconds, keys };
  if (steps.length) out.steps = steps;
  return out;
}

/** The user file for one action: src/game/actions/<name>.ts. PURE. */
export function actionFile(def: ActionDef): { path: string; source: string } {
  return {
    path: `${GAME_ACTIONS_DIR}/${def.name}.ts`,
    source: [
      `// The "${def.name}" action, made by NavBharatAI. performAction(ctx, '${def.name}') plays it on the player's character.`,
      '// Each key is a pose at a point of the action (t from 0 to 1): a direction for each limb in the character\'s own frame',
      '// (+Z forward, +Y up, -X its right). Steps happen at their point: pickUp, drop, open, consume or emit.',
      "import type { ActionDef } from '../play/actions';",
      '',
      `export const ACTION: ActionDef = ${JSON.stringify(def, null, 2)};`,
      '',
    ].join('\n'),
  };
}

export const GAME_ACTIONS = String.raw`// ANY ACTION THE USER ASKS FOR, ON THE CHARACTER THEY CHOSE (admin 2026-11-24: "sadak par padi banduk uthao, ya gate
// khol kr ghar me ghusna, ya hero khana khaye … usi character jo abhi user ne select kiya woh karne lage").
//
//   performAction(ctx, 'pick-up')   // the player bends, takes the nearest pickup (userData.pickup = true, or a name that
//                                   // matches the step's "near") and holds it in the hand
//   performAction(ctx, 'open-door') // pushes the nearest house door (or calls a nearby object's userData.interact())
//   performAction(ctx, 'eat')       // brings the hand to the mouth; a held item is eaten (ITEM_CONSUMED)
// The kit has: pick-up, drop, eat, drink, open-door, wave, point, raise-hands, bow. Any other action is made by
// NavBharatAI and saved as src/game/actions/<name>.ts (export const ACTION) — this file reads that folder by itself, and a
// file there wins over the kit's action of the same name. The shell calls updateActions every step; nothing to wire.
//
// It plays on whatever body is shown: the kit person (its joints) or a model (its skeleton's bones, found by name). An
// action is directions for limbs in the character's own frame, so the same action works on every rig. A body without a
// limb the action needs still does the action's steps, and says once that the pose is partly shown.
import * as THREE from 'three';
import type { GameContext } from '../Game';
import { events } from '../core/events';
import { aimBone, boneKey, playerModelRoot, holdItem } from './playerBody';
import { interactHouseDoor } from '../three/buildings';

export type ActionRole = 'rightUpperArm' | 'rightForeArm' | 'leftUpperArm' | 'leftForeArm' | 'rightUpLeg' | 'rightLeg' | 'leftUpLeg' | 'leftLeg' | 'spine' | 'head';
export interface ActionKey { t: number; pose: Partial<Record<ActionRole, [number, number, number]>> }
export interface ActionStep { at: number; do: 'pickUp' | 'drop' | 'open' | 'consume' | 'emit'; near?: string; event?: string }
export interface ActionDef { name: string; seconds: number; keys: ActionKey[]; steps?: ActionStep[] }

const ROLES: readonly ActionRole[] = ['rightUpperArm', 'rightForeArm', 'leftUpperArm', 'leftForeArm', 'rightUpLeg', 'rightLeg', 'leftUpLeg', 'leftLeg', 'spine', 'head'];
const BONES: Record<ActionRole, readonly string[]> = {
  rightUpperArm: ['rightarm', 'upperarmr', 'rightupperarm', 'armr', 'rupperarm', 'uparmr'],
  rightForeArm: ['rightforearm', 'forearmr', 'lowerarmr', 'rightlowerarm', 'rforearm', 'elbowr'],
  leftUpperArm: ['leftarm', 'upperarml', 'leftupperarm', 'arml', 'lupperarm', 'uparml'],
  leftForeArm: ['leftforearm', 'forearml', 'lowerarml', 'leftlowerarm', 'lforearm', 'elbowl'],
  rightUpLeg: ['rightupleg', 'thighr', 'upperlegr', 'rightupperleg', 'rightthigh', 'uplegr'],
  rightLeg: ['rightleg', 'calfr', 'shinr', 'lowerlegr', 'rightlowerleg', 'rightshin', 'legr'],
  leftUpLeg: ['leftupleg', 'thighl', 'upperlegl', 'leftupperleg', 'leftthigh', 'uplegl'],
  leftLeg: ['leftleg', 'calfl', 'shinl', 'lowerlegl', 'leftlowerleg', 'leftshin', 'legl'],
  spine: ['spine', 'spine1', 'chest', 'upperchest', 'torso'],
  head: ['neck', 'head'],
};
const ALIASES: Record<string, string> = {
  pickup: 'pick-up', grab: 'pick-up', take: 'pick-up', pick: 'pick-up', 'pick-it-up': 'pick-up',
  open: 'open-door', 'open-gate': 'open-door', gate: 'open-door', door: 'open-door',
  'drink-water': 'drink', 'eat-food': 'eat', food: 'eat', hello: 'wave', hi: 'wave', 'put-down': 'drop',
};
export function actionKey(name: string): string {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return ALIASES[s] || s;
}

const LIBRARY: Record<string, ActionDef> = {};
for (const def of (__LIBRARY__ as unknown as ActionDef[])) LIBRARY[def.name] = def;

function userActions(): Record<string, ActionDef> {
  const out: Record<string, ActionDef> = {};
  try {
    const found = import.meta.glob('../actions/*.ts', { eager: true }) as Record<string, { ACTION?: ActionDef }>;
    for (const mod of Object.values(found)) {
      const a = mod && mod.ACTION;
      if (a && typeof a.name === 'string' && Array.isArray(a.keys) && a.keys.length >= 2) out[actionKey(a.name)] = a;
    }
  } catch { /* a bundler without import.meta.glob: the kit's actions only */ }
  return out;
}
let mine: Record<string, ActionDef> | null = null;
/** Every action this game can play, by name: the user's files win over the kit's. */
export function knownActions(): Record<string, ActionDef> {
  if (!mine) mine = userActions();
  return { ...LIBRARY, ...mine };
}

const told = new Set<string>();
function say(id: string, text: string): void {
  if (told.has(id)) return;
  told.add(id);
  console.warn('[action] ' + text);
  try { events.emit('HINT', { id, text, seconds: 5 }); } catch { /* no Hud */ }
}

type Limbs = Partial<Record<ActionRole, THREE.Object3D>>;
/** The limbs of the body shown now: the model's bones by name, else the kit person's joints. */
function limbsOf(ctx: GameContext): { limbs: Limbs; frame: THREE.Object3D | null } {
  const model = playerModelRoot(ctx);
  if (model) {
    const limbs: Limbs = {};
    model.traverse((o) => {
      const key = boneKey(o.name);
      if (!key) return;
      for (const role of ROLES) if (!limbs[role] && BONES[role].includes(key)) limbs[role] = o;
    });
    return { limbs, frame: model };
  }
  const hero = ctx.hero;
  if (!hero) return { limbs: {}, frame: null };
  const j = hero.joints;
  return { limbs: {
    rightUpperArm: j.rightShoulder, rightForeArm: j.rightElbow, leftUpperArm: j.leftShoulder, leftForeArm: j.leftElbow,
    rightUpLeg: j.rightHip, rightLeg: j.rightKnee, leftUpLeg: j.leftHip, leftLeg: j.leftKnee, spine: j.spine, head: j.neck,
  }, frame: hero.root };
}

interface Running { def: ActionDef; t: number; done: Set<number> }
const running = new WeakMap<object, Running>();
const held = new WeakMap<object, THREE.Object3D>();
/** Bones this module turned last step, with the value it set and the value before — undone next step if untouched. */
const turned = new WeakMap<object, Map<THREE.Object3D, { before: THREE.Quaternion; set: THREE.Quaternion }>>();

/** Play an action on the player's character. False when the game has no such action (said once) or no player. */
export function performAction(ctx: GameContext, name: string): boolean {
  const key = actionKey(name);
  const def = knownActions()[key];
  if (!def) { say('action-missing-' + key, 'There is no "' + key + '" action yet. Ask NavBharatAI to make it.'); return false; }
  if (!ctx.player) return false;
  running.set(ctx, { def, t: 0, done: new Set() });
  events.emit('ACTION_STARTED', { name: def.name });
  return true;
}
/** The action playing now, or null. */
export function currentAction(ctx: GameContext): string | null { return running.get(ctx)?.def.name ?? null; }
/** The item the player is holding through an action (pick-up), or null. */
export function heldItem(ctx: GameContext): THREE.Object3D | null { return held.get(ctx) ?? null; }

function feet(ctx: GameContext): THREE.Vector3 { return ctx.player.object.getWorldPosition(new THREE.Vector3()); }
function isMine(ctx: GameContext, o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === ctx.player.object) return true;
  return false;
}
function nearest(ctx: GameContext, test: (o: THREE.Object3D) => boolean, range = 2.5): THREE.Object3D | null {
  const at = feet(ctx);
  let best: THREE.Object3D | null = null, bestD = range;
  const p = new THREE.Vector3();
  ctx.scene.traverse((o) => {
    if (o === ctx.scene || isMine(ctx, o) || !test(o)) return;
    const d = o.getWorldPosition(p).distanceTo(at);
    if (d <= bestD) { bestD = d; best = o; }
  });
  return best;
}

function runStep(ctx: GameContext, def: ActionDef, step: ActionStep): void {
  if (step.do === 'pickUp') {
    const near = step.near;
    const item = nearest(ctx, (o) => o.userData.pickup === true || (!!near && o.name.toLowerCase().includes(near)));
    if (!item) { say('action-nothing-' + def.name, 'There is nothing to pick up here. Walk next to it first.'); return; }
    const before = held.get(ctx);
    if (before) before.removeFromParent();
    if (!holdItem(ctx, item, 'right')) { if (ctx.hero) ctx.hero.hold(item); else return; }
    held.set(ctx, item);
    events.emit('ITEM_PICKED_UP', { name: item.name || 'item', item });
  } else if (step.do === 'drop') {
    const item = held.get(ctx);
    if (!item) return;
    if (ctx.hero) ctx.hero.hold(null);
    const forward = new THREE.Vector3(0, 0, 0.8).applyQuaternion(ctx.player.object.getWorldQuaternion(new THREE.Quaternion()));
    item.removeFromParent();
    item.position.copy(feet(ctx).add(forward));
    item.scale.setScalar(1);
    ctx.scene.add(item);
    held.delete(ctx);
    events.emit('ITEM_DROPPED', { name: item.name || 'item', item });
  } else if (step.do === 'open') {
    const opened = interactHouseDoor(ctx.scene, { feet: feet(ctx), radius: 0.4, height: 1.8 });
    if (!opened) {
      const thing = nearest(ctx, (o) => typeof o.userData.interact === 'function');
      if (thing) { (thing.userData.interact as (c: GameContext) => void)(ctx); events.emit('INTERACTED', { name: thing.name || 'object' }); return; }
      say('action-no-door-' + def.name, 'There is no door here to open. Walk up to it first.');
    }
    events.emit('DOOR_INTERACTED', { opened });
  } else if (step.do === 'consume') {
    const item = held.get(ctx);
    if (!item) { events.emit('ITEM_CONSUMED', { name: 'nothing' }); return; }
    if (ctx.hero) ctx.hero.hold(null);
    item.removeFromParent();
    held.delete(ctx);
    events.emit('ITEM_CONSUMED', { name: item.name || 'item' });
  } else if (step.do === 'emit' && step.event) {
    events.emit(step.event, { action: def.name });
  }
}

const _f = new THREE.Quaternion();
function dirAt(keys: ActionKey[], role: ActionRole, k: number): THREE.Vector3 | null {
  let a: ActionKey | null = null, b: ActionKey | null = null;
  for (const key of keys) { if (key.t <= k) a = key; if (key.t >= k) { b = key; break; } }
  const da = a && a.pose[role], db = b && b.pose[role];
  if (!da && !db) return null;
  if (!da || !db || !a || !b || b.t === a.t) { const d = (da || db)!; return new THREE.Vector3(d[0], d[1], d[2]).normalize(); }
  const s = (k - a.t) / (b.t - a.t);
  return new THREE.Vector3(da[0], da[1], da[2]).normalize().lerp(new THREE.Vector3(db[0], db[1], db[2]).normalize(), s).normalize();
}
/** Weight of a limb's pose at k: full where a key names it, fading toward a key that does not. */
function weightAt(keys: ActionKey[], role: ActionRole, k: number): number {
  let a: ActionKey | null = null, b: ActionKey | null = null;
  for (const key of keys) { if (key.t <= k) a = key; if (key.t >= k) { b = key; break; } }
  const wa = a && a.pose[role] ? 1 : 0, wb = b && b.pose[role] ? 1 : 0;
  if (!a || !b || b.t === a.t) return Math.max(wa, wb);
  const s = (k - a.t) / (b.t - a.t);
  return wa + (wb - wa) * (s * s * (3 - 2 * s));
}

/** Called by the shell every step, after the body has posed itself. */
export function updateActions(ctx: GameContext, dt: number): void {
  let mineTurned = turned.get(ctx);
  if (!mineTurned) { mineTurned = new Map(); turned.set(ctx, mineTurned); }
  // Undo last step's pose on every bone nothing else has posed since (an unanimated bone would otherwise keep it).
  for (const [bone, q] of mineTurned) if (bone.quaternion.equals(q.set)) bone.quaternion.copy(q.before);
  mineTurned.clear();
  const run = running.get(ctx);
  if (!run) return;
  run.t += Number.isFinite(dt) && dt > 0 ? dt : 0;
  const k = Math.min(1, run.t / run.def.seconds);
  (run.def.steps || []).forEach((step, i) => { if (!run.done.has(i) && k >= step.at) { run.done.add(i); runStep(ctx, run.def, step); } });
  const { limbs, frame } = limbsOf(ctx);
  if (frame) {
    frame.updateMatrixWorld(true);
    frame.getWorldQuaternion(_f);
    let missing = false;
    for (const role of ROLES) {
      const dir = dirAt(run.def.keys, role, k);
      if (!dir) continue;
      const bone = limbs[role];
      if (!bone) { missing = true; continue; }
      const before = bone.quaternion.clone();
      if (aimBone(bone, dir.applyQuaternion(_f), weightAt(run.def.keys, role, k))) mineTurned.set(bone, { before, set: bone.quaternion.clone() });
    }
    if (missing) say('action-partial-' + run.def.name, 'Your character has no bone for part of "' + run.def.name + '", so that part of the pose is not shown.');
  }
  if (k >= 1) { running.delete(ctx); events.emit('ACTION_DONE', { name: run.def.name }); }
}
`.replace('__LIBRARY__', JSON.stringify(LIBRARY_ACTIONS));
