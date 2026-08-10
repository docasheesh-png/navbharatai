// The character controller — phase 3 of game building, and the phase that decides whether a game
// feels GOOD or merely works.
//
// A controller can be physically correct and still feel awful. The gap between the two is a handful of
// small, deliberate lies that every good platformer and third-person game tells, and that a
// from-scratch implementation almost never includes because they only look like bugs on paper:
//
//   COYOTE TIME — jump still works for ~100ms AFTER walking off a ledge. Without it, players who press
//     jump a frame or two late (which is most players, most of the time) get nothing, and the game
//     feels unresponsive in a way they cannot articulate: "I pressed it, it didn't jump."
//   JUMP BUFFERING — a jump pressed shortly BEFORE landing is remembered and fires on touchdown.
//     Without it, pressing jump slightly early while falling is silently dropped, and chained jumps
//     feel like they need frame-perfect timing.
//   VARIABLE JUMP HEIGHT — releasing the button early cuts the upward velocity. One fixed jump arc is
//     the single most obvious sign of a first attempt.
//   SEPARATE AIR CONTROL — full control in mid-air feels floaty and weightless; zero air control feels
//     like a punishment. It belongs somewhere in between, and it must be its own number.
//   STEP OFFSET — small ledges are climbed rather than collided with, or the character snags on every
//     kerb and doorstep in the level.
//   SLOPE LIMIT + GROUND SNAP — steep slopes are refused (and slid down); shallow descents keep the
//     character stuck to the ground instead of launching off every bump.
//
// WHY THE MOTOR IS PURE. All of that is arithmetic over time, and arithmetic is testable. The motor
// takes numbers and returns numbers — no three.js, no scene, no DOM — so "does coyote time actually
// expire" is a real assertion rather than something a human has to feel for in a browser. The thin
// three.js controller on top only does the raycasts.
//
// PURE builder → the caller writes the files.

