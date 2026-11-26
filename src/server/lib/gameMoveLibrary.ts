// THE MOVE LIBRARY — every move a game character commonly makes, as DATA that plays on ANY character (admin 2026-11-26:
// "sabhi characters ke moves ko character se alag kar do … jo user bole, sirf hero nahi kisi bhi character par yeh move
// lagaye ja sake … police / villagers / bot, user jo bole woh kam kare").
//
// A move is not a clip baked into one model. It is a few key poses (a direction for each named limb, in the character's
// own frame), an optional whole-body motion (rise, lean, roll, turn, travel), and steps that touch the world (strike,
// fire, throw, push, get in or out of a vehicle, pick up, open). play/actions.ts plays it on whatever body is shown —
// the kit person, a library model or the user's own — and on any character: the player, one NPC, or every NPC of a kind.
// A move missing here is designed by NavBharatAI with one model call (compose_action), in the same vocabulary.
//
// Frame: +Z forward, +Y up, -X the character's RIGHT, +X its LEFT. An arm or leg hanging straight down is [0, -1, 0].
// Body: rise (metres up), pitch (lean forward, radians), roll (tilt to its left), yaw (twist) are SHOWN and undone when
// the move ends; forward / side (metres) and turn (radians) are REAL travel, the total reached by that point of the move.
// The body pivots at the feet, so lying flat is pitch ±π/2 with a small rise.
//
// PURE data plus pure helpers. The kit receives this table as JSON (GameActionsGenerator injects it), so the server and
// every game always hold the same library.

import type { ActionDef, ActionKey, ActionStep, ActionBody, ActionRole } from './GameActionsGenerator';

type V = [number, number, number];
type Pose = ActionKey['pose'];

// ── Directions (the RIGHT side; `L` mirrors a whole pose to the left) ─────────────────────────────────────────────────
const DOWN: V = [0, -1, 0];
const UP: V = [0, 1, 0];
const FWD: V = [0, 0, 1];
const R_SIDE: V = [-1, 0, 0];
const FWD_UP: V = [0, 0.7, 0.7];
const FWD_DOWN: V = [0, -0.7, 0.7];
const BACK_DOWN: V = [0, -0.6, -0.8];

const MIRROR: Record<ActionRole, ActionRole> = {
  rightUpperArm: 'leftUpperArm', leftUpperArm: 'rightUpperArm', rightForeArm: 'leftForeArm', leftForeArm: 'rightForeArm',
  rightUpLeg: 'leftUpLeg', leftUpLeg: 'rightUpLeg', rightLeg: 'leftLeg', leftLeg: 'rightLeg', spine: 'spine', head: 'head',
};
/** The same pose done with the other side of the body. PURE. */
export function mirrorPose(p: Pose): Pose {
  const out: Pose = {};
  for (const [role, d] of Object.entries(p) as Array<[ActionRole, V]>) out[MIRROR[role]] = [-d[0], d[1], d[2]];
  return out;
}
const L = mirrorPose;
const both = (right: Pose): Pose => ({ ...right, ...L(right) });

// ── Pose pieces ──────────────────────────────────────────────────────────────────────────────────────────────────────
const ARMS_UP: Pose = both({ rightUpperArm: [-0.3, 1, 0], rightForeArm: [-0.1, 1, 0] });
const ARMS_FWD: Pose = both({ rightUpperArm: [-0.15, 0, 1], rightForeArm: [-0.1, 0, 1] });
const ARMS_OUT: Pose = both({ rightUpperArm: R_SIDE, rightForeArm: R_SIDE });
const GUARD: Pose = both({ rightUpperArm: [-0.35, -0.25, 0.6], rightForeArm: [-0.05, 0.8, 0.5] });
const CROUCH_LEGS: Pose = both({ rightUpLeg: [-0.05, -0.45, 0.9], rightLeg: [0, -0.9, -0.45] });
const SIT_LEGS: Pose = both({ rightUpLeg: [-0.08, -0.1, 1], rightLeg: [0, -1, 0.05] });
const KNEEL_LEGS: Pose = { rightUpLeg: [-0.05, -0.2, 1], rightLeg: [0, -1, 0], leftUpLeg: [0.05, -1, -0.1], leftLeg: [0, -0.1, -1] };
const PUNCH_R: Pose = { rightUpperArm: [-0.08, 0.1, 1], rightForeArm: [-0.05, 0.1, 1], leftUpperArm: [0.35, -0.25, 0.6], leftForeArm: [0.05, 0.8, 0.5] };
const KICK_R: Pose = { rightUpLeg: [-0.05, 0.1, 1], rightLeg: [-0.05, 0.15, 1], leftUpperArm: [0.6, -0.3, 0.3], rightUpperArm: [-0.6, -0.3, -0.2] };
const HAND_TO_MOUTH: Pose = { rightUpperArm: [-0.3, -0.2, 0.9], rightForeArm: [0.4, 0.85, 0.3] };
const HAND_TO_EAR: Pose = { rightUpperArm: [-0.6, -0.3, 0.3], rightForeArm: [0.3, 1, -0.1] };
const HANDS_TOGETHER: Pose = both({ rightUpperArm: [-0.25, -0.5, 0.8], rightForeArm: [0.5, 0.75, 0.4] });
const ON_HEAD: Pose = both({ rightUpperArm: [-0.5, 0.85, 0], rightForeArm: [0.7, 0.6, 0] });
const AIM_RIFLE: Pose = { rightUpperArm: [-0.4, -0.1, 0.9], rightForeArm: [0.2, 0.1, 1], leftUpperArm: [0.1, 0, 1], leftForeArm: [0, 0.05, 1], head: [0, -0.1, 1] };
const AIM_PISTOL: Pose = { rightUpperArm: [-0.05, 0.05, 1], rightForeArm: [0, 0.05, 1] };
const OVERHAND_BACK: Pose = { rightUpperArm: [-0.3, 0.6, -0.7], rightForeArm: [-0.1, 1, -0.3], spine: [0, 1, -0.2] };
const OVERHAND_FWD: Pose = { rightUpperArm: [-0.1, 0.2, 1], rightForeArm: [-0.05, -0.2, 1], spine: [0, 0.9, 0.4] };
const SWING_BACK: Pose = { rightUpperArm: [-0.6, 0.6, -0.5], rightForeArm: [-0.4, 0.9, -0.2], spine: [0.2, 1, 0] };
const SWING_THROUGH: Pose = { rightUpperArm: [0.5, -0.2, 0.85], rightForeArm: [0.6, -0.3, 0.75], spine: [-0.2, 0.95, 0.2] };
const BEND: Pose = { spine: [0, 0.55, 0.85], head: [0, 0.4, 0.9] };
const LEAN_BACK: Pose = { spine: [0, 1, -0.3], head: [0, 1, -0.3] };
const STEP_A: Pose = { rightUpLeg: [0, -0.9, 0.45], rightLeg: [0, -1, 0.1], leftUpLeg: [0, -0.9, -0.4], leftLeg: [0, -0.8, -0.6], rightUpperArm: [-0.1, -0.95, -0.3], leftUpperArm: [0.1, -0.95, 0.3] };
const STEP_B: Pose = mirrorPose(STEP_A);
const RUN_A: Pose = { rightUpLeg: [0, -0.6, 0.8], rightLeg: [0, -0.9, -0.2], leftUpLeg: [0, -0.8, -0.6], leftLeg: [0, -0.3, -0.95], rightUpperArm: [-0.1, -0.7, -0.7], rightForeArm: [0, 0.3, -0.95], leftUpperArm: [0.1, -0.6, 0.8], leftForeArm: [0, 0.7, 0.7], spine: [0, 0.95, 0.25] };
const RUN_B: Pose = mirrorPose(RUN_A);

