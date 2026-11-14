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

/**
 * Rotate an input vector into CAMERA space, so "forward" means "away from the camera" and "right" means
 * the right of the SCREEN.
 *
 * The rig's yaw means one thing in every mode (camera.ts): the camera looks along (−sin yaw, 0, −cos yaw)
 * and its right is (cos yaw, 0, −sin yaw). Input arrives with forward as moveZ = −1 (W) and right as
 * moveX = +1 (D), so the world move is moveX·right − moveZ·forward.
 *
 * 🔴 THIS USED TO ROTATE THE OTHER WAY (moveX·cos − moveZ·sin, moveX·sin + moveZ·cos). The two agree only
 * at yaw 0 and π — exactly where a game starts — so it looked right until the camera turned: at a quarter
 * turn W walked TOWARD the camera and D went screen-left (measured 2026-10-11 while working the admin's
 * "left dabane par right" report, build 46e2d74b; tests/theCarIsSeenFromBehind.test.ts). The same
 * "controls feel reversed" class as the car camera that sat in front of the car.
 */
export function cameraRelative(moveX: number, moveZ: number, cameraYaw: number): { x: number; z: number } {
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  return { x: moveX * cos + moveZ * sin, z: -moveX * sin + moveZ * cos };
}
`;

const CONTROLLER = `import * as THREE from 'three';
import { stepMotor, initialMotorState, cameraRelative, DEFAULT_MOTOR, type MotorConfig, type MotorState } from './motor';
import { events } from '../core/events';
import { collisionRoot, hasWorldGround, sweepWorldCapsules, uprightCapsule, worldColliders, worldFloorAt } from '../three/collision';

export interface CharacterOptions {
  radius?: number;
  height?: number;
  config?: Partial<MotorConfig>;
  /** Small ledges up to this height can be stepped onto. */
  stepOffset?: number;
}

interface GroundContact { y: number; normal: THREE.Vector3; mesh?: THREE.Object3D }

export class CharacterController {
  readonly object = new THREE.Object3D();
  private state: MotorState = initialMotorState();
  private readonly config: MotorConfig;
  private readonly radius: number;
  private readonly height: number;
  private readonly stepOffset: number;
  private readonly slopeLimit: number;
  private colliders: THREE.Object3D[] = [];
  private world: THREE.Mesh[] = [];
  private implicitGround = true;
  /** Leading edge support while the feet move onto the centre of a stair tread. */
  private readonly stepSupport = new THREE.Vector3();
  private readonly lastSafe = new THREE.Vector3();

  constructor(options: CharacterOptions = {}) {
    this.radius = options.radius ?? 0.4;
    this.height = options.height ?? 1.8;
    this.stepOffset = options.stepOffset ?? 0.35;
    this.config = { ...DEFAULT_MOTOR, ...(options.config || {}) };
    this.slopeLimit = Math.cos(this.config.maxSlopeDegrees * Math.PI / 180);
  }

  /** Add explicit colliders when using the controller outside the game shell. */
  setColliders(list: THREE.Object3D[]): void {
    this.colliders = list;
    for (const c of list) c.updateWorldMatrix(true, true);
  }

  reset(x = 0, y = 0, z = 0): void {
    this.state = initialMotorState();
    this.object.position.set(x, y, z);
    this.lastSafe.set(x, y, z);
    this.stepSupport.set(0, 0, 0);
  }

  get velocity(): { x: number; y: number; z: number } { return { x: this.state.vx, y: this.state.vy, z: this.state.vz }; }
  get isGrounded(): boolean { return this.state.grounded; }
  get speed(): number { return Math.hypot(this.state.vx, this.state.vz); }

