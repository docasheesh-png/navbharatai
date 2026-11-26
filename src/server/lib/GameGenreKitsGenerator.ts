/** What a recipe returns (the same shape as gameRecipeLayers' RecipeOutput; kept local so the registry can import this file). */
export interface GenreKitsResult { files: Record<string, string>; dependencies: Array<{ name: string; version: string }>; instructions: string }

/**
 * GENRE KITS — the rules of the genres the game kit had no system for (admin 2026-11-26 game-maker audit: "navbharatai abhi
 * sabhi prkar ke game 100% nahi bana pata"). The audit found NO code in the kit for a fighting game (hit-stun, combos,
 * blocking, special moves) or a tower-defense game (a path, towers, waves, money): every such request was written from memory
 * by the builder, and a builder writing a fighting game from memory gets block, throw and combo scaling wrong in ways a
 * player feels at once.
 *
 * Each kit is PURE TypeScript — no three.js, no DOM — stepped at a fixed 60 Hz, so the same rules drive a 2D canvas or a 3D
 * scene, and tests run the very code a game ships. The game draws; the kit decides.
 */

export const FIGHTING_PATH = 'src/game/genres/fighting.ts';
export const TOWER_DEFENSE_PATH = 'src/game/genres/towerDefense.ts';

const FIGHTING = String.raw`// FIGHTING — the rules of a one-on-one fighting game, frame by frame (60 frames a second).
//
// What players feel, and what a hand-written fighter gets wrong:
//   • every attack has STARTUP (it cannot hit yet), ACTIVE (it can) and RECOVERY (you are open) frames;
//   • a hit puts the defender in HIT-STUN; another hit landing during it is a COMBO, and each extra hit does less damage;
//   • BLOCKING (hold away from the opponent, or the block button) takes a little CHIP damage and BLOCK-STUN instead;
//     a LOW attack must be blocked crouching; a HIGH attack misses a crouching fighter;
//   • a THROW cannot be blocked, but only reaches up close;
//   • a SPECIAL MOVE is a motion (down, forward, attack) entered within a short window;
//   • a move that HITS may be CANCELLED into the next one during its recovery;
//   • rounds end on a KO or when the timer runs out (more health left wins), best of three.
//
//   const match = createMatch({ ai: 'normal' });               // player 2 is the computer
//   const events = stepMatch(match, readFighterInput(ctx.input)); // in update(), 60 times a second
//   // draw match.p1 / match.p2 (x, facing, state, move, frame) and react to events (hit, blocked, ko, round, match)

export type Height = 'high' | 'mid' | 'low' | 'throw';
export interface MoveSpec {
  name: string;
  damage: number;
  startup: number;
  active: number;
  recovery: number;
  /** Frames the defender cannot act after being hit / after blocking. */
  hitstun: number;
  blockstun: number;
  /** Damage a block still takes. */
  chip: number;
  /** How far in front of the attacker it reaches, in metres. */
  range: number;
  height: Height;
  /** Metres the defender is pushed back on hit. */
  knockback: number;
  /** Moves this one may be cancelled into during its recovery, once it has hit. */
  cancelInto?: readonly string[];
  /** Entered as a motion: the directions, then the attack button, within MOTION_WINDOW frames. */
  motion?: readonly ('down' | 'forward' | 'back')[];
  /** Super meter it costs (0–100). */
  meterCost?: number;
}

export const MOTION_WINDOW = 15;
export const COMBO_SCALING = 0.85;
export const MIN_SCALING = 0.3;
export const STAGE_HALF_WIDTH = 6;
export const MIN_GAP = 0.7;
export const WALK_SPEED = 2.6;
export const ROUND_SECONDS = 99;
export const ROUNDS_TO_WIN = 2;

export const DEFAULT_MOVES: Readonly<Record<string, MoveSpec>> = {
  jab: { name: 'jab', damage: 4, startup: 4, active: 2, recovery: 7, hitstun: 14, blockstun: 9, chip: 0, range: 1.0, height: 'high', knockback: 0.15, cancelInto: ['punch', 'kick', 'blast'] },
  punch: { name: 'punch', damage: 8, startup: 7, active: 3, recovery: 12, hitstun: 18, blockstun: 12, chip: 1, range: 1.15, height: 'mid', knockback: 0.3, cancelInto: ['uppercut', 'blast'] },
  kick: { name: 'kick', damage: 10, startup: 9, active: 3, recovery: 15, hitstun: 19, blockstun: 12, chip: 1, range: 1.4, height: 'mid', knockback: 0.4, cancelInto: ['blast'] },
  sweep: { name: 'sweep', damage: 9, startup: 10, active: 4, recovery: 20, hitstun: 24, blockstun: 12, chip: 1, range: 1.35, height: 'low', knockback: 0.35 },
  uppercut: { name: 'uppercut', damage: 14, startup: 6, active: 4, recovery: 26, hitstun: 30, blockstun: 16, chip: 2, range: 1.0, height: 'mid', knockback: 0.9 },
  throw: { name: 'throw', damage: 13, startup: 5, active: 2, recovery: 22, hitstun: 40, blockstun: 0, chip: 0, range: 0.95, height: 'throw', knockback: 1.6 },
  blast: { name: 'blast', damage: 15, startup: 12, active: 6, recovery: 22, hitstun: 26, blockstun: 18, chip: 3, range: 4.5, height: 'mid', knockback: 0.8, motion: ['down', 'forward'] },
  superMove: { name: 'superMove', damage: 32, startup: 8, active: 8, recovery: 30, hitstun: 45, blockstun: 24, chip: 6, range: 2.2, height: 'mid', knockback: 2.0, motion: ['down', 'forward', 'down', 'forward'], meterCost: 100 },
};

export type FighterState = 'idle' | 'walk' | 'crouch' | 'block' | 'attack' | 'hitstun' | 'blockstun' | 'ko';
export interface Fighter {
  id: 'p1' | 'p2';
  x: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  meter: number;
  state: FighterState;
  crouching: boolean;
  move: MoveSpec | null;
  /** Frames into the current move, or the stun frames left. */
  frame: number;
  stun: number;
  /** The current move already connected (it can be cancelled, and never hits twice). */
  connected: boolean;
  combo: number;
  comboDamage: number;
  rounds: number;
  /** Recent directions, newest last, with the frame each was pressed (for motion inputs). */
  history: Array<{ dir: 'down' | 'forward' | 'back'; at: number }>;
}

export interface FighterInput {
  left?: boolean;
  right?: boolean;
  down?: boolean;
  /** An explicit block button (a phone has no "hold back" that feels right). Holding away from the opponent also blocks. */
  block?: boolean;
  /** The attack pressed THIS frame: a move name from the fighter's move list. */
  attack?: string | null;
}

export type FightEvent =
  | { type: 'hit'; by: 'p1' | 'p2'; move: string; damage: number; combo: number }
  | { type: 'blocked'; by: 'p1' | 'p2'; move: string; chip: number }
  | { type: 'whiff'; by: 'p1' | 'p2'; move: string }
  | { type: 'ko'; loser: 'p1' | 'p2' }
  | { type: 'timeout'; winner: 'p1' | 'p2' | 'draw' }
  | { type: 'round'; winner: 'p1' | 'p2' | 'draw'; round: number }
  | { type: 'match'; winner: 'p1' | 'p2' };

export type AiLevel = 'easy' | 'normal' | 'hard';
export interface Match {
  p1: Fighter;
  p2: Fighter;
  moves: Readonly<Record<string, MoveSpec>>;
  frame: number;
  round: number;
  /** Frames left in the round. */
  clock: number;
  over: boolean;
  winner: 'p1' | 'p2' | null;
  ai: AiLevel | null;
  seed: number;
  /** Frames of pause between rounds. */
  pause: number;
}

function fighter(id: 'p1' | 'p2', maxHp: number): Fighter {
  return { id, x: id === 'p1' ? -2 : 2, facing: id === 'p1' ? 1 : -1, hp: maxHp, maxHp, meter: 0, state: 'idle', crouching: false, move: null, frame: 0, stun: 0, connected: false, combo: 0, comboDamage: 0, rounds: 0, history: [] };
}

export function createMatch(options: { maxHp?: number; moves?: Record<string, MoveSpec>; ai?: AiLevel | null; seed?: number } = {}): Match {
  const maxHp = options.maxHp ?? 100;
  return { p1: fighter('p1', maxHp), p2: fighter('p2', maxHp), moves: { ...DEFAULT_MOVES, ...(options.moves ?? {}) }, frame: 0, round: 1, clock: ROUND_SECONDS * 60, over: false, winner: null, ai: options.ai === undefined ? 'normal' : options.ai, seed: (options.seed ?? 1) >>> 0, pause: 0 };
}

function rand(m: Match): number {
  m.seed = (m.seed * 1664525 + 1013904223) >>> 0;
  return m.seed / 4294967296;
}

function startRound(m: Match): void {
  for (const f of [m.p1, m.p2]) {
    Object.assign(f, { x: f.id === 'p1' ? -2 : 2, hp: f.maxHp, state: 'idle', crouching: false, move: null, frame: 0, stun: 0, connected: false, combo: 0, comboDamage: 0, history: [] });
  }
  m.clock = ROUND_SECONDS * 60;
}

/** The direction this input points, relative to where the fighter faces. */
function dirOf(f: Fighter, input: FighterInput): 'forward' | 'back' | null {
  const toward = f.facing === 1 ? input.right : input.left;
  const away = f.facing === 1 ? input.left : input.right;
  return toward && !away ? 'forward' : away && !toward ? 'back' : null;
}

function pushHistory(f: Fighter, dir: 'down' | 'forward' | 'back', at: number): void {
  const last = f.history[f.history.length - 1];
  if (last && last.dir === dir && at - last.at < 2) { last.at = at; return; }
  f.history.push({ dir, at });
  if (f.history.length > 8) f.history.shift();
}

/** The special move whose motion was just completed, if any. */
function motionMove(f: Fighter, moves: Readonly<Record<string, MoveSpec>>, now: number): MoveSpec | null {
  let best: MoveSpec | null = null;
  for (const mv of Object.values(moves)) {
    if (!mv.motion || (mv.meterCost ?? 0) > f.meter) continue;
    const recent = f.history.filter((h) => now - h.at <= MOTION_WINDOW + mv.motion!.length * 4).map((h) => h.dir);
    const want = mv.motion;
    let i = recent.length - 1;
    let ok = true;
    for (let j = want.length - 1; j >= 0; j--) {
      while (i >= 0 && recent[i] !== want[j]) i--;
      if (i < 0) { ok = false; break; }
      i--;
    }
    if (ok && (!best || (mv.motion.length > (best.motion?.length ?? 0)))) best = mv;
  }
  return best;
}

function canAct(f: Fighter): boolean {
  return f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'block';
}

function begin(f: Fighter, mv: MoveSpec): void {
  f.state = 'attack';
  f.move = mv;
  f.frame = 0;
  f.connected = false;
  if (mv.meterCost) f.meter = Math.max(0, f.meter - mv.meterCost);
}

function apply(m: Match, f: Fighter, input: FighterInput): void {
  if (f.state === 'ko') return;
  const dir = dirOf(f, input);
  if (input.down) pushHistory(f, 'down', m.frame);
  if (dir) pushHistory(f, dir, m.frame);
  // A cancel: the move hit and is in recovery, and the next move is one it may chain into.
  if (input.attack && f.state === 'attack' && f.move && f.connected) {
    const cur = f.move;
    const special = motionMove(f, m.moves, m.frame);
    const next = special ?? m.moves[input.attack];
    if (next && (cur.cancelInto ?? []).includes(next.name) && f.frame >= cur.startup + cur.active) { begin(f, next); return; }
  }
  if (!canAct(f)) return;
  f.crouching = !!input.down;
  if (input.attack) {
    const special = motionMove(f, m.moves, m.frame);
    const mv = special ?? m.moves[input.attack];
    if (mv && !mv.motion) { begin(f, mv); return; }
    if (special) { begin(f, special); return; }
  }
  const blocking = !!input.block || dir === 'back';
  if (blocking) { f.state = 'block'; return; }
  if (f.crouching) { f.state = 'crouch'; return; }
  if (dir) {
    f.state = 'walk';
    f.x += (dir === 'forward' ? f.facing : -f.facing) * (dir === 'forward' ? WALK_SPEED : WALK_SPEED * 0.8) / 60;
    return;
  }
  f.state = 'idle';
}

function advance(f: Fighter): void {
  if (f.state === 'attack' && f.move) {
    f.frame++;
    if (f.frame >= f.move.startup + f.move.active + f.move.recovery) { f.state = 'idle'; f.move = null; f.frame = 0; f.connected = false; }
  } else if (f.state === 'hitstun' || f.state === 'blockstun') {
    f.stun--;
    if (f.stun <= 0) { f.state = 'idle'; f.stun = 0; }
  }
}

function resolve(a: Fighter, d: Fighter, events: FightEvent[]): void {
  const mv = a.move;
  if (a.state !== 'attack' || !mv || a.connected) return;
  const inActive = a.frame >= mv.startup && a.frame < mv.startup + mv.active;
  if (!inActive) {
    if (a.frame === mv.startup + mv.active) events.push({ type: 'whiff', by: a.id, move: mv.name });
    return;
  }
  const gap = (d.x - a.x) * a.facing;
  if (gap < 0 || gap > mv.range || d.state === 'ko') return;
  // A HIGH attack passes over a crouching fighter; a throw only grabs one who is not already reeling.
  if (mv.height === 'high' && d.crouching) return;
  if (mv.height === 'throw' && (d.state === 'hitstun' || d.state === 'attack')) return;
  const blockable = mv.height !== 'throw';
  const blockedRight = d.state === 'block' && (mv.height !== 'low' || d.crouching);
  a.connected = true;
  if (blockable && blockedRight) {
    d.hp = Math.max(1, d.hp - mv.chip);
    d.state = 'blockstun'; d.stun = mv.blockstun;
    d.x += a.facing * mv.knockback * 0.5;
    a.meter = Math.min(100, a.meter + 3);
    events.push({ type: 'blocked', by: a.id, move: mv.name, chip: mv.chip });
    return;
  }
  const inCombo = d.state === 'hitstun';
  a.combo = inCombo ? a.combo + 1 : 1;
  const scale = Math.max(MIN_SCALING, Math.pow(COMBO_SCALING, a.combo - 1));
  const damage = Math.max(1, Math.round(mv.damage * scale));
  a.comboDamage = inCombo ? a.comboDamage + damage : damage;
  d.hp = Math.max(0, d.hp - damage);
  d.state = 'hitstun'; d.stun = mv.hitstun; d.move = null; d.frame = 0; d.crouching = false;
  d.x += a.facing * mv.knockback;
  a.meter = Math.min(100, a.meter + 6);
  d.meter = Math.min(100, d.meter + 4);
  events.push({ type: 'hit', by: a.id, move: mv.name, damage, combo: a.combo });
  if (d.hp === 0) { d.state = 'ko'; events.push({ type: 'ko', loser: d.id }); }
}

function separate(m: Match): void {
  const { p1, p2 } = m;
  for (const f of [p1, p2]) f.x = Math.max(-STAGE_HALF_WIDTH, Math.min(STAGE_HALF_WIDTH, f.x));
  const gap = Math.abs(p2.x - p1.x);
  if (gap < MIN_GAP) {
    const push = (MIN_GAP - gap) / 2, s = p1.x <= p2.x ? 1 : -1;
    p1.x -= s * push; p2.x += s * push;
    for (const f of [p1, p2]) f.x = Math.max(-STAGE_HALF_WIDTH, Math.min(STAGE_HALF_WIDTH, f.x));
  }
  // Fighters always face each other, except mid-move (a move keeps the direction it started in).
  if (p1.state !== 'attack') p1.facing = p1.x <= p2.x ? 1 : -1;
  if (p2.state !== 'attack') p2.facing = p2.x < p1.x ? -1 : 1;
}

function endRound(m: Match, winner: 'p1' | 'p2' | 'draw', events: FightEvent[]): void {
  if (winner !== 'draw') m[winner].rounds++;
  events.push({ type: 'round', winner, round: m.round });
  const champ = m.p1.rounds >= ROUNDS_TO_WIN ? 'p1' : m.p2.rounds >= ROUNDS_TO_WIN ? 'p2' : null;
  if (champ) { m.over = true; m.winner = champ; events.push({ type: 'match', winner: champ }); return; }
  m.round++;
  m.pause = 90;
}

/**
 * The computer opponent. It blocks an attack it sees coming (more often when harder), punishes a whiffed move, keeps to its
 * favourite range and mixes in throws and lows — seeded, so a replay of the same inputs plays out the same. PURE on the match.
 */
export function aiInput(m: Match, me: Fighter, them: Fighter, level: AiLevel): FighterInput {
  const sense = level === 'easy' ? 0.3 : level === 'normal' ? 0.62 : 0.9;
  const gap = Math.abs(them.x - me.x);
  const toward = them.x > me.x ? { right: true } : { left: true };
  const away = them.x > me.x ? { left: true } : { right: true };
  if (them.state === 'attack' && them.move && them.frame < them.move.startup + them.move.active && gap <= them.move.range + 0.4) {
    if (rand(m) < sense) return { block: true, down: them.move.height === 'low' || (them.move.height === 'high' && rand(m) < 0.5) };
  }
  if (!canAct(me)) return {};
  // A whiffed move in recovery and close: punish it.
  if (them.state === 'attack' && them.move && them.frame >= them.move.startup + them.move.active && gap < 1.2 && rand(m) < sense) return { attack: 'uppercut' };
  if (them.state === 'block' && gap < 0.95 && rand(m) < sense * 0.5) return { attack: 'throw' };
  if (gap > 1.3) return rand(m) < 0.08 * sense && me.meter < 100 ? { down: true, ...toward, attack: 'blast' } : toward;
  if (gap < 0.8 && rand(m) < 0.15) return away;
  const r = rand(m);
  if (r < 0.06 + sense * 0.1) return { attack: 'jab' };
  if (r < 0.1 + sense * 0.12) return { attack: 'kick' };
  if (r < 0.13 + sense * 0.1) return { down: true, attack: 'sweep' };
  return {};
}

/** One frame (1/60 s). Returns what happened this frame. PURE on the match. */
export function stepMatch(m: Match, p1Input: FighterInput, p2Input?: FighterInput): FightEvent[] {
  const events: FightEvent[] = [];
  if (m.over) return events;
  if (m.pause > 0) { m.pause--; if (m.pause === 0) startRound(m); return events; }
  m.frame++;
  const p2In = p2Input ?? (m.ai ? aiInput(m, m.p2, m.p1, m.ai) : {});
  apply(m, m.p1, p1Input);
  apply(m, m.p2, p2In);
  // Both resolve against the positions of THIS frame, so a trade (both hit together) hurts both.
  resolve(m.p1, m.p2, events);
  resolve(m.p2, m.p1, events);
  advance(m.p1);
  advance(m.p2);
  separate(m);
  const ko = events.find((e): e is Extract<FightEvent, { type: 'ko' }> => e.type === 'ko');
  if (ko) {
    const bothOut = m.p1.hp === 0 && m.p2.hp === 0;
    endRound(m, bothOut ? 'draw' : ko.loser === 'p1' ? 'p2' : 'p1', events);
    return events;
  }
  m.clock--;
  if (m.clock <= 0) {
    const a = m.p1.hp / m.p1.maxHp, b = m.p2.hp / m.p2.maxHp;
    const winner = a > b ? 'p1' : b > a ? 'p2' : 'draw';
    events.push({ type: 'timeout', winner });
    endRound(m, winner, events);
  }
  return events;
}

/** Seconds left in the round, for the HUD. */
export function roundSeconds(m: Match): number { return Math.ceil(m.clock / 60); }

/** Read the kit's Input (core/input.ts) as a fighter's controls: arrows/WASD move, down crouches, attack punches, jump kicks, interact throws, reload sweeps, sprint (Shift) blocks. */
export function readFighterInput(input: { isDown(action: string): boolean; wasPressed?(action: string): boolean }): FighterInput {
  const pressed = (a: string) => (input.wasPressed ? input.wasPressed(a) : input.isDown(a));
  return {
    left: input.isDown('left'), right: input.isDown('right'), down: input.isDown('down') || input.isDown('crouch'), block: input.isDown('sprint'),
    attack: pressed('attack') ? 'punch' : pressed('jump') ? 'kick' : pressed('interact') ? 'throw' : pressed('reload') ? 'sweep' : null,
  };
}
`;

