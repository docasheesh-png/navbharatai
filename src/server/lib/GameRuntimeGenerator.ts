// The game RUNTIME the generated game targets — NavBharatAI's game-engine foundation.
//
// WHY THIS EXISTS, AND WHY IT COMES FIRST (admin 2026-08-09: "4D games banane me bhi kisi se kam na
// rahe"). The instinct is that AI-generated games look bad because of ASSETS. That is half the story
// and the less important half. They play badly because the model is asked to hand-roll an engine every
// single time: a `requestAnimationFrame` loop using raw delta, an ad-hoc keydown handler, a `new`
// inside the update loop. Each of those has a specific, well-known failure:
//
//   • RAW DELTA makes physics frame-rate dependent. The same jump reaches a different height on a
//     144 Hz monitor and a cheap Android, and a single long frame tunnels the player through a wall.
//   • NO DELTA CLAMP means alt-tabbing for a minute produces one 60-second frame — the "spiral of
//     death" — and the player teleports across the level or the simulation NaNs out.
//   • EVENT-DRIVEN INPUT loses presses: a key pressed and released between two frames never happened
//     as far as the game is concerned, and holding a key repeats at the OS key-repeat rate.
//   • ALLOCATING IN THE LOOP (a bullet, a particle) hands the garbage collector work every frame; the
//     GC pause is the single most common cause of stutter in browser games.
//
// A model given a runtime that has already solved these writes a game that feels good. A model asked
// to solve them inline writes one that jitters. So the engine layer ships FIRST, and every later
// generator (world, enemies, VFX) targets it.
//
// DEPENDENCY-FREE AND ENGINE-AGNOSTIC. Nothing here imports three.js, a physics engine or a framework:
// it is the loop, input, events, pooling, state and game-feel that a 2D canvas game and a 3D scene
// need identically. That keeps it usable for both, keeps the generated app light, and means the 3D
// layer can be swapped without touching gameplay code.
//
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

export interface GameRuntimeResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const LOOP = `/**
 * The game loop — FIXED TIMESTEP with interpolated rendering.
 *
 * Logic runs at a constant rate (default 60 Hz) no matter what the display does, so a jump reaches the
 * same height on a 144 Hz monitor and a slow phone, and collision cannot be skipped by one long frame.
 * Rendering happens as often as the browser allows and INTERPOLATES between the last two logic states,
 * so motion still looks smooth at any refresh rate.
 *
 * The accumulator is CLAMPED. Without that, returning to a backgrounded tab hands the loop one giant
 * delta, which it tries to catch up on in a single frame — each catch-up step making the next delta
 * bigger. That is the "spiral of death"; the page freezes and the player teleports. Clamping simply
 * drops the missed time, which is what every shipped engine does.
 */
export type UpdateFn = (fixedDelta: number) => void;
export type RenderFn = (alpha: number, frameDelta: number) => void;

export interface GameLoopOptions {
  /** Logic steps per second. 60 is right for almost everything. */
  hz?: number;
  /** Never simulate more than this much real time in one frame (seconds). */
  maxFrameTime?: number;
}

export class GameLoop {
  private readonly step: number;
  private readonly maxFrameTime: number;
  private accumulator = 0;
  private last = 0;
  private rafId: number | null = null;
  private running = false;
  private paused = false;

  constructor(
    private readonly update: UpdateFn,
    private readonly render: RenderFn,
    options: GameLoopOptions = {},
  ) {
    const hz = options.hz && options.hz > 0 ? options.hz : 60;
    this.step = 1 / hz;
    // 0.25s = 15 dropped frames at 60Hz. Beyond that we are catching up on time nobody watched.
    this.maxFrameTime = options.maxFrameTime ?? 0.25;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.accumulator = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      let frameTime = (now - this.last) / 1000;
      this.last = now;
      if (frameTime > this.maxFrameTime) frameTime = this.maxFrameTime; // drop the missed time
      if (!this.paused) {
        this.accumulator += frameTime;
        while (this.accumulator >= this.step) {
          this.update(this.step);
          this.accumulator -= this.step;
        }
      }
      // alpha = how far we are between the last logic state and the next one.
      this.render(this.paused ? 1 : this.accumulator / this.step, frameTime);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  /** Pause LOGIC but keep rendering — menus stay responsive and the scene does not freeze black. */
  setPaused(paused: boolean): void { this.paused = paused; }
  get isPaused(): boolean { return this.paused; }
  get isRunning(): boolean { return this.running; }
}
`;

const INPUT = `/**
 * Input as POLLED STATE — keyboard, mouse, gamepad and touch behind one interface.
 *
 * A game loop asks "is jump held?" at a fixed moment; it does not react to a keydown whenever the OS
 * decides to send one. Event-driven input in a game loop loses a press that starts and ends between
 * two frames, and repeats at the OS key-repeat rate while a key is held.
 *
 * \`wasPressed\` is edge-triggered and cleared once per frame by \`endFrame()\`, which the loop calls
 * after update — that is what makes "jump on the frame the key went down" exact.
 */
export type ActionMap = Record<string, string[]>;

/** Sensible defaults; pass your own to remap. Codes are KeyboardEvent.code (layout-independent). */
export const DEFAULT_ACTIONS: ActionMap = {
  // Pad:N is a STANDARD-mapping gamepad's button N (A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Start=9 L3=10, d-pad 12-15).
  up: ['KeyW', 'ArrowUp', 'Pad:12'],
  down: ['KeyS', 'ArrowDown', 'Pad:13'],
  left: ['KeyA', 'ArrowLeft', 'Pad:14'],
  right: ['KeyD', 'ArrowRight', 'Pad:15'],
  jump: ['Space', 'Pad:0'],
  sprint: ['ShiftLeft', 'ShiftRight', 'Pad:5', 'Pad:10'],
  interact: ['KeyE', 'Pad:1'],
  // A keyboard player can attack too (it was the mouse button only, so a laptop with no mouse could never fire).
  attack: ['Mouse0', 'KeyF', 'KeyJ', 'Pad:2', 'Pad:7'],
  aim: ['Mouse2', 'Pad:6'],
  pause: ['Escape', 'Pad:9'],
  kick: ['KeyK'],
  reload: ['KeyR', 'Pad:3'],
  drift: ['Space', 'Pad:4'],
};

/** A stick inside this radius is at rest (worn sticks never read exactly 0). */
export const PAD_DEADZONE = 0.15;
/** Right-stick look speed, in mouse-pixels per fixed step at full tilt. */
export const PAD_LOOK_SPEED = 14;

/**
 * Names that MEAN the same action (admin 2026-11-19: "fire button press kiya … kabhi kabhi action bhi nahi hota").
 * A game that reads 'fire' or 'shoot' while the on-screen button sets 'attack' heard nothing: its action had no key
 * and no button. Every name in a group answers to the keys AND the buttons of every other name in it.
 */
export const ACTION_GROUPS: readonly (readonly string[])[] = [
  ['attack', 'fire', 'shoot', 'punch', 'strike', 'melee', 'hit', 'slash'],
  ['interact', 'use', 'action'],
  ['sprint', 'run', 'boost', 'nitro'],
  ['drift', 'handbrake'],
];
/**
 * TWO PLAYERS ON ONE DEVICE (admin 2026-11-19 game-gap audit: no local multiplayer). Player 1 keeps every default key
 * except the arrows; player 2 gets the arrows and the keys by them. Each player reads only their own gamepad.
 */
export const PLAYER1_ACTIONS: ActionMap = Object.fromEntries(Object.entries(DEFAULT_ACTIONS).map(([a, codes]) => [a, codes.filter((c) => !c.startsWith('Arrow'))]));
export const PLAYER2_ACTIONS: ActionMap = {
  up: ['ArrowUp', 'Pad:12'], down: ['ArrowDown', 'Pad:13'], left: ['ArrowLeft', 'Pad:14'], right: ['ArrowRight', 'Pad:15'],
  jump: ['ShiftRight', 'Numpad0', 'Pad:0'], attack: ['Slash', 'Enter', 'Numpad1', 'Pad:2', 'Pad:7'], interact: ['Period', 'Numpad2', 'Pad:1'],
  sprint: ['ControlRight', 'Pad:5', 'Pad:10'], aim: ['Pad:6'], reload: ['Comma', 'Pad:3'], drift: ['Numpad3', 'Pad:4'], pause: ['Pad:9'],
};

const GROUP_OF: Record<string, readonly string[]> = Object.fromEntries(ACTION_GROUPS.flatMap((g) => g.map((name) => [name, g])));

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private readonly actions: ActionMap;
  private detach: Array<() => void> = [];

  /** Mouse/stick movement since the last frame, in pixels. Reset by endFrame(). */
  lookX = 0;
  lookY = 0;
  /** Analogue move vector (-1..1). Touch joystick and gamepad write here; keys synthesise it. */
  moveX = 0;
  moveY = 0;
  /** A gamepad is connected and was read last step. */
  gamepad = false;
  /** The left stick wrote moveX/moveY (so letting it go clears only what the pad wrote, never the touch joystick). */
  private padMoving = false;
  private padDown = new Set<string>();

  /** Read only this gamepad (0 = the first one plugged in, 1 = the second…); undefined = the first connected pad. */
  readonly padIndex: number | undefined;

  constructor(target: HTMLElement | Window = window, actions: ActionMap = DEFAULT_ACTIONS, options: { padIndex?: number } = {}) {
    this.padIndex = Number.isInteger(options.padIndex) ? options.padIndex : undefined;
    this.actions = actions;
    const el = target as Window;

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore the OS auto-repeat: holding a key is "down", not a stream of new presses.
      if (e.repeat) return;
      this.set(e.code, true);
    };
    const onKeyUp = (e: KeyboardEvent) => this.set(e.code, false);
    const onMouseDown = (e: MouseEvent) => this.set('Mouse' + e.button, true);
    const onMouseUp = (e: MouseEvent) => this.set('Mouse' + e.button, false);
    const onMouseMove = (e: MouseEvent) => { this.lookX += e.movementX || 0; this.lookY += e.movementY || 0; };
    // A tab-switch must release everything, or the player keeps running after they come back.
    const onBlur = () => { this.down.clear(); this.moveX = 0; this.moveY = 0; };

    el.addEventListener('keydown', onKeyDown as EventListener);
    el.addEventListener('keyup', onKeyUp as EventListener);
    el.addEventListener('mousedown', onMouseDown as EventListener);
    el.addEventListener('mouseup', onMouseUp as EventListener);
    el.addEventListener('mousemove', onMouseMove as EventListener);
    el.addEventListener('blur', onBlur);
    this.detach = [
      () => el.removeEventListener('keydown', onKeyDown as EventListener),
      () => el.removeEventListener('keyup', onKeyUp as EventListener),
      () => el.removeEventListener('mousedown', onMouseDown as EventListener),
      () => el.removeEventListener('mouseup', onMouseUp as EventListener),
      () => el.removeEventListener('mousemove', onMouseMove as EventListener),
      () => el.removeEventListener('blur', onBlur),
    ];
  }

  private set(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      if (this.down.has(code)) this.released.add(code);
      this.down.delete(code);
    }
  }

  private codes(action: string): string[] {
    const group = GROUP_OF[action];
    if (!group) return this.actions[action] || [];
    return group.flatMap((name) => this.actions[name] || []);
  }

  /** Held right now. */
  isDown(action: string): boolean { return this.codes(action).some((c) => this.down.has(c)); }
  /** Went down THIS frame. */
  wasPressed(action: string): boolean { return this.codes(action).some((c) => this.pressed.has(c)); }
  /** Came up THIS frame. */
  wasReleased(action: string): boolean { return this.codes(action).some((c) => this.released.has(c)); }

  /** Movement vector from keys + analogue sources, normalised so diagonals are not faster. */
  axis(): { x: number; y: number } {
    let x = this.moveX;
    let y = this.moveY;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('up')) y -= 1;
    if (this.isDown('down')) y += 1;
    const len = Math.hypot(x, y);
    // Without this, holding two directions moves you 1.41x faster than one — the classic bug.
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /**
   * Read the GAMEPAD (the Gamepad API is polled, it sends no events): the first connected pad with the standard layout.
   * Left stick moves, right stick looks, buttons press actions (Pad:N in the action map). Call once per step BEFORE the
   * game reads input — the shell does. Nothing happens without a pad (or in a browser without the API).
   */
  pollGamepads(): void {
    let pad: Gamepad | null = null;
    try {
      const pads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const usable = Array.from(pads ?? []).filter((p): p is Gamepad => !!p && p.connected && (p.mapping === 'standard' || p.axes.length >= 2));
      pad = this.padIndex === undefined ? (usable[0] ?? null) : (usable[this.padIndex] ?? null);
    } catch { pad = null; }
    this.gamepad = pad !== null;
    const now = new Set<string>();
    if (pad) {
      pad.buttons.forEach((b, i) => { if (b && (b.pressed || b.value > 0.5)) now.add('Pad:' + i); });
      const dz = (v: number | undefined): number => { const x = typeof v === 'number' && Number.isFinite(v) ? v : 0; return Math.abs(x) < PAD_DEADZONE ? 0 : (x - Math.sign(x) * PAD_DEADZONE) / (1 - PAD_DEADZONE); };
      const lx = dz(pad.axes[0]), ly = dz(pad.axes[1]);
      if (lx || ly) { this.setAnalogueMove(lx, ly); this.padMoving = true; }
      else if (this.padMoving) { this.setAnalogueMove(0, 0); this.padMoving = false; }
      const rx = dz(pad.axes[2]), ry = dz(pad.axes[3]);
      this.lookX += rx * PAD_LOOK_SPEED; this.lookY += ry * PAD_LOOK_SPEED;
    } else if (this.padMoving) { this.setAnalogueMove(0, 0); this.padMoving = false; }
    for (const code of now) if (!this.padDown.has(code)) this.set(code, true);
    for (const code of this.padDown) if (!now.has(code)) this.set(code, false);
    this.padDown = now;
  }

  /**
   * Call AFTER update. Clears the one-frame edges and the accumulated look delta. keepPresses = true keeps the
   * press/release edges for the next frame: a hit-stop freeze passes it, so a press made during the freeze is
   * still seen when the game runs again instead of being wiped unseen.
   */
  endFrame(keepPresses = false): void {
    if (!keepPresses) {
      this.pressed.clear();
      this.released.clear();
    }
    this.lookX = 0;
    this.lookY = 0;
  }

  /** Touch joystick / gamepad feed this. Values are clamped to the unit square. */
  setAnalogueMove(x: number, y: number): void {
    this.moveX = Math.max(-1, Math.min(1, x));
    this.moveY = Math.max(-1, Math.min(1, y));
  }

  /** Virtual buttons for touch controls — same action names as the keyboard. */
  setVirtualButton(action: string, isDown: boolean): void {
    const code = 'Virtual:' + action;
    if (!this.actions[action]) this.actions[action] = [];
    if (!this.actions[action].includes(code)) this.actions[action].push(code);
    this.set(code, isDown);
  }

  dispose(): void { this.detach.forEach((off) => off()); this.detach = []; this.down.clear(); }
}
`;