export interface GameControllerResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const MOTOR = `/**
 * The character MOTOR — the feel, as pure arithmetic.
 *
 * No three.js, no scene, no DOM. It is handed the frame's input and whether the character is standing
 * on something, and it returns the new velocity. That makes every "feel" rule an assertion instead of
 * something a human has to sense in a browser.
 *
 * The defaults are tuned for a human-scale third-person character in metres and seconds. They are
 * deliberately NOT round numbers — 0.1s of coyote time and 0.12s of buffer are the values that stop
 * being noticeable while still doing their job.
 */
export interface MotorConfig {
  maxSpeed: number;
  sprintMultiplier: number;
  /** How fast we reach maxSpeed on the ground. Higher = snappier, lower = heavier. */
  groundAcceleration: number;
  groundFriction: number;
  /** Air control is its own number: full control feels floaty, none feels like a punishment. */
  airAcceleration: number;
  airFriction: number;
  gravity: number;
  /** Fall speed cap, so a long drop does not tunnel through the floor. */
  terminalVelocity: number;
  jumpSpeed: number;
  /** Jump still fires this long AFTER leaving the ground. */
  coyoteTime: number;
  /** A jump pressed this long BEFORE landing is remembered. */
  jumpBufferTime: number;
  /** Releasing early multiplies upward velocity by this — variable jump height. */
  jumpCutMultiplier: number;
  /** Steeper than this (degrees) cannot be walked up. */
  maxSlopeDegrees: number;
}

export const DEFAULT_MOTOR: MotorConfig = {
  maxSpeed: 6,
  sprintMultiplier: 1.7,
  groundAcceleration: 60,
  groundFriction: 12,
  airAcceleration: 18,
  airFriction: 1.5,
  gravity: -24,          // ~2.4x real gravity; real gravity feels sluggish in games
  terminalVelocity: -55,
  jumpSpeed: 8.5,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  jumpCutMultiplier: 0.45,
  maxSlopeDegrees: 50,
};

export interface MotorInput {
  /** Desired direction, already camera-relative and normalised. */
  moveX: number;
  moveZ: number;
  sprint: boolean;
  /** Jump went down THIS frame (Input.wasPressed). */
  jumpPressed: boolean;
  /** Jump is still held — drives variable jump height. */
  jumpHeld: boolean;
}

export interface MotorState {
  vx: number; vy: number; vz: number;
  grounded: boolean;
  /** Seconds since we were last grounded — the coyote window. */
  timeSinceGrounded: number;
  /** Seconds since jump was pressed — the buffer window. */
  timeSinceJumpPressed: number;
  jumping: boolean;
}

export function initialMotorState(): MotorState {
  return { vx: 0, vy: 0, vz: 0, grounded: false, timeSinceGrounded: 999, timeSinceJumpPressed: 999, jumping: false };
}

export interface StepResult {
  state: MotorState;
  /** True on the frame a jump actually started — emit a sound/VFX here, not on the key press. */
  jumped: boolean;
  /** True on the frame we touched down — landing dust, camera dip, footstep. */
  landed: boolean;
}

/**
 * Advance one FIXED timestep. Never mutates its input, so a caller can predict or rewind.
 *
 * \`groundNormalY\` is the upward component of the surface normal (1 = flat, 0 = vertical wall). It is
 * how the slope limit is enforced without the motor knowing anything about geometry.
 */
export function stepMotor(
  prev: MotorState,
  input: MotorInput,
  grounded: boolean,
  delta: number,
  config: MotorConfig = DEFAULT_MOTOR,
  groundNormalY = 1,
): StepResult {
  const s: MotorState = { ...prev };
  const landed = grounded && !prev.grounded;
  s.grounded = grounded;

  s.timeSinceGrounded = grounded ? 0 : prev.timeSinceGrounded + delta;
  s.timeSinceJumpPressed = input.jumpPressed ? 0 : prev.timeSinceJumpPressed + delta;

  // A slope steeper than the limit is not ground you can stand on — you slide.
  const slopeOk = groundNormalY >= Math.cos((config.maxSlopeDegrees * Math.PI) / 180);
  const standing = grounded && slopeOk;

  // ── horizontal ────────────────────────────────────────────────────────────────────────────────
  const accel = standing ? config.groundAcceleration : config.airAcceleration;
  const friction = standing ? config.groundFriction : config.airFriction;
  const target = config.maxSpeed * (input.sprint ? config.sprintMultiplier : 1);

  const wants = Math.hypot(input.moveX, input.moveZ) > 0.001;
  if (wants) {
    s.vx += input.moveX * accel * delta;
    s.vz += input.moveZ * accel * delta;
    const speed = Math.hypot(s.vx, s.vz);
    // Clamp to the target rather than to maxSpeed, so sprinting is not silently capped at walk speed.
    if (speed > target) { s.vx = (s.vx / speed) * target; s.vz = (s.vz / speed) * target; }
  } else {
    // Exponential friction, not a fixed subtraction: a fixed one overshoots past zero at low speed and
    // makes the character jitter in place.
    const decay = Math.exp(-friction * delta);
    s.vx *= decay;
    s.vz *= decay;
    if (Math.abs(s.vx) < 0.01) s.vx = 0;
    if (Math.abs(s.vz) < 0.01) s.vz = 0;
  }

  // ── vertical ──────────────────────────────────────────────────────────────────────────────────
  let jumped = false;
  const canCoyote = s.timeSinceGrounded <= config.coyoteTime && slopeOk;
  const bufferedJump = s.timeSinceJumpPressed <= config.jumpBufferTime;

  if (bufferedJump && canCoyote && !s.jumping) {
    s.vy = config.jumpSpeed;
    s.jumping = true;
    jumped = true;
    // BOTH windows are consumed, or the same press fires again next frame and the character
    // double-jumps for free.
    s.timeSinceJumpPressed = 999;
    s.timeSinceGrounded = 999;
  } else if (standing && s.vy <= 0) {
    s.jumping = false;
    // A small downward bias keeps the character glued to slopes on the way down instead of launching
    // off every bump — ground snap.
    s.vy = -2;
  } else {
    s.vy += config.gravity * delta;
    // Variable jump height: let go early and the arc is cut short.
    if (s.jumping && !input.jumpHeld && s.vy > 0) s.vy *= config.jumpCutMultiplier;
    if (s.vy < config.terminalVelocity) s.vy = config.terminalVelocity;
  }

  // Sliding down a too-steep slope: no standing, and horizontal control is heavily damped.
  if (grounded && !slopeOk) {
    s.vx *= 0.9;
    s.vz *= 0.9;
  }

  return { state: s, jumped, landed };
}

/** Rotate an input vector into CAMERA space, so "forward" means "away from the camera". */
export function cameraRelative(moveX: number, moveZ: number, cameraYaw: number): { x: number; z: number } {
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  return { x: moveX * cos - moveZ * sin, z: moveX * sin + moveZ * cos };
}
`;