const TOWER_DEFENSE = String.raw`// TOWER DEFENSE — the rules: a path, waves of enemies that walk it, towers the player places beside it, money and lives.
//
// What a hand-written tower defense gets wrong, and this does not:
//   • the path is FOUND from the map (spawn to base), never hand-typed coordinates that drift from the drawing;
//   • a tower can only stand on a build tile, never on the path, never two on one tile, never without the money;
//   • a tower aims at the enemy FURTHEST along the path in its range by default (what players expect), or the strongest
//     or the nearest; it fires at its own rate; splash hurts everything near the target; frost slows for a while;
//   • armour takes a flat amount off every hit (never below 1), so cheap rapid towers fall off against armoured waves;
//   • flying enemies are hit only by towers that can aim up;
//   • each wave is stronger than the last; sending the next wave early pays a bonus;
//   • an enemy that reaches the base costs lives; zero lives is defeat; surviving every wave is victory.
//
//   const td = createTowerDefense({ map: ['S..##', '#..##', '##..E'] /* S spawn, E base, . path, # build */ });
//   placeTower(td, 'arrow', 3, 0);  startWave(td);
//   const events = stepTowerDefense(td, 1 / 60);   // in update(); draw td.enemies, td.towers and td.shots

export interface Cell { x: number; y: number }
export interface TowerSpec {
  kind: string;
  cost: number;
  range: number;
  damage: number;
  /** Shots a second. */
  rate: number;
  splash?: number;
  /** Slows what it hits to this fraction of its speed for slowSeconds. */
  slow?: number;
  slowSeconds?: number;
  hitsFlying?: boolean;
  /** Cost of each upgrade level; each level adds 40% damage and 10% range. */
  upgrades: readonly number[];
}
export interface EnemySpec { kind: string; hp: number; speed: number; reward: number; armour: number; flying?: boolean; livesCost: number }
export type Targeting = 'first' | 'strongest' | 'nearest';

export const TOWERS: Readonly<Record<string, TowerSpec>> = {
  arrow: { kind: 'arrow', cost: 50, range: 2.6, damage: 9, rate: 2, hitsFlying: true, upgrades: [40, 80] },
  cannon: { kind: 'cannon', cost: 90, range: 2.2, damage: 26, rate: 0.6, splash: 0.9, upgrades: [70, 130] },
  frost: { kind: 'frost', cost: 70, range: 2.2, damage: 3, rate: 1.2, slow: 0.5, slowSeconds: 2, hitsFlying: true, upgrades: [50, 90] },
  sniper: { kind: 'sniper', cost: 120, range: 5, damage: 60, rate: 0.35, hitsFlying: true, upgrades: [90, 160] },
};
export const ENEMIES: Readonly<Record<string, EnemySpec>> = {
  runner: { kind: 'runner', hp: 30, speed: 1.6, reward: 6, armour: 0, livesCost: 1 },
  grunt: { kind: 'grunt', hp: 60, speed: 1.0, reward: 9, armour: 1, livesCost: 1 },
  tank: { kind: 'tank', hp: 220, speed: 0.6, reward: 25, armour: 6, livesCost: 3 },
  flyer: { kind: 'flyer', hp: 45, speed: 1.3, reward: 10, armour: 0, flying: true, livesCost: 1 },
};
export const SELL_REFUND = 0.7;
export const EARLY_WAVE_BONUS = 15;
export const WAVE_GROWTH = 1.18;

export interface Enemy { id: number; spec: EnemySpec; hp: number; maxHp: number; /** Distance walked along the path, in tiles. */ progress: number; x: number; y: number; slowUntil: number; slowFactor: number; alive: boolean }
export interface Tower { id: number; spec: TowerSpec; x: number; y: number; level: number; cooldown: number; targeting: Targeting; spent: number }
export interface Shot { from: number; to: number; x: number; y: number; damage: number }
export interface WavePlan { groups: Array<{ kind: string; count: number; every: number }>; hpScale: number }
export interface TowerDefense {
  width: number;
  height: number;
  tiles: string[];
  path: Cell[];
  money: number;
  lives: number;
  wave: number;
  waves: number;
  waveActive: boolean;
  /** Seconds until the next wave starts by itself (between waves). */
  nextWaveIn: number;
  breakSeconds: number;
  enemies: Enemy[];
  towers: Tower[];
  shots: Shot[];
  time: number;
  queue: Array<{ at: number; kind: string; hpScale: number }>;
  result: 'playing' | 'won' | 'lost';
  ids: number;
  plans: (wave: number) => WavePlan;
}

export type TdEvent =
  | { type: 'spawned'; id: number; kind: string }
  | { type: 'killed'; id: number; reward: number }
  | { type: 'leaked'; id: number; lives: number }
  | { type: 'shot'; tower: number; enemy: number; damage: number }
  | { type: 'wave-start'; wave: number }
  | { type: 'wave-cleared'; wave: number }
  | { type: 'won' } | { type: 'lost' };

/** Spawn to base over path tiles, by breadth-first search. Null when the map has no connected path. PURE. */
export function findPath(tiles: readonly string[]): Cell[] | null {
  let start: Cell | null = null, goal: Cell | null = null;
  tiles.forEach((row, y) => { for (let x = 0; x < row.length; x++) { if (row[x] === 'S') start = { x, y }; if (row[x] === 'E') goal = { x, y }; } });
  if (!start || !goal) return null;
  const s: Cell = start, g: Cell = goal;
  const walk = (x: number, y: number) => y >= 0 && y < tiles.length && x >= 0 && x < tiles[y].length && '.SE'.includes(tiles[y][x]);
  const prev = new Map<string, string | null>([[s.x + ',' + s.y, null]]);
  const q: Cell[] = [s];
  while (q.length) {
    const c = q.shift()!;
    if (c.x === g.x && c.y === g.y) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy, k = nx + ',' + ny;
      if (walk(nx, ny) && !prev.has(k)) { prev.set(k, c.x + ',' + c.y); q.push({ x: nx, y: ny }); }
    }
  }
  if (!prev.has(g.x + ',' + g.y)) return null;
  const out: Cell[] = [];
  for (let k: string | null = g.x + ',' + g.y; k; k = prev.get(k) ?? null) { const [x, y] = k.split(',').map(Number); out.unshift({ x, y }); }
  return out;
}

/** The default waves: more and tougher enemies each wave, tanks from wave 4, flyers from wave 3. PURE. */
export function defaultWavePlan(wave: number): WavePlan {
  const groups: WavePlan['groups'] = [{ kind: 'grunt', count: 4 + wave * 2, every: 0.9 }];
  if (wave >= 2) groups.push({ kind: 'runner', count: 2 + wave, every: 0.6 });
  if (wave >= 3) groups.push({ kind: 'flyer', count: wave, every: 1.1 });
  if (wave >= 4) groups.push({ kind: 'tank', count: Math.floor(wave / 2), every: 2.2 });
  return { groups, hpScale: Math.pow(WAVE_GROWTH, wave - 1) };
}

export function createTowerDefense(options: { map: string[]; money?: number; lives?: number; waves?: number; breakSeconds?: number; plans?: (wave: number) => WavePlan }): TowerDefense {
  const path = findPath(options.map);
  if (!path) throw new Error('The tower-defense map needs an S (spawn) and an E (base) joined by "." path tiles.');
  return {
    width: Math.max(...options.map.map((r) => r.length)), height: options.map.length, tiles: [...options.map], path,
    money: options.money ?? 150, lives: options.lives ?? 20, wave: 0, waves: options.waves ?? 10, waveActive: false,
    breakSeconds: options.breakSeconds ?? 8, nextWaveIn: options.breakSeconds ?? 8, enemies: [], towers: [], shots: [], time: 0, queue: [],
    result: 'playing', ids: 1, plans: options.plans ?? defaultWavePlan,
  };
}

/** Why a tower cannot go there, or null when it can. PURE. */
export function placementProblem(td: TowerDefense, kind: string, x: number, y: number): string | null {
  const spec = TOWERS[kind];
  if (!spec) return 'There is no tower called ' + kind + '.';
  if (td.tiles[y]?.[x] !== '#') return 'Towers stand on build tiles only, never on the path.';
  if (td.towers.some((t) => t.x === x && t.y === y)) return 'A tower already stands there.';
  if (td.money < spec.cost) return 'Not enough money (' + spec.cost + ' needed, ' + td.money + ' left).';
  return null;
}

export function placeTower(td: TowerDefense, kind: string, x: number, y: number, targeting: Targeting = 'first'): Tower | null {
  if (td.result !== 'playing' || placementProblem(td, kind, x, y)) return null;
  const spec = TOWERS[kind];
  td.money -= spec.cost;
  const t: Tower = { id: td.ids++, spec, x, y, level: 0, cooldown: 0, targeting, spent: spec.cost };
  td.towers.push(t);
  return t;
}

export function upgradeTower(td: TowerDefense, id: number): boolean {
  const t = td.towers.find((x) => x.id === id);
  if (!t || t.level >= t.spec.upgrades.length) return false;
  const cost = t.spec.upgrades[t.level];
  if (td.money < cost) return false;
  td.money -= cost; t.spent += cost; t.level++;
  return true;
}

export function sellTower(td: TowerDefense, id: number): number {
  const i = td.towers.findIndex((x) => x.id === id);
  if (i < 0) return 0;
  const refund = Math.floor(td.towers[i].spent * SELL_REFUND);
  td.money += refund;
  td.towers.splice(i, 1);
  return refund;
}

/** The tower's damage and range at its level. PURE. */
export function towerStats(t: Tower): { damage: number; range: number } {
  return { damage: t.spec.damage * (1 + 0.4 * t.level), range: t.spec.range * (1 + 0.1 * t.level) };
}

/** Start the next wave now; between waves this pays the early bonus. */
export function startWave(td: TowerDefense): boolean {
  if (td.result !== 'playing' || td.waveActive || td.wave >= td.waves) return false;
  if (td.wave > 0 && td.nextWaveIn > 0.5) td.money += EARLY_WAVE_BONUS;
  td.wave++;
  td.waveActive = true;
  const plan = td.plans(td.wave);
  for (const g of plan.groups) for (let i = 0; i < g.count; i++) td.queue.push({ at: td.time + i * g.every, kind: g.kind, hpScale: plan.hpScale });
  td.queue.sort((a, b) => a.at - b.at);
  return true;
}

function placeOnPath(td: TowerDefense, e: Enemy): void {
  const i = Math.min(td.path.length - 1, Math.floor(e.progress));
  const a = td.path[i], b = td.path[Math.min(td.path.length - 1, i + 1)], f = e.progress - i;
  e.x = a.x + (b.x - a.x) * f; e.y = a.y + (b.y - a.y) * f;
}

function pickTarget(td: TowerDefense, t: Tower, range: number): Enemy | null {
  let best: Enemy | null = null, score = -Infinity;
  for (const e of td.enemies) {
    if (!e.alive || (e.spec.flying && !t.spec.hitsFlying)) continue;
    const d = Math.hypot(e.x - t.x, e.y - t.y);
    if (d > range) continue;
    const s = t.targeting === 'strongest' ? e.hp : t.targeting === 'nearest' ? -d : e.progress;
    if (s > score) { score = s; best = e; }
  }
  return best;
}

function hurt(td: TowerDefense, e: Enemy, raw: number, events: TdEvent[]): void {
  if (!e.alive) return;
  e.hp -= Math.max(1, raw - e.spec.armour);
  if (e.hp <= 0) { e.alive = false; td.money += e.spec.reward; events.push({ type: 'killed', id: e.id, reward: e.spec.reward }); }
}

/** Advance the game by dt seconds (call it with 1/60). Returns what happened. PURE on the state. */
export function stepTowerDefense(td: TowerDefense, dt: number): TdEvent[] {
  const events: TdEvent[] = [];
  td.shots = [];
  if (td.result !== 'playing') return events;
  td.time += dt;
  if (!td.waveActive && td.wave < td.waves) {
    td.nextWaveIn -= dt;
    if (td.nextWaveIn <= 0 && startWave(td)) events.push({ type: 'wave-start', wave: td.wave });
  }
  while (td.queue.length && td.queue[0].at <= td.time) {
    const q = td.queue.shift()!;
    const spec = ENEMIES[q.kind];
    if (!spec) continue;
    const hp = Math.round(spec.hp * q.hpScale);
    const e: Enemy = { id: td.ids++, spec, hp, maxHp: hp, progress: 0, x: td.path[0].x, y: td.path[0].y, slowUntil: 0, slowFactor: 1, alive: true };
    td.enemies.push(e);
    events.push({ type: 'spawned', id: e.id, kind: spec.kind });
  }
  const end = td.path.length - 1;
  for (const e of td.enemies) {
    if (!e.alive) continue;
    const slow = td.time < e.slowUntil ? e.slowFactor : 1;
    e.progress += e.spec.speed * slow * dt;
    if (e.progress >= end) {
      e.alive = false;
      td.lives = Math.max(0, td.lives - e.spec.livesCost);
      events.push({ type: 'leaked', id: e.id, lives: td.lives });
      continue;
    }
    placeOnPath(td, e);
  }
  for (const t of td.towers) {
    t.cooldown -= dt;
    if (t.cooldown > 0) continue;
    const { damage, range } = towerStats(t);
    const target = pickTarget(td, t, range);
    if (!target) continue;
    t.cooldown = 1 / t.spec.rate;
    td.shots.push({ from: t.id, to: target.id, x: target.x, y: target.y, damage });
    events.push({ type: 'shot', tower: t.id, enemy: target.id, damage });
    if (t.spec.slow) { target.slowFactor = t.spec.slow; target.slowUntil = td.time + (t.spec.slowSeconds ?? 1); }
    if (t.spec.splash) {
      const at = { x: target.x, y: target.y };
      for (const e of td.enemies) if (e.alive && !e.spec.flying && Math.hypot(e.x - at.x, e.y - at.y) <= t.spec.splash) hurt(td, e, damage, events);
    } else hurt(td, target, damage, events);
  }
  td.enemies = td.enemies.filter((e) => e.alive);
  if (td.lives === 0) { td.result = 'lost'; events.push({ type: 'lost' }); return events; }
  if (td.waveActive && td.queue.length === 0 && td.enemies.length === 0) {
    td.waveActive = false;
    td.nextWaveIn = td.breakSeconds;
    events.push({ type: 'wave-cleared', wave: td.wave });
    if (td.wave >= td.waves) { td.result = 'won'; events.push({ type: 'won' }); }
  }
  return events;
}
`;