const EVENTS = `/**
 * The game event bus — how VFX, audio and UI react without gameplay knowing they exist.
 *
 * Gameplay emits \`PLAYER_DAMAGED\`; the HUD, the hit-flash, the camera shake and the sound each
 * subscribe. Without this, the damage function ends up importing the audio manager, the particle
 * system and the HUD, and every new reaction means editing gameplay code again.
 */
export type GameEvent =
  | 'GAME_STARTED' | 'GAME_OVER' | 'GAME_WON' | 'GAME_PAUSED' | 'GAME_RESUMED' | 'GAME_MENU' | 'SETTINGS_CHANGED' | 'LOADING_PROGRESS' | 'ASSET_LOADING' | 'FULLSCREEN_CHANGED' | 'LANGUAGE_CHANGED' | 'WEAPON_RELOADING' | 'BOSS_BAR' | 'RACE_COUNTDOWN' | 'RACE_STARTED' | 'RACE_STATUS' | 'RACE_FINISHED' | 'LEVELS_CHANGED' | 'HINT' | 'OBJECTIVES_CHANGED' | 'DIALOGUE_STARTED' | 'DIALOGUE_LINE' | 'DIALOGUE_ENDED' | 'INVENTORY_CHANGED' | 'COINS_CHANGED' | 'SHOP_CHANGED' | 'PERF_CHANGED' | 'POWERUP_STARTED' | 'POWERUP_ENDED' | 'POWERUPS_CHANGED' | 'LOOT_DROPPED' | 'LEADERBOARD_CHANGED'
  | 'LEVEL_STARTED' | 'LEVEL_COMPLETED' | 'CHECKPOINT_REACHED'
  | 'PLAYER_SPAWNED' | 'PLAYER_MOVED' | 'PLAYER_JUMPED' | 'PLAYER_LANDED'
  | 'PLAYER_DAMAGED' | 'PLAYER_HEALED' | 'PLAYER_DIED' | 'PLAYER_FELL'
  | 'ENEMY_SPAWNED' | 'ENEMY_DAMAGED' | 'ENEMY_DIED' | 'ENEMY_ALERTED'
  | 'WEAPON_FIRED' | 'WEAPON_RELOADED' | 'WEAPON_EMPTY' | 'MELEE_SWING' | 'MELEE_HIT' | 'PROJECTILE_HIT'
  | 'ITEM_COLLECTED' | 'ITEM_USED' | 'SCORE_CHANGED'
  | 'QUEST_STARTED' | 'QUEST_COMPLETED'
  | 'BOSS_SPAWNED' | 'BOSS_PHASE_CHANGED' | 'BOSS_DEFEATED'
  // The meta layer (meta.ts): what a player sees between and across rounds.
  | 'COMBO_CHANGED' | 'COMBO_MILESTONE' | 'NEW_BEST' | 'LEVEL_UP' | 'ACHIEVEMENT_UNLOCKED'
  | 'DAILY_REWARD' | 'GOAL_COMPLETED' | 'RUN_SUMMARY'
  // The Director (systems/director.ts): the run's rhythm — build, peak, breather.
  | 'PACE_CHANGED';

type Handler = (payload?: any) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  /** Returns an unsubscribe function — always call it when a system is torn down. */
  on(event: GameEvent | string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) { set = new Set(); this.handlers.set(event, set); }
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  once(event: GameEvent | string, handler: Handler): () => void {
    const off = this.on(event, (payload) => { off(); handler(payload); });
    return off;
  }

  emit(event: GameEvent | string, payload?: any): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;
    // Iterate a COPY: a handler that unsubscribes itself (or subscribes another) during dispatch must
    // not corrupt the iteration — a real crash source in event-driven gameplay.
    for (const h of [...set]) {
      // One broken listener must never stop the others, or a cosmetic VFX bug kills the gameplay
      // reaction behind it.
      try { h(payload); } catch (err) { console.error('[events] handler for ' + event + ' threw:', err); }
    }
  }

  clear(): void { this.handlers.clear(); }
}

/** The one bus a generated game shares. */
export const events = new EventBus();
`;

const POOL = `/**
 * Object pool — reuse instead of allocate.
 *
 * A shooter creates and discards hundreds of bullets and thousands of particles a minute. Each \`new\`
 * is work for the garbage collector, and a GC pause is the most common cause of the stutter that makes
 * a browser game feel cheap. Pooling turns that into zero allocations in the steady state.
 *
 * \`reset\` is separate from \`create\` on purpose: a recycled object must be returned to a known state,
 * and forgetting that is how a "new" bullet arrives already carrying the last one's velocity.
 */
export class Pool<T> {
  private free: T[] = [];
  private live = new Set<T>();

  constructor(
    private readonly create: () => T,
    private readonly reset: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(create());
  }

  acquire(): T {
    const item = this.free.pop() ?? this.create();
    this.reset(item);
    this.live.add(item);
    return item;
  }

  release(item: T): void {
    // Releasing twice would put the same object in the free list twice, and two callers would then be
    // handed the SAME "new" object — a bug that looks like teleporting bullets.
    if (!this.live.delete(item)) return;
    this.free.push(item);
  }

  releaseAll(): void {
    for (const item of this.live) this.free.push(item);
    this.live.clear();
  }

  get activeCount(): number { return this.live.size; }
  get pooledCount(): number { return this.free.length; }
  /** Iterate the live objects — the update loop's usual entry point. */
  forEachActive(fn: (item: T) => void): void { for (const item of [...this.live]) fn(item); }
}
`;

const GAME_FEEL = `/**
 * Game feel — the code that makes a hit LAND.
 *
 * Two techniques carry most of it, and both are code, not art:
 *
 * SCREEN SHAKE with trauma-squared decay (Squirrel Eiserloh's method). Adding a random offset per
 * frame looks like noise; driving the offset by trauma² makes a big hit punchy and small ones subtle,
 * and the decay curve feels organic instead of linear. Trauma is added, never set, so overlapping hits
 * stack naturally and cap out.
 *
 * HIT-STOP: freeze the simulation for a few dozen milliseconds on impact. It reads as WEIGHT — the
 * single cheapest thing that separates a game that feels good from one that feels floaty.
 */
export class GameFeel {
  private trauma = 0;
  private hitStopRemaining = 0;
  private seed = 1;

  /** 0..1. A light hit ~0.2, a heavy one ~0.5, an explosion ~0.9. */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
  }

  /** Freeze logic briefly. Seconds — 0.05 is a punch, 0.12 is a kill. */
  addHitStop(seconds: number): void {
    this.hitStopRemaining = Math.max(this.hitStopRemaining, Math.max(0, seconds));
  }

  /** True while the simulation should hold still. The loop skips gameplay update when this is set. */
  get frozen(): boolean { return this.hitStopRemaining > 0; }

  update(delta: number): void {
    if (this.hitStopRemaining > 0) this.hitStopRemaining = Math.max(0, this.hitStopRemaining - delta);
    // Linear trauma decay; the SQUARE is applied when sampling, which is what shapes the feel.
    this.trauma = Math.max(0, this.trauma - delta * 1.4);
  }

  /**
   * Current shake offset. Deterministic PRNG rather than Math.random so a replay or a test produces
   * the same shake — and so nothing here depends on a global the host page might have stubbed.
   */
  shake(maxOffset = 24, maxRoll = 0.08): { x: number; y: number; roll: number } {
    if (this.trauma <= 0) return { x: 0, y: 0, roll: 0 };
    const amount = this.trauma * this.trauma; // the whole trick
    return {
      x: maxOffset * amount * this.noise(),
      y: maxOffset * amount * this.noise(),
      roll: maxRoll * amount * this.noise(),
    };
  }

  private noise(): number {
    // xorshift32 — small, fast, no dependency, and repeatable.
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) / 0xffffffff) * 2 - 1;
  }

  reset(): void { this.trauma = 0; this.hitStopRemaining = 0; }
}

/** Easing functions — use these instead of linear interpolation; linear motion reads as robotic. */
export const ease = {
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  outElastic: (t: number) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
};

/** Frame-rate INDEPENDENT smoothing. \`a + (b - a) * rate\` is not — it moves faster at high FPS. */
export function damp(current: number, target: number, lambda: number, delta: number): number {
  return target + (current - target) * Math.exp(-lambda * delta);
}
`;

const STATE = `/**
 * Game state + save/load.
 *
 * One object, one place. The alternative — values scattered across modules as \`let\` globals — is what
 * makes "restart the level" leave the score from last time, and makes a save file impossible to define.
 *
 * Only DURABLE facts are saved. Transient rendering state (positions mid-animation, particle handles)
 * is deliberately excluded: writing it produces a save that breaks the moment the renderer changes.
 */
import { events } from './events';

export interface GameState {
  status: 'menu' | 'playing' | 'paused' | 'gameover' | 'won';
  level: number;
  score: number;
  highScore: number;
  health: number;
  maxHealth: number;
  lives: number;
  inventory: string[];
  unlocked: string[];
  questsCompleted: string[];
  settings: { musicVolume: number; sfxVolume: number; quality: 'low' | 'medium' | 'high' };
}

export function initialState(): GameState {
  return {
    status: 'menu', level: 1, score: 0, highScore: 0,
    health: 100, maxHealth: 100, lives: 3,
    inventory: [], unlocked: [], questsCompleted: [],
    settings: { musicVolume: 0.6, sfxVolume: 0.8, quality: 'high' },
  };
}

export const state: GameState = initialState();

/** Change state through here so UI and audio can react without polling every frame. */
export function setStatus(status: GameState['status']): void {
  if (state.status === status) return;
  const previous = state.status;
  state.status = status;
  // Leaving PAUSE is a resume, not a new game. It used to emit GAME_STARTED, so anything that starts a
  // round on that event (music, the meta layer's run timer) restarted on every unpause, and
  // GAME_RESUMED — declared, and listened to by the HUD — never fired at all.
  if (status === 'playing') events.emit(previous === 'paused' ? 'GAME_RESUMED' : 'GAME_STARTED');
  if (status === 'paused') events.emit('GAME_PAUSED');
  if (status === 'gameover') events.emit('GAME_OVER');
  if (status === 'won') events.emit('GAME_WON');
  if (status === 'menu') events.emit('GAME_MENU');
}

export function addScore(points: number): void {
  state.score += points;
  if (state.score > state.highScore) state.highScore = state.score;
  events.emit('SCORE_CHANGED', { score: state.score });
}

export function damagePlayer(amount: number): void {
  if (state.status !== 'playing' || amount <= 0) return;
  state.health = Math.max(0, state.health - amount);
  events.emit('PLAYER_DAMAGED', { amount, health: state.health });
  if (state.health === 0) {
    state.lives -= 1;
    events.emit('PLAYER_DIED', { livesLeft: state.lives });
    if (state.lives <= 0) setStatus('gameover');
  }
}

const SAVE_KEY = 'game-save-v1';

/** Durable progress only. Never throws — a full or blocked localStorage must not crash the game. */
export function save(): boolean {
  try {
    const { status, health, ...durable } = state;
    localStorage.setItem(SAVE_KEY, JSON.stringify(durable));
    return true;
  } catch { return false; }
}

export function load(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    // Merge over a FRESH state, so a save written by an older version that lacks newer fields still
    // loads instead of leaving them undefined and crashing on first read.
    Object.assign(state, initialState(), parsed, { status: 'menu' as const });
    return true;
  } catch { return false; }
}

/** A saved game exists on this device (the start screen offers Continue). */
export function hasSave(): boolean {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

/** Forget the saved game (New game). */
export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to forget */ }
}

export function resetRun(): void {
  const { highScore, unlocked, settings } = state;
  Object.assign(state, initialState(), { highScore, unlocked, settings });
}
`;

