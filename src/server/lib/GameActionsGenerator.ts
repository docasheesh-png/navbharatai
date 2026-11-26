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
//
// 2026-11-26 (admin: "sabhi characters ke moves ko character se alag kar do … sirf hero nahi kisi bhi character par"): the
// library grew to 120+ moves (gameMoveLibrary.ts), an action can move the WHOLE body and TOUCH the world (strike, fire,
// throw, push, vehicles), loop or hold, and performAction plays it on ANY character — the player, one NPC, or every NPC of a
// kind ('police', 'villager', 'all').

import { MOVE_ALIASES, MOVE_LIBRARY } from './gameMoveLibrary';

export const GAME_ACTIONS_PATH = 'src/game/play/actions.ts';
export const GAME_ACTIONS_DIR = 'src/game/actions';

/** The limbs an action can move. Directions are in the character's own frame: +Z forward, +Y up, -X its right. */
export const ACTION_ROLES = ['rightUpperArm', 'rightForeArm', 'leftUpperArm', 'leftForeArm', 'rightUpLeg', 'rightLeg', 'leftUpLeg', 'leftLeg', 'spine', 'head'] as const;
export type ActionRole = typeof ACTION_ROLES[number];
/**
 * What a step does to the world at its point of the action (2026-11-26: moves that TOUCH the world, not only pose):
 *   pickUp / drop / consume — an item in the hand; open — the nearest door, gate or interactive thing;
 *   strike — hits what stands in front (a character loses `damage` health and is knocked back, a car or crate is shoved);
 *   push — shoves what is in front without harm; fire — a shot along the way the character faces, hitting the first
 *   character in line; throw — the held item flies; enterVehicle / exitVehicle — into or out of the nearest vehicle;
 *   emit — an UPPER_CASE event the game reacts to.
 */
export const ACTION_STEPS = ['pickUp', 'drop', 'open', 'consume', 'emit', 'strike', 'push', 'fire', 'throw', 'enterVehicle', 'exitVehicle'] as const;
export type ActionStepKind = typeof ACTION_STEPS[number];
/** Where an action can happen: in water, next to a vehicle, sitting in one, or holding an item. */
export const ACTION_REQUIRES = ['water', 'vehicle', 'seated', 'item'] as const;
export type ActionRequires = typeof ACTION_REQUIRES[number];

/**
 * The whole body at a key. rise (metres), pitch (lean forward), roll (tilt to its left) and yaw (twist), in radians, are
 * SHOWN and undone when the action ends; forward / side (metres, +side = its left) and turn (radians) are REAL travel —
 * the total reached at that key. The body pivots at the feet.
 */
export interface ActionBody { rise?: number; pitch?: number; roll?: number; yaw?: number; forward?: number; side?: number; turn?: number }
export const BODY_FIELDS = ['rise', 'pitch', 'roll', 'yaw', 'forward', 'side', 'turn'] as const;
export interface ActionKey { t: number; pose: Partial<Record<ActionRole, [number, number, number]>>; body?: ActionBody }
export interface ActionStep { at: number; do: ActionStepKind; near?: string; event?: string; damage?: number; force?: number }
/**
 * loop: plays again and again until stopAction or the next action (swim, dance, walk). hold: keeps its last pose until then
 * (sit, sleep, aim). requires: refused honestly where it cannot happen (swim on dry land).
 */
export interface ActionDef { name: string; seconds: number; keys: ActionKey[]; steps?: ActionStep[]; loop?: boolean; hold?: boolean; requires?: ActionRequires }

/** 'Pick Up', 'pick_up' → 'pick-up'. */
export function actionSlug(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** The name an action is kept under, aliases resolved (English, Hindi and Hinglish — gameMoveLibrary.ts). */
export function actionKey(name: string): string {
  const s = actionSlug(name);
  return MOVE_ALIASES[s] ?? s;
}

const D = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
/** The first nine actions the kit shipped, unchanged. */
const ORIGINAL_ACTIONS: readonly ActionDef[] = [
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
/**
 * Every action a game has without asking: the original nine, then the move library (120+ moves — gameMoveLibrary.ts).
 * A user's own file of the same name wins. Names are unique (the census test holds it).
 */
export const LIBRARY_ACTIONS: readonly ActionDef[] = [
  ...ORIGINAL_ACTIONS,
  ...MOVE_LIBRARY.filter((m) => !ORIGINAL_ACTIONS.some((o) => o.name === m.name)),
];


const ROLE_SET: ReadonlySet<string> = new Set(ACTION_ROLES);
const STEP_SET: ReadonlySet<string> = new Set(ACTION_STEPS);
const REQUIRES_SET: ReadonlySet<string> = new Set(ACTION_REQUIRES);
const finite3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10) && v.some((n) => n !== 0);
/** The bounds of each body field: metres for rise / forward / side, radians for the rest. */
const BODY_LIMITS: Record<typeof BODY_FIELDS[number], number> = { rise: 2.5, pitch: 7, roll: 7, yaw: 7, forward: 6, side: 6, turn: 7 };
const clampN = (v: number, lim: number): number => Math.round(Math.min(lim, Math.max(-lim, v)) * 1000) / 1000;

function validBody(raw: unknown): ActionBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: ActionBody = {};
  for (const f of BODY_FIELDS) {
    const v = (raw as Record<string, unknown>)[f];
    if (typeof v === 'number' && Number.isFinite(v)) out[f] = clampN(v, BODY_LIMITS[f]);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Keep only a well-formed action (the input is a model's or a builder's). Unknown limbs, body fields and steps are dropped;
 * times and amounts are clamped and sorted; an action with fewer than two keys or nothing to do is refused (null) — never
 * guessed. PURE.
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
    const key: ActionKey = { t: Math.min(1, Math.max(0, t)), pose };
    const body = validBody((k as { body?: unknown }).body);
    if (body) key.body = body;
    keys.push(key);
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
    if (typeof st.damage === 'number' && Number.isFinite(st.damage) && st.damage > 0) step.damage = Math.min(100, Math.round(st.damage));
    if (typeof st.force === 'number' && Number.isFinite(st.force) && st.force > 0) step.force = Math.min(30, Math.round(st.force * 10) / 10);
    steps.push(step);
  }
  const moves = keys.some((k) => Object.keys(k.pose).length > 0 || !!k.body);
  if (keys.length < 2 || (!moves && !steps.length)) return null;
  const out: ActionDef = { name, seconds, keys };
  if (steps.length) out.steps = steps;
  if (r.loop === true) out.loop = true;
  else if (r.hold === true) out.hold = true;
  if (typeof r.requires === 'string' && REQUIRES_SET.has(r.requires)) out.requires = r.requires as ActionRequires;
  return out;
}