// ── Builders ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type K = [number, Pose] | [number, Pose, ActionBody];
interface Extra { steps?: ActionStep[]; loop?: boolean; hold?: boolean; requires?: ActionDef['requires'] }
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
/** Numbers kept to three decimals — the form validateAction stores — so every library move validates to itself. */
function tidyBody(body: ActionBody): ActionBody {
  const out: ActionBody = {};
  for (const [f, v] of Object.entries(body) as Array<[keyof ActionBody, number]>) out[f] = r3(v);
  return out;
}
function mv(name: string, seconds: number, keys: K[], extra: Extra = {}): ActionDef {
  const def: ActionDef = { name, seconds, keys: keys.map(([t, pose, body]) => (body && Object.keys(body).length ? { t, pose, body: tidyBody(body) } : { t, pose })) };
  if (extra.steps?.length) def.steps = extra.steps;
  if (extra.loop) def.loop = true;
  if (extra.hold) def.hold = true;
  if (extra.requires) def.requires = extra.requires;
  return def;
}
/** A one-shot: rest → the pose (held a moment) → rest. */
const shot = (name: string, seconds: number, pose: Pose, body?: ActionBody, extra?: Extra): ActionDef =>
  mv(name, seconds, [[0, {}], [0.35, pose, body ?? {}], [0.7, pose, body ?? {}], [1, {}]], extra);
/** A stance: settles into the pose and keeps it until the next move or stopAction. */
const stance = (name: string, seconds: number, pose: Pose, body?: ActionBody, extra?: Extra): ActionDef =>
  mv(name, seconds, [[0, {}], [1, pose, body ?? {}]], { ...extra, hold: true });
/** Real travel in `body` is the total for one cycle: it grows from 0 to that total across the cycle. Shown fields stay. */
function along(body: ActionBody | undefined, share: number): ActionBody {
  const out: ActionBody = { ...(body ?? {}) };
  for (const f of ['forward', 'side', 'turn'] as const) if (typeof out[f] === 'number') out[f] = Math.round((out[f] as number) * share * 1000) / 1000;
  return out;
}
/** A loop between two poses (A → B → A); `body` real travel is per cycle. */
const cycle = (name: string, seconds: number, a: Pose, b: Pose, body?: ActionBody, extra?: Extra): ActionDef =>
  mv(name, seconds, [[0, a, along(body, 0)], [0.5, b, along(body, 0.5)], [1, a, along(body, 1)]], { ...extra, loop: true });
const step = (at: number, s: Omit<ActionStep, 'at'>): ActionStep => ({ at, ...s });
const emit = (at: number, event: string): ActionStep => ({ at, do: 'emit', event });
const PI = Math.PI;