const STRINGS = `/**
 * THE GAME'S OWN WORDS, IN THE PLAYER'S LANGUAGE (admin 2026-11-19 game-gap audit: every kit screen was hard-coded
 * English — "Paused", "Game over", "Play again"). This is the USER'S game, so its words follow the user: English and
 * Hindi are written here; any other language is supplied by the builder through options.strings (never guessed).
 * Placeholders like {score} are filled by t(key, { score }).
 */
import { events } from './events';

const EN = {
  ready: 'Ready?', play: 'Play', settings: 'Settings', paused: 'Paused', resume: 'Resume', restart: 'Restart', menu: 'Menu',
  gameOver: 'Game over', youWin: 'You win', playAgain: 'Play again', back: 'Back', score: 'Score', best: 'Best',
  sound: 'Sound', volume: 'Volume', music: 'Music', effects: 'Effects', graphics: 'Graphics', graphicsQuality: 'Graphics quality',
  smooth: 'Smooth', balanced: 'Balanced', sharp: 'Sharp', lookSpeed: 'Look speed', vibration: 'Vibration', on: 'On', off: 'Off',
  mute: 'Mute', soundOn: 'Sound on', pause: 'Pause', fullScreen: 'Full screen', exitFullScreen: 'Exit full screen',
  loading: 'Loading', loadingModels: 'Loading models', rotateHint: 'Turn your phone sideways to play',
  controlsTouch: 'Left thumb to move · buttons on the right to act',
  controlsKeyboard: 'WASD / arrow keys to move · Space to jump · F or click to attack · Esc to pause',
  attack: 'Attack', jump: 'Jump', use: 'Use', run: 'Run', left: 'Left', right: 'Right', brake: 'Brake', drift: 'Drift', gas: 'Gas',
  newBest: 'NEW BEST! {score}', soClose: 'So close! Only {n} more to beat your best ({best})', scoreBest: 'Score {score} · Best {best}',
  xpLine: '+{xp} XP · Level {level} ({into}/{next})', levelUp: 'Level up! You reached level {level}', unlocked: 'Unlocked: {name}',
  achievement: 'Achievement: {name}', goalComplete: 'Goal complete: {name}', nextGoal: 'Next goal: {name} ({done})', streak: '{n}-day streak',
  minutes: 'min',
  level: 'Level', levels: 'Levels', levelComplete: 'Level complete', nextLevel: 'Next level', locked: 'Locked',
  difficulty: 'Difficulty', easy: 'Easy', normal: 'Normal', hard: 'Hard', checkpoint: 'Checkpoint',
  continue: 'Continue', inventory: 'Bag', inventoryEmpty: 'Your bag is empty', close: 'Close', needs: 'Needs {name}',
  continueGame: 'Continue', newGame: 'New game', credits: 'Credits',
  reduceMotion: 'Reduce motion', largeText: 'Large text', colourSafe: 'Colour-blind colours', captions: 'Captions',
  capHit: 'You were hit', capEnemyDown: 'Enemy down', capPickup: 'Picked up', capReload: 'Reloading', capEmpty: 'Out of ammo', capBoss: 'A boss appears', capBossDown: 'Boss defeated', capLevelUp: 'Level up', capCoin: 'Coin', capDanger: 'Enemy spotted you',
  share: 'Share', copied: 'Copied!', shareText: 'I scored {score} in {game}! Can you beat it?', bestOnDevice: 'Best on this device',
  autoQuality: 'Auto quality', fpsCounter: 'FPS counter',
  shop: 'Shop', coins: 'Coins', buy: 'Buy', equip: 'Use', equipped: 'In use', owned: 'Owned', maxed: 'Max', levelShort: 'Lv {n}',
};

export type StringKey = keyof typeof EN;
export type GameLanguage = 'en' | 'hi';

const HI: Record<StringKey, string> = {
  ready: 'तैयार?', play: 'खेलें', settings: 'सेटिंग्स', paused: 'रुका हुआ', resume: 'जारी रखें', restart: 'फिर से शुरू', menu: 'मेनू',
  gameOver: 'गेम ओवर', youWin: 'आप जीत गए', playAgain: 'फिर खेलें', back: 'वापस', score: 'स्कोर', best: 'बेस्ट',
  sound: 'आवाज़', volume: 'वॉल्यूम', music: 'संगीत', effects: 'इफ़ेक्ट्स', graphics: 'ग्राफ़िक्स', graphicsQuality: 'ग्राफ़िक्स क्वालिटी',
  smooth: 'स्मूथ', balanced: 'संतुलित', sharp: 'शार्प', lookSpeed: 'कैमरा स्पीड', vibration: 'वाइब्रेशन', on: 'चालू', off: 'बंद',
  mute: 'आवाज़ बंद करें', soundOn: 'आवाज़ चालू करें', pause: 'रोकें', fullScreen: 'फ़ुल स्क्रीन', exitFullScreen: 'फ़ुल स्क्रीन बंद करें',
  loading: 'लोड हो रहा है', loadingModels: 'मॉडल लोड हो रहे हैं', rotateHint: 'खेलने के लिए फ़ोन को तिरछा करें',
  controlsTouch: 'बाएँ अंगूठे से चलें · दाईं ओर के बटन से एक्शन करें',
  controlsKeyboard: 'WASD / तीर कुंजियों से चलें · Space से कूदें · F या क्लिक से हमला · Esc से रोकें',
  attack: 'हमला', jump: 'कूदें', use: 'इस्तेमाल', run: 'दौड़ें', left: 'बाएँ', right: 'दाएँ', brake: 'ब्रेक', drift: 'ड्रिफ़्ट', gas: 'गैस',
  newBest: 'नया बेस्ट! {score}', soClose: 'बस {n} और! अपना बेस्ट ({best}) तोड़ने के लिए', scoreBest: 'स्कोर {score} · बेस्ट {best}',
  xpLine: '+{xp} XP · लेवल {level} ({into}/{next})', levelUp: 'लेवल अप! आप लेवल {level} पर पहुँचे', unlocked: 'अनलॉक: {name}',
  achievement: 'उपलब्धि: {name}', goalComplete: 'लक्ष्य पूरा: {name}', nextGoal: 'अगला लक्ष्य: {name} ({done})', streak: '{n} दिन लगातार',
  minutes: 'मिनट',
  level: 'लेवल', levels: 'लेवल', levelComplete: 'लेवल पूरा', nextLevel: 'अगला लेवल', locked: 'बंद',
  difficulty: 'कठिनाई', easy: 'आसान', normal: 'सामान्य', hard: 'कठिन', checkpoint: 'चेकपॉइंट',
  continue: 'आगे', inventory: 'थैला', inventoryEmpty: 'थैला खाली है', close: 'बंद करें', needs: '{name} चाहिए',
  continueGame: 'जारी रखें', newGame: 'नया गेम', credits: 'क्रेडिट्स',
  reduceMotion: 'कम हलचल', largeText: 'बड़े अक्षर', colourSafe: 'कलर-ब्लाइंड रंग', captions: 'कैप्शन',
  capHit: 'आपको चोट लगी', capEnemyDown: 'दुश्मन गिरा', capPickup: 'उठाया', capReload: 'रीलोड', capEmpty: 'गोलियाँ ख़त्म', capBoss: 'बॉस आ गया', capBossDown: 'बॉस हारा', capLevelUp: 'लेवल अप', capCoin: 'सिक्का', capDanger: 'दुश्मन ने देख लिया',
  share: 'शेयर करें', copied: 'कॉपी हो गया!', shareText: 'मैंने {game} में {score} स्कोर किया! क्या आप इसे हरा सकते हैं?', bestOnDevice: 'इस फ़ोन पर सबसे अच्छे',
  autoQuality: 'ऑटो क्वालिटी', fpsCounter: 'FPS काउंटर',
  shop: 'दुकान', coins: 'सिक्के', buy: 'खरीदें', equip: 'चुनें', equipped: 'चुना हुआ', owned: 'आपका', maxed: 'पूरा', levelShort: 'लेवल {n}',
};

export const GAME_STRINGS: Readonly<Record<GameLanguage, Record<StringKey, string>>> = { en: EN, hi: HI };

let active: Record<StringKey, string> = { ...EN };
let activeLanguage: GameLanguage | 'custom' = 'en';

/** The page's own language, then the browser's — for language: 'auto'. */
function detect(): GameLanguage {
  try {
    const page = typeof document !== 'undefined' ? document.documentElement?.lang ?? '' : '';
    const browser = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
    return /^hi\\b/i.test(page) || (!page && /^hi\\b/i.test(browser)) ? 'hi' : 'en';
  } catch { return 'en'; }
}

/**
 * Choose the words: 'en', 'hi', or 'auto' (the page's language). overrides replaces any key — the way a builder
 * gives Tamil, Bangla or any other language, or changes one label. A non-string override is ignored.
 */
export function setGameLanguage(language: GameLanguage | 'auto' = 'en', overrides: Partial<Record<StringKey, string>> = {}): GameLanguage {
  const lang: GameLanguage = language === 'auto' ? detect() : (language in GAME_STRINGS ? language : 'en');
  const clean: Partial<Record<StringKey, string>> = {};
  for (const [k, v] of Object.entries(overrides ?? {})) if (k in EN && typeof v === 'string' && v.trim()) clean[k as StringKey] = v;
  active = { ...GAME_STRINGS[lang], ...clean };
  activeLanguage = Object.keys(clean).length ? 'custom' : lang;
  events.emit('LANGUAGE_CHANGED', { language: lang });
  return lang;
}

export function gameLanguage(): GameLanguage | 'custom' { return activeLanguage; }

/** The word for key in the chosen language, with {placeholders} filled. Falls back to English, never to a key name. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let text = active[key] ?? EN[key] ?? '';
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split('{' + k + '}').join(String(v));
  return text;
}
`;

const LOADING = `/**
 * LOADING — what is still being fetched or built, so the player sees honest progress instead of a blank screen
 * (admin 2026-11-19 game-gap audit: "loading screen nahi"). Real work only: a job is begun when a download or a
 * build starts and ended when it finishes; the fraction never moves on its own. The Hud draws it while active.
 */
import { events } from './events';
import { t } from './strings';

interface Job { label: string; fraction: number }

export interface LoadingState {
  /** Something is still loading. */
  active: boolean;
  /** 0..1 across everything begun since the last time nothing was loading. */
  fraction: number;
  /** What is loading now (the newest job). */
  label: string;
  pending: number;
}

const jobs = new Map<number, Job>();
let nextId = 1;
let finished = 0;

function snapshot(): LoadingState {
  const total = finished + jobs.size;
  let done = finished;
  let label = '';
  for (const job of jobs.values()) { done += Math.max(0, Math.min(1, job.fraction)); label = job.label; }
  return { active: jobs.size > 0, fraction: total === 0 ? 1 : done / total, label, pending: jobs.size };
}
const announce = (): void => { events.emit('LOADING_PROGRESS', snapshot()); };

export const loading = {
  /** A job starts; returns its id. */
  begin(label = t('loading')): number { const id = nextId++; jobs.set(id, { label, fraction: 0 }); announce(); return id; },
  /** How far one job is, 0..1 (only from real bytes or real steps). */
  progress(id: number, fraction: number): void { const job = jobs.get(id); if (!job || !Number.isFinite(fraction)) return; job.fraction = fraction; announce(); },
  /** A job finished (or failed — either way it is no longer loading). */
  end(id: number): void { if (jobs.delete(id)) finished++; if (jobs.size === 0) finished = 0; announce(); },
  get: snapshot,
  /** Track a promise as one job. */
  async track<T>(label: string, work: Promise<T>): Promise<T> { const id = loading.begin(label); try { return await work; } finally { loading.end(id); } },
};

// The model loader (externalAssets.ts / humanRuntime.ts) reports on the event bus, so it never depends on this file.
const assetJob = new Map<number, number>();
events.on('ASSET_LOADING', (p: { id?: unknown; fraction?: unknown; done?: unknown } | undefined) => {
  if (!p || typeof p.id !== 'number') return;
  let id = assetJob.get(p.id);
  if (id === undefined) { id = loading.begin(t('loadingModels')); assetJob.set(p.id, id); }
  if (p.done === true) { loading.end(id); assetJob.delete(p.id); return; }
  if (typeof p.fraction === 'number') loading.progress(id, p.fraction);
});
`;