const CONTROLLER = `import * as THREE from 'three';
import { stepMotor, initialMotorState, cameraRelative, DEFAULT_MOTOR, type MotorConfig, type MotorState } from './motor';
import { events } from '../core/events';

/**
 * The three.js side of the character — raycasts and movement. All the FEEL lives in motor.ts; this
 * only answers "what am I standing on" and "did I hit a wall".
 *
 * SKIN WIDTH is why the ground ray starts slightly ABOVE the feet and reaches slightly BELOW them.
 * A ray starting exactly at the feet intermittently misses the floor through floating-point error, and
 * the character flickers between grounded and airborne — which looks like stuttering and breaks both
 * coyote time and the jump.
 */
export interface CharacterOptions {
  radius?: number;
  height?: number;
  config?: Partial<MotorConfig>;
  /** Small ledges up to this height are stepped onto instead of blocking. */
  stepOffset?: number;
}

export class CharacterController {
  readonly object = new THREE.Object3D();
  private state: MotorState = initialMotorState();
  private readonly config: MotorConfig;
  private readonly radius: number;
  private readonly height: number;
  private readonly stepOffset: number;
  private readonly down = new THREE.Raycaster();
  private readonly side = new THREE.Raycaster();
  private colliders: THREE.Object3D[] = [];

  constructor(options: CharacterOptions = {}) {
    this.radius = options.radius ?? 0.4;
    this.height = options.height ?? 1.8;
    this.stepOffset = options.stepOffset ?? 0.35;
    this.config = { ...DEFAULT_MOTOR, ...(options.config || {}) };
  }

  setColliders(list: THREE.Object3D[]): void { this.colliders = list; }

  /**
   * Put the character back at a spawn point. Restart MUST clear the motor state, not just the position:
   * a player who died mid-fall would otherwise respawn still carrying that downward velocity — and with
   * jumping still true, so their first jump does nothing.
   */
  reset(x = 0, y = 0, z = 0): void {
    this.state = initialMotorState();
    this.object.position.set(x, y, z);
  }

  get velocity(): { x: number; y: number; z: number } { return { x: this.state.vx, y: this.state.vy, z: this.state.vz }; }
  get isGrounded(): boolean { return this.state.grounded; }
  get speed(): number { return Math.hypot(this.state.vx, this.state.vz); }

  /** Call from the FIXED update. \`cameraYaw\` makes movement camera-relative. */
  update(
    delta: number,
    input: { moveX: number; moveZ: number; sprint: boolean; jumpPressed: boolean; jumpHeld: boolean },
    cameraYaw = 0,
  ): void {
    const dir = cameraRelative(input.moveX, input.moveZ, cameraYaw);
    const ground = this.probeGround();

    const { state, jumped, landed } = stepMotor(
      this.state,
      { ...input, moveX: dir.x, moveZ: dir.z },
      ground.grounded,
      delta,
      this.config,
      ground.normalY,
    );
    this.state = state;

    // Events, not direct calls: VFX, audio and the camera react without this class importing them.
    if (jumped) events.emit('PLAYER_JUMPED');
    if (landed) events.emit('PLAYER_LANDED', { impact: Math.abs(this.state.vy) });

    this.move(delta);
  }

  /** Ground probe with skin width — see the note above on why it starts above the feet. */
  private probeGround(): { grounded: boolean; normalY: number } {
    if (this.colliders.length === 0) {
      // No collision geometry yet: treat y<=0 as the floor so a scene under construction still plays.
      return { grounded: this.object.position.y <= 0.001, normalY: 1 };
    }
    const skin = 0.1;
    const origin = this.object.position.clone().add(new THREE.Vector3(0, skin, 0));
    this.down.set(origin, new THREE.Vector3(0, -1, 0));
    this.down.far = skin * 2 + 0.05;
    const hit = this.down.intersectObjects(this.colliders, true)[0];
    if (!hit) return { grounded: false, normalY: 1 };
    const n = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);
    return { grounded: true, normalY: Math.abs(n.y) };
  }

  /**
   * Apply velocity, refusing moves that would enter a wall.
   *
   * X and Z are resolved SEPARATELY so that sliding along a wall still works: blocking both because one
   * is obstructed is what makes a character stick to walls at an angle instead of sliding along them.
   */
  private move(delta: number): void {
    const p = this.object.position;
    const tryAxis = (dx: number, dz: number) => {
      if (dx === 0 && dz === 0) return;
      if (this.colliders.length === 0) { p.x += dx; p.z += dz; return; }
      const dir = new THREE.Vector3(dx, 0, dz);
      const dist = dir.length();
      dir.normalize();
      // Cast from mid-body, not the feet — a foot-height ray walks straight through a table top.
      const origin = p.clone().add(new THREE.Vector3(0, this.height * 0.5, 0));
      this.side.set(origin, dir);
      this.side.far = dist + this.radius;
      const hit = this.side.intersectObjects(this.colliders, true)[0];
      if (hit) {
        // A low obstacle within the step offset is climbed instead of blocking — no snagging on kerbs.
        const stepTop = hit.point.y - p.y;
        if (stepTop > 0 && stepTop <= this.stepOffset) { p.y += stepTop + 0.01; p.x += dx; p.z += dz; }
        return;
      }
      p.x += dx; p.z += dz;
    };

    tryAxis(this.state.vx * delta, 0);
    tryAxis(0, this.state.vz * delta);
    p.y += this.state.vy * delta;
    if (this.colliders.length === 0 && p.y < 0) { p.y = 0; }
  }

  teleport(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
    this.state = initialMotorState();
  }
}
`;