/** A tower-defense request, in English, Hinglish or Hindi ("qila bachao", "towers and waves"). */
const TOWER_DEFENSE_WORDS = /\btower[\s-]*defen[cs]e\b|\btd\s+game\b|\btowers?\s+(?:and|aur|or)\s+(?:enemy\s+)?waves?\b|\bwaves?\s+(?:of|ki)\s+enemies\b.*\btowers?\b|\bqil[ae]\s+(?:ko\s+)?bachao\b|टावर\s*डिफेंस/i;

/**
 * Which genre kits a request needs — the ONE reader, for the kit seed, the recipe's input and the design document. A fighting
 * game (the genre reader's 'fighting') gets the fighter; a tower-defense request gets the defense. PURE.
 */
export function genreKitsFor(text: string | null | undefined, genre: string): string[] {
  const out: string[] = [];
  if (genre === 'fighting') out.push('fighting');
  if (TOWER_DEFENSE_WORDS.test(String(text ?? ''))) out.push('towerDefense');
  return out;
}

export const GENRE_KITS: Readonly<Record<string, { path: string; source: string }>> = {
  fighting: { path: FIGHTING_PATH, source: FIGHTING },
  towerDefense: { path: TOWER_DEFENSE_PATH, source: TOWER_DEFENSE },
};