const LEVELS = `/**
 * LEVELS, CHECKPOINTS AND FIRST-TIME HINTS (admin 2026-11-19 game-gap audit: no stage progression, no respawn at a
 * checkpoint, no tutorial — the LEVEL_* and CHECKPOINT_REACHED events were declared and nothing emitted them).
 *
 *   levels.define([{ name: 'Village' }, { name: 'Forest' }, { name: 'Fort' }], 'my-game');   // once, at start-up
 *   events.on('LEVEL_STARTED', ({ index }) => buildLevel(index));                              // the game builds it
 *   … levels.complete(stars);        // the round is won; the Hud offers Next level
 *   … levels.checkpoint(player.position); on death: const p = levels.respawnPoint(); if (p) put the player there
 *   showHint('jump', 'Press Space or Jump to jump over the gap');   // shown once per game, ever
 * Progress (unlocked levels, stars, the last checkpoint) is saved on the device per game.
 */
import { events } from './events';
import { state, setStatus } from './state';

export interface LevelDef { name: string; /** One line shown in the level list. */ goal?: string }
interface Progress { unlocked: number; stars: number[]; checkpoint: { level: number; x: number; y: number; z: number } | null; hints: string[] }

let defs: LevelDef[] = [];
let gameId = 'game';
let index = 0;
let progress: Progress = { unlocked: 0, stars: [], checkpoint: null, hints: [] };
const key = (): string => 'nb-levels-v1:' + gameId;

function load(): void {
  progress = { unlocked: 0, stars: [], checkpoint: null, hints: [] };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key()) : null;
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<Progress>;
    if (typeof p.unlocked === 'number' && p.unlocked >= 0) progress.unlocked = Math.floor(p.unlocked);
    if (Array.isArray(p.stars)) progress.stars = p.stars.map((n) => (typeof n === 'number' ? Math.max(0, Math.min(3, Math.floor(n))) : 0));
    const c = p.checkpoint;
    if (c && typeof c.level === 'number' && [c.x, c.y, c.z].every((v) => typeof v === 'number' && Number.isFinite(v))) progress.checkpoint = { level: c.level, x: c.x, y: c.y, z: c.z };
    if (Array.isArray(p.hints)) progress.hints = p.hints.filter((h): h is string => typeof h === 'string').slice(0, 200);
  } catch { /* a corrupt save starts fresh */ }
}
function save(): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key(), JSON.stringify(progress)); } catch { /* not saved, still played */ }
}

export const levels = {
  /** Declare the levels (once). Re-declaring keeps the saved progress for the same gameId. */
  define(list: LevelDef[], id = 'game'): void {
    defs = (Array.isArray(list) ? list : []).filter((l) => l && typeof l.name === 'string').map((l) => ({ name: l.name, goal: l.goal }));
    gameId = String(id || 'game');
    load();
    index = Math.min(progress.unlocked, Math.max(0, defs.length - 1));
    state.level = index + 1;
    events.emit('LEVELS_CHANGED', {});
  },
  get count(): number { return defs.length; },
  get list(): readonly LevelDef[] { return defs; },
  get index(): number { return index; },
  get current(): LevelDef | null { return defs[index] ?? null; },
  get hasNext(): boolean { return index + 1 < defs.length; },
  isUnlocked(i: number): boolean { return i >= 0 && i < defs.length && i <= progress.unlocked; },
  stars(i: number): number { return progress.stars[i] ?? 0; },
  /** Begin level i (when unlocked): LEVEL_STARTED { index, name } — the game builds that level. */
  start(i: number): boolean {
    if (!levels.isUnlocked(i)) return false;
    index = i; state.level = i + 1;
    if (progress.checkpoint && progress.checkpoint.level !== i) progress.checkpoint = null;
    save();
    events.emit('LEVEL_STARTED', { index: i, name: defs[i].name });
    return true;
  },
  /** The current level is beaten: stars (0..3) kept at their best, the next level unlocked, the round won. */
  complete(stars = 1): void {
    if (!defs.length) return;
    const s = Math.max(0, Math.min(3, Math.floor(stars)));
    progress.stars[index] = Math.max(progress.stars[index] ?? 0, s);
    progress.unlocked = Math.max(progress.unlocked, Math.min(defs.length - 1, index + 1));
    progress.checkpoint = null;
    save();
    events.emit('LEVEL_COMPLETED', { index, name: defs[index].name, stars: s, next: index + 1 < defs.length });
    setStatus('won');
  },
  /** Start the level after this one. */
  next(): boolean { return levels.start(index + 1); },
  /** Remember where the player is (CHECKPOINT_REACHED); a death can resume here. */
  checkpoint(p: { x: number; y: number; z: number }): void {
    if (![p?.x, p?.y, p?.z].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    progress.checkpoint = { level: index, x: p.x, y: p.y, z: p.z };
    save();
    events.emit('CHECKPOINT_REACHED', { level: index, position: { x: p.x, y: p.y, z: p.z } });
  },
  /** The last checkpoint in THIS level, or null (start from the level's beginning). */
  respawnPoint(): { x: number; y: number; z: number } | null {
    const c = progress.checkpoint;
    return c && c.level === index ? { x: c.x, y: c.y, z: c.z } : null;
  },
  /** Forget all progress for this game (a "reset progress" button). */
  reset(): void { progress = { unlocked: 0, stars: [], checkpoint: null, hints: [] }; index = 0; save(); events.emit('LEVELS_CHANGED', {}); },
};

/**
 * Show a hint ONCE per game, ever (first-time tutorial): HINT { id, text, seconds }. The kit's Hud shows it; the next
 * time the player plays, it stays quiet. Returns whether it was shown.
 */
export function showHint(id: string, text: string, seconds = 4): boolean {
  if (!id || !text || progress.hints.includes(id)) return false;
  progress.hints.push(id);
  save();
  events.emit('HINT', { id, text, seconds: Math.max(1, Math.min(15, seconds)) });
  return true;
}
`;

const QUESTS = `/**
 * OBJECTIVES AND QUESTS (admin 2026-11-19 game-gap audit: "objective / quest tracker nahi" — QUEST_STARTED and
 * QUEST_COMPLETED were declared and nothing used them). What the player is trying to do, on screen, with progress.
 *
 *   objectives.set([{ id: 'coins', text: 'Collect coins', target: 10 }, { id: 'boss', text: 'Defeat the guard' }]);
 *   objectives.progress('coins');          // +1 (or progress('coins', 3))
 *   objectives.complete('boss');
 *   objectives.allDone                     // true once every one is done
 * The kit's Hud shows the list; QUEST_STARTED / QUEST_COMPLETED / OBJECTIVES_CHANGED are announced.
 */
import { events } from './events';
import { state } from './state';

export interface Objective { id: string; text: string; target: number; progress: number; done: boolean }

let list: Objective[] = [];
const changed = (): void => { events.emit('OBJECTIVES_CHANGED', { objectives: objectives.list }); };

export const objectives = {
  /** Replace the list (a new level, a new chapter). */
  set(items: Array<{ id: string; text: string; target?: number }>): void {
    list = (Array.isArray(items) ? items : []).filter((o) => o && o.id && o.text)
      .map((o) => ({ id: String(o.id), text: String(o.text), target: Math.max(1, Math.floor(o.target ?? 1)), progress: 0, done: false }));
    for (const o of list) events.emit('QUEST_STARTED', { id: o.id, text: o.text });
    changed();
  },
  /** Add progress (default 1); reaching the target completes it. */
  progress(id: string, amount = 1): void {
    const o = list.find((x) => x.id === id);
    if (!o || o.done || !Number.isFinite(amount)) return;
    o.progress = Math.max(0, Math.min(o.target, o.progress + amount));
    if (o.progress >= o.target) objectives.complete(id); else changed();
  },
  complete(id: string): void {
    const o = list.find((x) => x.id === id);
    if (!o || o.done) return;
    o.done = true; o.progress = o.target;
    if (!state.questsCompleted.includes(o.id)) state.questsCompleted.push(o.id);
    events.emit('QUEST_COMPLETED', { id: o.id, text: o.text });
    changed();
  },
  get list(): readonly Objective[] { return list.map((o) => ({ ...o })); },
  get allDone(): boolean { return list.length > 0 && list.every((o) => o.done); },
  clear(): void { list = []; changed(); },
};
`;

const INVENTORY = `/**
 * THE PLAYER'S BAG (admin 2026-11-19 game-gap audit: \`state.inventory\` existed and nothing could add to it, count it,
 * use an item or show it). Items are stacks of ids kept IN \`state.inventory\` itself, so save(), load() and a restart
 * already handle the bag — there is no second copy to drift.
 *
 *   inventory.define({ potion: { name: 'Health potion', icon: '🧪', usable: true }, key: { name: 'Gate key', icon: '🔑' } });
 *   inventory.onUse('potion', () => healPlayer(30));   // return false to keep the item (e.g. already at full health)
 *   inventory.add('potion', 2); inventory.has('key'); inventory.remove('key');
 * The kit's Hud shows a bag button once anything is in it (I on a keyboard); INVENTORY_CHANGED / ITEM_USED are announced.
 */
import { events } from './events';
import { state } from './state';

export interface ItemInfo { name?: string; icon?: string; description?: string; usable?: boolean; max?: number }
export interface ItemStack { id: string; name: string; icon: string; description: string; count: number; usable: boolean }

const info = new Map<string, ItemInfo>();
const handlers = new Map<string, (id: string) => boolean | void>();
const changed = (): void => { events.emit('INVENTORY_CHANGED', { items: inventory.list }); };
const valid = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64;
const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

export const inventory = {
  /** Names, icons and rules for item ids. An undefined id still works — it shows its id. */
  define(items: Record<string, ItemInfo>): void {
    for (const [id, i] of Object.entries(items ?? {})) if (valid(id) && i) info.set(id, i);
    changed();
  },
  /** The item's display name (its id when it was never defined). */
  nameOf(id: string): string { return info.get(id)?.name ?? id; },
  count(id: string): number { return state.inventory.filter((x) => x === id).length; },
  has(id: string, count = 1): boolean { return inventory.count(id) >= Math.max(1, whole(count)); },
  /** Add up to \`count\` (a stack holds at most \`max\`, default 99). Returns how many were added. */
  add(id: string, count = 1): number {
    if (!valid(id)) return 0;
    const room = Math.max(0, whole(info.get(id)?.max ?? 99) - inventory.count(id));
    const n = Math.min(room, whole(count));
    for (let i = 0; i < n; i++) state.inventory.push(id);
    if (n > 0) changed();
    return n;
  },
  /** Take \`count\` away — all of them or none (a recipe needing 3 never takes 2). */
  remove(id: string, count = 1): boolean {
    const n = Math.max(1, whole(count));
    if (!inventory.has(id, n)) return false;
    let left = n;
    for (let i = state.inventory.length - 1; i >= 0 && left > 0; i--) if (state.inventory[i] === id) { state.inventory.splice(i, 1); left--; }
    changed();
    return true;
  },
  /** What happens when the player uses an item. Return false to keep it. */
  onUse(id: string, fn: (id: string) => boolean | void): () => void {
    handlers.set(id, fn);
    return () => { if (handlers.get(id) === fn) handlers.delete(id); };
  },
  /** Use one: runs its onUse, then spends it. False when there is none, or nothing to do with it. */
  use(id: string): boolean {
    const fn = handlers.get(id);
    if (!inventory.has(id) || (!fn && !info.get(id)?.usable)) return false;
    if (fn && fn(id) === false) return false;
    inventory.remove(id, 1);
    events.emit('ITEM_USED', { id, left: inventory.count(id) });
    return true;
  },
  /** One entry per kind, in the order they were first picked up. */
  get list(): ItemStack[] {
    const order: string[] = [];
    for (const id of state.inventory) if (!order.includes(id)) order.push(id);
    return order.map((id) => {
      const i = info.get(id) ?? {};
      return { id, name: inventory.nameOf(id), icon: i.icon ?? '◆', description: i.description ?? '', count: inventory.count(id), usable: !!(i.usable || handlers.has(id)) };
    });
  },
  clear(): void { state.inventory.length = 0; changed(); },
};
`;

const PERF = `/**
 * SMOOTH ON EVERY PHONE (admin 2026-11-19 game-gap audit: no frame-rate watch and no automatic quality — a game that ran
 * at 60 on a laptop ran at 18 on a budget phone and stayed there). The governor watches the real frame time and steps
 * the picture DOWN one level after a few seconds of struggling, and back up after a long good run. It never goes above
 * what the player chose in Settings, and the player can turn it off (Settings → Auto quality).
 *
 *   const gov = createPerfGovernor();
 *   gov.feed(frameSeconds);   // every drawn frame; true when the step changed
 *   gov.fps, gov.drop          // smoothed frames per second; 0, 1 or 2 levels below the player's choice
 * Hitches (a tab switch, a long load) are ignored, and so are the first seconds while the world is still building.
 */
export interface PerfOptions {
  /** Below this many frames a second counts as struggling. */
  low?: number;
  /** Above this counts as comfortable. */
  high?: number;
  /** Seconds of struggling before stepping down. */
  downAfter?: number;
  /** Seconds of comfort before stepping back up. */
  upAfter?: number;
  /** Seconds ignored at the start. */
  warmup?: number;
  /** The most levels it may drop. */
  maxDrop?: number;
}

export interface PerfGovernor { feed(frameSeconds: number): boolean; readonly fps: number; readonly drop: number; reset(): void }

export function createPerfGovernor(o: PerfOptions = {}): PerfGovernor {
  const low = o.low ?? 40, high = o.high ?? 56, downAfter = o.downAfter ?? 3, upAfter = o.upAfter ?? 12;
  const warmup = o.warmup ?? 2, maxDrop = Math.max(0, Math.floor(o.maxDrop ?? 2));
  let fps = 60, drop = 0, elapsed = 0, slow = 0, fast = 0;
  return {
    feed(dt: number): boolean {
      // A hitch is not the device's pace: a tab switch or a long load would otherwise drop quality for nothing.
      if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) return false;
      elapsed += dt;
      fps += (1 / dt - fps) * Math.min(1, dt * 2);       // smoothed over about half a second
      if (elapsed < warmup) return false;
      if (fps < low) { slow += dt; fast = 0; } else if (fps > high) { fast += dt; slow = 0; } else { slow = 0; fast = 0; }
      if (slow >= downAfter && drop < maxDrop) { drop++; slow = 0; fps = Math.max(fps, low); return true; }
      if (fast >= upAfter && drop > 0) { drop--; fast = 0; return true; }
      return false;
    },
    get fps(): number { return fps; },
    get drop(): number { return drop; },
    reset(): void { fps = 60; drop = 0; elapsed = 0; slow = 0; fast = 0; },
  };
}

/** The player's quality stepped down \`drop\` levels (high → medium → low). */
export function steppedQuality(chosen: 'low' | 'medium' | 'high', drop: number): 'low' | 'medium' | 'high' {
  const order = ['high', 'medium', 'low'] as const;
  return order[Math.min(2, order.indexOf(chosen) + Math.max(0, Math.floor(drop)))];
}
`;