// ── The library (the original nine come first, unchanged) ────────────────────────────────────────────────────────────
export const MOVE_LIBRARY: readonly ActionDef[] = [
  // Movement
  mv('jump', 0.9, [[0, {}], [0.2, CROUCH_LEGS, { rise: -0.12 }], [0.5, { ...ARMS_UP, rightUpLeg: [0, -0.8, 0.5], leftUpLeg: [0, -0.8, 0.5] }, { rise: 0.9 }], [0.85, CROUCH_LEGS, { rise: 0.05 }], [1, {}]], { steps: [emit(0.3, 'JUMPED')] }),
  mv('double-jump', 1.3, [[0, {}], [0.15, CROUCH_LEGS, { rise: -0.12 }], [0.4, ARMS_UP, { rise: 0.9 }], [0.6, CROUCH_LEGS, { rise: 1.3, pitch: PI }], [0.8, ARMS_UP, { rise: 1.0, pitch: 2 * PI }], [1, {}, { pitch: 2 * PI }]], { steps: [emit(0.2, 'JUMPED')] }),
  stance('crouch', 0.4, { ...CROUCH_LEGS, spine: [0, 0.9, 0.4] }, { rise: -0.35 }),
  cycle('crawl', 1.2, { rightUpperArm: [-0.2, -0.3, 0.95], leftUpperArm: [0.2, -0.95, 0.2], ...CROUCH_LEGS }, { leftUpperArm: [0.2, -0.3, 0.95], rightUpperArm: [-0.2, -0.95, 0.2], ...CROUCH_LEGS }, { pitch: 1.35, rise: 0.25, forward: 0.6 }),
  mv('roll', 0.9, [[0, {}], [0.2, CROUCH_LEGS, { rise: -0.3, pitch: 0.6, forward: 0.3 }], [0.6, CROUCH_LEGS, { rise: -0.2, pitch: PI + 0.6, forward: 1.1 }], [1, {}, { pitch: 2 * PI, forward: 1.6 }]]),
  mv('slide', 0.9, [[0, {}], [0.25, { ...both({ rightUpLeg: [0, 0, 1] }), ...LEAN_BACK }, { rise: -0.25, pitch: -0.9, forward: 1.2 }], [0.75, both({ rightUpLeg: [0, 0, 1] }), { rise: -0.25, pitch: -0.9, forward: 2.4 }], [1, {}, { forward: 2.6 }]]),
  mv('sidestep-left', 0.5, [[0, {}], [0.5, { leftUpLeg: [0.5, -0.85, 0] }, { roll: 0.08, side: 0.5 }], [1, {}, { side: 0.8 }]]),
  mv('sidestep-right', 0.5, [[0, {}], [0.5, { rightUpLeg: [-0.5, -0.85, 0] }, { roll: -0.08, side: -0.5 }], [1, {}, { side: -0.8 }]]),
  mv('turn-around', 0.6, [[0, {}], [0.5, STEP_A, { turn: PI / 2 }], [1, {}, { turn: PI }]]),
  cycle('walk', 1.0, STEP_A, STEP_B, { forward: 1.2 }),
  cycle('walk-backwards', 1.1, STEP_B, STEP_A, { forward: -0.9 }),
  cycle('run', 0.65, RUN_A, RUN_B, { forward: 2.6 }),
  cycle('sprint', 0.5, { ...RUN_A, spine: [0, 0.85, 0.5] }, { ...RUN_B, spine: [0, 0.85, 0.5] }, { forward: 3.2, pitch: 0.15 }),
  cycle('sneak', 1.4, { ...STEP_A, ...CROUCH_LEGS, spine: [0, 0.85, 0.5] }, { ...STEP_B, ...CROUCH_LEGS, spine: [0, 0.85, 0.5] }, { rise: -0.3, forward: 0.7 }),
  cycle('limp', 1.3, STEP_A, { ...STEP_B, rightLeg: [0, -1, 0.3] }, { roll: 0.08, forward: 0.7 }),
  mv('climb-ladder', 2.0, [[0, {}], [0.25, { rightUpperArm: UP, rightForeArm: UP, leftUpperArm: [0.2, 0.6, 0.6], leftUpLeg: [0, -0.4, 0.9], leftLeg: [0, -1, 0] }, { rise: 0.3 }], [0.5, { leftUpperArm: UP, leftForeArm: UP, rightUpperArm: [-0.2, 0.6, 0.6], rightUpLeg: [0, -0.4, 0.9], rightLeg: [0, -1, 0] }, { rise: 0.65 }], [0.75, { rightUpperArm: UP, rightForeArm: UP, leftUpperArm: [0.2, 0.6, 0.6], leftUpLeg: [0, -0.4, 0.9] }, { rise: 1.0 }], [1, {}, { rise: 1.2 }]], { steps: [emit(1, 'CLIMBED')] }),
  mv('climb-wall', 1.6, [[0, {}], [0.3, { ...ARMS_UP, spine: [0, 0.95, 0.3] }, { rise: 0.4 }], [0.7, { ...ARMS_FWD, ...CROUCH_LEGS }, { rise: 1.4, pitch: 0.5, forward: 0.3 }], [1, {}, { rise: 1.6, forward: 0.6 }]], { steps: [emit(1, 'CLIMBED')] }),
  mv('vault', 0.8, [[0, {}], [0.4, { ...ARMS_FWD, ...both({ rightUpLeg: [0, 0, 1] }) }, { rise: 0.7, roll: 0.4, forward: 0.8 }], [1, {}, { forward: 1.6 }]]),
  // Water and air
  cycle('swim', 1.2, { rightUpperArm: [-0.15, 0, 1], leftUpperArm: [0.2, -0.3, -0.9], rightUpLeg: [0, -0.95, -0.2], leftUpLeg: [0, -0.95, 0.2] }, { leftUpperArm: [0.15, 0, 1], rightUpperArm: [-0.2, -0.3, -0.9], rightUpLeg: [0, -0.95, 0.2], leftUpLeg: [0, -0.95, -0.2] }, { pitch: 1.45, rise: -0.3, forward: 1.3 }, { requires: 'water' }),
  cycle('tread-water', 1.4, both({ rightUpperArm: [-0.8, -0.4, 0.4], rightUpLeg: [0, -0.9, 0.3] }), both({ rightUpperArm: [-0.8, -0.4, -0.4], rightUpLeg: [0, -0.9, -0.3] }), { rise: -0.9 }, { requires: 'water' }),
  stance('float', 0.8, ARMS_OUT, { pitch: -1.5, rise: -0.25 }, { requires: 'water' }),
  mv('dive', 1.0, [[0, {}], [0.3, ARMS_UP, { rise: 0.4, pitch: 0.4 }], [0.7, ARMS_UP, { rise: -0.6, pitch: 1.9, forward: 1.2 }], [1, ARMS_UP, { rise: -1.2, pitch: 1.6, forward: 1.8 }]], { requires: 'water', steps: [emit(0.7, 'SPLASHED')] }),
  shot('splash', 0.6, both({ rightUpperArm: [-0.6, -0.5, 0.6], rightForeArm: [-0.3, -0.9, 0.3] }), { rise: -0.6 }, { requires: 'water', steps: [emit(0.5, 'SPLASHED')] }),
  mv('fall', 0.9, [[0, {}], [0.4, { ...ARMS_UP, rightUpLeg: [0, -0.7, 0.7] }, { pitch: -0.3 }], [1, CROUCH_LEGS, { rise: -0.25 }]], { steps: [emit(1, 'LANDED')] }),
  shot('land', 0.5, { ...CROUCH_LEGS, ...both({ rightUpperArm: [-0.6, -0.6, 0.4] }) }, { rise: -0.3 }),
  stance('parachute', 0.6, { ...both({ rightUpperArm: [-0.4, 0.9, 0], rightForeArm: [-0.1, 1, 0] }), ...both({ rightUpLeg: [0, -1, 0.15] }) }),
  stance('skydive', 0.6, { ...ARMS_OUT, ...both({ rightUpLeg: [-0.4, -0.3, -0.85] }) }, { pitch: 1.5, rise: 0.6 }),
  // Fighting — a strike lands on whatever stands in front: a character loses health, a car or crate is shoved
  shot('punch', 0.5, PUNCH_R, { yaw: -0.2 }, { steps: [step(0.4, { do: 'strike', damage: 10, force: 3 })] }),
  shot('left-punch', 0.5, L(PUNCH_R), { yaw: 0.2 }, { steps: [step(0.4, { do: 'strike', damage: 10, force: 3 })] }),
  mv('uppercut', 0.6, [[0, {}], [0.3, { ...GUARD, rightUpperArm: [-0.3, -0.8, 0.4] }, { rise: -0.1 }], [0.55, { rightUpperArm: [-0.1, 0.7, 0.7], rightForeArm: [0, 1, 0.1] }, { rise: 0.1 }], [1, {}]], { steps: [step(0.55, { do: 'strike', damage: 15, force: 4 })] }),
  mv('hook-punch', 0.6, [[0, {}], [0.3, { rightUpperArm: [-1, 0, 0.1], rightForeArm: [0, 0, 1] }, { yaw: -0.4 }], [0.55, { rightUpperArm: [-0.2, 0, 1], rightForeArm: [0.8, 0, 0.5] }, { yaw: 0.3 }], [1, {}]], { steps: [step(0.55, { do: 'strike', damage: 14, force: 4 })] }),
  shot('kick', 0.6, KICK_R, { pitch: -0.15 }, { steps: [step(0.45, { do: 'strike', damage: 15, force: 6 })] }),
  shot('side-kick', 0.6, { rightUpLeg: [-1, 0.1, 0.1], rightLeg: [-1, 0.1, 0.1], leftUpperArm: [0.7, 0, 0.3] }, { roll: 0.5, yaw: -0.9 }, { steps: [step(0.45, { do: 'strike', damage: 16, force: 7 })] }),
  mv('flying-kick', 0.9, [[0, {}], [0.25, CROUCH_LEGS, { rise: -0.15 }], [0.55, KICK_R, { rise: 0.8, pitch: -0.3, forward: 1.0 }], [1, {}, { forward: 1.5 }]], { steps: [step(0.55, { do: 'strike', damage: 25, force: 9 })] }),
  mv('roundhouse-kick', 0.9, [[0, {}], [0.3, { rightUpLeg: [-0.8, 0.2, 0.4] }, { yaw: PI * 0.7, roll: 0.3 }], [0.6, { rightUpLeg: [-1, 0.25, 0.1], rightLeg: [-1, 0.25, 0.1] }, { yaw: PI * 1.4, roll: 0.4 }], [1, {}, { yaw: 2 * PI }]], { steps: [step(0.6, { do: 'strike', damage: 22, force: 8 })] }),
  shot('kick-car', 0.7, { ...KICK_R, spine: [0, 1, -0.15] }, { pitch: -0.2 }, { steps: [step(0.5, { do: 'strike', damage: 5, force: 12, near: 'car' })] }),
  shot('stomp', 0.6, { rightUpLeg: [0, -0.3, 0.95], rightLeg: [0, -1, 0] }, undefined, { steps: [step(0.65, { do: 'strike', damage: 12, force: 2 })] }),
  shot('block', 0.8, GUARD, { pitch: 0.1 }),
  mv('dodge', 0.6, [[0, {}], [0.4, { ...GUARD, ...CROUCH_LEGS }, { roll: 0.35, side: 0.6, rise: -0.2 }], [1, {}, { side: 0.7 }]]),
  shot('duck', 0.6, { ...CROUCH_LEGS, ...GUARD }, { rise: -0.6, pitch: 0.3 }),
  shot('elbow-strike', 0.5, { rightUpperArm: [-0.9, 0.1, 0.4], rightForeArm: [0.6, 0.2, 0.75] }, { yaw: 0.4 }, { steps: [step(0.4, { do: 'strike', damage: 14, force: 3 })] }),
  shot('knee-strike', 0.5, { rightUpLeg: [0, 0.4, 0.9], rightLeg: [0, -1, 0], ...both({ rightUpperArm: [-0.2, 0, 1] }) }, undefined, { steps: [step(0.4, { do: 'strike', damage: 14, force: 4 })] }),
  shot('headbutt', 0.5, { head: [0, 0.4, 0.9], spine: [0, 0.7, 0.7] }, { forward: 0.2 }, { steps: [step(0.4, { do: 'strike', damage: 12, force: 3 })] }),
  shot('push', 0.6, ARMS_FWD, { pitch: 0.2 }, { steps: [step(0.4, { do: 'push', force: 6 })] }),
  shot('shove', 0.6, { ...ARMS_FWD, spine: [0, 0.85, 0.5] }, { pitch: 0.3, forward: 0.3 }, { steps: [step(0.45, { do: 'push', force: 10 })] }),
  shot('grab', 0.6, both({ rightUpperArm: [-0.1, 0, 1], rightForeArm: [0.4, 0, 0.9] }), undefined, { steps: [step(0.45, { do: 'pickUp' }), emit(0.45, 'GRABBED')] }),
  shot('get-hit', 0.5, { spine: [0, 1, -0.35], head: [0, 0.9, -0.4], ...both({ rightUpperArm: [-0.5, -0.5, 0.6] }) }, { pitch: -0.25 }),
  mv('knocked-down', 2.4, [[0, {}], [0.25, ARMS_UP, { pitch: -1.55, rise: 0.12 }], [0.6, ARMS_OUT, { pitch: -1.55, rise: 0.12 }], [0.85, { ...CROUCH_LEGS, spine: [0, 0.6, 0.8] }, { rise: -0.35 }], [1, {}]], { steps: [emit(0.25, 'KNOCKED_DOWN')] }),
  mv('die', 1.2, [[0, {}], [0.3, { spine: [0, 1, -0.4], ...ARMS_UP }, { pitch: -0.4 }], [1, ARMS_OUT, { pitch: -1.55, rise: 0.12 }]], { hold: true, steps: [emit(0.9, 'CHARACTER_DIED')] }),
  stance('play-dead', 0.8, ARMS_OUT, { pitch: -1.55, rise: 0.12 }),
  mv('get-up', 1.2, [[0, ARMS_OUT, { pitch: -1.55, rise: 0.12 }], [0.5, { ...KNEEL_LEGS, spine: [0, 0.8, 0.6] }, { rise: -0.4 }], [1, {}]]),
  cycle('taunt', 1.2, { rightUpperArm: [-0.3, 0.2, 0.9], rightForeArm: [0, 1, 0.3] }, { rightUpperArm: [-0.3, 0.2, 0.9], rightForeArm: [0, 0.6, 0.8] }),
  shot('fist-pump', 0.8, { rightUpperArm: [-0.2, 1, 0.1], rightForeArm: [0, 1, 0] }, undefined, { steps: [emit(0.4, 'CELEBRATED')] }),
  // Weapons — fire hits the first character in the line of the shot; throw sends the held item flying
  shot('fire-pistol', 0.5, AIM_PISTOL, undefined, { steps: [step(0.4, { do: 'fire', damage: 20 })] }),
  shot('fire-rifle', 0.5, AIM_RIFLE, undefined, { steps: [step(0.4, { do: 'fire', damage: 25 })] }),
  stance('aim', 0.4, AIM_RIFLE),
  mv('reload', 1.4, [[0, AIM_RIFLE], [0.3, { ...AIM_RIFLE, leftUpperArm: [0.2, -0.6, 0.7], leftForeArm: [0.1, 0.2, 1] }], [0.6, { ...AIM_RIFLE, leftUpperArm: [0.1, -0.2, 0.95] }], [1, {}]], { steps: [emit(0.9, 'RELOADED')] }),
  mv('throw-grenade', 1.0, [[0, {}], [0.4, OVERHAND_BACK, { yaw: -0.3 }], [0.6, OVERHAND_FWD, { yaw: 0.2 }], [1, {}]], { steps: [step(0.6, { do: 'throw', force: 12 }), emit(0.6, 'GRENADE_THROWN')] }),
  mv('knife-slash', 0.5, [[0, {}], [0.3, { rightUpperArm: [-0.9, 0.3, 0.2], rightForeArm: [-0.6, 0.3, 0.6] }], [0.6, { rightUpperArm: [0.4, 0, 0.9], rightForeArm: [0.6, -0.1, 0.8] }], [1, {}]], { steps: [step(0.55, { do: 'strike', damage: 20, force: 2 })] }),
  mv('sword-swing', 0.8, [[0, {}], [0.35, SWING_BACK, { yaw: -0.5 }], [0.6, SWING_THROUGH, { yaw: 0.4 }], [1, {}]], { steps: [step(0.6, { do: 'strike', damage: 30, force: 5 })] }),
  shot('spear-thrust', 0.6, { rightUpperArm: [-0.1, 0, 1], rightForeArm: [0, 0, 1], leftUpperArm: [0.2, -0.2, 0.9] }, { forward: 0.3, pitch: 0.2 }, { steps: [step(0.45, { do: 'strike', damage: 22, force: 4 })] }),
  mv('bow-shoot', 1.2, [[0, {}], [0.4, { leftUpperArm: [0.05, 0.05, 1], leftForeArm: [0, 0.05, 1], rightUpperArm: [-0.8, 0.1, 0.4], rightForeArm: [0.7, 0, -0.6] }], [0.7, { leftUpperArm: [0.05, 0.05, 1], leftForeArm: [0, 0.05, 1], rightUpperArm: [-0.8, 0.1, -0.2] }], [1, {}]], { steps: [step(0.65, { do: 'fire', damage: 22 }), emit(0.65, 'ARROW_FIRED')] }),
  shot('swap-weapon', 0.7, { rightUpperArm: [-0.4, -0.5, -0.7], rightForeArm: [0, 0.4, -0.9] }, undefined, { steps: [emit(0.5, 'WEAPON_SWAPPED')] }),
  shot('holster', 0.6, { rightUpperArm: [-0.3, -0.9, -0.1], rightForeArm: [0, -0.9, 0.3] }, undefined, { steps: [emit(0.5, 'WEAPON_HOLSTERED')] }),
  stance('take-cover', 0.5, { ...CROUCH_LEGS, ...GUARD, spine: [0, 0.8, 0.6] }, { rise: -0.4 }),
  shot('crouch-fire', 0.6, { ...AIM_RIFLE, ...KNEEL_LEGS }, { rise: -0.45 }, { steps: [step(0.45, { do: 'fire', damage: 25 })] }),
  mv('throw', 0.8, [[0, {}], [0.4, OVERHAND_BACK], [0.6, OVERHAND_FWD], [1, {}]], { steps: [step(0.6, { do: 'throw', force: 10 })] }),
  // Vehicles
  shot('open-car-door', 0.9, { rightUpperArm: [-0.3, -0.1, 0.95], rightForeArm: [0.2, 0, 1], spine: [0, 0.95, 0.3] }, { yaw: -0.2 }, { steps: [step(0.5, { do: 'open', near: 'car' }), emit(0.5, 'CAR_DOOR_OPENED')] }),
  shot('close-car-door', 0.8, { rightUpperArm: [-0.6, -0.2, 0.7], rightForeArm: [0.3, 0, 0.9] }, { yaw: 0.3 }, { steps: [emit(0.5, 'CAR_DOOR_CLOSED')] }),
  shot('get-in-car', 1.0, { ...SIT_LEGS, ...ARMS_FWD }, { rise: -0.4, turn: 0 }, { requires: 'vehicle', steps: [step(0.7, { do: 'enterVehicle' })] }),
  shot('get-out-car', 0.9, { rightUpLeg: [-0.3, -0.5, 0.8], rightUpperArm: [-0.4, -0.2, 0.8] }, undefined, { requires: 'seated', steps: [step(0.3, { do: 'exitVehicle' })] }),
  stance('drive', 0.5, { ...SIT_LEGS, ...both({ rightUpperArm: [-0.25, -0.2, 0.95], rightForeArm: [0.2, 0.2, 0.95] }) }, { rise: -0.45 }),
  stance('ride-bike', 0.5, { ...both({ rightUpLeg: [-0.3, -0.2, 0.9], rightLeg: [0, -1, 0.1], rightUpperArm: [-0.35, -0.3, 0.9] }), spine: [0, 0.85, 0.5] }, { rise: -0.3 }),
  shot('honk', 0.5, both({ rightUpperArm: [-0.2, -0.3, 0.95], rightForeArm: [0.5, -0.1, 0.85] }), undefined, { steps: [emit(0.35, 'HONK')] }),
  cycle('push-car', 1.0, { ...ARMS_FWD, ...STEP_A, spine: [0, 0.7, 0.7] }, { ...ARMS_FWD, ...STEP_B, spine: [0, 0.7, 0.7] }, { pitch: 0.4, forward: 0.4 }, { steps: [step(0.5, { do: 'push', force: 5, near: 'car' })] }),
  cycle('fix-car', 1.0, { ...KNEEL_LEGS, ...BEND, rightUpperArm: [-0.2, -0.3, 0.9], rightForeArm: [0, 0.4, 0.9] }, { ...KNEEL_LEGS, ...BEND, rightUpperArm: [-0.2, -0.5, 0.85], rightForeArm: [0, -0.2, 1] }, { rise: -0.45 }, { steps: [emit(0.5, 'CAR_FIXING')] }),
  shot('wave-down', 1.2, { rightUpperArm: [-0.7, 0.7, 0.2], rightForeArm: [-0.3, 1, 0] }, undefined, { steps: [emit(0.5, 'WAVED_DOWN')] }),
  // Objects
  stance('carry-box', 0.5, both({ rightUpperArm: [-0.2, -0.4, 0.9], rightForeArm: [0.4, 0.1, 0.9] })),
  cycle('push-box', 1.0, { ...ARMS_FWD, ...STEP_A }, { ...ARMS_FWD, ...STEP_B }, { pitch: 0.35, forward: 0.5 }, { steps: [step(0.5, { do: 'push', force: 4 })] }),
  shot('close-door', 0.8, { rightUpperArm: [-0.4, 0, 0.9], rightForeArm: [0.2, 0, 1] }, { yaw: 0.2 }, { steps: [step(0.5, { do: 'open' })] }),
  cycle('knock-door', 0.6, { rightUpperArm: [-0.3, 0.1, 0.95], rightForeArm: [0, 0.6, 0.8] }, { rightUpperArm: [-0.3, 0.1, 0.95], rightForeArm: [0, 0.2, 1] }, undefined, { steps: [emit(0.5, 'KNOCK')] }),
  shot('open-chest', 1.2, { ...KNEEL_LEGS, ...BEND, ...both({ rightUpperArm: [-0.2, -0.6, 0.8], rightForeArm: [0, 0.2, 1] }) }, { rise: -0.45 }, { steps: [step(0.6, { do: 'open', near: 'chest' }), emit(0.6, 'CHEST_OPENED')] }),
  stance('use-phone', 0.6, { ...HAND_TO_EAR, head: [0.2, 1, 0.1] }),
  stance('read-book', 0.6, { ...both({ rightUpperArm: [-0.2, -0.7, 0.6], rightForeArm: [0.3, 0.3, 0.9] }), head: [0, 0.6, 0.8] }),
  shot('press-button', 0.7, { rightUpperArm: [-0.15, 0.1, 1], rightForeArm: [-0.1, 0.1, 1] }, undefined, { steps: [step(0.4, { do: 'open', near: 'button' }), emit(0.4, 'BUTTON_PRESSED')] }),
  shot('kick-ball', 0.6, KICK_R, undefined, { steps: [step(0.45, { do: 'push', force: 9, near: 'ball' })] }),
  shot('catch', 0.6, both({ rightUpperArm: [-0.2, 0.1, 1], rightForeArm: [0.3, 0.3, 0.9] }), undefined, { steps: [step(0.5, { do: 'pickUp', near: 'ball' })] }),
  // Daily life
  stance('sit', 0.6, { ...SIT_LEGS, spine: [0, 1, -0.05] }, { rise: -0.45 }),
  stance('sit-on-ground', 0.8, { ...both({ rightUpLeg: [-0.3, 0, 1], rightLeg: [0.4, 0, -0.9] }), ...both({ rightUpperArm: [-0.2, -0.9, 0.3] }) }, { rise: -0.8 }),
  stance('sleep', 1.0, both({ rightUpperArm: [-0.2, -0.95, 0.2] }), { pitch: -1.55, rise: 0.12 }),
  stance('lie-down', 1.0, ARMS_OUT, { pitch: -1.55, rise: 0.12 }),
  mv('stand-up', 0.8, [[0, SIT_LEGS, { rise: -0.45 }], [0.6, { ...CROUCH_LEGS, spine: [0, 0.8, 0.6] }, { rise: -0.2 }], [1, {}]]),
  cycle('cook', 1.0, { rightUpperArm: [-0.2, -0.5, 0.85], rightForeArm: [0.3, -0.3, 0.9], head: [0, 0.6, 0.8] }, { rightUpperArm: [-0.4, -0.5, 0.75], rightForeArm: [-0.2, -0.3, 0.9], head: [0, 0.6, 0.8] }, undefined, { steps: [emit(0.5, 'COOKING')] }),
  cycle('sweep', 1.0, { ...BEND, ...both({ rightUpperArm: [-0.4, -0.7, 0.6] }), rightForeArm: [0.4, -0.8, 0.4] }, { ...BEND, ...both({ rightUpperArm: [0.2, -0.7, 0.6] }), rightForeArm: [0.6, -0.7, 0.3] }),
  cycle('wash-hands', 0.8, HANDS_TOGETHER, both({ rightUpperArm: [-0.25, -0.6, 0.75], rightForeArm: [0.6, 0.5, 0.6] })),
  cycle('dig', 1.1, { ...SWING_BACK, spine: [0, 1, 0] }, { rightUpperArm: [-0.2, -0.6, 0.8], rightForeArm: [0, -0.9, 0.4], spine: [0, 0.6, 0.8] }, undefined, { steps: [emit(0.5, 'DUG')] }),
  cycle('water-plants', 1.4, { rightUpperArm: [-0.3, -0.2, 0.9], rightForeArm: [-0.1, -0.3, 0.95] }, { rightUpperArm: [-0.3, -0.2, 0.9], rightForeArm: [-0.1, -0.7, 0.7] }, undefined, { steps: [emit(0.5, 'WATERED')] }),
  cycle('chop-wood', 1.0, { ...both({ rightUpperArm: [-0.2, 1, -0.2] }), spine: [0, 1, -0.15] }, { ...both({ rightUpperArm: [-0.1, -0.5, 0.85] }), spine: [0, 0.6, 0.8] }, undefined, { steps: [step(0.5, { do: 'strike', damage: 5, force: 1, near: 'tree' }), emit(0.5, 'CHOPPED')] }),
  cycle('hammer', 0.7, { rightUpperArm: [-0.3, 0.6, 0.6], rightForeArm: [0, 1, 0.1] }, { rightUpperArm: [-0.2, -0.3, 0.9], rightForeArm: [0, -0.6, 0.8] }, undefined, { steps: [emit(0.5, 'HAMMERED')] }),
  // Social
  stance('namaste', 0.7, { ...HANDS_TOGETHER, head: [0, 0.85, 0.5] }),
  cycle('clap', 0.5, both({ rightUpperArm: [-0.4, -0.3, 0.85], rightForeArm: [-0.3, 0.5, 0.8] }), HANDS_TOGETHER, undefined, { steps: [emit(0.5, 'CLAP')] }),
  cycle('cheer', 0.8, ARMS_UP, both({ rightUpperArm: [-0.7, 0.7, 0], rightForeArm: [-0.4, 0.9, 0] }), { rise: 0.15 }),
  cycle('laugh', 0.6, { spine: [0, 0.9, 0.4], head: [0, 0.8, 0.6], ...both({ rightUpperArm: [-0.2, -0.8, 0.5] }) }, { spine: [0, 1, -0.2], head: [0, 1, -0.3] }),
  cycle('cry', 1.2, { ...both({ rightUpperArm: [-0.3, -0.3, 0.9], rightForeArm: [0.3, 0.9, 0.3] }), head: [0, 0.5, 0.85] }, { ...both({ rightUpperArm: [-0.3, -0.35, 0.85], rightForeArm: [0.3, 0.85, 0.3] }), head: [0, 0.45, 0.9], spine: [0, 0.9, 0.4] }),
  cycle('angry', 0.6, { rightUpperArm: [-0.3, 0.2, 0.9], rightForeArm: [0, 1, 0.2], leftUpperArm: [0.3, -0.8, 0.2] }, { rightUpperArm: [-0.3, 0.1, 0.95], rightForeArm: [0, 0.7, 0.7], leftUpperArm: [0.3, -0.8, 0.2], rightUpLeg: [0, -0.7, 0.6] }),
  shot('shrug', 0.9, { ...both({ rightUpperArm: [-0.5, -0.6, 0.4], rightForeArm: [-0.6, 0.2, 0.7] }), head: [0.2, 1, 0] }),
  shot('salute', 1.2, { rightUpperArm: [-0.8, 0.4, 0.4], rightForeArm: [0.7, 0.7, 0.1], head: [0, 1, 0.1] }),
  cycle('handshake', 0.5, { rightUpperArm: [-0.1, -0.5, 0.85], rightForeArm: [0, -0.1, 1] }, { rightUpperArm: [-0.1, -0.6, 0.8], rightForeArm: [0, -0.3, 0.95] }, undefined, { steps: [emit(0.5, 'HANDSHAKE')] }),
  shot('hug', 1.4, both({ rightUpperArm: [-0.4, 0, 0.9], rightForeArm: [0.8, 0, 0.5] }), { forward: 0.2 }, { steps: [emit(0.5, 'HUG')] }),
  shot('high-five', 0.6, { rightUpperArm: [-0.3, 0.8, 0.5], rightForeArm: [-0.1, 1, 0.2] }, undefined, { steps: [emit(0.4, 'HIGH_FIVE')] }),
  shot('thumbs-up', 1.0, { rightUpperArm: [-0.2, -0.3, 0.95], rightForeArm: [0, 0.8, 0.6] }),
  shot('facepalm', 1.2, { rightUpperArm: [-0.3, -0.2, 0.9], rightForeArm: [0.4, 0.85, 0.3], head: [0, 0.6, 0.8] }),
  stance('think', 0.7, { rightUpperArm: [-0.2, -0.6, 0.75], rightForeArm: [0.2, 0.9, 0.3], leftUpperArm: [0.2, -0.6, 0.75], leftForeArm: [-0.6, 0.3, 0.7], head: [0.15, 0.95, 0.2] }),
  cycle('beckon', 0.7, { rightUpperArm: [-0.2, 0, 1], rightForeArm: [0, 0.3, 1] }, { rightUpperArm: [-0.2, 0, 1], rightForeArm: [0, 1, -0.2] }, undefined, { steps: [emit(0.5, 'CALLED_OVER')] }),
  // Dance and fitness
  cycle('dance', 1.0, { ...ARMS_UP, rightUpLeg: [-0.3, -0.9, 0.2] }, { ...both({ rightUpperArm: [-0.8, -0.2, 0.5], rightForeArm: [-0.2, 0.9, 0.3] }), leftUpLeg: [0.3, -0.9, 0.2] }, { roll: 0.15, rise: 0.05 }),
  cycle('bhangra', 0.8, { rightUpperArm: [-0.5, 0.85, 0], rightForeArm: [-0.2, 1, 0], leftUpperArm: [0.6, 0.8, 0], leftForeArm: [0.2, 1, 0], rightUpLeg: [0, -0.3, 0.95], rightLeg: [0, -1, 0] }, { leftUpperArm: [0.5, 0.85, 0], leftForeArm: [0.2, 1, 0], rightUpperArm: [-0.6, 0.8, 0], rightForeArm: [-0.2, 1, 0], leftUpLeg: [0, -0.3, 0.95], leftLeg: [0, -1, 0] }, { rise: 0.12 }),
  cycle('garba', 1.2, { rightUpperArm: [-0.6, 0.6, 0.5], rightForeArm: [0.2, 1, 0.2], leftUpperArm: [0.7, 0.3, 0], ...STEP_A }, { leftUpperArm: [0.6, 0.6, 0.5], leftForeArm: [-0.2, 1, 0.2], rightUpperArm: [-0.7, 0.3, 0], ...STEP_B }, { turn: PI / 3, rise: 0.05 }, { steps: [emit(0.5, 'CLAP')] }),
  mv('celebrate', 1.4, [[0, {}], [0.25, ARMS_UP, { rise: 0.5 }], [0.5, CROUCH_LEGS, { rise: -0.1 }], [0.75, ARMS_UP, { rise: 0.5 }], [1, {}]], { steps: [emit(0.25, 'CELEBRATED')] }),
  stance('victory-pose', 0.6, { rightUpperArm: [-0.3, 1, 0.1], rightForeArm: [0, 1, 0], leftUpperArm: [0.3, -0.6, 0.3], leftForeArm: [-0.6, 0.4, 0.5] }),
  cycle('push-ups', 1.2, both({ rightUpperArm: [-0.25, -1, 0.1], rightForeArm: [0, -1, 0] }), both({ rightUpperArm: [-0.7, -0.3, -0.2], rightForeArm: [0, -1, 0] }), { pitch: 1.3, rise: 0.45 }, { steps: [emit(0.5, 'PUSH_UP')] }),
  cycle('sit-ups', 1.4, { ...ARMS_UP, ...CROUCH_LEGS }, { ...HANDS_TOGETHER, ...CROUCH_LEGS }, { pitch: -1.0, rise: -0.3 }),
  cycle('jumping-jacks', 0.7, both({ rightUpperArm: DOWN, rightUpLeg: DOWN }), both({ rightUpperArm: [-0.6, 0.8, 0], rightUpLeg: [-0.35, -0.94, 0] }), { rise: 0.15 }),
  stance('yoga', 1.2, { rightUpperArm: UP, rightForeArm: UP, leftUpperArm: UP, leftForeArm: UP, rightUpLeg: [-0.8, -0.5, 0.2], rightLeg: [0.9, -0.3, 0] }),
  shot('stretch', 1.6, { ...ARMS_UP, spine: [0, 1, -0.15] }, { rise: 0.05 }),
  // Roles
  shot('police-whistle', 1.0, HAND_TO_MOUTH, undefined, { steps: [emit(0.4, 'WHISTLE')] }),
  shot('handcuff', 1.4, both({ rightUpperArm: [-0.15, -0.3, 0.95], rightForeArm: [0.4, 0, 0.9] }), { forward: 0.15 }, { steps: [emit(0.8, 'HANDCUFFED')] }),
  stance('stop-signal', 0.5, { rightUpperArm: [-0.1, 0.25, 1], rightForeArm: [0, 1, 0.2] }),
  cycle('direct-traffic', 1.4, { rightUpperArm: [-1, 0, 0], rightForeArm: [-1, 0, 0] }, { rightUpperArm: [-0.4, 0, 0.9], rightForeArm: [0.5, 0, 0.85] }),
  shot('sell', 1.0, both({ rightUpperArm: [-0.2, -0.3, 0.95], rightForeArm: [0, -0.1, 1] }), { pitch: 0.15 }, { steps: [emit(0.5, 'OFFERED')] }),
  cycle('plough', 1.4, { ...ARMS_FWD, ...STEP_A, spine: [0, 0.8, 0.55] }, { ...ARMS_FWD, ...STEP_B, spine: [0, 0.8, 0.55] }, { forward: 0.8, pitch: 0.3 }),
  shot('check-pulse', 1.6, { ...KNEEL_LEGS, ...BEND, rightUpperArm: [-0.2, -0.6, 0.8], rightForeArm: [0, -0.5, 0.85] }, { rise: -0.45 }, { steps: [emit(0.6, 'PULSE_CHECKED')] }),
  cycle('patrol-look', 2.4, { head: [0.6, 0.1, 0.8] }, { head: [-0.6, 0.1, 0.8] }),
  stance('carry-on-head', 0.6, ON_HEAD),
  mv('cast-net', 1.2, [[0, {}], [0.4, { ...SWING_BACK, leftUpperArm: [0.6, 0.6, -0.5] }, { yaw: -0.6 }], [0.65, both({ rightUpperArm: [-0.5, 0.3, 0.8] }), { yaw: 0.4 }], [1, {}]], { steps: [emit(0.65, 'NET_CAST')] }),
  // States
  cycle('stunned', 1.2, { head: [0.3, 0.9, 0.2], spine: [0.15, 1, 0] }, { head: [-0.3, 0.9, 0.2], spine: [-0.15, 1, 0] }, { roll: 0.08 }),
  mv('faint', 1.3, [[0, {}], [0.4, { head: [0, 0.6, 0.8], ...both({ rightUpperArm: DOWN }) }, { pitch: 0.2, rise: -0.15 }], [1, ARMS_OUT, { pitch: -1.55, rise: 0.12 }]], { hold: true, steps: [emit(1, 'FAINTED')] }),
  cycle('shiver', 0.25, both({ rightUpperArm: [-0.15, -0.8, 0.55], rightForeArm: [0.5, 0.6, 0.6] }), both({ rightUpperArm: [-0.12, -0.8, 0.58], rightForeArm: [0.55, 0.55, 0.6] })),
  cycle('look-around', 2.0, { head: [0.7, 0.2, 0.7], spine: [0.15, 1, 0] }, { head: [-0.7, 0.2, 0.7], spine: [-0.15, 1, 0] }),
  // A few more everyday and game moves
  cycle('dance-robot', 0.8, { rightUpperArm: R_SIDE, rightForeArm: UP, leftUpperArm: [0.2, -0.95, 0] }, { leftUpperArm: [1, 0, 0], leftForeArm: UP, rightUpperArm: [-0.2, -0.95, 0] }),
  shot('kneel', 0.8, KNEEL_LEGS, { rise: -0.45 }, { hold: true }),
  shot('pray', 1.6, { ...HANDS_TOGETHER, ...KNEEL_LEGS, head: [0, 0.6, 0.8] }, { rise: -0.45 }),
  shot('look-up', 1.2, { head: [0, 1, -0.6] }),
  shot('look-down', 1.0, { head: [0, 0.3, 0.95] }),
  shot('nod', 0.6, { head: [0, 0.5, 0.9] }),
  cycle('shake-head', 0.5, { head: [0.5, 0.2, 0.85] }, { head: [-0.5, 0.2, 0.85] }),
  shot('pick-up-heavy', 1.6, { ...KNEEL_LEGS, ...BEND, ...both({ rightUpperArm: [-0.2, -0.8, 0.55], rightForeArm: [0.4, -0.5, 0.75] }) }, { rise: -0.4 }, { steps: [step(0.6, { do: 'pickUp' })] }),
  shot('put-on-shelf', 1.0, { rightUpperArm: [-0.2, 0.7, 0.7], rightForeArm: [0, 0.6, 0.8] }, undefined, { steps: [step(0.5, { do: 'drop' })] }),
  shot('wipe-sweat', 1.2, { rightUpperArm: [-0.4, 0.2, 0.9], rightForeArm: [0.6, 0.7, 0.3] }),
  cycle('jog-in-place', 0.6, { rightUpLeg: [0, -0.5, 0.85], rightLeg: [0, -1, 0], rightUpperArm: [-0.1, -0.7, -0.6], leftUpperArm: [0.1, -0.7, 0.6] }, { leftUpLeg: [0, -0.5, 0.85], leftLeg: [0, -1, 0], leftUpperArm: [0.1, -0.7, -0.6], rightUpperArm: [-0.1, -0.7, 0.6] }, { rise: 0.05 }),
  shot('point-up', 1.0, { rightUpperArm: [-0.1, 1, 0.2], rightForeArm: [0, 1, 0.1] }),
  shot('point-down', 1.0, { rightUpperArm: FWD_DOWN, rightForeArm: FWD_DOWN }),
  shot('reach-forward', 0.9, { rightUpperArm: FWD_UP, rightForeArm: FWD }, { pitch: 0.2 }),
  shot('look-behind', 1.0, { head: [0.9, 0.1, -0.3], spine: [0.4, 1, -0.2] }),
  shot('stand-guard', 1.0, both({ rightUpperArm: BACK_DOWN }), undefined, { hold: true }),
];

