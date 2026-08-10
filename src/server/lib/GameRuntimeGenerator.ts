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
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  interact: ['KeyE'],
  attack: ['Mouse0'],
  aim: ['Mouse2'],
  pause: ['Escape'],
};

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

  constructor(target: HTMLElement | Window = window, actions: ActionMap = DEFAULT_ACTIONS) {
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

  private codes(action: string): string[] { return this.actions[action] || []; }

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

  /** Call AFTER update. Clears the one-frame edges and the accumulated look delta. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
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
  | 'GAME_STARTED' | 'GAME_OVER' | 'GAME_WON' | 'GAME_PAUSED' | 'GAME_RESUMED'
  | 'LEVEL_STARTED' | 'LEVEL_COMPLETED' | 'CHECKPOINT_REACHED'
  | 'PLAYER_SPAWNED' | 'PLAYER_MOVED' | 'PLAYER_JUMPED' | 'PLAYER_LANDED'
  | 'PLAYER_DAMAGED' | 'PLAYER_HEALED' | 'PLAYER_DIED'
  | 'ENEMY_SPAWNED' | 'ENEMY_DAMAGED' | 'ENEMY_DIED' | 'ENEMY_ALERTED'
  | 'WEAPON_FIRED' | 'WEAPON_RELOADED' | 'PROJECTILE_HIT'
  | 'ITEM_COLLECTED' | 'ITEM_USED' | 'SCORE_CHANGED'
  | 'QUEST_STARTED' | 'QUEST_COMPLETED'
  | 'BOSS_SPAWNED' | 'BOSS_PHASE_CHANGED' | 'BOSS_DEFEATED';

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
  state.status = status;
  if (status === 'playing') events.emit('GAME_STARTED');
  if (status === 'paused') events.emit('GAME_PAUSED');
  if (status === 'gameover') events.emit('GAME_OVER');
  if (status === 'won') events.emit('GAME_WON');
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

export function resetRun(): void {
  const { highScore, unlocked, settings } = state;
  Object.assign(state, initialState(), { highScore, unlocked, settings });
}
`;

const FILES: Record<string, string> = {
  'src/game/core/loop.ts': LOOP,
  'src/game/core/input.ts': INPUT,
  'src/game/core/events.ts': EVENTS,
  'src/game/core/pool.ts': POOL,
  'src/game/core/feel.ts': GAME_FEEL,
  'src/game/core/state.ts': STATE,
};

/** Every module this generator can emit, by the name callers pass to `include`. PURE. */
export const GAME_RUNTIME_MODULES: readonly string[] = ['loop', 'input', 'events', 'pool', 'feel', 'state'];

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
      "import { state, setStatus, damagePlayer } from './game/core/state';\n\n" +
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
      '- Use damp() for camera follow, not `a + (b-a)*0.1` — the latter moves faster at higher frame rates.',
  };
}