const ECONOMY = `/**
 * COINS, A SHOP, UPGRADES AND A GARAGE (admin 2026-11-19 game-gap audit: no currency, no shop, no upgrades, no car or
 * character to choose — nothing to come back for). Saved on the device per game, so coins and purchases survive a
 * restart and a reload.
 *
 *   economy.setup({ id: 'desert-rally', startCoins: 50, items: [
 *     { id: 'red',    name: 'Red car',    price: 0,   slot: 'car' },             // price 0 = owned and in use from the start
 *     { id: 'blue',   name: 'Blue racer', price: 300, slot: 'car', icon: '🏎️' },
 *     { id: 'engine', name: 'Engine',     price: 100, levels: 5 },               // an upgrade: 100, 150, 225 … (priceStep 1.5)
 *     { id: 'potion', name: 'Potion',     price: 40,  kind: 'item' },            // a consumable: goes in the bag
 *   ] });
 *   economy.earn(10);                                 // a coin picked up
 *   const top = economy.stat('engine', 30, 4);        // 30 + 4 per engine level
 *   economy.equipped('car')                           // 'red' — build that car; SHOP_CHANGED says when it changes
 * The kit's Hud shows the coins and a Shop on the start and game-over screens. COINS_CHANGED / SHOP_CHANGED are announced.
 */
import { events } from './events';
import { inventory } from './inventory';

export interface ShopItem {
  id: string; name: string; price: number; icon?: string; description?: string;
  /** A slot ('car', 'character', 'gun'): owned items in it are chosen between, one in use at a time. */
  slot?: string;
  /** An upgrade: how many times it can be bought. Each level costs priceStep (default 1.5) times the last. */
  levels?: number; priceStep?: number;
  /** 'item' = a consumable that goes in the bag (core/inventory.ts) every time it is bought. */
  kind?: 'item';
}
export type BuyResult = 'bought' | 'owned' | 'poor' | 'max' | 'unknown';
export interface ShopEntry extends ShopItem { owned: boolean; level: number; nextPrice: number | null; inUse: boolean }

interface Saved { coins: number; owned: Record<string, number>; equipped: Record<string, string> }
let key = 'nb-economy:game';
let items: ShopItem[] = [];
let data: Saved = { coins: 0, owned: {}, equipped: {} };
const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

function persist(): void { try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* full or blocked storage: play on */ } }
function read(): Saved | null {
  try {
    const p = JSON.parse(localStorage.getItem(key) || 'null');
    if (!p || typeof p !== 'object') return null;
    const owned: Record<string, number> = {}; const equipped: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.owned ?? {})) if (whole(v) > 0) owned[k] = whole(v);
    for (const [k, v] of Object.entries(p.equipped ?? {})) if (typeof v === 'string') equipped[k] = v;
    return { coins: whole(p.coins), owned, equipped };
  } catch { return null; }
}
const find = (id: string): ShopItem | undefined => items.find((i) => i.id === id);
const maxLevel = (i: ShopItem): number => (i.kind === 'item' ? Infinity : Math.max(1, whole(i.levels ?? 1)));
const coinsChanged = (): void => { events.emit('COINS_CHANGED', { coins: data.coins }); };
const shopChanged = (id: string, action: string): void => { events.emit('SHOP_CHANGED', { id, action }); };

/** Free items are owned, and every slot has something in use when anything in it is owned. */
function settle(): void {
  for (const i of items) if (whole(i.price) === 0 && i.kind !== 'item' && !data.owned[i.id]) data.owned[i.id] = 1;
  const slots = new Set(items.filter((i) => i.slot).map((i) => i.slot as string));
  for (const slot of slots) {
    const current = find(data.equipped[slot] ?? '');
    if (current && current.slot === slot && data.owned[current.id]) continue;
    const first = items.find((i) => i.slot === slot && data.owned[i.id]);
    if (first) data.equipped[slot] = first.id; else delete data.equipped[slot];
  }
}

export const economy = {
  /** Declare the shop and load this game's saved wallet. Call once, before the start screen shows. */
  setup(o: { id?: string; items?: ShopItem[]; startCoins?: number }): void {
    key = 'nb-economy:' + String(o?.id ?? 'game');
    items = (Array.isArray(o?.items) ? o.items : []).filter((i) => i && typeof i.id === 'string' && i.id && typeof i.name === 'string')
      .map((i) => ({ ...i, price: whole(i.price) }));
    data = read() ?? { coins: whole(o?.startCoins), owned: {}, equipped: {} };
    settle(); persist();
    coinsChanged(); shopChanged('', 'setup');
  },
  get ready(): boolean { return items.length > 0; },
  get coins(): number { return data.coins; },
  earn(amount: number): void { const n = whole(amount); if (!n) return; data.coins += n; persist(); coinsChanged(); },
  /** Pay \`amount\` if the player has it — all or nothing. */
  spend(amount: number): boolean {
    const n = whole(amount);
    if (n > data.coins) return false;
    if (!n) return true;
    data.coins -= n; persist(); coinsChanged();
    return true;
  },
  level(id: string): number { return data.owned[id] ?? 0; },
  owns(id: string): boolean { return (data.owned[id] ?? 0) > 0; },
  /** What the next purchase of \`id\` costs, or null when it cannot be bought again. */
  priceOf(id: string): number | null {
    const i = find(id);
    if (!i) return null;
    const lv = economy.level(id);
    if (lv >= maxLevel(i)) return null;
    if (i.kind === 'item') return i.price;
    return Math.round(i.price * Math.pow(i.priceStep && i.priceStep > 0 ? i.priceStep : 1.5, lv));
  },
  buy(id: string): BuyResult {
    const i = find(id);
    if (!i) return 'unknown';
    const price = economy.priceOf(id);
    if (price === null) return maxLevel(i) === 1 ? 'owned' : 'max';
    if (!economy.spend(price)) return 'poor';
    if (i.kind === 'item') inventory.add(i.id, 1);
    else data.owned[id] = economy.level(id) + 1;
    // A new car or character is put to use at once — that is why it was bought.
    if (i.slot) data.equipped[i.slot] = i.id;
    persist(); shopChanged(id, 'bought');
    return 'bought';
  },
  /** Put an owned slot item in use. */
  equip(id: string): boolean {
    const i = find(id);
    if (!i || !i.slot || !economy.owns(id)) return false;
    data.equipped[i.slot] = id; persist(); shopChanged(id, 'equipped');
    return true;
  },
  equipped(slot: string): string | null { return data.equipped[slot] ?? null; },
  /** A number that grows with an upgrade: base + perLevel × its level. */
  stat(id: string, base: number, perLevel: number): number { return base + perLevel * economy.level(id); },
  get list(): ShopEntry[] {
    return items.map((i) => ({ ...i, owned: economy.owns(i.id), level: economy.level(i.id), nextPrice: economy.priceOf(i.id), inUse: !!i.slot && data.equipped[i.slot] === i.id }));
  },
  /** Wipe this game's wallet and purchases (a "reset progress" button). */
  reset(): void { data = { coins: 0, owned: {}, equipped: {} }; settle(); persist(); coinsChanged(); shopChanged('', 'reset'); },
};
`;

const POWERUPS = `/**
 * POWER-UPS (admin 2026-11-19 game-gap audit: no timed boosts — every "speed boost" or "shield" was a hand-rolled
 * setTimeout that kept running through the pause menu and survived a restart). A power-up here lasts game time: it
 * counts down only while the round runs, freezes in the pause menu, and every one ends when a new round starts.
 *
 *   powerUps.define({ speed: { name: 'Speed', icon: '⚡', seconds: 6 }, shield: { name: 'Shield', icon: '🛡️', seconds: 8 },
 *                     magnet: { name: 'Magnet', icon: '🧲', seconds: 10, stack: 'extend' } });
 *   powerUps.give('speed');                                   // on pickup
 *   const run = powerUps.value('speed', 6, 10);               // 10 while it lasts, 6 otherwise
 *   if (powerUps.active('shield')) return;                    // ignore the hit
 * Picking one up again: 'refresh' (default) restarts its clock, 'extend' adds its time, 'stack' raises its level (up to
 * maxStacks) and restarts the clock. The kit's Hud shows each with a ring for the time left.
 */
import { events } from './events';

export interface PowerUpDef {
  name?: string; icon?: string;
  /** How long one pickup lasts, in seconds of play. */
  seconds: number;
  stack?: 'refresh' | 'extend' | 'stack';
  maxStacks?: number;
  /** Called when it starts (and with the new level when it stacks). */
  onStart?: (level: number) => void;
  onEnd?: () => void;
}
export interface ActivePowerUp { id: string; name: string; icon: string; remaining: number; total: number; level: number }

const defs = new Map<string, PowerUpDef>();
const live = new Map<string, { remaining: number; total: number; level: number }>();
const changed = (): void => { events.emit('POWERUPS_CHANGED', { active: powerUps.list }); };
const safe = (fn: (() => void) | undefined): void => { try { fn?.(); } catch (e) { console.error('[powerUps]', e); } };

export const powerUps = {
  define(items: Record<string, PowerUpDef>): void {
    for (const [id, d] of Object.entries(items ?? {})) if (id && d && Number.isFinite(d.seconds) && d.seconds > 0) defs.set(id, d);
  },
  /** Start (or re-apply) a power-up. Unknown ids are refused. seconds overrides the defined length. */
  give(id: string, seconds?: number): boolean {
    const d = defs.get(id);
    if (!d) return false;
    const len = Number.isFinite(seconds) && (seconds as number) > 0 ? (seconds as number) : d.seconds;
    const cur = live.get(id);
    if (!cur) {
      live.set(id, { remaining: len, total: len, level: 1 });
      safe(() => d.onStart?.(1));
      events.emit('POWERUP_STARTED', { id, level: 1 });
    } else if ((d.stack ?? 'refresh') === 'extend') {
      cur.remaining += len; cur.total = Math.max(cur.total, cur.remaining);
    } else if (d.stack === 'stack') {
      const level = Math.min(Math.max(1, Math.floor(d.maxStacks ?? 3)), cur.level + 1);
      if (level !== cur.level) { cur.level = level; safe(() => d.onStart?.(level)); events.emit('POWERUP_STARTED', { id, level }); }
      cur.remaining = Math.max(cur.remaining, len); cur.total = Math.max(cur.total, len);
    } else {
      cur.remaining = Math.max(cur.remaining, len); cur.total = Math.max(cur.total, cur.remaining);
    }
    changed();
    return true;
  },
  /** Advance the clocks by dt seconds of play (the 3D shell calls this every step of a running round). */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || live.size === 0) return;
    const ended: string[] = [];
    for (const [id, p] of live) { p.remaining -= dt; if (p.remaining <= 0) ended.push(id); }
    for (const id of ended) powerUps.end(id);
  },
  end(id: string): void {
    if (!live.delete(id)) return;
    safe(() => defs.get(id)?.onEnd?.());
    events.emit('POWERUP_ENDED', { id });
    changed();
  },
  active(id: string): boolean { return live.has(id); },
  level(id: string): number { return live.get(id)?.level ?? 0; },
  remaining(id: string): number { return Math.max(0, live.get(id)?.remaining ?? 0); },
  /** boosted while the power-up lasts, base otherwise. */
  value<T>(id: string, base: T, boosted: T): T { return live.has(id) ? boosted : base; },
  get list(): ActivePowerUp[] {
    return [...live].map(([id, p]) => { const d = defs.get(id) ?? { seconds: p.total }; return { id, name: d.name ?? id, icon: d.icon ?? '★', remaining: Math.max(0, p.remaining), total: p.total, level: p.level }; });
  },
  /** End every power-up (a new round). */
  clear(): void { for (const id of [...live.keys()]) powerUps.end(id); },
};
`;

const LOOT = `/**
 * LOOT TABLES (admin 2026-11-19 game-gap audit: no drops — an enemy died and nothing happened, or the model wrote
 * Math.random() < 0.1 and a player went 40 kills without the item). Weighted entries with rarities, a "nothing" entry,
 * amounts, and a pity rule so bad luck has a ceiling.
 *
 *   const drops = createLootTable([
 *     { item: null, weight: 50 },                                  // nothing
 *     { item: 'coin', weight: 40, count: [1, 5] },
 *     { item: 'potion', weight: 9, rarity: 'rare' },
 *     { item: 'golden-sword', weight: 1, rarity: 'legendary' },
 *   ], { pity: { rarity: 'rare', after: 15 } });                    // a rare or better at least every 15 rolls
 *   const d = drops.roll();      // { item, rarity, count } — LOOT_DROPPED is announced when there is an item
 */
import { events } from './events';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
const ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export interface LootEntry { item: string | null; weight: number; rarity?: Rarity; count?: [number, number] }
export interface LootDrop { item: string | null; rarity: Rarity; count: number }
export interface LootTable { roll(rng?: () => number): LootDrop; chances(): Array<{ item: string | null; rarity: Rarity; chance: number }>; readonly sincePity: number }

export function createLootTable(entries: LootEntry[], o: { pity?: { rarity: Rarity; after: number } } = {}): LootTable {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && Number.isFinite(e.weight) && e.weight > 0).map((e) => ({ ...e, rarity: e.rarity ?? 'common' as Rarity }));
  if (list.length === 0) throw new Error('a loot table needs at least one entry with a positive weight');
  const total = list.reduce((n, e) => n + e.weight, 0);
  const pity = o.pity && ORDER.includes(o.pity.rarity) && o.pity.after >= 1 ? o.pity : null;
  const pityPool = pity ? list.filter((e) => e.item !== null && ORDER.indexOf(e.rarity) >= ORDER.indexOf(pity.rarity)) : [];
  let since = 0;
  const pick = (pool: typeof list, r: number) => {
    const sum = pool.reduce((n, e) => n + e.weight, 0);
    let x = r * sum;
    for (const e of pool) { x -= e.weight; if (x < 0) return e; }
    return pool[pool.length - 1];
  };
  return {
    roll(rng: () => number = Math.random): LootDrop {
      const forced = pity && pityPool.length > 0 && since >= pity.after - 1;
      const e = forced ? pick(pityPool, rng()) : pick(list, rng());
      const counts = e.count ?? [1, 1];
      const lo = Math.max(0, Math.floor(Math.min(counts[0], counts[1]))), hi = Math.max(lo, Math.floor(Math.max(counts[0], counts[1])));
      const count = e.item === null ? 0 : lo + Math.floor(rng() * (hi - lo + 1));
      if (pity) since = e.item !== null && ORDER.indexOf(e.rarity) >= ORDER.indexOf(pity.rarity) ? 0 : since + 1;
      const drop = { item: e.item, rarity: e.rarity, count };
      if (drop.item !== null && drop.count > 0) events.emit('LOOT_DROPPED', drop);
      return drop;
    },
    chances() { return list.map((e) => ({ item: e.item, rarity: e.rarity, chance: e.weight / total })); },
    get sincePity() { return since; },
  };
}
`;