/**
 * The words people type for a move — English, Hindi and Hinglish — and the library name each means. The kit's
 * actionKey reads this same table (injected as JSON), so a builder or a game that says "laat" plays 'kick'. PURE data.
 */
export const MOVE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  // the original kit aliases
  pickup: 'pick-up', grab: 'pick-up', take: 'pick-up', pick: 'pick-up', 'pick-it-up': 'pick-up',
  open: 'open-door', 'open-gate': 'open-door', gate: 'open-door', door: 'open-door',
  'drink-water': 'drink', 'eat-food': 'eat', food: 'eat', hello: 'wave', hi: 'wave', 'put-down': 'drop',
  // movement
  kood: 'jump', koodna: 'jump', kudna: 'jump', jhump: 'jump', hop: 'jump', leap: 'jump', 'double-kood': 'double-jump', flip: 'double-jump',
  jhukna: 'crouch', baithna: 'sit', 'baith-jao': 'sit', squat: 'crouch', rengna: 'crawl', ludhakna: 'roll', 'side-step': 'sidestep-left',
  ghoomna: 'turn-around', mudna: 'turn-around', 'turn-back': 'turn-around', chalna: 'walk', daudna: 'run', 'tez-daudna': 'sprint', bhaagna: 'run',
  chupke: 'sneak', 'chup-ke-chalna': 'sneak', langdana: 'limp', seedhi: 'climb-ladder', 'seedhi-chadhna': 'climb-ladder', chadhna: 'climb-wall',
  'climb': 'climb-wall', phaandna: 'vault', 'jump-over': 'vault',
  // water and air
  tairna: 'swim', taire: 'swim', 'swimming': 'swim', dubki: 'dive', 'dubki-lagana': 'dive', 'float-on-water': 'float', girna: 'fall',
  // fighting
  mukka: 'punch', ghoonsa: 'punch', 'left-mukka': 'left-punch', laat: 'kick', 'laat-maarna': 'kick', 'flying-laat': 'flying-kick',
  'car-par-laat': 'kick-car', 'kick-the-car': 'kick-car', 'kick-vehicle': 'kick-car', bachna: 'dodge', bachao: 'block', rokna: 'block',
  kohni: 'elbow-strike', dhakka: 'push', 'dhakka-dena': 'push', pakadna: 'grab', 'chot-lagna': 'get-hit', hit: 'get-hit', marna: 'die',
  'mar-jana': 'die', dead: 'die', 'uth-jana': 'get-up', uthna: 'get-up', 'stand-up-from-ground': 'get-up', attack: 'punch', fight: 'punch',
  // weapons
  goli: 'fire-pistol', 'goli-chalana': 'fire-pistol', shoot: 'fire-pistol', fire: 'fire-pistol', 'gun-fire': 'fire-pistol', 'fire-gun': 'fire-pistol',
  'rifle-fire': 'fire-rifle', nishana: 'aim', 'reload-gun': 'reload', grenade: 'throw-grenade', chaku: 'knife-slash', stab: 'knife-slash',
  talwar: 'sword-swing', sword: 'sword-swing', slash: 'sword-swing', bhala: 'spear-thrust', teer: 'bow-shoot', 'shoot-arrow': 'bow-shoot',
  cover: 'take-cover', fenkna: 'throw', 'throw-item': 'throw', 'throw-ball': 'throw',
  // vehicles
  'car-ka-gate-kholna': 'open-car-door', 'car-ka-darwaza-kholna': 'open-car-door', 'open-car-gate': 'open-car-door', 'car-gate': 'open-car-door',
  'gaadi-me-baithna': 'get-in-car', 'enter-car': 'get-in-car', 'get-in': 'get-in-car', 'gaadi-se-utarna': 'get-out-car', 'exit-car': 'get-out-car',
  'get-out': 'get-out-car', chalana: 'drive', 'bike-chalana': 'ride-bike', horn: 'honk', 'car-dhakelna': 'push-car', 'repair-car': 'fix-car',
  // objects and daily life
  'dabba-uthana': 'carry-box', 'darwaza-kholna': 'open-door', 'darwaza-band': 'close-door', khatkhatana: 'knock-door', phone: 'use-phone',
  padhna: 'read-book', 'button-dabana': 'press-button', 'ball-ko-laat': 'kick-ball', pakdo: 'catch', khana: 'eat', peena: 'drink', sona: 'sleep',
  letna: 'lie-down', 'khade-hona': 'stand-up', pakana: 'cook', jhaadu: 'sweep', 'haath-dhona': 'wash-hands', khodna: 'dig',
  'paani-dena': 'water-plants', 'lakdi-kaatna': 'chop-wood', hathoda: 'hammer',
  // social
  'haath-hilana': 'wave', namaskar: 'namaste', pranam: 'namaste', taali: 'clap', hasna: 'laugh', rona: 'cry', gussa: 'angry',
  'salaam': 'salute', 'haath-milana': 'handshake', 'gale-lagna': 'hug', 'gale-milna': 'hug', sochna: 'think', bulana: 'beckon',
  surrender: 'raise-hands', 'haath-upar': 'raise-hands', 'hands-up': 'raise-hands',
  // dance and fitness
  nachna: 'dance', naach: 'dance', 'robot-dance': 'dance-robot', jashn: 'celebrate', 'push-up': 'push-ups', 'sit-up': 'sit-ups',
  // roles and states
  seeti: 'police-whistle', whistle: 'police-whistle', hathkadi: 'handcuff', arrest: 'handcuff', ruko: 'stop-signal', 'stop-sign': 'stop-signal',
  bechna: 'sell', 'hal-chalana': 'plough', 'nabz-dekhna': 'check-pulse', pehra: 'patrol-look', patrol: 'patrol-look', 'sir-par-matka': 'carry-on-head',
  'jaal-fenkna': 'cast-net', chakkar: 'stunned', behosh: 'faint', kaanpna: 'shiver', 'idhar-udhar-dekhna': 'look-around', ghutne: 'kneel',
  'prarthana': 'pray', 'sir-hilana': 'nod',
});

/** The library's names, for a builder's or a prompt's list. PURE. */
export function moveNames(): string[] {
  return MOVE_LIBRARY.map((m) => m.name);
}