  /** Call at a fixed timestep. Camera yaw makes the controls view-relative. */
  update(
    delta: number,
    input: { moveX: number; moveZ: number; sprint: boolean; jumpPressed: boolean; jumpHeld: boolean },
    cameraYaw = 0,
  ): void {
    const dir = cameraRelative(input.moveX, input.moveZ, cameraYaw);
    const root = collisionRoot(this.object);
    this.world = worldColliders(root, this.colliders, this.object);
    this.implicitGround = this.colliders.length === 0 && !hasWorldGround(this.world, root);
    const ground = this.probeGround(delta);
    const grounded = this.state.vy <= 0 && ground !== null && this.object.position.y - ground.y <= 0.15;
    const normalY = ground?.normal.y ?? 1;
    const impact = Math.max(0, -this.state.vy);
    const { state, jumped, landed } = stepMotor(
      this.state, { ...input, moveX: dir.x, moveZ: dir.z }, grounded, delta, this.config, normalY,
    );
    this.state = state;
    if (grounded && ground && normalY < this.slopeLimit) {
      const downhill = -this.config.gravity * normalY * delta;
      this.state.vx += ground.normal.x * downhill;
      this.state.vz += ground.normal.z * downhill;
    }

    if (jumped) events.emit('PLAYER_JUMPED');
    if (landed) events.emit('PLAYER_LANDED', { impact });
    this.move(delta, grounded && normalY >= this.slopeLimit && !jumped);
    if (this.state.grounded && normalY >= this.slopeLimit) this.lastSafe.copy(this.object.position);
    if (!this.implicitGround && this.object.position.y < this.lastSafe.y - 60) {
      this.object.position.copy(this.lastSafe);
      this.state = initialMotorState();
      this.stepSupport.set(0, 0, 0);
      events.emit('PLAYER_FELL', { at: this.lastSafe.clone() });
    }
  }

  private floorAt(position: THREE.Vector3, rise: number, fall: number): GroundContact | null {
    const origin = position.clone().add(new THREE.Vector3(0, rise, 0));
    const floor = worldFloorAt(origin, rise + fall, this.world);
    if (floor) return floor;
    return this.implicitGround && position.y >= -rise && position.y <= fall
      ? { y: 0, normal: new THREE.Vector3(0, 1, 0) } : null;
  }

  /** Reach through this frame's entire fall, including a fast drop onto a thin platform. */
  private probeGround(delta: number): GroundContact | null {
    const position = this.object.position;
    const skin = 0.1;
    const fall = Math.max(0.15, -this.state.vy * delta) + 0.05;
    const centre = this.floorAt(position, skin, fall);
    if (this.stepSupport.lengthSq() && (!centre || centre.y < position.y - 0.01)) {
      // The leading point may already be over the NEXT riser while the current
      // tread still supports the rounded foot. Keep checking the supported span.
      for (const fraction of [1, 0.75, 0.5, 0.25]) {
        const edge = this.floorAt(position.clone().addScaledVector(this.stepSupport, fraction), 0.015, 0.035);
        if (edge && edge.normal.y >= this.slopeLimit) return edge;
      }
    }
    this.stepSupport.set(0, 0, 0);
    return centre;
  }

  private sweep(from: THREE.Vector3, motion: THREE.Vector3, support?: GroundContact | null): number {
    const walkable = support?.mesh && support.normal.y >= this.slopeLimit
      ? { mesh: support.mesh, slopeLimit: this.slopeLimit } : undefined;
    return sweepWorldCapsules([uprightCapsule(from, this.radius, this.height)], motion, this.world, walkable);
  }