const LEADERBOARD = `/**
 * THE BEST SCORES ON THIS DEVICE (admin 2026-11-19 game-gap audit: no leaderboard — one "best" number, nothing to climb).
 * A top ten per game, saved on the device. It is honest about what it is: the scores played HERE, not the world — a
 * worldwide board needs an online service the game does not have.
 *
 *   leaderboard.record('desert-rally', 1250)   → 3 (the place it took), or null outside the top ten
 *   leaderboard.top('desert-rally', 5)          → [{ score, name, at }, …] best first
 * The 3D shell records every finished round by itself and the end screen lists the top five.
 */
import { events } from './events';

export interface ScoreEntry { score: number; name: string; at: number }
const SIZE = 10;
const key = (gameId: string): string => 'nb-leaderboard:' + String(gameId || 'game');

function read(gameId: string): ScoreEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(gameId)) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e && Number.isFinite(e.score) && e.score >= 0)
      .map((e) => ({ score: Math.floor(e.score), name: String(e.name ?? 'You').slice(0, 24), at: Number.isFinite(e.at) ? e.at : 0 }))
      .sort((a, b) => b.score - a.score || a.at - b.at).slice(0, SIZE);
  } catch { return []; }
}

let last: { gameId: string; at: number } | null = null;

export const leaderboard = {
  /** Record a finished round. Returns its place (1 = best) or null when it did not make the top ten. */
  record(gameId: string, score: number, name = 'You'): number | null {
    if (!Number.isFinite(score) || score <= 0) return null;
    const entry: ScoreEntry = { score: Math.floor(score), name: String(name).slice(0, 24) || 'You', at: Date.now() };
    const list = [...read(gameId), entry].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, SIZE);
    const place = list.indexOf(entry);
    if (place < 0) return null;
    try { localStorage.setItem(key(gameId), JSON.stringify(list)); } catch { /* full or blocked storage: the round still counts on screen */ }
    last = { gameId, at: entry.at };
    events.emit('LEADERBOARD_CHANGED', { gameId, place: place + 1 });
    return place + 1;
  },
  top(gameId: string, n = SIZE): ScoreEntry[] { return read(gameId).slice(0, Math.max(0, n)); },
  /** Is this entry the one just recorded (for highlighting it)? */
  isLatest(gameId: string, e: ScoreEntry): boolean { return !!last && last.gameId === gameId && last.at === e.at; },
  clear(gameId: string): void { try { localStorage.removeItem(key(gameId)); } catch { /* nothing to clear */ } last = null; events.emit('LEADERBOARD_CHANGED', { gameId, place: null }); },
};
`;

const DIALOGUE = `/**
 * TALKING TO PEOPLE (admin 2026-11-19 game-gap audit: an RPG had no dialogue box and no choices). A speaker, a line,
 * and — when the story forks — choices; a choice can need an item from the bag. While someone is talking the game
 * holds still (the shell does not run your update), and the press that ends the talk is not also a jump.
 *
 *   await dialogue.say('Guard', 'Halt! Who goes there?');
 *   const pick = await dialogue.open({ start: 'hi', nodes: {
 *     hi:  { speaker: 'Trader', text: 'Want a potion?', choices: [
 *            { id: 'buy', text: 'Yes (1 coin)', requires: { item: 'coin' }, onChoose: () => { inventory.remove('coin'); inventory.add('potion'); }, next: 'bye' },
 *            { id: 'no',  text: 'No thanks' } ] },
 *     bye: { speaker: 'Trader', text: 'Stay safe out there.' } } });
 * A plain list of lines works too: dialogue.open([{ speaker: 'Mira', text: 'Follow me.' }, { text: '…' }]).
 * The promise resolves with the id of the last choice made (or null). DIALOGUE_STARTED / _LINE / _ENDED are announced.
 */
import { events } from './events';
import { inventory } from './inventory';

export interface DialogueChoice { id?: string; text: string; next?: string; requires?: { item: string; count?: number }; onChoose?: () => void }
export interface DialogueNode { speaker?: string; text: string; next?: string; choices?: DialogueChoice[]; onEnter?: () => void }
export type DialogueScript = DialogueNode[] | { start: string; nodes: Record<string, DialogueNode> };
export interface DialogueView { speaker: string; text: string; choices: Array<{ text: string; available: boolean; needs: string | null }> }

let nodes: Record<string, DialogueNode> = {};
let at: string | null = null;
let lastChoice: string | null = null;
let resolve: ((choice: string | null) => void) | null = null;
let justEnded = false;

function enter(id: string | undefined): void {
  const n = id != null ? nodes[id] : undefined;
  if (!n || typeof n.text !== 'string') { dialogue.close(); return; }
  at = id!;
  try { n.onEnter?.(); } catch (e) { console.error('[dialogue] onEnter failed', e); }
  events.emit('DIALOGUE_LINE', dialogue.current);
}

export const dialogue = {
  /** Start a conversation (it replaces one already open, which ends with null). */
  open(script: DialogueScript): Promise<string | null> {
    if (at !== null) dialogue.close();
    if (Array.isArray(script)) {
      nodes = {};
      script.forEach((n, i) => { nodes[String(i)] = { ...n, next: n.next ?? (n.choices?.length ? undefined : (i + 1 < script.length ? String(i + 1) : undefined)) }; });
      if (script.length === 0) return Promise.resolve(null);
      return dialogue.begin('0');
    }
    nodes = { ...(script?.nodes ?? {}) };
    return dialogue.begin(script?.start);
  },
  /** One line from one speaker. */
  say(speaker: string, text: string): Promise<string | null> { return dialogue.open([{ speaker, text }]); },
  begin(start: string | undefined): Promise<string | null> {
    if (start == null || !nodes[start]) return Promise.resolve(null);
    lastChoice = null;
    const done = new Promise<string | null>((r) => { resolve = r; });
    events.emit('DIALOGUE_STARTED', {});
    enter(start);
    return done;
  },
  get active(): boolean { return at !== null; },
  get current(): DialogueView | null {
    const n = at !== null ? nodes[at] : undefined;
    if (!n) return null;
    return {
      speaker: n.speaker ?? '',
      text: n.text,
      choices: (n.choices ?? []).map((c) => {
        const r = c.requires;
        const ok = !r || inventory.has(r.item, r.count ?? 1);
        return { text: c.text, available: ok, needs: ok || !r ? null : inventory.nameOf(r.item) };
      }),
    };
  },
  /** Next line (Continue). Does nothing while choices are waiting — the player has to pick one. */
  advance(): void {
    const n = at !== null ? nodes[at] : undefined;
    if (!n || n.choices?.length) return;
    enter(n.next);
  },
  /** Pick choice \`index\`. A choice whose item is missing cannot be picked. */
  choose(index: number): boolean {
    const n = at !== null ? nodes[at] : undefined;
    const c = n?.choices?.[index];
    if (!c || (c.requires && !inventory.has(c.requires.item, c.requires.count ?? 1))) return false;
    lastChoice = c.id ?? c.text;
    try { c.onChoose?.(); } catch (e) { console.error('[dialogue] onChoose failed', e); }
    if (at === null) return true;          // onChoose opened or closed a conversation itself
    enter(c.next);
    return true;
  },
  close(): void {
    if (at === null) return;
    at = null;
    justEnded = true;
    const r = resolve; resolve = null;
    events.emit('DIALOGUE_ENDED', { choice: lastChoice });
    r?.(lastChoice);
  },
  /** True once after a conversation ends — the shell skips that step so the closing press is not also a jump. */
  takeJustEnded(): boolean { const j = justEnded; justEnded = false; return j; },
};
`;

const SETTINGS = `/**
 * THE PLAYER'S SETTINGS — one place, saved on this device, and actually APPLIED (admin 2026-11-19 audit: the old
 * \`state.settings\` held a music volume, an sfx volume and a quality that nothing ever read, and there was no mute).
 *
 * The shell (Game.ts) applies every change at once: volumes and mute to the audio buses, quality to the renderer,
 * look sensitivity to the camera; vibration is read by buzz(). The pause menu edits them. A game can read them too:
 * settings.get(), settings.subscribe(fn), or the SETTINGS_CHANGED event.
 */
import { events } from './events';
import { state } from './state';

export type Quality = 'low' | 'medium' | 'high';

export interface GameSettings {
  /** 0..1, all sound. */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  /** Silence everything without losing the volumes. */
  muted: boolean;
  /** low = fewer pixels and no shadows (smoother on a weak phone); high = full resolution and shadows. */
  quality: Quality;
  /** Camera look speed, 0.25..3 (1 = default). */
  lookSensitivity: number;
  /** Phone vibration on hits and rewards. */
  vibration: boolean;
  /** How hard the game is; read it with difficultyScale(). */
  difficulty: Difficulty;
  /** Lower the picture by itself when the device cannot keep up (never above \`quality\`). */
  autoQuality: boolean;
  /** Show the frames-per-second counter. */
  showFps: boolean;
  /** No camera shake. On by itself when the device asks for reduced motion. */
  reduceMotion: boolean;
  /** Menus and the HUD drawn larger. */
  largeText: boolean;
  /** Colours that colour-blind players can tell apart (health bar, minimap). */
  colourSafe: boolean;
  /** Short text for important sounds (a hit, an enemy down, a boss…). */
  captions: boolean;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * What a difficulty means, as multipliers a game applies to its own numbers (admin 2026-11-19 game-gap audit: no Easy /
 * Normal / Hard). enemyDamage and enemyHealth scale enemies; enemySpeed their movement; spawn how many come.
 *   const k = difficultyScale(); hp.max = 100 * k.enemyHealth; …
 */
export function difficultyScale(d: Difficulty = current.difficulty): { enemyDamage: number; enemyHealth: number; enemySpeed: number; spawn: number } {
  if (d === 'easy') return { enemyDamage: 0.6, enemyHealth: 0.75, enemySpeed: 0.85, spawn: 0.7 };
  if (d === 'hard') return { enemyDamage: 1.35, enemyHealth: 1.3, enemySpeed: 1.12, spawn: 1.3 };
  return { enemyDamage: 1, enemyHealth: 1, enemySpeed: 1, spawn: 1 };
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = {
  masterVolume: 0.9, musicVolume: 0.6, sfxVolume: 0.8, muted: false, quality: 'high', lookSensitivity: 1, vibration: true, difficulty: 'normal', autoQuality: true, showFps: false, reduceMotion: false, largeText: false, colourSafe: false, captions: false,
};

const KEY = 'nb-game-settings-v1';
const unit = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** Anything read from storage is untrusted: every field is checked, and a bad one falls back to its default. */
export function sanitizeSettings(raw: unknown): GameSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const look = typeof r.lookSensitivity === 'number' && Number.isFinite(r.lookSensitivity) ? Math.max(0.25, Math.min(3, r.lookSensitivity)) : DEFAULT_SETTINGS.lookSensitivity;
  return {
    masterVolume: unit(r.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: unit(r.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: unit(r.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    quality: r.quality === 'low' || r.quality === 'medium' || r.quality === 'high' ? r.quality : DEFAULT_SETTINGS.quality,
    lookSensitivity: look,
    vibration: typeof r.vibration === 'boolean' ? r.vibration : DEFAULT_SETTINGS.vibration,
    difficulty: r.difficulty === 'easy' || r.difficulty === 'normal' || r.difficulty === 'hard' ? r.difficulty : DEFAULT_SETTINGS.difficulty,
    autoQuality: typeof r.autoQuality === 'boolean' ? r.autoQuality : DEFAULT_SETTINGS.autoQuality,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : DEFAULT_SETTINGS.showFps,
    reduceMotion: typeof r.reduceMotion === 'boolean' ? r.reduceMotion : DEFAULT_SETTINGS.reduceMotion,
    largeText: typeof r.largeText === 'boolean' ? r.largeText : DEFAULT_SETTINGS.largeText,
    colourSafe: typeof r.colourSafe === 'boolean' ? r.colourSafe : DEFAULT_SETTINGS.colourSafe,
    captions: typeof r.captions === 'boolean' ? r.captions : DEFAULT_SETTINGS.captions,
  };
}

function read(): GameSettings {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KEY);
      if (raw) return sanitizeSettings(JSON.parse(raw));
    }
  } catch { /* private mode or a corrupt value: the defaults */ }
  // A first visit follows the device: someone who asked their phone for reduced motion gets no camera shake.
  let reduce = false;
  try { reduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no media queries */ }
  return { ...DEFAULT_SETTINGS, reduceMotion: reduce };
}

let current: GameSettings = read();
const listeners = new Set<(s: GameSettings) => void>();
// The older fields stay in step, so code that reads state.settings sees the same values.
const mirror = (): void => { state.settings = { musicVolume: current.musicVolume, sfxVolume: current.sfxVolume, quality: current.quality }; };
mirror();

function set(patch: Partial<GameSettings>): GameSettings {
  current = sanitizeSettings({ ...current, ...patch });
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* not saved, still applied */ }
  mirror();
  const copy = { ...current };
  for (const fn of [...listeners]) { try { fn({ ...copy }); } catch { /* one listener must not stop the others */ } }
  events.emit('SETTINGS_CHANGED', copy);
  return copy;
}

export const settings = {
  get: (): GameSettings => ({ ...current }),
  set,
  toggleMute: (): boolean => set({ muted: !current.muted }).muted,
  reset: (): GameSettings => set({ ...DEFAULT_SETTINGS }),
  /** Called with the new settings after every change. Returns an unsubscribe. */
  subscribe(fn: (s: GameSettings) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
`;

