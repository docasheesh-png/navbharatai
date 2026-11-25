// 🧍 THE PLAYER'S BODY, FOR EVERY GAME ON THE KIT (admin 2026-11-22: "Use as my character" — the user's own model, or one
// from the game library — must work in ALL games, not only the open world).
//
// 🔑 ROOT CAUSE. The swap lived in the open-world starter alone: OpenWorldGame called applyPlayerChoice, only the open-world
// mount wrote src/game/player.ts, and the platform's "Use as my character" refused silently (returned nothing) wherever
// that file was missing — so a boxing game, a runner or any game the builder wrote on the shell had no character to swap.
// 🧬 THE FIX AT THE ROOT: this file ships WITH the shell (Game.ts), and the shell, the open world and the endless runner
// each read src/game/player.ts by themselves (resolvePlayerChoice), so a game never has to wire it and a builder cannot
// forget. Moves are the model's OWN clips, matched by name with the server's table (playerMoves.ts); a move the model lacks
// is said on screen, never faked. PURE — no I/O.
import { PLAYER_MOVE_WORDS } from './playerMoves';

export const GAME_PLAYER_BODY_PATH = 'src/game/play/playerBody.ts';

export const GAME_PLAYER_BODY = String.raw`// WHO THE PLAYER IS — and how it is changed (admin 2026-11-21: "yeh jo character banta hai, isko user jab chahe replace
// karwa de, text se ya game library se chun ke"; 2026-11-22: in EVERY game).
//
// The player's body is the kit's own animated person by default. It is changed in ONE place, src/game/player.ts, and every
// game on the kit reads that file by itself (the shell, the open world, the endless runner) — nothing has to wire it:
//   • look  — the same person with other colours, height or build (still walks, runs, jumps and plays every action pose);
//   • model — a character from the game library, by its subject ("knight", "boxer"), loaded from the game's saved models;
//   • file  — the user's OWN model, attached in the chat and saved at public/models/<name>.glb: file: '/models/<name>.glb'.
// A model stands modelHeight metres tall (default 1.75), feet on the ground, centred where the player stands, facing
// forward (+Z, the kit's convention; turn: 180 for one made facing the other way). It plays ITS OWN clips for each move,
// found by name (idle, walk, run, jump, punch, kick, block, hit, die…; moves: { punch: 'Jab_R' } names a clip the kit does
// not recognise). A move the model does not have is NEVER faked: the game says on screen, once, which move is missing (a
// boxer without a punch clip says so). While a model loads, and if it cannot be loaded, the kit person stays — the player
// is never missing. A game with no visible body (first-person, or one that brought its own) says so when a model is asked.
import * as THREE from 'three';
import type { GameContext } from '../Game';
import type { HumanoidAction, HumanoidOptions } from '../three/humanoid';
import { events } from '../core/events';

export type PlayerMove = 'idle' | 'walk' | 'run' | 'jump' | 'land' | 'punch' | 'kick' | 'block' | 'hit' | 'die' | 'fire' | 'swing' | 'throw' | 'use' | 'slide';

// The kit person's action poses (three/humanoid.ts HumanoidAction) named in the model's own move vocabulary. A Record over
// every HumanoidAction, so a pose added to the kit person without a move here fails the game's typecheck instead of
// reaching a model as a move it has no name for (failedbr #2523: 'bat' was a pose, never a move).
const MOVE_FOR_POSE: Readonly<Record<HumanoidAction, PlayerMove>> = {
  punch: 'punch', swing: 'swing', fire: 'fire', kick: 'kick', throw: 'throw', jump: 'jump', land: 'land', hit: 'hit', use: 'use',
  bat: 'swing', dive: 'slide', 'dive-left': 'slide',
};

export interface PlayerChoice {
  /** The kit person's look: { height, build, skin, hair, shirt, trousers, shoes } (colours as 0xRRGGBB). */
  look?: HumanoidOptions;
  /** A library character's subject (it must be one of the game's saved models), or null for the kit person. */
  model?: string | null;
  /** The user's own model file under public/, e.g. '/models/my-hero.glb', or null. Wins over model when both are set. */
  file?: string | null;
  /** How tall the model stands, in metres. Default 1.75. */
  modelHeight?: number;
  /** Degrees to turn a model that does not face forward (+Z). Default 0; 180 for one made facing backwards. */
  turn?: number;
  /** The model's own clip for a move, when its name is not one the kit recognises: { punch: 'Jab_R', block: 'Guard' }. */
  moves?: Partial<Record<PlayerMove, string>>;
  /** What the character holds: library subjects, for example { right: 'pistol' } or { right: 'sword', left: 'shield' }. */
  holds?: { right?: string | null; left?: string | null };
}

export interface PlayerModelHandle { root: THREE.Object3D; source?: string; update(dt: number): void; dispose?(): void; play?(role: string, fade?: number): boolean }
export type PlayerAssetModule = { loadRequestedAsset?: (subject: string, fallback: () => PlayerModelHandle) => Promise<PlayerModelHandle> };
/** What three's GLTFLoader hands over for the user's own file. */
export interface PlayerGltf { scene: THREE.Object3D; animations: THREE.AnimationClip[] }
/** How a model is fetched. A game uses the defaults; tests pass their own. */
export interface PlayerLoaders {
  library?: () => Promise<PlayerAssetModule | null>;
  file?: (url: string) => Promise<PlayerGltf>;
}

/** The game's saved library models, when it has any. A game without the file simply has none — never a broken build. */
function assetModule(): Promise<PlayerAssetModule | null> {
  try {
    const found = import.meta.glob('../three/assetModels.ts') as Record<string, () => Promise<PlayerAssetModule>>;
    const load = Object.values(found)[0];
    return load ? load().catch(() => null) : Promise.resolve(null);
  } catch { return Promise.resolve(null); }
}

/** The user's own .glb, read with three's GLTFLoader (fetched only by a game that uses a file). */
async function gltfFile(url: string): Promise<PlayerGltf> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  return { scene: gltf.scene, animations: gltf.animations };
}

/**
 * src/game/player.ts, read by the game itself. A game that passes its own choice (a prop) uses that; otherwise the file
 * decides. A project without the file (or a bundler without import.meta.glob) has no choice: the kit person.
 */
export function resolvePlayerChoice(given?: PlayerChoice | null): PlayerChoice | undefined {
  if (given !== undefined) return given ?? undefined;
  try {
    const found = import.meta.glob('../player.ts', { eager: true }) as Record<string, { PLAYER?: PlayerChoice }>;
    const mod = Object.values(found)[0];
    return mod && mod.PLAYER && typeof mod.PLAYER === 'object' ? mod.PLAYER : undefined;
  } catch { return undefined; }
}

/** '/models/hero.glb' (or 'public/models/hero.glb') → the URL the game reads; null for anything outside the project. */
export function playerFileUrl(file: string | null | undefined): string | null {
  let path = String(file ?? '').trim();
  while (path.startsWith('/')) path = path.slice(1);
  if (path.startsWith('public/')) path = path.slice('public/'.length);
  const parts = path.split('/');
  const safe = (part: string) => part.length > 0 && part !== '.' && part !== '..' && /^[A-Za-z0-9_ .-]+$/.test(part);
  if (!path || path.length > 240 || !/\.glb$/i.test(path) || !parts.every(safe)) return null;
  let base = '/';
  try { base = import.meta.env.BASE_URL || '/'; } catch { /* not built by Vite: the site root */ }
  return (base.endsWith('/') ? base : base + '/') + path;
}

/** Which clip a moving body plays. */
export function locomotionRole(speed: number, grounded: boolean): 'idle' | 'walk' | 'run' | 'jump' {
  if (!grounded) return 'jump';
  return speed > 4.2 ? 'run' : speed > 0.25 ? 'walk' : 'idle';
}

// The words a clip name carries for each move — the SAME table the server reads (src/server/lib/playerMoves.ts).
const MOVE_WORDS: Record<PlayerMove, readonly string[]> = ` + JSON.stringify(PLAYER_MOVE_WORDS) + String.raw`;
/** A real clip of the same model that may stand in for a missing one (said on screen); every other move has none. */
const STAND_IN: Partial<Record<PlayerMove, PlayerMove>> = { run: 'walk', walk: 'run' };

function clipWords(name: string): string[] {
  return String(name ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/** The model's own clip for a move, or null when it has none. PLAYER.moves[move] wins when the model has that clip. */
export function clipForMove(names: readonly string[], move: PlayerMove, chosen?: string): string | null {
  if (chosen && names.includes(chosen)) return chosen;
  const ranked = [...names].sort((a, b) => clipWords(a).length - clipWords(b).length);
  for (const word of MOVE_WORDS[move] ?? []) {
    const hit = ranked.find((n) => clipWords(n).some((w) => w === word || (word.length >= 3 && w.startsWith(word))));
    if (hit) return hit;
  }
  return null;
}

/** A loaded model the body drives. */
export interface PlayerModel {
  root: THREE.Object3D;
  /** The model's own clip names when they are known (the user's file); null for a library model, which answers play(). */
  readonly clips: readonly string[] | null;
  /** Play the model's clip for a move (once, or looping); false when the model has no such clip. */
  play(move: PlayerMove, once: boolean): boolean;
  /** How long the move's clip lasts, in seconds (0 when unknown). */
  seconds(move: PlayerMove): number;
  update(dt: number): void;
  dispose(): void;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of list) m.dispose();
  });
}

function fromFile(gltf: PlayerGltf, choice: PlayerChoice): PlayerModel {
  const visual = gltf.scene;
  const clips = gltf.animations.map((a) => a.name);
  const mixer = clips.length ? new THREE.AnimationMixer(visual) : null;
  const clipOf = (move: PlayerMove) => {
    const name = clipForMove(clips, move, choice.moves?.[move]);
    return name ? gltf.animations.find((a) => a.name === name) ?? null : null;
  };
  let current: THREE.AnimationAction | null = null;
  return {
    root: visual, clips,
    play(move, once) {
      const clip = clipOf(move);
      if (!mixer || !clip) return false;
      const next = mixer.clipAction(clip);
      if (next === current && !once) return true;
      next.reset();
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = once;
      next.setEffectiveWeight(1).play();
      if (current && current !== next) current.crossFadeTo(next, 0.15, false);
      current = next;
      return true;
    },
    seconds(move) { return clipOf(move)?.duration ?? 0; },
    update(dt) { if (mixer && Number.isFinite(dt) && dt > 0) mixer.update(Math.min(dt, 0.1)); },
    dispose() { mixer?.stopAllAction(); mixer?.uncacheRoot(visual); visual.removeFromParent(); disposeTree(visual); },
  };
}

function fromHandle(handle: PlayerModelHandle): PlayerModel {
  return {
    root: handle.root, clips: null,
    play(move) { return !!handle.play?.(move); },
    seconds() { return 0; },
    update(dt) { handle.update(dt); },
    dispose() { handle.root.removeFromParent(); handle.dispose?.(); },
  };
}

// ── THE SKELETON: an item in the hand, and a made move for one the model lacks (admin 2026-11-24) ─────────────────────
// "character ke hath me gun do" used to be impossible: a library model is a baked file, and the kit could only play its
// own clips. Two things are built from the model's SKELETON instead, the same way for every rig:
//   • holdItem — an item is parented to the hand bone (found by name: RightHand, Hand_R, mixamorig:RightHand, Hand.R…),
//     sized to the character, so it moves with every clip the model plays. No hand bone: it is held at the side, and said.
//   • a made move — when the model has no clip for punch, kick, swing, throw, fire or use, the arm or leg bones are turned
//     toward the target direction in WORLD space for the length of the move, then let go. World space is what makes it work
//     on any rig: the bones' local axes differ between rigs, a direction in the world does not. It is said once on screen
//     that the move is made by NavBharatAI from the skeleton. A model with no such bones keeps the old honest line.
export type BoneRole = 'rightHand' | 'leftHand' | 'rightUpperArm' | 'rightForeArm' | 'rightUpLeg' | 'rightLeg';
const BONE_NAMES: Record<BoneRole, readonly string[]> = {
  rightHand: ['righthand', 'handr', 'rhand', 'handright', 'wristr', 'rightwrist'],
  leftHand: ['lefthand', 'handl', 'lhand', 'handleft', 'wristl', 'leftwrist'],
  rightUpperArm: ['rightarm', 'upperarmr', 'rightupperarm', 'armr', 'rupperarm', 'uparmr'],
  rightForeArm: ['rightforearm', 'forearmr', 'lowerarmr', 'rightlowerarm', 'rforearm', 'elbowr'],
  rightUpLeg: ['rightupleg', 'thighr', 'upperlegr', 'rightupperleg', 'rightthigh', 'uplegr'],
  rightLeg: ['rightleg', 'calfr', 'shinr', 'lowerlegr', 'rightlowerleg', 'rightshin', 'legr'],
};
/** 'mixamorig:RightForeArm' → 'rightforearm'; 'Hand.R' → 'handr'. */
export function boneKey(name: string): string {
  return String(name || '').toLowerCase().replace(/^mixamorig\d*[:_]?/, '').replace(/[^a-z]/g, '');
}
/** The bones of a model's skeleton that the kit knows by role. Exact names only, never a guess. */
export function findBones(root: THREE.Object3D): Partial<Record<BoneRole, THREE.Object3D>> {
  const out: Partial<Record<BoneRole, THREE.Object3D>> = {};
  root.traverse((o) => {
    const key = boneKey(o.name);
    if (!key) return;
    for (const role of Object.keys(BONE_NAMES) as BoneRole[]) if (!out[role] && BONE_NAMES[role].includes(key)) out[role] = o;
  });
  return out;
}

type Aim = { role: BoneRole; dir: (t: number) => THREE.Vector3 };
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();
const lerpDir = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, Math.min(1, Math.max(0, t))).normalize();
/** Directions in the character's own frame (+Z forward, +Y up, -X its right), as a function of the move's progress 0..1. */
export const MADE_MOVES: Partial<Record<PlayerMove, { seconds: number; aims: Aim[] }>> = {
  punch: { seconds: 0.35, aims: [{ role: 'rightUpperArm', dir: () => v(-0.15, 0.05, 1) }, { role: 'rightForeArm', dir: () => v(-0.1, 0.05, 1) }] },
  fire: { seconds: 0.3, aims: [{ role: 'rightUpperArm', dir: () => v(-0.1, 0.1, 1) }, { role: 'rightForeArm', dir: (t) => v(-0.05, 0.1 + 0.25 * Math.sin(Math.PI * t), 1) }] },
  swing: { seconds: 0.45, aims: [{ role: 'rightUpperArm', dir: (t) => lerpDir(v(-0.3, 1, 0.2), v(0.2, -0.4, 1), t) }, { role: 'rightForeArm', dir: (t) => lerpDir(v(-0.2, 1, 0.3), v(0.3, -0.5, 1), t) }] },
  throw: { seconds: 0.5, aims: [{ role: 'rightUpperArm', dir: (t) => lerpDir(v(-0.3, 0.8, -0.6), v(-0.1, 0.3, 1), t) }, { role: 'rightForeArm', dir: (t) => lerpDir(v(-0.2, 1, -0.4), v(-0.1, 0.2, 1), t) }] },
  kick: { seconds: 0.45, aims: [{ role: 'rightUpLeg', dir: () => v(-0.05, -0.2, 1) }, { role: 'rightLeg', dir: () => v(-0.05, -0.1, 1) }] },
  use: { seconds: 0.4, aims: [{ role: 'rightUpperArm', dir: () => v(-0.1, -0.4, 1) }, { role: 'rightForeArm', dir: () => v(-0.1, -0.6, 1) }] },
};

/** The first child of a bone that the bone points at (its direction is bone → child). */
function childOf(bone: THREE.Object3D): THREE.Object3D | null {
  return bone.children.find((c) => (c as THREE.Bone).isBone || c.type === 'Bone' || c.children.length > 0) ?? bone.children[0] ?? null;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _w = new THREE.Quaternion();
/** Turn bone so it points along worldDir by weight (0..1). Rig-agnostic: computed in world space. */
export function aimBone(bone: THREE.Object3D, worldDir: THREE.Vector3, weight: number): boolean {
  const child = childOf(bone);
  if (!child || weight <= 0) return false;
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  const now = _b.sub(_a);
  if (now.lengthSq() < 1e-10) return false;
  now.normalize();
  const want = now.clone().lerp(worldDir.clone().normalize(), Math.min(1, weight)).normalize();
  _q.setFromUnitVectors(now, want);                         // the world turn
  bone.getWorldQuaternion(_w);
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(_p) : _p.identity();
  bone.quaternion.copy(parentQ.clone().invert().multiply(_q.multiply(_w)));
  bone.updateWorldMatrix(false, true);
  return true;
}

/** Said to the player on screen (the kit's Hud shows HINT) and in the console — once per message per game. */
function say(id: string, text: string): void {
  console.warn('[player] ' + text);
  try { events.emit('HINT', { id, text, seconds: 6 }); } catch { /* a game without the Hud still plays */ }
}

/** The player's character: the kit's body until a model takes its place. */
export interface PlayerCharacter {
  readonly showing: 'person' | 'model';
  /** The model, sized and grounded, under the holder — null while the kit body is shown. */
  readonly root: THREE.Object3D | null;
  /** A move that lasts (idle, walk, run, jump, slide). True when the model plays its OWN clip for exactly this move. */
  move(role: PlayerMove): boolean;
  /** A one-shot move (punch, kick, block, hit, die…). False — and said on screen once — when the model lacks it. */
  act(move: PlayerMove): boolean;
  /** Back on its feet after die (a respawn, Play again). */
  revive(): void;
  /** Put an item in a hand (it follows the hand bone). False while the kit body is shown. */
  hold(item: THREE.Object3D, side?: 'right' | 'left'): boolean;
  update(dt: number): void;
  dispose(): void;
}

const asked = (choice: PlayerChoice | null | undefined) => ({
  url: typeof choice?.file === 'string' && choice.file.trim() ? choice.file.trim() : '',
  subject: typeof choice?.model === 'string' ? choice.model.trim() : '',
});

/** Does this choice ask for a model in place of the kit person? */
export function asksForModel(choice: PlayerChoice | null | undefined): boolean {
  const a = asked(choice);
  return !!(a.url || a.subject);
}

/**
 * Put the chosen model under holder (the object that moves as the player) and drive its moves. shown() runs once the
 * model has taken its place — hide the kit body there. Nothing is asked → the kit body stays and nothing is loaded.
 */
export function createPlayerCharacter(holder: THREE.Object3D, choice: PlayerChoice | null | undefined, shown: () => void = () => {}, loaders: PlayerLoaders = {}): PlayerCharacter {
  const { url, subject } = asked(choice);
  let model: PlayerModel | null = null;
  let wrapper: THREE.Group | null = null;
  let gone = false;
  let looping: PlayerMove | '' = '';
  let exact = false;
  let busy = 0;
  let down = false;
  let bones: Partial<Record<BoneRole, THREE.Object3D>> = {};
  let made: { move: PlayerMove; t: number; seconds: number } | null = null;
  const rests = new Map<THREE.Object3D, THREE.Quaternion>();
  const tallness = Number.isFinite(choice?.modelHeight) && Number(choice?.modelHeight) > 0 ? Number(choice?.modelHeight) : 1.75;
  const told = new Set<string>();
  const tell = (move: PlayerMove, rest: string) => {
    if (told.has(move) || told.has('*')) return;
    told.add(move);
    say('player-move-' + move, 'Your character has no ' + move + ' move of its own. ' + rest);
  };
  const failed = (why: string) => {
    if (gone) return;
    const name = url || subject;
    console.error('[player] the character "' + name + '" could not be used (' + why + '); the default person is shown.');
    try { events.emit('HINT', { id: 'player-model-missing', text: 'Your character "' + name + '" could not be loaded, so the default person is shown.', seconds: 6 }); } catch { /* no Hud */ }
  };
  const mount = (m: PlayerModel) => {
    if (gone) { m.dispose(); return; }
    const pivot = new THREE.Group();
    pivot.add(m.root);
    pivot.rotation.y = (Number.isFinite(choice?.turn) ? Number(choice?.turn) : 0) * Math.PI / 180;
    const outer = new THREE.Group();
    outer.add(pivot);
    outer.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(outer);
    const tall = box.max.y - box.min.y;
    if (Number.isFinite(tall) && tall > 0.01) {
      const want = Number.isFinite(choice?.modelHeight) && Number(choice?.modelHeight) > 0 ? Number(choice?.modelHeight) : 1.75;
      const k = want / tall;
      pivot.scale.multiplyScalar(k);
      pivot.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
    }
    holder.add(outer);
    model = m; wrapper = outer;
    bones = findBones(m.root);
    // What the character holds (PLAYER.holds): library subjects, each put in its hand once it has loaded.
    for (const side of ['right', 'left'] as const) {
      const wanted = typeof choice?.holds?.[side] === 'string' ? String(choice?.holds?.[side]).trim() : '';
      if (!wanted) continue;
      const none = (): PlayerModelHandle => ({ root: new THREE.Group(), source: 'procedural', update() { /* nothing to move */ } });
      void (loaders.library ?? assetModule)().then((mod) => (mod?.loadRequestedAsset ? mod.loadRequestedAsset(wanted, none) : null)).then((item) => {
        if (gone) { item?.dispose?.(); return; }
        if (!item || item.source !== 'model') { item?.dispose?.(); say('player-hold-missing-' + side, 'The ' + wanted + ' to hold is not one of this game\'s saved models, so nothing is in the hand.'); return; }
        api.hold(item.root, side);
      }).catch(() => say('player-hold-missing-' + side, 'The ' + wanted + ' to hold could not be loaded, so nothing is in the hand.'));
    }
    if (m.clips && m.clips.length === 0) { told.add('*'); say('player-moves-none', 'Your character has no animations of its own, so it moves without walking or posing.'); }
    shown();
  };
  if (url) {
    const at = playerFileUrl(url);
    if (!at) failed('"' + url + '" is not a .glb file inside the project');
    else void (loaders.file ?? gltfFile)(at).then((gltf) => mount(fromFile(gltf, choice ?? {}))).catch((error) => failed(String(error)));
  } else if (subject) {
    const empty = (): PlayerModelHandle => ({ root: new THREE.Group(), source: 'procedural', update() { /* nothing to move */ } });
    void (loaders.library ?? assetModule)().then((mod) => (mod?.loadRequestedAsset ? mod.loadRequestedAsset(subject, empty) : null)).then((handle) => {
      if (!handle || handle.source !== 'model') { handle?.dispose?.(); failed('it is not one of this game\'s saved models'); return; }
      mount(fromHandle(handle));
    }).catch((error) => failed(String(error)));
  }
  const api: PlayerCharacter = {
    get showing() { return model ? 'model' as const : 'person' as const; },
    get root() { return wrapper; },
    move(role) {
      if (!model || down || busy > 0) return false;
      if (role === looping) return exact;
      looping = role;
      exact = model.play(role, false);
      if (exact) return true;
      const stand = STAND_IN[role];
      if (stand && model.play(stand, false)) tell(role, 'It plays its ' + stand + ' instead.');
      else tell(role, 'That move is shown without an animation.');
      return false;
    },
    act(move) {
      if (!model || (down && move !== 'die')) return false;
      if (!model.play(move, true)) {
        // No clip of its own: make the move from the skeleton when the model has the bones for it (see MADE_MOVES).
        const recipe = MADE_MOVES[move];
        if (recipe && recipe.aims.every((a) => bones[a.role])) {
          made = { move, t: 0, seconds: recipe.seconds };
          looping = '';
          busy = recipe.seconds;
          if (!told.has('made-' + move)) { told.add('made-' + move); say('player-move-made-' + move, 'Your character has no ' + move + ' move of its own, so NavBharatAI animates one from its skeleton.'); }
          return true;
        }
        // Landing is the kit person's small settle pose, not a move anyone asked for: a model without one simply lands.
        if (move !== 'land') tell(move, 'It is not animated when the game asks for it.');
        return false;
      }
      looping = '';
      if (move === 'die') { down = true; return true; }
      busy = model.seconds(move) || 0.6;
      return true;
    },
    revive() { down = false; busy = 0; looping = ''; made = null; },
    hold(item, side = 'right') {
      if (!model || !wrapper) return false;
      const box = new THREE.Box3().setFromObject(item);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z) || 1;
      const want = 0.3 * tallness;                          // a hand-held item is about a third of the character's height
      const bone = bones[side === 'left' ? 'leftHand' : 'rightHand'];
      if (bone) {
        bone.updateWorldMatrix(true, false);
        const scale = new THREE.Vector3();
        bone.getWorldScale(scale);
        item.scale.multiplyScalar(want / longest / (Math.abs(scale.x) || 1));
        bone.add(item);
        return true;
      }
      item.scale.multiplyScalar(want / longest);
      item.position.set((side === 'left' ? 1 : -1) * 0.22 * tallness, 0.5 * tallness, 0.2 * tallness);
      wrapper.add(item);
      if (!told.has('hold-' + side)) { told.add('hold-' + side); say('player-hold-' + side, 'Your character has no ' + side + ' hand bone, so the item is held at its side.'); }
      return true;
    },
    update(dt) {
      if (!model) return;
      for (const [bone, rest] of rests) bone.quaternion.copy(rest);   // undo last frame's made pose before the clips run
      rests.clear();
      if (busy > 0) { busy -= dt; if (busy <= 0) { busy = 0; looping = ''; } }
      model.update(dt);
      if (made && wrapper) {
        made.t += Number.isFinite(dt) && dt > 0 ? dt : 0;
        const k = made.t / made.seconds;
        const recipe = MADE_MOVES[made.move];
        if (k >= 1 || !recipe) { made = null; return; }
        const weight = Math.sin(Math.PI * k);                 // in, hold, out
        wrapper.updateMatrixWorld(true);
        const frame = wrapper.getWorldQuaternion(new THREE.Quaternion());
        for (const aim of recipe.aims) {
          const bone = bones[aim.role];
          if (!bone) continue;
          rests.set(bone, bone.quaternion.clone());
          aimBone(bone, aim.dir(k).clone().applyQuaternion(frame), weight);
        }
      }
    },
    dispose() {
      gone = true;
      if (model) { model.root.removeFromParent(); model.dispose(); model = null; }
      if (wrapper) { wrapper.removeFromParent(); wrapper = null; }
    },
  };
  return api;
}

export interface PlayerBody {
  /** Call every step. */
  update(delta: number): void;
  /** 'person' while the kit person is shown; 'model' once the chosen character has taken its place. */
  readonly showing: 'person' | 'model';
  dispose(): void;
}

const applied = new WeakMap<object, { body: PlayerBody; character: PlayerCharacter }>();

/**
 * Apply the choice to a running game on the shell: the model stands in the kit person's place, faces where it faces,
 * plays its own clip for the way it moves, and every pose the game or the shell plays on the kit person (ctx.hero.act —
 * punch, kick, fire, swing, hit, jump…, ctx.hero.die) is played by the model too. The shell does this by itself from
 * src/game/player.ts; a second call for the same game changes nothing. The third argument exists for tests.
 */
export function applyPlayerChoice(ctx: GameContext, choice?: PlayerChoice | null, load: (() => Promise<PlayerAssetModule | null>) | PlayerLoaders = {}): PlayerBody {
  const person: PlayerBody = { get showing() { return 'person' as const; }, update() { /* the shell drives the kit person */ }, dispose() { /* nothing taken */ } };
  const before = applied.get(ctx);
  if (before) return { get showing() { return before.body.showing; }, update() { /* the first one drives it */ }, dispose() { /* the first one owns it */ } };
  if (!asksForModel(choice)) return person;
  const hero = ctx.hero;
  if (!hero) {
    say('player-no-body', 'This game shows no player body (it is first-person, or it brought its own), so your character is not shown.');
    return person;
  }
  const loaders: PlayerLoaders = typeof load === 'function' ? { library: load } : load;
  const character = createPlayerCharacter(ctx.player.object, choice, () => { hero.root.scale.setScalar(0.0001); }, loaders);   // the kit person steps aside (the shell still drives it)
  const act = hero.act, die = hero.die, revive = hero.revive;
  hero.act = (pose, strength) => { act(pose, strength); character.act(MOVE_FOR_POSE[pose]); };
  hero.die = (fromFront) => { die(fromFront); character.act('die'); };
  hero.revive = () => { revive(); character.revive(); };
  const body: PlayerBody = {
    get showing() { return character.showing; },
    update(delta) {
      const root = character.root;
      if (!root) return;
      root.rotation.y = hero.root.rotation.y;
      root.visible = hero.root.visible;
      character.move(locomotionRole(ctx.player.speed, ctx.player.isGrounded));
      character.update(delta);
    },
    dispose() {
      applied.delete(ctx);
      hero.act = act; hero.die = die; hero.revive = revive;
      character.dispose();
      hero.root.scale.setScalar(1);
    },
  };
  applied.set(ctx, { body, character });
  return body;
}

/**
 * Play a move the kit person has no button pose for — block, die, slide, or any clip the game names — on the player's
 * model: playMove(ctx, 'block'). False when the game shows the kit person (play its own pose then) or the model lacks it.
 */
export function playMove(ctx: GameContext, move: PlayerMove): boolean {
  return applied.get(ctx)?.character.act(move) ?? false;
}

/**
 * Put an item (a gun, a sword, a torch…) in the player's hand: holdItem(ctx, gunMesh). It follows the hand bone through
 * every clip. False when the game shows the kit person (it has its own grips: ctx.hero.rightHand).
 */
export function holdItem(ctx: GameContext, item: THREE.Object3D, side: 'right' | 'left' = 'right'): boolean {
  return applied.get(ctx)?.character.hold(item, side) ?? false;
}

/**
 * Put an item in the hand of ANY character — an NPC, an enemy, a pet — not only the player (admin 2026-11-24: "sabhi
 * character apne hath me object utha le"). Works on a library or uploaded model (its hand bone, found by name, the same
 * way as the player's), and on a kit person (createHumanoid: its own right/left hand). The item is sized to about a third
 * of the character's height. With no hand bone it is held at the character's side, and false says so.
 */
export function holdInHand(
  character: THREE.Object3D | { root: THREE.Object3D; hold: (item: THREE.Object3D | null) => void; joints?: { leftHand?: THREE.Object3D } },
  item: THREE.Object3D,
  side: 'right' | 'left' = 'right',
): boolean {
  // A kit person (createHumanoid): its own grip — the right hand through hold(), the left hand by its joint.
  if (!(character instanceof THREE.Object3D)) {
    if (side === 'left' && character.joints?.leftHand) { character.joints.leftHand.add(item); return true; }
    character.hold(item);
    return true;
  }
  const bone = findBones(character)[side === 'left' ? 'leftHand' : 'rightHand'];
  const box = new THREE.Box3().setFromObject(character);
  const tall = Math.max(0.2, box.max.y - box.min.y);
  const size = new THREE.Box3().setFromObject(item).getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const want = 0.3 * tall;
  if (bone) {
    bone.updateWorldMatrix(true, false);
    const scale = new THREE.Vector3();
    bone.getWorldScale(scale);
    item.scale.multiplyScalar(want / longest / (Math.abs(scale.x) || 1));
    item.position.set(0, 0, 0);
    bone.add(item);
    return true;
  }
  // No hand bone: at the character's side, in its own frame, and false says so.
  item.scale.multiplyScalar(want / longest / (Math.abs(character.scale.x) || 1));
  item.position.set((side === 'left' ? 1 : -1) * 0.22 * tall, 0.5 * tall, 0.2 * tall).divideScalar(Math.abs(character.scale.x) || 1);
  character.add(item);
  return false;
}

/** The chosen character's model root while it is shown, else null (the kit person is shown). play/actions.ts poses it. */
export function playerModelRoot(ctx: GameContext): THREE.Object3D | null {
  const a = applied.get(ctx);
  return a && a.character.showing === 'model' ? a.character.root : null;
}
`;