export function generateGenreKits(include?: string[]): GenreKitsResult {
  const names = Object.keys(GENRE_KITS).filter((n) => !include || include.length === 0 || include.includes(n));
  const files: Record<string, string> = {};
  for (const n of names) files[GENRE_KITS[n].path] = GENRE_KITS[n].source;
  return {
    files,
    dependencies: [],
    instructions: [
      'Added the genre kits (pure rules, 60 Hz, no three.js — draw them in 2D or 3D):',
      names.includes('fighting')
        ? '• FIGHTING (src/game/genres/fighting.ts): createMatch({ ai: \'normal\' }) then stepMatch(match, readFighterInput(ctx.input)) every'
          + ' frame. It owns startup / active / recovery frames, hit-stun and combos (scaled damage), blocking with chip damage (low must be'
          + ' blocked crouching, highs miss a crouch), throws, motion specials (down, forward, attack), cancels, the super meter, rounds,'
          + ' the timer and the computer opponent. Draw match.p1 / match.p2 (x, facing, state, move, frame) and play hits from the events.'
          + ' Change the moves through createMatch({ moves }) — never write your own hit detection.'
        : '',
      names.includes('towerDefense')
        ? '• TOWER DEFENSE (src/game/genres/towerDefense.ts): createTowerDefense({ map }) with S spawn, E base, . path, # build tiles;'
          + ' placeTower / upgradeTower / sellTower; startWave (early = bonus); stepTowerDefense(td, dt) every frame. It finds the path,'
          + ' refuses towers on the path or without money, aims at the first enemy in range (or strongest / nearest), splash, frost slow,'
          + ' armour, flyers, growing waves, lives, victory and defeat. Draw td.enemies, td.towers and td.shots; never write your own waves.'
        : '',
      '```ts',
      ...(names.includes('fighting') ? [
        "import { createMatch, stepMatch, roundSeconds, type FighterInput } from './game/genres/fighting';",
        "const match = createMatch({ ai: 'normal', maxHp: 120 });",
        "export function fightFrame(input: FighterInput): string[] {",
        '  const said: string[] = [];',
        '  for (const e of stepMatch(match, input)) {',
        "    if (e.type === 'hit') said.push(e.combo > 1 ? e.combo + ' hit combo!' : e.move);",
        "    if (e.type === 'match') said.push(e.winner === 'p1' ? 'You win' : 'You lose');",
        '  }',
        "  said.push(roundSeconds(match) + 's', 'P1 ' + match.p1.hp, 'P2 ' + match.p2.hp);",
        '  return said;',
        '}',
      ] : []),
      ...(names.includes('towerDefense') ? [
        "import { createTowerDefense, placeTower, startWave, stepTowerDefense } from './game/genres/towerDefense';",
        "const td = createTowerDefense({ map: ['S...####', '###.####', '###.....', '#######E'], money: 200, waves: 12 });",
        "placeTower(td, 'arrow', 4, 1);",
        'startWave(td);',
        'export function defenseFrame(dt: number): number {',
        "  for (const e of stepTowerDefense(td, dt)) if (e.type === 'leaked') console.info('Lives left', e.lives);",
        '  return td.enemies.length;',
        '}',
      ] : []),
      '```',
    ].filter(Boolean).join('\n'),
  };
}