const META = `/**
 * META — the reasons a player presses "Play again", and comes back tomorrow.
 *
 * A game that plays well but forgets everything the moment it ends is played once. What brings a
 * player back is almost never more content; it is a handful of small, honest systems that every
 * successful casual game shares:
 *   • a BEST SCORE that survives a reload, and a loud "NEW BEST!" when it falls;
 *   • the NEAR MISS — "only 12 more to beat your best" — the strongest one-more-try there is;
 *   • a COMBO multiplier, so playing well feels different from playing at all;
 *   • XP and LEVELS that always move forward, even on a bad run, with something unlocked on the way;
 *   • ACHIEVEMENTS for the things a player is proud of;
 *   • a DAILY STREAK and three DAILY GOALS that adapt to what this game actually has.
 *
 * 🔒 ENGAGEMENT, NEVER MANIPULATION. Everything here rewards PLAYING and getting BETTER. There are no
 * loot boxes, no random paid rewards, no fake countdown timers, no guilt messages, and nothing that
 * costs money. A missed day resets the streak quietly and the best streak is kept forever. Many players
 * of these games are children; a reward loop built on chance or pressure is not something we ship.
 *
 * Wiring is ONE call: startMeta({ gameId }). It listens to the events the game already emits
 * (GAME_STARTED, GAME_OVER, GAME_WON, ENEMY_DIED, ITEM_COLLECTED, SCORE_CHANGED), so gameplay code does
 * not change. Add combo.hit() on each successful action for a combo, and combo.update(dt) in the loop.
 * Pure TypeScript, no dependency; storage failures never throw.
 */
import { events } from './events';
import { state, addScore } from './state';
import { settings } from './settings';
import { t } from './strings';

export interface RunStats {
  score: number;
  kills: number;
  items: number;
  maxCombo: number;
  seconds: number;
  won: boolean;
  /** Beat the best score that stood when this round began. */
  newBest: boolean;
}

export type GoalStat = 'runs' | 'time' | 'score' | 'kills' | 'items' | 'combo' | 'seconds';

export interface Goal {
  id: string;
  stat: GoalStat;
  text: string;
  target: number;
  progress: number;
  done: boolean;
  xp: number;
}

export interface Profile {
  version: 1;
  xp: number;
  level: number;
  runs: number;
  bestScore: number;
  bestSeconds: number;
  bestCombo: number;
  totalKills: number;
  totalItems: number;
  streak: number;
  bestStreak: number;
  lastPlayedDay: string;
  dailyClaimedDay: string;
  achievements: string[];
  unlocked: string[];
  goals: { day: string; list: Goal[] };
  haptics: boolean;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  /** Checked when a run ends, with the profile already updated by that run. */
  test: (profile: Profile, run: RunStats) => boolean;
}

export interface RunSummary {
  run: RunStats;
  best: number;
  previousBest: number;
  newBest: boolean;
  /** Points still needed to beat the best, when the run came within 20% of it; otherwise null. */
  nearMiss: number | null;
  xpGained: number;
  level: number;
  levelsGained: number;
  xpIntoLevel: number;
  xpForNext: number;
  unlockedNow: string[];
  achievementsNow: AchievementDef[];
  goalsCompletedNow: Goal[];
  goals: Goal[];
  streak: number;
}

export interface MetaConfig {
  /** Separates saves when one site hosts several games. */
  gameId?: string;
  /** Extra achievements for this game, on top of the built-in ones. */
  achievements?: AchievementDef[];
  /** Rewards unlocked at a level: { 3: 'Red car', 5: 'Night track' }. */
  unlocks?: Record<number, string>;
  /** Clock and storage are injectable so the whole layer is testable and deterministic. */
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** XP needed to go from \`level\` to the next one. Early levels come fast — the first one inside a run. */
export function xpForLevel(level: number): number {
  return Math.round(40 * Math.pow(Math.max(1, level), 1.5));
}

export const BUILTIN_ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-run', title: 'First steps', description: 'Finish your first round', test: (p) => p.runs >= 1 },
  { id: 'ten-runs', title: 'Regular', description: 'Play 10 rounds', test: (p) => p.runs >= 10 },
  { id: 'fifty-runs', title: 'Devoted', description: 'Play 50 rounds', test: (p) => p.runs >= 50 },
  { id: 'beat-best', title: 'Getting better', description: 'Beat your own best score', test: (p, r) => p.runs > 1 && r.newBest },
  { id: 'combo-10', title: 'On fire', description: 'Reach a x10 combo', test: (_p, r) => r.maxCombo >= 10 },
  { id: 'combo-25', title: 'Unstoppable', description: 'Reach a x25 combo', test: (_p, r) => r.maxCombo >= 25 },
  { id: 'streak-3', title: 'Three days running', description: 'Play three days in a row', test: (p) => p.streak >= 3 },
  { id: 'streak-7', title: 'A whole week', description: 'Play seven days in a row', test: (p) => p.streak >= 7 },
  { id: 'level-5', title: 'Level 5', description: 'Reach level 5', test: (p) => p.level >= 5 },
  { id: 'level-10', title: 'Level 10', description: 'Reach level 10', test: (p) => p.level >= 10 },
  { id: 'winner', title: 'Champion', description: 'Win a round', test: (_p, r) => r.won },
];

function freshProfile(): Profile {
  return {
    version: 1, xp: 0, level: 1, runs: 0, bestScore: 0, bestSeconds: 0, bestCombo: 0, totalKills: 0, totalItems: 0,
    streak: 0, bestStreak: 0, lastPlayedDay: '', dailyClaimedDay: '', achievements: [], unlocked: [],
    goals: { day: '', list: [] }, haptics: true,
  };
}

/** Local calendar day, so a streak follows the player's own midnight, not UTC's. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

function previousDay(ms: number): string {
  const d = new Date(ms);
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

/** 1, 2, 5, 10, 20, 50 … — a target a person can say out loud. */
function niceNumber(n: number): number {
  if (n <= 5) return Math.max(1, Math.round(n));
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Three goals for the day, chosen only from what THIS game has shown it does: a game that never
 * emitted ENEMY_DIED never asks for kills. Targets scale from the player's own bests, so they are
 * reachable today and a little ahead of yesterday. Deterministic per day.
 */
export function goalsForDay(day: string, p: Profile): Goal[] {
  const pool: Array<Omit<Goal, 'progress' | 'done'>> = [
    { id: 'runs', stat: 'runs', target: 3, text: 'Play 3 rounds', xp: 30 },
    // Every game has time, so a brand-new player always gets three goals.
    { id: 'time', stat: 'time', target: 180, text: 'Play for 3 minutes', xp: 30 },
  ];
  if (p.bestScore > 0) {
    const t = niceNumber(Math.max(1, p.bestScore * 0.7));
    pool.push({ id: 'score', stat: 'score', target: t, text: 'Score ' + t + ' in one round', xp: 40 });
  }
  if (p.bestSeconds >= 10) {
    const t = niceNumber(Math.max(10, p.bestSeconds * 0.8));
    pool.push({ id: 'seconds', stat: 'seconds', target: t, text: 'Last ' + t + ' seconds in one round', xp: 30 });
  }
  if (p.totalKills > 0) {
    const t = niceNumber(Math.max(5, (p.totalKills / Math.max(1, p.runs)) * 2));
    pool.push({ id: 'kills', stat: 'kills', target: t, text: 'Defeat ' + t + ' enemies', xp: 40 });
  }
  if (p.totalItems > 0) {
    const t = niceNumber(Math.max(5, (p.totalItems / Math.max(1, p.runs)) * 2));
    pool.push({ id: 'items', stat: 'items', target: t, text: 'Collect ' + t + ' items', xp: 30 });
  }
  if (p.bestCombo >= 3) {
    const t = Math.max(3, Math.round(p.bestCombo * 0.8));
    pool.push({ id: 'combo', stat: 'combo', target: t, text: 'Reach a x' + t + ' combo', xp: 40 });
  }
  if (pool.length < 3) pool.push({ id: 'runs5', stat: 'runs', target: 5, text: 'Play 5 rounds', xp: 50 });
  // A seeded shuffle: the same three goals all day, different ones tomorrow.
  let seed = hashString(day);
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
  }
  return shuffled.slice(0, 3).map((g) => ({ ...g, progress: 0, done: false }));
}

/**
 * COMBO — consecutive successes inside a short window raise a multiplier. Missing the window (or
 * taking a hit, via break()) resets it. The multiplier is what makes a skilful run score differently
 * from a long one.
 */
export class Combo {
  count = 0;
  best = 0;
  private timer = 0;
  constructor(public windowSeconds = 2.5, public step = 5, public maxMultiplier = 8) {}

  get multiplier(): number { return Math.min(this.maxMultiplier, 1 + Math.floor(this.count / this.step)); }

  /** One success. Adds \`points × multiplier\` to the score when points are given; returns what was added. */
  hit(points = 0): number {
    this.count += 1;
    this.timer = this.windowSeconds;
    if (this.count > this.best) this.best = this.count;
    events.emit('COMBO_CHANGED', { count: this.count, multiplier: this.multiplier });
    if (this.count % 10 === 0) events.emit('COMBO_MILESTONE', { count: this.count });
    if (points <= 0) return 0;
    const gained = Math.round(points * this.multiplier);
    addScore(gained);
    return gained;
  }

  update(dt: number): void {
    if (this.count === 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.break();
  }

  break(): void {
    if (this.count === 0) return;
    this.count = 0;
    this.timer = 0;
    events.emit('COMBO_CHANGED', { count: 0, multiplier: 1 });
  }

  reset(): void { this.count = 0; this.best = 0; this.timer = 0; }
}

export const combo = new Combo();

/** A short vibration on a phone that supports it. Off when the player turned haptics off. */
export function buzz(pattern: number | number[]): void {
  // The player's Vibration setting (pause menu → Settings) and this game's own haptics toggle must both be on.
  if (!meta.profile.haptics || !settings.get().vibration) return;
  try {
    const nav = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean; userActivation?: { hasBeenActive: boolean } })
      : null;
    // Before the player's first tap the browser blocks vibration AND logs an error to the console — and a
    // console error reads as a broken app. The daily reward fires at start-up, before any tap.
    if (nav && nav.userActivation && !nav.userActivation.hasBeenActive) return;
    if (nav && typeof nav.vibrate === 'function') nav.vibrate(pattern);
  } catch { /* vibration is a nicety; it must never break the game */ }
}

class Meta {
  profile: Profile = freshProfile();
  lastSummary: RunSummary | null = null;
  private config: MetaConfig = {};
  private key = 'nb-meta-v1:game';
  private offs: Array<() => void> = [];
  private run: RunStats | null = null;
  private runStartedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private bestAtStart = 0;

  private now(): number { return this.config.now ? this.config.now() : Date.now(); }
  private store(): Pick<Storage, 'getItem' | 'setItem'> | null {
    if (this.config.storage !== undefined) return this.config.storage;
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  }

  /** Load the profile and start listening. Safe to call twice (the second call re-binds). */
  start(config: MetaConfig = {}): Profile {
    this.stop();
    // A round left unfinished (the player left the game mid-round) must not leak into the next game:
    // it would inherit that round's start time and combo.
    this.run = null;
    this.pausedAt = 0;
    combo.reset();
    this.config = config;
    this.key = 'nb-meta-v1:' + (config.gameId || 'game');
    this.profile = this.read();
    // The HUD and every game that reads state.highScore see the REAL best, from the first frame.
    state.highScore = Math.max(state.highScore, this.profile.bestScore);
    this.offs = [
      events.on('GAME_STARTED', () => this.beginRun()),
      events.on('GAME_PAUSED', () => { this.pausedAt = this.now(); }),
      events.on('GAME_RESUMED', () => { if (this.pausedAt) { this.pausedTotal += this.now() - this.pausedAt; this.pausedAt = 0; } }),
      events.on('ENEMY_DIED', () => { if (this.run) this.run.kills += 1; }),
      events.on('ITEM_COLLECTED', () => { if (this.run) this.run.items += 1; }),
      events.on('GAME_OVER', () => { this.endRun(false); }),
      events.on('GAME_WON', () => { this.endRun(true); }),
    ];
    return this.profile;
  }

  stop(): void { for (const off of this.offs) off(); this.offs = []; }

  setHaptics(on: boolean): void { this.profile.haptics = on; this.write(); }

  /** Today's goals, refreshed at the first look of a new day. */
  goals(): Goal[] {
    const today = dayKey(this.now());
    if (this.profile.goals.day !== today) {
      this.profile.goals = { day: today, list: goalsForDay(today, this.profile) };
      this.write();
    }
    return this.profile.goals.list;
  }

  /** Called on GAME_STARTED. Idempotent while a run is live — resuming from pause emits it too. */
  beginRun(): void {
    if (this.run) return;
    this.lastSummary = null; // the game-over screen must never show the PREVIOUS round's summary
    const t = this.now();
    this.run = { score: 0, kills: 0, items: 0, maxCombo: 0, seconds: 0, won: false, newBest: false };
    this.runStartedAt = t;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.bestAtStart = this.profile.bestScore;
    combo.reset();
    this.touchDay(t);
    this.goals();
  }

  /** The streak and the once-a-day reward. A missed day resets the streak quietly; the best is kept. */
  private touchDay(t: number): void {
    const today = dayKey(t);
    const p = this.profile;
    if (p.lastPlayedDay !== today) {
      p.streak = p.lastPlayedDay === previousDay(t) ? p.streak + 1 : 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.lastPlayedDay = today;
    }
    if (p.dailyClaimedDay !== today) {
      p.dailyClaimedDay = today;
      const xp = 20 * Math.min(p.streak, 7);
      this.addXp(xp);
      events.emit('DAILY_REWARD', { streak: p.streak, xp });
      buzz(30);
    }
    this.write();
  }

  private addXp(amount: number): { levels: number; unlocked: string[] } {
    const p = this.profile;
    p.xp += Math.max(0, Math.round(amount));
    let levels = 0;
    const unlocked: string[] = [];
    while (p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level += 1;
      levels += 1;
      const reward = this.config.unlocks ? this.config.unlocks[p.level] : undefined;
      if (reward && p.unlocked.indexOf(reward) < 0) { p.unlocked.push(reward); unlocked.push(reward); }
      events.emit('LEVEL_UP', { level: p.level, reward: reward || null });
      buzz([40, 60, 40]);
    }
    return { levels, unlocked };
  }

  /** Called on GAME_OVER / GAME_WON. Returns the summary the game-over screen shows. */
  endRun(won: boolean): RunSummary | null {
    const run = this.run;
    if (!run) return null;
    this.run = null;
    const t = this.now();
    if (this.pausedAt) { this.pausedTotal += t - this.pausedAt; this.pausedAt = 0; }
    run.score = state.score;
    run.won = won;
    run.maxCombo = combo.best;
    run.seconds = Math.max(0, Math.round((t - this.runStartedAt - this.pausedTotal) / 1000));
    combo.break();

    const p = this.profile;
    const previousBest = this.bestAtStart;
    const newBest = run.score > previousBest && run.score > 0;
    run.newBest = newBest;
    p.runs += 1;
    p.bestScore = Math.max(p.bestScore, run.score);
    p.bestSeconds = Math.max(p.bestSeconds, run.seconds);
    p.bestCombo = Math.max(p.bestCombo, run.maxCombo);
    p.totalKills += run.kills;
    p.totalItems += run.items;
    state.highScore = Math.max(state.highScore, p.bestScore);

    // XP is scale-free: it rewards playing, lasting and improving, never a raw score whose size
    // differs a thousandfold between games.
    let xp = 10 + Math.min(30, Math.floor(run.seconds / 10)) + (newBest ? 25 : 0) + (won ? 20 : 0);

    const goalsCompletedNow: Goal[] = [];
    for (const g of this.goals()) {
      if (g.done) continue;
      const value = g.stat === 'runs' ? 1 : g.stat === 'time' ? run.seconds : g.stat === 'kills' ? run.kills : g.stat === 'items' ? run.items
        : g.stat === 'score' ? run.score : g.stat === 'combo' ? run.maxCombo : run.seconds;
      // Counters accumulate over the day; "in one round" goals keep the best single round.
      g.progress = g.stat === 'runs' || g.stat === 'time' || g.stat === 'kills' || g.stat === 'items' ? g.progress + value : Math.max(g.progress, value);
      if (g.progress >= g.target) {
        g.progress = g.target;
        g.done = true;
        goalsCompletedNow.push(g);
        xp += g.xp;
        events.emit('GOAL_COMPLETED', { goal: g });
      }
    }

    const achievementsNow: AchievementDef[] = [];
    for (const a of BUILTIN_ACHIEVEMENTS.concat(this.config.achievements || [])) {
      if (p.achievements.indexOf(a.id) >= 0) continue;
      let earned = false;
      try { earned = a.test(p, run); } catch { earned = false; }
      if (earned) {
        p.achievements.push(a.id);
        achievementsNow.push(a);
        xp += 20;
        events.emit('ACHIEVEMENT_UNLOCKED', { achievement: a });
      }
    }

    const levelBefore = p.level;
    const gained = this.addXp(xp);
    if (newBest) { events.emit('NEW_BEST', { score: run.score, previousBest }); buzz([60, 40, 120]); }

    const nearMiss = !newBest && previousBest > 0 && run.score >= previousBest * 0.8 ? previousBest - run.score + 1 : null;
    const summary: RunSummary = {
      run, best: p.bestScore, previousBest, newBest, nearMiss, xpGained: xp,
      level: p.level, levelsGained: p.level - levelBefore, xpIntoLevel: p.xp, xpForNext: xpForLevel(p.level),
      unlockedNow: gained.unlocked, achievementsNow, goalsCompletedNow, goals: this.goals().slice(), streak: p.streak,
    };
    this.lastSummary = summary;
    this.write();
    events.emit('RUN_SUMMARY', summary);
    return summary;
  }

  private read(): Profile {
    try {
      const raw = this.store()?.getItem(this.key);
      if (!raw) return freshProfile();
      const parsed = JSON.parse(raw) as Partial<Profile>;
      // Merge over a fresh profile, so a save from an older version still loads with every field.
      const p = { ...freshProfile(), ...parsed } as Profile;
      if (!Array.isArray(p.achievements)) p.achievements = [];
      if (!Array.isArray(p.unlocked)) p.unlocked = [];
      if (!p.goals || !Array.isArray(p.goals.list)) p.goals = { day: '', list: [] };
      return p;
    } catch { return freshProfile(); }
  }

  private write(): void {
    try { this.store()?.setItem(this.key, JSON.stringify(this.profile)); } catch { /* full or blocked storage */ }
  }
}

/** The one meta layer a game shares. */
export const meta = new Meta();

/** Start the meta layer. Call once, after the game is created. */
export function startMeta(config: MetaConfig = {}): Profile { return meta.start(config); }

/**
 * The run summary as short lines, for any game-over screen: React, canvas or DOM. The first line is
 * the hook — a new best, or exactly how close the player came.
 */
export function summaryLines(s: RunSummary): string[] {
  const lines: string[] = [];
  if (s.newBest) lines.push(t('newBest', { score: s.run.score }));
  else if (s.nearMiss !== null) lines.push(t('soClose', { n: s.nearMiss, best: s.previousBest }));
  else lines.push(t('scoreBest', { score: s.run.score, best: s.best }));
  lines.push(t('xpLine', { xp: s.xpGained, level: s.level, into: s.xpIntoLevel, next: s.xpForNext }));
  if (s.levelsGained > 0) lines.push(t('levelUp', { level: s.level }));
  for (const u of s.unlockedNow) lines.push(t('unlocked', { name: u }));
  for (const a of s.achievementsNow) lines.push(t('achievement', { name: a.title }));
  for (const g of s.goalsCompletedNow) lines.push(t('goalComplete', { name: g.text }));
  const open = s.goals.filter((g) => !g.done)[0];
  if (open) {
    const done = open.stat === 'time' ? Math.floor(open.progress / 60) + '/' + open.target / 60 + ' ' + t('minutes') : open.progress + '/' + open.target;
    lines.push(t('nextGoal', { name: open.text, done }));
  }
  if (s.streak > 1) lines.push(t('streak', { n: s.streak }));
  return lines;
}

/**
 * Small announcements over the game — NEW BEST, LEVEL UP, ACHIEVEMENT, DAILY REWARD, GOAL, COMBO.
 * Plain DOM so it works in a React game, a canvas game or a 3D one; returns its own teardown.
 * Text goes in with textContent, never HTML, and the region is announced to screen readers.
 */
export function mountMetaToasts(root?: HTMLElement): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const host = root || document.body;
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.style.cssText = 'position:fixed;left:50%;top:max(56px,env(safe-area-inset-top));transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;z-index:50;font-family:system-ui,sans-serif';
  host.appendChild(box);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const show = (text: string, color: string) => {
    while (box.childElementCount >= 3) box.removeChild(box.firstChild as Node);
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = 'padding:8px 16px;border-radius:999px;font-weight:800;font-size:16px;color:#111;box-shadow:0 6px 20px rgba(0,0,0,.35);background:' + color + ';transition:transform .25s,opacity .25s;' + (reduced ? '' : 'transform:scale(.6);opacity:0');
    box.appendChild(t);
    if (!reduced) requestAnimationFrame(() => { t.style.transform = 'scale(1)'; t.style.opacity = '1'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2400);
  };
  const offs = [
    events.on('NEW_BEST', (p: { score: number }) => show('NEW BEST! ' + p.score, '#fde047')),
    events.on('LEVEL_UP', (p: { level: number; reward: string | null }) => show('LEVEL ' + p.level + '!' + (p.reward ? ' Unlocked ' + p.reward : ''), '#86efac')),
    events.on('ACHIEVEMENT_UNLOCKED', (p: { achievement: AchievementDef }) => show('🏆 ' + p.achievement.title, '#fdba74')),
    events.on('DAILY_REWARD', (p: { streak: number; xp: number }) => show((p.streak > 1 ? p.streak + '-day streak! ' : 'Welcome back! ') + '+' + p.xp + ' XP', '#93c5fd')),
    events.on('GOAL_COMPLETED', (p: { goal: Goal }) => show('✓ ' + p.goal.text, '#a7f3d0')),
    events.on('COMBO_MILESTONE', (p: { count: number }) => show('COMBO x' + p.count + '!', '#f0abfc')),
  ];
  return () => { for (const off of offs) off(); box.remove(); };
}
`;