export const GAME_PLAYER_FILE_PATH = 'src/game/player.ts';
/**
 * The game's own player — the user's file (never a kit file, so a kit refresh never resets the character): created once
 * with the shell (and by the open-world mount); changing the character is changing this.
 */
export const GAME_PLAYER_FILE = [
  "// THIS GAME'S PLAYER — the character you play as. The game reads this file by itself; nothing else needs to change.",
  '// look: how the default person looks (colours are 0xRRGGBB; height in metres; build 0.85 slight to 1.2 heavy).',
  "// model: a character from the game library — add it to the game first, then set its subject (for example 'knight').",
  "// file: your OWN model, attached in the chat and saved at public/models/<name>.glb (for example '/models/my-hero.glb').",
  "// modelHeight: its height in metres. turn: 180 if it faces backwards. moves: { punch: 'Jab_R' } for clips with unusual names.",
  "// holds: what it holds, from the game library, for example holds: { right: 'pistol' } or { right: 'sword', left: 'shield' }.",
  '// Set model and file back to null for the default person.',
  "import type { PlayerChoice } from './play/playerBody';",
  '',
  'export const PLAYER: PlayerChoice = {',
  '  look: { shirt: 0x2e5a87 },',
  '  model: null,',
  '  file: null,',
  '};',
  '',
].join('\n');