/** The user file for one action: src/game/actions/<name>.ts. PURE. */
export function actionFile(def: ActionDef): { path: string; source: string } {
  return {
    path: `${GAME_ACTIONS_DIR}/${def.name}.ts`,
    source: [
      `// The "${def.name}" action, made by NavBharatAI. performAction(ctx, '${def.name}') plays it on the player; performAction(ctx,`,
      `// '${def.name}', 'police') on every police character; performAction(ctx, '${def.name}', entity.object) on one character.`,
      '// Each key is a pose at a point of the action (t from 0 to 1): a direction for each limb in the character\'s own frame',
      '// (+Z forward, +Y up, -X its right), and optionally the whole body (rise, pitch, roll, yaw shown; forward, side, turn',
      '// real travel). Steps happen at their point: pickUp, drop, open, consume, strike, push, fire, throw, enterVehicle,',
      '// exitVehicle or emit.',
      "import type { ActionDef } from '../play/actions';",
      '',
      `export const ACTION: ActionDef = ${JSON.stringify(def, null, 2)};`,
      '',
    ].join('\n'),
  };
}

export const GAME_ACTIONS = String.raw`// ANY ACTION THE USER ASKS FOR, ON ANY CHARACTER (admin 2026-11-24: "sadak par padi banduk uthao, ya gate khol kr ghar me
// ghusna, ya hero khana khaye"; 2026-11-26: "sirf hero nahi kisi bhi character par … police / villagers / bot, user jo bole
// woh kam kare").
//
//   performAction(ctx, 'jump')                  // the player jumps
//   performAction(ctx, 'kick-car')              // the player kicks the car in front of them — it is shoved
//   performAction(ctx, 'swim')                  // only in water (said plainly otherwise); loops until stopAction
//   performAction(ctx, 'dance', 'villager')     // EVERY villager dances (any kind: 'police', 'bot', 'enemy' …)
//   performAction(ctx, 'salute', 'all')         // every character but the player
//   performAction(ctx, 'fire-pistol', npc.object) // one character fires — the first character in line is hit
//   stopAction(ctx, 'villager')                 // ends a loop or a held stance (sit, sleep, aim)
// The kit has 120+ moves (MOVES below: jump, crouch, crawl, roll, swim, dive, punch, kick, flying-kick, block, dodge,
// fire-pistol, fire-rifle, reload, throw-grenade, sword-swing, open-car-door, get-in-car, get-out-car, sit, sleep, dance,
// bhangra, namaste, salute, police-whistle, handcuff …). Any other action is made by NavBharatAI and saved as
// src/game/actions/<name>.ts (export const ACTION) — this file reads that folder by itself, and a file there wins over the
// kit's action of the same name. Hindi and Hinglish names work too ('laat' is kick, 'tairna' is swim). The shell calls
// updateActions every step; nothing to wire.
//
// A character is the player, or anything systems/entities.ts spawned (its object carries userData.actor). It plays on
// whatever body is shown: the kit person (its joints) or a model (its skeleton's bones, found by name). When the character's
// own model has a real clip for the move (a jump, a punch, a swim) — the player's chosen model or an NPC's library model —
// that clip plays instead of the data pose.
import * as THREE from 'three';
import type { GameContext } from '../Game';
import { events } from '../core/events';
import { aimBone, boneKey, playerModelRoot, holdItem, holdInHand, playMove } from './playerBody';
import { interactHouseDoor } from '../three/buildings';
import { isWaterAt } from '../three/surfaces';

export type ActionRole = 'rightUpperArm' | 'rightForeArm' | 'leftUpperArm' | 'leftForeArm' | 'rightUpLeg' | 'rightLeg' | 'leftUpLeg' | 'leftLeg' | 'spine' | 'head';
export interface ActionBody { rise?: number; pitch?: number; roll?: number; yaw?: number; forward?: number; side?: number; turn?: number }
export interface ActionKey { t: number; pose: Partial<Record<ActionRole, [number, number, number]>>; body?: ActionBody }
export type ActionStepKind = 'pickUp' | 'drop' | 'open' | 'consume' | 'emit' | 'strike' | 'push' | 'fire' | 'throw' | 'enterVehicle' | 'exitVehicle';
export interface ActionStep { at: number; do: ActionStepKind; near?: string; event?: string; damage?: number; force?: number }
export interface ActionDef { name: string; seconds: number; keys: ActionKey[]; steps?: ActionStep[]; loop?: boolean; hold?: boolean; requires?: 'water' | 'vehicle' | 'seated' | 'item' }

/** What a character's object exposes (systems/entities.ts sets object.userData.actor to a function returning this). */
interface ActorInfo {
  kind?: string;
  humanoid?: { root: THREE.Object3D; joints: Record<string, THREE.Object3D>; hold: (item: THREE.Object3D | null) => void } | null;
  model?: THREE.Object3D | null;
  health?: { damage: (amount: number, position?: { x: number; y: number; z: number }) => unknown } | null;
}
interface Actor { object: THREE.Object3D; isPlayer: boolean; info: ActorInfo }
/** Who does it: nothing or 'player' = the player; a kind ('police', 'villager'); 'all' = every character but the player; an object; or a list. */
export type Who = undefined | null | string | THREE.Object3D | { object: THREE.Object3D } | ReadonlyArray<string | THREE.Object3D | { object: THREE.Object3D }>;

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
/** The words people type for a move (English, Hindi, Hinglish) — the same table the server uses (gameMoveLibrary.ts). */
const ALIASES: Record<string, string> = __ALIASES__;
export function actionKey(name: string): string {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return ALIASES[s] || s;
}
/** The player's own model clip for a move, where one with the same meaning exists (playerBody's moves). */
const CLIP_MOVE: Record<string, 'jump' | 'swim' | 'dive' | 'punch' | 'kick' | 'block' | 'hit' | 'die' | 'fire' | 'swing' | 'throw' | 'use' | 'slide'> = {
  jump: 'jump', swim: 'swim', dive: 'dive', punch: 'punch', kick: 'kick', block: 'block', 'get-hit': 'hit', die: 'die',
  'fire-pistol': 'fire', 'fire-rifle': 'fire', 'sword-swing': 'swing', throw: 'throw', 'pick-up': 'use', slide: 'slide',
};

const LIBRARY: Record<string, ActionDef> = {};
for (const def of (__LIBRARY__ as unknown as ActionDef[])) LIBRARY[def.name] = def;
/** Every move the kit ships, by name (120+). */
export const MOVES: readonly string[] = Object.keys(LIBRARY);

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

// ── Who: the player, a kind of character, every character, or one ─────────────────────────────────────────────────────
function infoOf(o: THREE.Object3D): ActorInfo | null {
  const f = o.userData && o.userData.actor;
  if (typeof f !== 'function') return null;
  try { return (f as () => ActorInfo)() || null; } catch { return null; }
}
function playerActor(ctx: GameContext): Actor | null {
  return ctx.player && ctx.player.object ? { object: ctx.player.object, isPlayer: true, info: { kind: 'player' } } : null;
}
function actorAt(ctx: GameContext, o: THREE.Object3D): Actor | null {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (ctx.player && p === ctx.player.object) return playerActor(ctx);
    const info = infoOf(p);
    if (info) return { object: p, isPlayer: false, info };
  }
  return null;
}
/** Every character in the scene other than the player. */
function sceneActors(ctx: GameContext): Actor[] {
  const out: Actor[] = [];
  ctx.scene.traverse((o) => {
    if (ctx.player && o === ctx.player.object) return;
    const info = infoOf(o);
    if (info && o.visible !== false) out.push({ object: o, isPlayer: false, info });
  });
  return out;
}
const PLAYER_WORDS = new Set(['', 'player', 'hero', 'me', 'main', 'mera', 'main-character']);
const ALL_WORDS = new Set(['all', 'everyone', 'everybody', 'npc', 'npcs', 'all-npcs', 'sab', 'sabhi', 'characters', 'crowd']);
function singular(k: string): string { return k.endsWith('s') && k.length > 3 ? k.slice(0, -1) : k; }
function resolve(ctx: GameContext, who: Who): Actor[] {
  if (who === undefined || who === null) { const p = playerActor(ctx); return p ? [p] : []; }
  if (Array.isArray(who)) { const out: Actor[] = []; for (const w of who) for (const a of resolve(ctx, w as Who)) if (!out.some((b) => b.object === a.object)) out.push(a); return out; }
  if (who instanceof THREE.Object3D) { const a = actorAt(ctx, who); return a ? [a] : []; }
  if (typeof who === 'object' && (who as { object?: unknown }).object instanceof THREE.Object3D) { const a = actorAt(ctx, (who as { object: THREE.Object3D }).object); return a ? [a] : []; }
  const k = String(who).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
  if (PLAYER_WORDS.has(k)) { const p = playerActor(ctx); return p ? [p] : []; }
  const everyone = sceneActors(ctx);
  if (ALL_WORDS.has(k)) return everyone;
  return everyone.filter((a) => {
    const kind = String(a.info.kind || a.object.name || '').toLowerCase();
    return kind === k || kind === singular(k) || singular(kind) === singular(k);
  });
}

// ── Bodies ────────────────────────────────────────────────────────────────────────────────────────────────────────
type Limbs = Partial<Record<ActionRole, THREE.Object3D>>;
function bonesOf(model: THREE.Object3D): Limbs {
  const limbs: Limbs = {};
  model.traverse((o) => {
    const key = boneKey(o.name);
    if (!key) return;
    for (const role of ROLES) if (!limbs[role] && BONES[role].includes(key)) limbs[role] = o;
  });
  return limbs;
}
function jointsOf(j: Record<string, THREE.Object3D>): Limbs {
  return {
    rightUpperArm: j.rightShoulder, rightForeArm: j.rightElbow, leftUpperArm: j.leftShoulder, leftForeArm: j.leftElbow,
    rightUpLeg: j.rightHip, rightLeg: j.rightKnee, leftUpLeg: j.leftHip, leftLeg: j.leftKnee, spine: j.spine, head: j.neck,
  };
}
/** The limbs of a character's body, and its visual root (the frame the action's directions are in). */
function limbsOf(ctx: GameContext, actor: Actor): { limbs: Limbs; frame: THREE.Object3D | null } {
  if (actor.isPlayer) {
    const model = playerModelRoot(ctx);
    if (model) return { limbs: bonesOf(model), frame: model };
    return ctx.hero ? { limbs: jointsOf(ctx.hero.joints as unknown as Record<string, THREE.Object3D>), frame: ctx.hero.root } : { limbs: {}, frame: null };
  }
  if (actor.info.humanoid) return { limbs: jointsOf(actor.info.humanoid.joints), frame: actor.info.humanoid.root };
  if (actor.info.model) return { limbs: bonesOf(actor.info.model), frame: actor.info.model };
  return { limbs: {}, frame: null };
}
/** A group between the character and its visual root, so whole-body motion never fights the code that faces the body. */
function pivotOf(frame: THREE.Object3D): THREE.Object3D | null {
  const parent = frame.parent;
  if (!parent) return null;
  if (parent.userData.actionPivot) return parent;
  const pivot = new THREE.Group();
  pivot.name = 'action-pivot';
  pivot.userData.actionPivot = true;
  parent.add(pivot);
  pivot.add(frame);
  return pivot;
}

// ── Running actions ───────────────────────────────────────────────────────────────────────────────────────────────
interface Running { def: ActionDef; actor: Actor; t: number; done: Set<number>; cycle: number; real: { forward: number; side: number; turn: number }; clip: boolean; holding: boolean }
const running = new WeakMap<object, Map<THREE.Object3D, Running>>();
const held = new WeakMap<THREE.Object3D, THREE.Object3D>();
/** Bones this module turned last step, with the value it set and the value before — undone next step if untouched. */
const turned = new WeakMap<object, Map<THREE.Object3D, { before: THREE.Quaternion; set: THREE.Quaternion }>>();
const seatedNpc = new WeakMap<THREE.Object3D, THREE.Object3D>();
interface Flying { item: THREE.Object3D; v: THREE.Vector3; floor: number; age: number }
const flying = new WeakMap<object, Flying[]>();

function runsOf(ctx: GameContext): Map<THREE.Object3D, Running> {
  let m = running.get(ctx);
  if (!m) { m = new Map(); running.set(ctx, m); }
  return m;
}
function feetOf(a: Actor): THREE.Vector3 { return a.object.getWorldPosition(new THREE.Vector3()); }
function facingOf(ctx: GameContext, a: Actor): THREE.Vector3 {
  const { frame } = limbsOf(ctx, a);
  const q = (frame || a.object).getWorldQuaternion(new THREE.Quaternion());
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  f.y = 0;
  return f.lengthSq() > 1e-6 ? f.normalize() : new THREE.Vector3(0, 0, 1);
}
function isPartOf(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}
function nearestObject(ctx: GameContext, a: Actor, test: (o: THREE.Object3D) => boolean, range: number, inFront = false): THREE.Object3D | null {
  const at = feetOf(a);
  const fwd = facingOf(ctx, a);
  let best: THREE.Object3D | null = null, bestD = range;
  const p = new THREE.Vector3();
  ctx.scene.traverse((o) => {
    if (o === ctx.scene || isPartOf(o, a.object) || !test(o)) return;
    o.getWorldPosition(p);
    const d = Math.hypot(p.x - at.x, p.z - at.z);
    if (d > bestD) return;
    if (inFront && d > 0.3 && ((p.x - at.x) * fwd.x + (p.z - at.z) * fwd.z) / d < 0.2) return;
    bestD = d; best = o;
  });
  return best;
}
function others(ctx: GameContext, a: Actor): Actor[] {
  const list = sceneActors(ctx).filter((b) => b.object !== a.object);
  if (!a.isPlayer) { const p = playerActor(ctx); if (p) list.push(p); }
  return list;
}
function nearestActorInFront(ctx: GameContext, a: Actor, range: number): Actor | null {
  const at = feetOf(a);
  const fwd = facingOf(ctx, a);
  let best: Actor | null = null, bestD = range;
  for (const b of others(ctx, a)) {
    const p = feetOf(b);
    const d = Math.hypot(p.x - at.x, p.z - at.z);
    if (d > bestD) continue;
    if (d > 0.3 && ((p.x - at.x) * fwd.x + (p.z - at.z) * fwd.z) / d < 0.3) continue;
    bestD = d; best = b;
  }
  return best;
}
const nameHas = (o: THREE.Object3D, word: string): boolean => (o.name || '').toLowerCase().includes(word);
const isVehicle = (o: THREE.Object3D): boolean => o.userData.vehicle === true || /\b(car|bike|truck|bus|jeep|scooter|vehicle|taxi|van)\b/.test((o.name || '').toLowerCase().replace(/[^a-z]+/g, ' '));
function burst(ctx: GameContext, preset: string, at: THREE.Vector3): void {
  try { (ctx.particles as unknown as { burst?: (p: string, x: number, y: number, z: number) => void }).burst?.(preset, at.x, at.y, at.z); } catch { /* effects are a garnish */ }
}
function who(a: Actor): string { return a.isPlayer ? 'player' : String(a.info.kind || a.object.name || 'character'); }

function hurt(ctx: GameContext, by: Actor, target: Actor, damage: number, push: THREE.Vector3): void {
  const at = feetOf(target).add(new THREE.Vector3(0, 1, 0));
  if (damage > 0) {
    if (target.info.health) target.info.health.damage(damage, { x: at.x, y: at.y, z: at.z });
    else if (target.isPlayer) events.emit('PLAYER_STRUCK', { by: who(by), damage });
  }
  target.object.position.add(push);
  burst(ctx, 'impact', at);
}

function meets(ctx: GameContext, a: Actor, def: ActionDef): boolean {
  const need = def.requires;
  if (!need) return true;
  if (need === 'water') {
    const p = feetOf(a);
    if (isWaterAt(p.x, p.z)) return true;
    say('action-needs-water-' + def.name, '"' + def.name + '" needs water — walk into the water first.');
    return false;
  }
  if (need === 'vehicle') {
    if (a.isPlayer ? !!ctx.vehicles?.inReach : !!nearestObject(ctx, a, isVehicle, 4)) return true;
    say('action-needs-vehicle-' + def.name, '"' + def.name + '" needs a car or bike next to the character.');
    return false;
  }
  if (need === 'seated') {
    if (a.isPlayer ? !!ctx.vehicles?.seated : seatedNpc.has(a.object)) return true;
    say('action-needs-seat-' + def.name, '"' + def.name + '" needs the character to be in a vehicle.');
    return false;
  }
  if (need === 'item') {
    if (held.has(a.object)) return true;
    say('action-needs-item-' + def.name, '"' + def.name + '" needs something in the hand — pick it up first.');
    return false;
  }
  return true;
}

/**
 * The character's OWN animation for the move, when its model has one: the player's chosen model (playerBody), or an NPC's
 * library model (three/assetModels sets model.userData.playRole). True when that clip is now playing — the data pose then
 * stands aside so the two never fight. A move's steps (the strike, the shot) still happen on time either way.
 */
function ownClip(ctx: GameContext, a: Actor, name: string): boolean {
  const move = CLIP_MOVE[name];
  if (a.isPlayer) return !!move && playMove(ctx, move);
  const play = a.info.model && a.info.model.userData.playRole;
  if (typeof play !== 'function') return false;
  try { return (move ? play(move) === true : false) || play(name) === true; } catch { return false; }
}

/**
 * Play an action on the player (no 'whom'), on every character of a kind ('police', 'villager', 'bot'), on every
 * character ('all'), or on one (its object or entity). True when at least one character started it; false (said once)
 * when the game has no such action, nobody matches, or it cannot happen where they stand.
 */
export function performAction(ctx: GameContext, name: string, whom?: Who): boolean {
  const key = actionKey(name);
  const def = knownActions()[key];
  if (!def) { say('action-missing-' + key, 'There is no "' + key + '" action yet. Ask NavBharatAI to make it.'); return false; }
  const actors = resolve(ctx, whom);
  if (!actors.length) {
    if (whom !== undefined && whom !== null) say('action-nobody-' + String(whom), 'No character called "' + String(whom) + '" is in the game yet.');
    return false;
  }
  const runs = runsOf(ctx);
  let started = 0;
  for (const a of actors) {
    if (!meets(ctx, a, def)) continue;
    const before = runs.get(a.object);
    if (before) end(ctx, before, false);
    const clip = ownClip(ctx, a, def.name);
    runs.set(a.object, { def, actor: a, t: 0, done: new Set(), cycle: 0, real: { forward: 0, side: 0, turn: 0 }, clip, holding: false });
    a.object.userData.acting = true;
    events.emit('ACTION_STARTED', { name: def.name, who: who(a) });
    started++;
  }
  return started > 0;
}

/** End a loop or a held stance (or any action) on the player, a kind, everyone, or one character. */
export function stopAction(ctx: GameContext, whom?: Who): void {
  const runs = runsOf(ctx);
  for (const a of resolve(ctx, whom)) { const r = runs.get(a.object); if (r) end(ctx, r, true); }
}
/** The action playing now on the player (or on 'whom''s first character), or null. */
export function currentAction(ctx: GameContext, whom?: Who): string | null {
  const a = resolve(ctx, whom)[0];
  return a ? runsOf(ctx).get(a.object)?.def.name ?? null : null;
}
/** The item the player (or 'whom') holds through an action (pick-up), or null. */
export function heldItem(ctx: GameContext, whom?: Who): THREE.Object3D | null {
  const a = resolve(ctx, whom)[0];
  return a ? held.get(a.object) ?? null : null;
}

function end(ctx: GameContext, r: Running, announce: boolean): void {
  runsOf(ctx).delete(r.actor.object);
  r.actor.object.userData.acting = false;
  // An NPC model that played its own clip goes back to standing.
  if (r.clip && !r.actor.isPlayer) {
    const play = r.actor.info.model && r.actor.info.model.userData.playRole;
    if (typeof play === 'function') { try { play('idle'); } catch { /* a model without idle keeps its last clip */ } }
  }
  const { frame } = limbsOf(ctx, r.actor);
  const pivot = frame && frame.parent && frame.parent.userData.actionPivot ? frame.parent : null;
  if (pivot) { pivot.position.set(0, 0, 0); pivot.quaternion.identity(); }
  if (announce) events.emit('ACTION_DONE', { name: r.def.name, who: who(r.actor) });
}

function hold(a: Actor, ctx: GameContext, item: THREE.Object3D): boolean {
  if (a.isPlayer) {
    if (holdItem(ctx, item, 'right')) return true;
    if (ctx.hero) { ctx.hero.hold(item); return true; }
    return false;
  }
  const body = a.info.humanoid ?? a.info.model;
  if (!body) return false;
  holdInHand(body as THREE.Object3D, item, 'right');
  return true;
}
function letGo(a: Actor, ctx: GameContext): THREE.Object3D | null {
  const item = held.get(a.object);
  if (!item) return null;
  if (a.isPlayer && ctx.hero) ctx.hero.hold(null);
  else if (!a.isPlayer && a.info.humanoid) a.info.humanoid.hold(null);
  const at = item.getWorldPosition(new THREE.Vector3());
  item.removeFromParent();
  item.position.copy(at);
  ctx.scene.add(item);
  held.delete(a.object);
  return item;
}

function runStep(ctx: GameContext, r: Running, step: ActionStep): void {
  const a = r.actor;
  const def = r.def;
  const fwd = facingOf(ctx, a);
  if (step.do === 'pickUp') {
    const near = step.near;
    const item = nearestObject(ctx, a, (o) => o.userData.pickup === true || (!!near && nameHas(o, near)), 2.5);
    if (!item) { say('action-nothing-' + def.name, 'There is nothing to pick up here. Walk next to it first.'); return; }
    letGo(a, ctx)?.removeFromParent();
    if (!hold(a, ctx, item)) return;
    held.set(a.object, item);
    events.emit('ITEM_PICKED_UP', { name: item.name || 'item', item, who: who(a) });
  } else if (step.do === 'drop') {
    const item = letGo(a, ctx);
    if (!item) return;
    item.position.copy(feetOf(a).add(fwd.clone().multiplyScalar(0.8)));
    item.scale.setScalar(1);
    events.emit('ITEM_DROPPED', { name: item.name || 'item', item, who: who(a) });
  } else if (step.do === 'open') {
    const near = step.near;
    if (!near) {
      const opened = interactHouseDoor(ctx.scene, { feet: feetOf(a), radius: 0.4, height: 1.8 });
      if (opened) { events.emit('DOOR_INTERACTED', { opened, who: who(a) }); return; }
    }
    const thing = nearestObject(ctx, a, (o) => typeof o.userData.interact === 'function' && (!near || nameHas(o, near) || (near === 'car' && isVehicle(o))), 3);
    if (thing) { (thing.userData.interact as (c: GameContext) => void)(ctx); events.emit('INTERACTED', { name: thing.name || 'object', who: who(a) }); return; }
    say('action-no-door-' + def.name, near ? 'There is no ' + near + ' here to open. Walk up to it first.' : 'There is no door here to open. Walk up to it first.');
    events.emit('DOOR_INTERACTED', { opened: false, who: who(a) });
  } else if (step.do === 'consume') {
    const item = held.get(a.object);
    if (!item) { events.emit('ITEM_CONSUMED', { name: 'nothing', who: who(a) }); return; }
    if (a.isPlayer && ctx.hero) ctx.hero.hold(null);
    else if (!a.isPlayer && a.info.humanoid) a.info.humanoid.hold(null);
    item.removeFromParent();
    held.delete(a.object);
    events.emit('ITEM_CONSUMED', { name: item.name || 'item', who: who(a) });
  } else if (step.do === 'strike' || step.do === 'push') {
    const force = step.force ?? (step.do === 'push' ? 6 : 3);
    const damage = step.do === 'strike' ? step.damage ?? 10 : 0;
    const near = step.near;
    const target = near ? null : nearestActorInFront(ctx, a, 1.9);
    if (target) {
      hurt(ctx, a, target, damage, fwd.clone().multiplyScalar(Math.min(1.2, force * 0.08)));
      events.emit(step.do === 'strike' ? 'ACTION_STRUCK' : 'ACTION_PUSHED', { by: who(a), target: who(target), damage });
      return;
    }
    const thing = nearestObject(ctx, a, (o) => (near ? nameHas(o, near) || (near === 'car' && isVehicle(o)) : typeof o.userData.onStruck === 'function' || o.userData.pushable === true || isVehicle(o)), near ? 3.5 : 2.4, true);
    if (thing) {
      const impulse = fwd.clone().multiplyScalar(force).add(new THREE.Vector3(0, force * 0.2, 0));
      if (typeof thing.userData.onStruck === 'function') (thing.userData.onStruck as (i: THREE.Vector3, c: GameContext) => void)(impulse, ctx);
      else thing.position.add(fwd.clone().multiplyScalar(Math.min(0.6, force * 0.04)));
      burst(ctx, 'impact', thing.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0)));
      events.emit(step.do === 'strike' ? 'ACTION_STRUCK' : 'ACTION_PUSHED', { by: who(a), target: thing.name || 'object', damage: 0 });
      return;
    }
    if (near) say('action-no-target-' + def.name, 'There is no ' + near + ' in front of the character.');
    events.emit(step.do === 'strike' ? 'ACTION_STRUCK' : 'ACTION_PUSHED', { by: who(a), target: null, damage: 0 });
  } else if (step.do === 'fire') {
    const origin = feetOf(a).add(new THREE.Vector3(0, 1.4, 0)).add(fwd.clone().multiplyScalar(0.5));
    burst(ctx, 'muzzleFlash', origin);
    let hit: Actor | null = null, hitT = 60;
    for (const b of others(ctx, a)) {
      const c = feetOf(b).add(new THREE.Vector3(0, 1, 0));
      const rel = c.clone().sub(origin);
      const t = rel.dot(fwd);
      if (t < 0 || t > hitT) continue;
      const miss = rel.clone().sub(fwd.clone().multiplyScalar(t));
      miss.y = Math.max(0, Math.abs(miss.y) - 0.6);
      if (miss.length() < 0.6) { hit = b; hitT = t; }
    }
    if (hit) hurt(ctx, a, hit, step.damage ?? 20, fwd.clone().multiplyScalar(0.15));
    events.emit('ACTION_FIRED', { by: who(a), hit: hit ? who(hit) : null, damage: hit ? step.damage ?? 20 : 0 });
  } else if (step.do === 'throw') {
    const item = letGo(a, ctx);
    if (!item) { say('action-nothing-to-throw-' + def.name, 'The character has nothing in the hand to throw — pick something up first.'); return; }
    const force = step.force ?? 10;
    const v = fwd.clone().multiplyScalar(force).add(new THREE.Vector3(0, force * 0.45, 0));
    let list = flying.get(ctx);
    if (!list) { list = []; flying.set(ctx, list); }
    list.push({ item, v, floor: feetOf(a).y, age: 0 });
    events.emit('ITEM_THROWN', { name: item.name || 'item', item, who: who(a) });
  } else if (step.do === 'enterVehicle') {
    if (a.isPlayer) {
      const car = ctx.vehicles?.inReach;
      if (car && ctx.vehicles.enter(car)) events.emit('VEHICLE_ENTERED', { who: 'player', vehicle: car.name || 'vehicle' });
      return;
    }
    const car = nearestObject(ctx, a, isVehicle, 4);
    if (!car) return;
    seatedNpc.set(a.object, car);
    a.object.visible = false;
    events.emit('VEHICLE_ENTERED', { who: who(a), vehicle: car.name || 'vehicle' });
  } else if (step.do === 'exitVehicle') {
    if (a.isPlayer) { if (ctx.vehicles?.seated && ctx.vehicles.exit()) events.emit('VEHICLE_EXITED', { who: 'player' }); return; }
    const car = seatedNpc.get(a.object);
    if (!car) return;
    seatedNpc.delete(a.object);
    const side = new THREE.Vector3(1.6, 0, 0).applyQuaternion(car.getWorldQuaternion(new THREE.Quaternion()));
    a.object.position.copy(car.getWorldPosition(new THREE.Vector3()).add(side));
    a.object.visible = true;
    events.emit('VEHICLE_EXITED', { who: who(a), vehicle: car.name || 'vehicle' });
  } else if (step.do === 'emit' && step.event) {
    events.emit(step.event, { action: def.name, who: who(a) });
  }
}

// ── Interpolation ─────────────────────────────────────────────────────────────────────────────────────────────────
function bracket(keys: ActionKey[], k: number): [ActionKey | null, ActionKey | null] {
  let a: ActionKey | null = null, b: ActionKey | null = null;
  for (const key of keys) { if (key.t <= k) a = key; if (key.t >= k) { b = key; break; } }
  return [a, b];
}
function dirAt(keys: ActionKey[], role: ActionRole, k: number): THREE.Vector3 | null {
  const [a, b] = bracket(keys, k);
  const da = a && a.pose[role], db = b && b.pose[role];
  if (!da && !db) return null;
  if (!da || !db || !a || !b || b.t === a.t) { const d = (da || db)!; return new THREE.Vector3(d[0], d[1], d[2]).normalize(); }
  const s = (k - a.t) / (b.t - a.t);
  return new THREE.Vector3(da[0], da[1], da[2]).normalize().lerp(new THREE.Vector3(db[0], db[1], db[2]).normalize(), s).normalize();
}
/** Weight of a limb's pose at k: full where a key names it, fading toward a key that does not. */
function weightAt(keys: ActionKey[], role: ActionRole, k: number): number {
  const [a, b] = bracket(keys, k);
  const wa = a && a.pose[role] ? 1 : 0, wb = b && b.pose[role] ? 1 : 0;
  if (!a || !b || b.t === a.t) return Math.max(wa, wb);
  const s = (k - a.t) / (b.t - a.t);
  return wa + (wb - wa) * (s * s * (3 - 2 * s));
}
/** A body field at k. Shown fields are 0 where a key omits them; real travel carries the last total forward. */
function bodyAt(keys: ActionKey[], field: keyof ActionBody, k: number, real: boolean): number {
  if (!real) {
    const [a, b] = bracket(keys, k);
    const va = (a && a.body && a.body[field]) || 0, vb = (b && b.body && b.body[field]) || 0;
    if (!a || !b || b.t === a.t) return a ? va : vb;
    const s = (k - a.t) / (b.t - a.t);
    return va + (vb - va) * s;
  }
  let lastT = 0, lastV = 0;
  for (const key of keys) {
    const v = key.body && key.body[field];
    if (typeof v !== 'number') continue;
    if (key.t >= k) { const span = key.t - lastT; return span > 0 ? lastV + (v - lastV) * ((k - lastT) / span) : v; }
    lastT = key.t; lastV = v;
  }
  return lastV;
}
const REAL_FIELDS: Array<'forward' | 'side' | 'turn'> = ['forward', 'side', 'turn'];

function travel(r: Running, k: number, frame: THREE.Object3D | null, fwd: THREE.Vector3): void {
  const next = { forward: 0, side: 0, turn: 0 };
  for (const f of REAL_FIELDS) next[f] = bodyAt(r.def.keys, f, k, true);
  const dF = next.forward - r.real.forward, dS = next.side - r.real.side, dT = next.turn - r.real.turn;
  r.real = next;
  if (dF || dS) {
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    r.actor.object.position.add(fwd.clone().multiplyScalar(dF)).add(left.multiplyScalar(dS));
  }
  if (dT && frame) frame.rotation.y += dT;
}

/** Called by the shell every step, after the bodies have posed themselves (the player's and every character's). */
export function updateActions(ctx: GameContext, dt: number): void {
  let mineTurned = turned.get(ctx);
  if (!mineTurned) { mineTurned = new Map(); turned.set(ctx, mineTurned); }
  // Undo last step's pose on every bone nothing else has posed since (an unanimated bone would otherwise keep it).
  for (const [bone, q] of mineTurned) if (bone.quaternion.equals(q.set)) bone.quaternion.copy(q.before);
  mineTurned.clear();
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  // A character sitting in a vehicle rides along with it.
  ctx.scene.traverse((o) => { const car = seatedNpc.get(o); if (car) o.position.copy(car.getWorldPosition(new THREE.Vector3())); });
  // Thrown items fly, fall and land.
  const air = flying.get(ctx);
  if (air && air.length) {
    for (const f of [...air]) {
      f.age += step;
      f.v.y -= 9.8 * step;
      f.item.position.addScaledVector(f.v, step);
      if (f.item.position.y <= f.floor || f.age > 6) {
        f.item.position.y = Math.max(f.item.position.y, f.floor);
        air.splice(air.indexOf(f), 1);
        events.emit('ITEM_LANDED', { name: f.item.name || 'item', item: f.item });
      }
    }
  }
  const runs = runsOf(ctx);
  for (const r of [...runs.values()]) {
    if (!r.actor.object.parent) { runs.delete(r.actor.object); continue; }
    const secs = Math.max(0.05, r.def.seconds);
    if (!r.holding) r.t += step;
    let k: number;
    if (r.def.loop) {
      const cycle = Math.floor(r.t / secs);
      if (cycle > r.cycle) {
        // Finish the travel of the cycle that ended, then start the next from zero.
        const { frame } = limbsOf(ctx, r.actor);
        travel(r, 1, frame, facingOf(ctx, r.actor));
        r.real = { forward: 0, side: 0, turn: 0 };
        r.cycle = cycle;
        r.done.clear();
      }
      k = (r.t - cycle * secs) / secs;
    } else k = Math.min(1, r.t / secs);
    (r.def.steps || []).forEach((s, i) => { if (!r.done.has(i) && k >= s.at) { r.done.add(i); runStep(ctx, r, s); } });
    const { limbs, frame } = limbsOf(ctx, r.actor);
    const fwd = facingOf(ctx, r.actor);
    if (!r.holding) travel(r, k, frame, fwd);
    if (frame) {
      // Whole-body motion that is SHOWN: rise, lean, roll, twist — on the pivot, so nothing else is disturbed.
      const rise = bodyAt(r.def.keys, 'rise', k, false), pitch = bodyAt(r.def.keys, 'pitch', k, false);
      const roll = bodyAt(r.def.keys, 'roll', k, false), yaw = bodyAt(r.def.keys, 'yaw', k, false);
      if (rise || pitch || roll || yaw || (frame.parent && frame.parent.userData.actionPivot)) {
        const pivot = pivotOf(frame);
        if (pivot) {
          pivot.position.set(0, rise, 0);
          // In the frame the character faces: lean about its sideways axis, roll about its forward axis.
          const face = frame.rotation.y;
          const side = new THREE.Vector3(Math.cos(face), 0, -Math.sin(face));
          const ahead = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
          pivot.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(side, pitch)
            .multiply(new THREE.Quaternion().setFromAxisAngle(ahead, -roll))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)));
        }
      }
      if (!r.clip) {
        frame.updateMatrixWorld(true);
        const fq = frame.getWorldQuaternion(new THREE.Quaternion());
        let missing = false;
        for (const role of ROLES) {
          const dir = dirAt(r.def.keys, role, k);
          if (!dir) continue;
          const bone = limbs[role];
          if (!bone) { missing = true; continue; }
          const before = bone.quaternion.clone();
          if (aimBone(bone, dir.applyQuaternion(fq), weightAt(r.def.keys, role, k))) mineTurned.set(bone, { before, set: bone.quaternion.clone() });
        }
        if (missing) say('action-partial-' + r.def.name, 'A character has no bone for part of "' + r.def.name + '", so that part of the pose is not shown.');
      }
    }
    if (!r.def.loop && k >= 1 && !r.holding) {
      if (r.def.hold) { r.holding = true; events.emit('ACTION_DONE', { name: r.def.name, who: who(r.actor), holding: true }); }
      else end(ctx, r, true);
    }
  }
}
`.replace('__LIBRARY__', JSON.stringify(LIBRARY_ACTIONS)).replace('__ALIASES__', JSON.stringify(MOVE_ALIASES));