  private move(delta: number, canClimb: boolean): void {
    const p = this.object.position;
    const startX = p.x, startZ = p.z;
    const dx = this.state.vx * delta, dz = this.state.vz * delta;
    const segments = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / Math.max(0.04, this.radius * 0.5)));
    const tryAxis = (dx: number, dz: number) => {
      if (dx === 0 && dz === 0) return;
      const motion = new THREE.Vector3(dx, 0, dz);
      let travel = this.sweep(p, motion);
      if (canClimb && this.stepOffset > 0) {
        const target = p.clone().add(motion);
        const lead = motion.clone().normalize().multiplyScalar(this.radius * 0.99);
        const rise = this.stepOffset + 0.002;
        const rising = (hit: GroundContact | null): hit is GroundContact => !!hit
          && hit.normal.y >= this.slopeLimit && hit.y - p.y > 1e-4 && hit.y - p.y <= this.stepOffset;
        const centre = this.floorAt(target, rise, 0);
        const edge = travel < 1 && !rising(centre) ? this.floorAt(target.clone().add(lead), rise, 0) : null;
        const support = rising(centre) ? centre : rising(edge) ? edge : null;
        const stepTop = (support?.y ?? p.y) - p.y;
        if (support && support === edge && support.normal.y < 0.999) {
          // Let the capsule's rounded foot reach a ramp before its centre is above the surface.
          travel = this.sweep(p, motion, support);
        } else if (support) {
          const lift = new THREE.Vector3(0, stepTop, 0);
          // Both sweeps are required. A low ceiling or the next riser can veto a step-up.
          if (this.sweep(p, lift) === 1) {
            const raised = p.clone().add(lift);
            const elevatedTravel = this.sweep(raised, motion, support);
            if (elevatedTravel === 1 || elevatedTravel > travel + 1e-4) {
              p.y = raised.y;
              travel = elevatedTravel;
              if (support === edge) this.stepSupport.copy(lead);
            }
          }
        }
      }
      p.addScaledVector(motion, travel);
    };

    // Separate axes preserve tangential movement when the body meets a wall.
    for (let i = 0; i < Math.min(128, segments); i++) {
      tryAxis(dx / segments, 0);
      tryAxis(0, dz / segments);
    }
    if (delta > 0) {
      this.state.vx = (p.x - startX) / delta;
      this.state.vz = (p.z - startZ) / delta;
    }

    const dy = this.state.vy * delta;
    const floor = dy <= 0 ? this.probeGround(delta) : null;
    if (floor && p.y + dy <= floor.y + 0.001) {
      p.y = floor.y;
      this.state.vy = 0;
      return;
    }
    const travel = this.sweep(p, new THREE.Vector3(0, dy, 0), floor);
    p.y += dy * travel;
    if (travel < 1) this.state.vy = 0;
    if (this.implicitGround && p.y < 0) p.y = 0;
  }

  teleport(x: number, y: number, z: number): void {
    this.object.position.set(x, y, z);
    this.state = initialMotorState();
    this.stepSupport.set(0, 0, 0);
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
    // 🔒 COMPILED IN CI (tests/aRecipeExampleCompiles.test.ts) — keep it a whole module with real imports.
    // It used to name terrain, buildings, input and cameraYaw without making any of them.
    instructions:
      `Added the character controller (${Object.keys(files).length} files under src/game/play).\n` +
      '```ts\n' +
      "import * as THREE from 'three';\n" +
      "import { CharacterController } from './game/play/character';\n" +
      "import { CameraRig } from './game/three/camera';\n" +
      "import { createTerrain } from './game/three/world';\n" +
      "import { Input } from './game/core/input';\n" +
      '\n' +
      'const scene = new THREE.Scene();\n' +
      'const terrain = createTerrain({ size: 200 });\n' +
      'scene.add(terrain);\n' +
      "const input = new Input(document.querySelector('canvas')!);\n" +
      "const rig = new CameraRig({ kind: 'third-person', collidables: [terrain] });\n" +
      'const player = new CharacterController({ config: { maxSpeed: 7 } });\n' +
      'player.setColliders([terrain]);\n' +
      'scene.add(player.object);\n' +
      '\n' +
      'export function fixedUpdate(dt: number): void {   // inside the FIXED update\n' +
      '  const a = input.axis();\n' +
      "  player.update(dt, { moveX: a.x, moveZ: a.y, sprint: input.isDown('sprint'),\n" +
      "    jumpPressed: input.wasPressed('jump'), jumpHeld: input.isDown('jump') }, rig.yaw);   // W = away from the camera\n" +
      '}\n' +
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