const FILES: Record<string, string> = {
  'src/game/core/loop.ts': LOOP,
  'src/game/core/input.ts': INPUT,
  'src/game/core/events.ts': EVENTS,
  'src/game/core/pool.ts': POOL,
  'src/game/core/feel.ts': GAME_FEEL,
  'src/game/core/state.ts': STATE,
  'src/game/core/meta.ts': META,
  'src/game/core/settings.ts': SETTINGS,
  'src/game/core/loading.ts': LOADING,
  'src/game/core/strings.ts': STRINGS,
  'src/game/core/levels.ts': LEVELS,
  'src/game/core/quests.ts': QUESTS,
  'src/game/core/inventory.ts': INVENTORY,
  'src/game/core/dialogue.ts': DIALOGUE,
  'src/game/core/economy.ts': ECONOMY,
  'src/game/core/perf.ts': PERF,
  'src/game/core/powerups.ts': POWERUPS,
  'src/game/core/loot.ts': LOOT,
  'src/game/core/leaderboard.ts': LEADERBOARD,
};

/** Every module this generator can emit, by the name callers pass to `include`. PURE. */
export const GAME_RUNTIME_MODULES: readonly string[] = ['loop', 'input', 'events', 'pool', 'feel', 'state', 'meta', 'settings', 'loading', 'strings', 'levels', 'quests', 'inventory', 'dialogue', 'economy', 'perf', 'powerups', 'loot', 'leaderboard'];

/**
 * Generate the game runtime. `include` optionally filters by module name; default = all.
 *
 * `state` imports `events`, so asking for it alone would emit a file that does not compile —
 * dependencies are pulled in automatically, for the same reason the motion pack does it. Pure; never
 * throws.
 */
export function generateGameRuntime(include?: string[]): GameRuntimeResult {
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
    // meta.ts imports state.ts (and events.ts); state.ts imports events.ts.
    if (files['src/game/core/meta.ts']) { files['src/game/core/state.ts'] = FILES['src/game/core/state.ts']; files['src/game/core/settings.ts'] = FILES['src/game/core/settings.ts']; }
    if (files['src/game/core/settings.ts']) files['src/game/core/state.ts'] = FILES['src/game/core/state.ts'];
    if (files['src/game/core/loading.ts']) { files['src/game/core/events.ts'] = FILES['src/game/core/events.ts']; files['src/game/core/strings.ts'] = FILES['src/game/core/strings.ts']; }
    if (files['src/game/core/meta.ts']) files['src/game/core/strings.ts'] = FILES['src/game/core/strings.ts'];
    if (files['src/game/core/strings.ts']) files['src/game/core/events.ts'] = FILES['src/game/core/events.ts'];
    if (files['src/game/core/levels.ts']) files['src/game/core/state.ts'] = FILES['src/game/core/state.ts'];
    if (files['src/game/core/quests.ts']) files['src/game/core/state.ts'] = FILES['src/game/core/state.ts'];
    if (files['src/game/core/economy.ts']) files['src/game/core/inventory.ts'] = FILES['src/game/core/inventory.ts'];
    if (files['src/game/core/dialogue.ts']) files['src/game/core/inventory.ts'] = FILES['src/game/core/inventory.ts'];
    if (files['src/game/core/inventory.ts']) files['src/game/core/state.ts'] = FILES['src/game/core/state.ts'];
    if (files['src/game/core/powerups.ts'] || files['src/game/core/loot.ts'] || files['src/game/core/leaderboard.ts']) files['src/game/core/events.ts'] = FILES['src/game/core/events.ts'];
    if (files['src/game/core/state.ts']) files['src/game/core/events.ts'] = FILES['src/game/core/events.ts'];
    if (Object.keys(files).length === 0) files = { ...FILES };
  }

  return {
    files,
    dependencies: [], // the runtime is plain TypeScript — no engine, no physics lib, no bundle cost
    instructions:
      `Added the game runtime (${Object.keys(files).length} files under src/game/core). Wire it like this:\n` +
      '```ts\n' +
      "import { GameLoop } from './game/core/loop';\n" +
      "import { Input } from './game/core/input';\n" +
      "import { GameFeel } from './game/core/feel';\n" +
      "import { events } from './game/core/events';\n" +
      "import { state, setStatus, damagePlayer } from './game/core/state';\n" +
      "import { startMeta, mountMetaToasts, combo, meta, summaryLines } from './game/core/meta';\n\n" +
      "startMeta({ gameId: 'my-game', unlocks: { 3: 'Red car', 5: 'Night level' } }); // once, at start-up\n" +
      'mountMetaToasts(); // NEW BEST / LEVEL UP / achievement / daily-reward announcements\n' +
      'const input = new Input();\n' +
      'const feel = new GameFeel();\n' +
      'const loop = new GameLoop(\n' +
      '  (dt) => { feel.update(dt); if (!feel.frozen) { /* gameplay at a FIXED 60Hz */ } input.endFrame(); },\n' +
      '  (alpha) => { /* draw, interpolating by alpha; apply feel.shake() to the camera */ },\n' +
      ');\n' +
      'loop.start();\n' +
      '```\n' +
      'RULES THAT KEEP IT FEELING GOOD:\n' +
      '- Put gameplay in update(dt) with the FIXED dt — never in render. Physics in render is frame-rate dependent.\n' +
      '- Call input.endFrame() at the END of update, or wasPressed() stays true for several frames.\n' +
      '- Never allocate in the loop: pool bullets and particles with Pool.\n' +
      '- On every impact: feel.addTrauma(0.2–0.9) + feel.addHitStop(0.05–0.12), and emit an event so VFX,\n' +
      '  audio and UI react without gameplay importing them.\n' +
      '- Use damp() for camera follow, not `a + (b-a)*0.1` — the latter moves faster at higher frame rates.\n' +
      'WHAT BRINGS THE PLAYER BACK (meta.ts — wire it in EVERY game, it is one call):\n' +
      '- startMeta({ gameId }) once. It listens to GAME_STARTED / GAME_OVER / GAME_WON / ENEMY_DIED /\n' +
      '  ITEM_COLLECTED by itself and keeps best score, XP + levels, achievements, a daily streak and three\n' +
      '  daily goals in localStorage. state.highScore is the REAL best from the first frame.\n' +
      '- Score successful actions through combo.hit(points) (and call combo.update(dt) in update; combo.break()\n' +
      '  when the player is hit) so playing WELL scores more than playing LONG.\n' +
      '- The game-over screen shows summaryLines(meta.lastSummary) — first line is the hook (NEW BEST, or\n' +
      '  "Only 12 more to beat your best") — with a big, already-focused "Play again" that restarts in one\n' +
      '  tap (and on Enter/Space/R). A slow or buried restart is where players stop.\n' +
      '- Never add loot boxes, paid randomness, fake timers or guilt messages. Reward playing and improving.',
  };
}