const FILES: Record<string, string> = {
  'src/game/play/motor.ts': MOTOR,
  'src/game/play/character.ts': CONTROLLER,
};

export const GAME_CONTROLLER_MODULES: readonly string[] = ['motor', 'character'];

/**
 * Generate the character controller. `character` imports `motor` and the runtime's `events`, so a
 * subset that would not compile is completed rather than emitted broken. Pure; never throws.
 */
export function generateGameController(include?: string[]): GameControllerResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;

  let files: Record<string, string>;
  if (!wanted) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.ts$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    if (files['src/game/play/character.ts']) files['src/game/play/motor.ts'] = FILES['src/game/play/motor.ts'];
    if (Object.keys(files).length === 0) files = { ...FILES };
  }

  return {
    files,
    dependencies: [], // motor is pure; character uses the `three` the 3D layer already declares
    instructions:
      `Added the character controller (${Object.keys(files).length} files under src/game/play).\n` +
      '```ts\n' +
      "const player = new CharacterController({ config: { maxSpeed: 7 } });\n" +
      'player.setColliders([terrain, ...buildings]);\n' +
      'scene.add(player.object);\n' +
      '// inside the FIXED update:\n' +
      'const a = input.axis();\n' +
      "player.update(dt, { moveX: a.x, moveZ: a.y, sprint: input.isDown('sprint'),\n" +
      "  jumpPressed: input.wasPressed('jump'), jumpHeld: input.isDown('jump') }, cameraYaw);\n" +
      '```\n' +
      'WHY IT FEELS RIGHT (do not "simplify" these away — each one is deliberate):\n' +
      '- COYOTE TIME: jump still works ~100ms after walking off a ledge. Without it players who press a\n' +
      '  frame late get nothing and the game feels unresponsive.\n' +
      '- JUMP BUFFERING: a jump pressed just before landing fires on touchdown, so chaining jumps does not\n' +
      '  need frame-perfect timing.\n' +
      '- VARIABLE JUMP HEIGHT: releasing early cuts the arc. One fixed jump is the clearest sign of a\n' +
      '  first attempt.\n' +
      '- AIR CONTROL is its own number — full control feels floaty, none feels like a punishment.\n' +
      '- STEP OFFSET stops the character snagging on every kerb; the SLOPE LIMIT makes steep ground slide.\n' +
      '- Emit-driven: PLAYER_JUMPED / PLAYER_LANDED fire from here, so VFX and audio hook on without this\n' +
      '  class importing them. Trigger landing dust on the EVENT, never inside the controller.',
  };
}
