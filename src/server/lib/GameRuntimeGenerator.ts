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
  if (!meta.profile.haptics) return;
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
  if (s.newBest) lines.push('NEW BEST! ' + s.run.score);
  else if (s.nearMiss !== null) lines.push('So close! Only ' + s.nearMiss + ' more to beat your best (' + s.previousBest + ')');
  else lines.push('Score ' + s.run.score + ' · Best ' + s.best);
  lines.push('+' + s.xpGained + ' XP · Level ' + s.level + ' (' + s.xpIntoLevel + '/' + s.xpForNext + ')');
  if (s.levelsGained > 0) lines.push('Level up! You reached level ' + s.level);
  for (const u of s.unlockedNow) lines.push('Unlocked: ' + u);
  for (const a of s.achievementsNow) lines.push('Achievement: ' + a.title);
  for (const g of s.goalsCompletedNow) lines.push('Goal complete: ' + g.text);
  const open = s.goals.filter((g) => !g.done)[0];
  if (open) {
    const done = open.stat === 'time' ? Math.floor(open.progress / 60) + '/' + open.target / 60 + ' min' : open.progress + '/' + open.target;
    lines.push('Next goal: ' + open.text + ' (' + done + ')');
  }
  if (s.streak > 1) lines.push(s.streak + '-day streak');
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
    t.style.cssText = 'padding:10px 18px;border-radius:999px;font-weight:800;font-size:16px;color:#111;box-shadow:0 6px 20px rgba(0,0,0,.35);background:' + color + ';transition:transform .25s,opacity .25s;' + (reduced ? '' : 'transform:scale(.6);opacity:0');
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
};

/** Every module this generator can emit, by the name callers pass to `include`. PURE. */
export const GAME_RUNTIME_MODULES: readonly string[] = ['loop', 'input', 'events', 'pool', 'feel', 'state', 'meta'];

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
    if (files['src/game/core/meta.ts']) files['src/game/core/state.ts'] = FILES['src/game/core/state.ts'];
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
