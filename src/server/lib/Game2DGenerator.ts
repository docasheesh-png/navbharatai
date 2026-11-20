// THE 2D GAME KIT — sprites, sprite-sheet animation, a tilemap, platformer physics, a camera, parallax and particles
// for a 2D canvas game (admin 2026-11-19 game-gap audit: "2D toolkit nahi hai").
//
// The 2D world recipe (world2d/) covers ONE thing — a big top-down map. Every other 2D game (a platformer, a side
// scroller, a shooter, a runner) was hand-rolled by the model each time: its own jump that felt floaty, its own
// collision that let the player clip into a wall at speed, a camera nailed to the player, no animation. This kit is
// the tested version of each, so the first build feels right.
//
// WHAT IT WRITES (src/game/2d/, plain TypeScript, no dependency):
//   sprite.ts    — loadImage, SpriteSheet (frame grid), Animator (named clips, fps, loop/once, flip), and an honest
//                  drawn placeholder while an image is missing (never an invisible player).
//   camera.ts    — Camera2D: follows a target through a dead zone with smoothing, clamps to the level, shakes,
//                  converts world ↔ screen, and applies itself to a canvas context.
//   tilemap.ts   — Tilemap from text rows and a legend (solid, one-way platform, hazard, empty), tile queries, spawn
//                  markers, drawing only the visible tiles.
//   physics.ts   — moveBody: swept per-axis AABB against the tilemap (no tunnelling at any speed), one-way platforms
//                  from above only, ground/wall/ceiling flags; PlatformerController with acceleration, friction,
//                  coyote time, jump buffering and a variable jump height; overlap tests.
//   parallax.ts  — layers that scroll slower than the world and repeat forever.
//   particles.ts — a capped particle pool with presets (dust, spark, coin, hit, explosion, smoke).
//   touch.ts     — the kit's on-screen joystick and buttons for a phone (the same ones the 3D shell uses).
//   index.ts     — one import.
//
// PURE — no I/O.

export interface Game2DResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

export const GAME_2D_DIR = 'src/game/2d';

const SPRITE = String.raw`/**
 * SPRITES AND ANIMATION. An image cut into a grid of frames, and named clips that play over it.
 *
 *   const sheet = new SpriteSheet(await loadImage('/hero.png'), 32, 32);
 *   const anim = new Animator(sheet, { idle: { frames: [0, 1], fps: 4 }, run: { frames: [2, 3, 4, 5], fps: 12 },
 *                                      jump: { frames: [6], fps: 1 }, hit: { frames: [7, 8], fps: 12, loop: false } });
 *   anim.play(onGround ? (Math.abs(vx) > 10 ? 'run' : 'idle') : 'jump');
 *   anim.update(dt); anim.draw(ctx, x, y, { flipX: facing < 0 });
 * While the image has not loaded (or failed), draw() paints a plain coloured shape the size of a frame, so the
 * player is never invisible.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load image ' + url));
    img.src = url;
  });
}

export class SpriteSheet {
  readonly columns: number;
  constructor(public image: CanvasImageSource | null, public readonly frameWidth: number, public readonly frameHeight: number, columns?: number) {
    const w = image && 'width' in image ? Number((image as { width: number }).width) : 0;
    this.columns = Math.max(1, columns ?? (Math.floor(w / frameWidth) || 1));
  }
  /** Where frame n sits in the image. */
  frameRect(n: number): { sx: number; sy: number; sw: number; sh: number } {
    const i = Math.max(0, Math.floor(n));
    return { sx: (i % this.columns) * this.frameWidth, sy: Math.floor(i / this.columns) * this.frameHeight, sw: this.frameWidth, sh: this.frameHeight };
  }
  get ready(): boolean {
    const img = this.image as (HTMLImageElement & { complete?: boolean }) | null;
    return !!img && (img.complete === undefined || (img.complete && (img.naturalWidth ?? 1) > 0));
  }
}

export interface Clip { frames: number[]; fps: number; loop?: boolean }
export interface DrawOptions { flipX?: boolean; scale?: number; alpha?: number; placeholder?: string; anchor?: 'center' | 'feet' }

export class Animator {
  private current = '';
  private time = 0;
  private finished = false;
  constructor(public sheet: SpriteSheet, public clips: Record<string, Clip>) {
    this.current = Object.keys(clips)[0] ?? '';
  }
  /** Switch clip. The same clip keeps playing from where it is; restart: true starts it over. */
  play(name: string, restart = false): void {
    if (!this.clips[name]) return;
    if (name === this.current && !restart) return;
    this.current = name; this.time = 0; this.finished = false;
  }
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const clip = this.clips[this.current];
    if (!clip) return;
    this.time += dt;
    if (clip.loop === false && this.time * clip.fps >= clip.frames.length) { this.time = clip.frames.length / Math.max(1e-6, clip.fps); this.finished = true; }
  }
  get clip(): string { return this.current; }
  /** A clip with loop: false has played its last frame. */
  get done(): boolean { return this.finished; }
  get frame(): number {
    const clip = this.clips[this.current];
    if (!clip || clip.frames.length === 0) return 0;
    const i = Math.floor(this.time * clip.fps);
    return clip.frames[clip.loop === false ? Math.min(clip.frames.length - 1, i) : i % clip.frames.length];
  }
  /** Draw centred on (x, y) — or standing on it with anchor: 'feet'. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, o: DrawOptions = {}): void {
    drawFrame(ctx, this.sheet, this.frame, x, y, o);
  }
}

export function drawFrame(ctx: CanvasRenderingContext2D, sheet: SpriteSheet, frame: number, x: number, y: number, o: DrawOptions = {}): void {
  const s = o.scale ?? 1;
  const w = sheet.frameWidth * s, h = sheet.frameHeight * s;
  const top = o.anchor === 'feet' ? y - h : y - h / 2;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.translate(Math.round(x), Math.round(top));
  if (o.flipX) ctx.scale(-1, 1);
  if (sheet.ready && sheet.image) {
    const r = sheet.frameRect(frame);
    ctx.drawImage(sheet.image, r.sx, r.sy, r.sw, r.sh, -w / 2, 0, w, h);
  } else {
    ctx.fillStyle = o.placeholder ?? '#f59e0b';
    ctx.fillRect(-w / 2, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(w * 0.1, h * 0.2, w * 0.18, h * 0.18);   // an eye on the side it faces
  }
  ctx.restore();
}
`;

const CAMERA = String.raw`/**
 * THE 2D CAMERA. It follows the player through a dead zone (small moves do not drag the screen), eases toward them,
 * stays inside the level, and shakes on a hit. Everything world-sized is drawn between begin() and end().
 *
 *   const cam = new Camera2D(canvas.width, canvas.height, { bounds: { x: 0, y: 0, w: map.width, h: map.height } });
 *   cam.follow(player.x, player.y, dt);  cam.begin(ctx); …draw the world… cam.end(ctx);  // then the HUD
 */
export interface CameraOptions {
  /** Half-size of the box the target may move in before the camera moves, in pixels. */
  deadZone?: { x: number; y: number };
  /** 0..1 per frame at 60 fps: how quickly the camera catches up (1 = locked). */
  smoothing?: number;
  bounds?: { x: number; y: number; w: number; h: number } | null;
  /** Look this far ahead in the direction the target moves. */
  lookAhead?: number;
}

export class Camera2D {
  x = 0; y = 0;
  zoom = 1;
  private trauma = 0;
  private shakeX = 0; private shakeY = 0;
  private seed = 1;
  private lastTx: number | null = null;
  private ahead = 0;
  constructor(public width: number, public height: number, public options: CameraOptions = {}) {}

  resize(width: number, height: number): void { this.width = width; this.height = height; this.clamp(); }

  /** Jump straight to a point (a respawn, a level start). */
  snap(tx: number, ty: number): void { this.x = tx; this.y = ty; this.lastTx = tx; this.ahead = 0; this.clamp(); }

  follow(tx: number, ty: number, dt: number): void {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    const dz = this.options.deadZone ?? { x: 40, y: 60 };
    const look = this.options.lookAhead ?? 0;
    if (look && this.lastTx !== null && dt > 0) {
      const dir = Math.sign(tx - this.lastTx);
      if (dir) this.ahead += (dir * look - this.ahead) * Math.min(1, dt * 3);
    }
    this.lastTx = tx;
    const wantX = tx + this.ahead;
    let goalX = this.x, goalY = this.y;
    if (wantX > this.x + dz.x) goalX = wantX - dz.x; else if (wantX < this.x - dz.x) goalX = wantX + dz.x;
    if (ty > this.y + dz.y) goalY = ty - dz.y; else if (ty < this.y - dz.y) goalY = ty + dz.y;
    // Frame-rate independent easing: the same feel at 30, 60 or 144 fps.
    const k = 1 - Math.pow(1 - Math.min(1, Math.max(0.0001, this.options.smoothing ?? 0.15)), Math.max(0, dt) * 60);
    this.x += (goalX - this.x) * k;
    this.y += (goalY - this.y) * k;
    this.clamp();
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma * 14;
    this.shakeX = s * this.noise(); this.shakeY = s * this.noise();
  }

  /** Add shake (0..1); it fades by itself. */
  shake(amount: number): void { if (Number.isFinite(amount) && amount > 0) this.trauma = Math.min(1, this.trauma + amount); }

  private noise(): number { this.seed = (this.seed * 16807) % 2147483647; return (this.seed / 2147483647) * 2 - 1; }

  private clamp(): void {
    const b = this.options.bounds;
    if (!b) return;
    const hw = this.width / 2 / this.zoom, hh = this.height / 2 / this.zoom;
    this.x = b.w <= hw * 2 ? b.x + b.w / 2 : Math.max(b.x + hw, Math.min(b.x + b.w - hw, this.x));
    this.y = b.h <= hh * 2 ? b.y + b.h / 2 : Math.max(b.y + hh, Math.min(b.y + b.h - hh, this.y));
  }

  /** The world rectangle on screen right now (for drawing only what is visible). */
  get view(): { x: number; y: number; w: number; h: number } {
    const w = this.width / this.zoom, h = this.height / this.zoom;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }
  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.width / 2 + this.shakeX, y: (wy - this.y) * this.zoom + this.height / 2 + this.shakeY };
  }
  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.width / 2 - this.shakeX) / this.zoom + this.x, y: (sy - this.height / 2 - this.shakeY) / this.zoom + this.y };
  }
  begin(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(Math.round(this.width / 2 + this.shakeX), Math.round(this.height / 2 + this.shakeY));
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-Math.round(this.x), -Math.round(this.y));
  }
  end(ctx: CanvasRenderingContext2D): void { ctx.restore(); }
}
`;

const TILEMAP = String.raw`/**
 * A TILEMAP FROM TEXT. A level is a few lines of characters, and a legend says what each one is.
 *
 *   const map = Tilemap.fromRows([
 *     '..............C.....',
 *     '.......====.........',
 *     '..P.........###..^^.',
 *     '####################',
 *   ], 32);                                   // the default legend below; pass your own as the third argument
 *   map.solidAt(x, y); map.markers('C');      // where the coins go
 *   map.draw(ctx, cam.view);                  // only the visible tiles
 * Default legend: '#' solid, '=' one-way platform (stand on it, jump up through it), '^' hazard, anything else empty.
 * Letters are MARKERS (spawn points: P player, E enemy, C coin, F flag) and read as empty space.
 */
export type TileType = 'empty' | 'solid' | 'platform' | 'hazard';
export interface TileStyle { type: TileType; colour?: string }
export const DEFAULT_LEGEND: Readonly<Record<string, TileStyle>> = {
  '#': { type: 'solid', colour: '#5b4636' },
  '=': { type: 'platform', colour: '#a16207' },
  '^': { type: 'hazard', colour: '#dc2626' },
};

export class Tilemap {
  readonly cols: number;
  readonly rows: number;
  private constructor(private readonly grid: string[], readonly tileSize: number, private readonly legend: Record<string, TileStyle>) {
    this.rows = grid.length;
    this.cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  }
  static fromRows(rows: string[], tileSize = 32, legend: Record<string, TileStyle> = { ...DEFAULT_LEGEND }): Tilemap {
    const clean = (Array.isArray(rows) ? rows : []).map((r) => String(r ?? ''));
    return new Tilemap(clean, Math.max(1, tileSize), legend);
  }
  get width(): number { return this.cols * this.tileSize; }
  get height(): number { return this.rows * this.tileSize; }
  charAt(col: number, row: number): string { return row >= 0 && row < this.rows ? (this.grid[row][col] ?? '.') : '.'; }
  /** Outside the map's sides and bottom is solid (nothing falls out of the level); above the top is open. */
  typeAt(col: number, row: number): TileType {
    if (col < 0 || col >= this.cols || row >= this.rows) return 'solid';
    if (row < 0) return 'empty';
    return this.legend[this.charAt(col, row)]?.type ?? 'empty';
  }
  typeAtPoint(x: number, y: number): TileType { return this.typeAt(Math.floor(x / this.tileSize), Math.floor(y / this.tileSize)); }
  solidAt(x: number, y: number): boolean { return this.typeAtPoint(x, y) === 'solid'; }
  /** World centres of every cell holding 'ch' (spawn points, coins, enemies). */
  markers(ch: string): Array<{ x: number; y: number; col: number; row: number }> {
    const out: Array<{ x: number; y: number; col: number; row: number }> = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.grid[r].length; c++) {
      if (this.grid[r][c] === ch) out.push({ x: (c + 0.5) * this.tileSize, y: (r + 0.5) * this.tileSize, col: c, row: r });
    }
    return out;
  }
  /** Change one tile at run time (a block broken, a door opened). */
  set(col: number, row: number, ch: string): void {
    if (row < 0 || row >= this.rows || col < 0) return;
    const line = this.grid[row].padEnd(col + 1, '.');
    this.grid[row] = line.slice(0, col) + ch.charAt(0) + line.slice(col + 1);
  }
  /** Draw the tiles inside 'view' (a camera's view rectangle) — never the whole level. */
  draw(ctx: CanvasRenderingContext2D, view: { x: number; y: number; w: number; h: number }, paint?: (ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, size: number) => boolean): number {
    const t = this.tileSize;
    const c0 = Math.max(0, Math.floor(view.x / t)), c1 = Math.min(this.cols - 1, Math.floor((view.x + view.w) / t));
    const r0 = Math.max(0, Math.floor(view.y / t)), r1 = Math.min(this.rows - 1, Math.floor((view.y + view.h) / t));
    let drawn = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const ch = this.charAt(c, r);
      const style = this.legend[ch];
      if (!style || style.type === 'empty') continue;
      drawn++;
      if (paint && paint(ctx, ch, c * t, r * t, t)) continue;
      ctx.fillStyle = style.colour ?? '#888';
      if (style.type === 'platform') ctx.fillRect(c * t, r * t, t, Math.max(4, t / 4));
      else if (style.type === 'hazard') {
        ctx.beginPath(); ctx.moveTo(c * t, (r + 1) * t); ctx.lineTo((c + 0.5) * t, r * t + t * 0.2); ctx.lineTo((c + 1) * t, (r + 1) * t); ctx.fill();
      } else {
        ctx.fillRect(c * t, r * t, t, t);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(c * t, r * t, t, 3);   // a lit top edge
      }
    }
    return drawn;
  }
}
`;

const PHYSICS = String.raw`/**
 * 2D PHYSICS THAT FEELS RIGHT. A body is a box; moveBody moves it one axis at a time in steps smaller than a tile, so
 * nothing passes through a wall however fast it goes. One-way platforms hold a body only when it comes down onto them
 * from above. The PlatformerController is the jump players expect: run-up and slow-down, coyote time (a jump still
 * works a moment after stepping off a ledge), jump buffering (a press just before landing still jumps) and a short
 * hop when the button is let go early.
 */
import type { Tilemap } from './tilemap';

export interface Body {
  /** Centre. */
  x: number; y: number;
  /** Full size. */
  w: number; h: number;
  vx: number; vy: number;
  onGround: boolean; hitWall: -1 | 0 | 1; hitCeiling: boolean;
  /** Set true for one step to drop down through a one-way platform. */
  dropThrough?: boolean;
}

export function createBody(x: number, y: number, w: number, h: number): Body {
  return { x, y, w, h, vx: 0, vy: 0, onGround: false, hitWall: 0, hitCeiling: false };
}

export interface WorldOptions { gravity?: number; maxFall?: number }

const EPS = 0.001;

/** Advance a body by its velocity through the map (gravity included). Sets onGround / hitWall / hitCeiling. */
export function moveBody(body: Body, map: Tilemap, dt: number, o: WorldOptions = {}): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const g = o.gravity ?? 1800, maxFall = o.maxFall ?? 900;
  body.vy = Math.min(maxFall, body.vy + g * dt);
  body.onGround = false; body.hitWall = 0; body.hitCeiling = false;
  const t = map.tileSize;
  const step = Math.max(1, t / 3);
  // X
  let dx = body.vx * dt;
  while (Math.abs(dx) > EPS) {
    const s = Math.sign(dx) * Math.min(Math.abs(dx), step);
    if (blockedX(body, map, body.x + s)) {
      const edge = s > 0 ? Math.floor((body.x + body.w / 2 + s) / t) * t - body.w / 2 - EPS : (Math.floor((body.x - body.w / 2 + s) / t) + 1) * t + body.w / 2 + EPS;
      body.x = s > 0 ? Math.min(body.x + s, edge) : Math.max(body.x + s, edge);
      body.hitWall = s > 0 ? 1 : -1; body.vx = 0; break;
    }
    body.x += s; dx -= s;
  }
  // Y
  let dy = body.vy * dt;
  while (Math.abs(dy) > EPS) {
    const s = Math.sign(dy) * Math.min(Math.abs(dy), step);
    const bottom = body.y + body.h / 2;
    if (blockedY(body, map, body.y + s, s > 0, bottom)) {
      if (s > 0) { body.y = Math.floor((bottom + s) / t) * t - body.h / 2 - EPS; body.onGround = true; }
      else { body.y = (Math.floor((body.y - body.h / 2 + s) / t) + 1) * t + body.h / 2 + EPS; body.hitCeiling = true; }
      body.vy = 0; break;
    }
    body.y += s; dy -= s;
  }
  body.dropThrough = false;
}

function columns(body: Body, map: Tilemap, x: number): [number, number] {
  return [Math.floor((x - body.w / 2 + EPS) / map.tileSize), Math.floor((x + body.w / 2 - EPS) / map.tileSize)];
}

function blockedX(body: Body, map: Tilemap, x: number): boolean {
  const t = map.tileSize;
  const col = Math.floor((x + (x > body.x ? body.w / 2 - EPS : -body.w / 2 + EPS)) / t);
  const r0 = Math.floor((body.y - body.h / 2 + EPS) / t), r1 = Math.floor((body.y + body.h / 2 - EPS) / t);
  for (let r = r0; r <= r1; r++) if (map.typeAt(col, r) === 'solid') return true;
  return false;
}

function blockedY(body: Body, map: Tilemap, y: number, down: boolean, oldBottom: number): boolean {
  const t = map.tileSize;
  const [c0, c1] = columns(body, map, body.x);
  const row = Math.floor((y + (down ? body.h / 2 - EPS : -body.h / 2 + EPS)) / t);
  for (let c = c0; c <= c1; c++) {
    const type = map.typeAt(c, row);
    if (type === 'solid') return true;
    // A one-way platform holds only a body coming DOWN whose feet were above its top before this step.
    if (type === 'platform' && down && !body.dropThrough && oldBottom <= row * t + EPS * 2) return true;
  }
  return false;
}

/** Two boxes overlap (pickups, enemies, the goal). */
export function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

/** The body touches a hazard tile (spikes, lava). */
export function touchesHazard(body: Body, map: Tilemap): boolean {
  const pts = [[body.x - body.w / 2 + 2, body.y + body.h / 2 - 1], [body.x + body.w / 2 - 2, body.y + body.h / 2 - 1], [body.x, body.y]];
  return pts.some(([x, y]) => map.typeAtPoint(x, y) === 'hazard');
}

export interface PlatformerTuning {
  runSpeed?: number; accel?: number; friction?: number; airControl?: number;
  jumpSpeed?: number; coyote?: number; buffer?: number;
  /** How much upward speed is kept when jump is released early (0..1). */
  jumpCut?: number;
  gravity?: number; maxFall?: number;
}

export interface PlatformerInput { x: number; jumpPressed: boolean; jumpHeld: boolean; down?: boolean }

/** Run, stop, jump and fall the way players expect. Call step() once per fixed update. */
export class PlatformerController {
  private sinceGround = Infinity;
  private sincePress = Infinity;
  private jumping = false;
  /** True on the step a jump started (for the sound, the dust and the squash). */
  jumped = false;
  /** True on the step the body landed. */
  landed = false;
  facing: 1 | -1 = 1;
  readonly t: Required<PlatformerTuning>;
  constructor(public body: Body, tuning: PlatformerTuning = {}) {
    this.t = { runSpeed: 220, accel: 2400, friction: 2800, airControl: 0.65, jumpSpeed: 620, coyote: 0.1, buffer: 0.12, jumpCut: 0.45, gravity: 1800, maxFall: 900, ...tuning };
  }
  step(input: PlatformerInput, map: Tilemap, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const b = this.body, t = this.t;
    const wasGround = b.onGround;
    const ix = Math.max(-1, Math.min(1, Number.isFinite(input.x) ? input.x : 0));
    if (ix) this.facing = ix > 0 ? 1 : -1;
    const control = b.onGround ? 1 : t.airControl;
    const target = ix * t.runSpeed;
    if (ix) b.vx = approach(b.vx, target, t.accel * control * dt);
    else b.vx = approach(b.vx, 0, (b.onGround ? t.friction : t.friction * 0.25) * dt);
    this.sinceGround = b.onGround ? 0 : this.sinceGround + dt;
    this.sincePress = input.jumpPressed ? 0 : this.sincePress + dt;
    this.jumped = false;
    if (this.sincePress <= t.buffer && this.sinceGround <= t.coyote) {
      // Down + jump on a one-way platform drops through it — and USES the press, or the buffer and coyote time would jump
      // straight back up onto the platform on the next step.
      if (input.down && b.onGround && standsOnPlatform(b, map)) { b.dropThrough = true; this.sincePress = Infinity; this.sinceGround = Infinity; }
      else { b.vy = -t.jumpSpeed; this.jumping = true; this.jumped = true; this.sincePress = Infinity; this.sinceGround = Infinity; }
    }
    // Let go early → a short hop.
    if (this.jumping && !input.jumpHeld && b.vy < 0) { b.vy *= t.jumpCut; this.jumping = false; }
    if (b.vy >= 0) this.jumping = false;
    moveBody(b, map, dt, { gravity: t.gravity, maxFall: t.maxFall });
    this.landed = b.onGround && !wasGround;
  }
}

function approach(v: number, target: number, delta: number): number {
  return v < target ? Math.min(target, v + delta) : Math.max(target, v - delta);
}

function standsOnPlatform(b: Body, map: Tilemap): boolean {
  const y = b.y + b.h / 2 + 1;
  return map.typeAtPoint(b.x, y) === 'platform';
}
`;

const PARALLAX = String.raw`/**
 * PARALLAX: background layers that move slower than the world, so a flat 2D game has depth. Each layer repeats
 * forever sideways. A layer is an image or a draw function (hills, clouds) — no art needed to start.
 *
 *   const sky = new Parallax([
 *     { factor: 0.1, draw: (ctx, w, h) => { ctx.fillStyle = '#7dd3fc'; ctx.fillRect(0, 0, w, h); } },
 *     { factor: 0.3, draw: hills('#16a34a', 0.65) },
 *     { factor: 0.6, image: treesImage, y: 140 },
 *   ]);
 *   sky.draw(ctx, cam.x, cam.y, canvas.width, canvas.height);   // BEFORE cam.begin()
 */
export interface ParallaxLayer {
  /** 0 = fixed to the screen, 1 = moves with the world. */
  factor: number;
  image?: CanvasImageSource & { width: number; height: number };
  /** Draw one tile of this layer, 'w' wide; it is repeated sideways. */
  draw?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** Vertical offset of the layer on screen. */
  y?: number;
  /** Width of one repeat (defaults to the image width, or the screen width). */
  width?: number;
  /** Follow the camera vertically too (0..1, default 0). */
  factorY?: number;
}

export class Parallax {
  constructor(public layers: ParallaxLayer[]) {}
  /** The screen x offsets at which this layer's repeats are drawn. */
  static repeats(camX: number, factor: number, tileW: number, screenW: number): number[] {
    if (!(tileW > 0)) return [];
    const shift = -(((camX * factor) % tileW) + tileW) % tileW;
    const out: number[] = [];
    for (let x = shift; x < screenW; x += tileW) out.push(x);
    return out;
  }
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, screenW: number, screenH: number): void {
    for (const l of this.layers) {
      const tileW = l.width ?? l.image?.width ?? screenW;
      const y = (l.y ?? 0) - camY * (l.factorY ?? 0);
      for (const x of Parallax.repeats(camX, l.factor, tileW, screenW)) {
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y));
        if (l.image) ctx.drawImage(l.image, 0, 0);
        else l.draw?.(ctx, tileW, screenH);
        ctx.restore();
      }
    }
  }
}

/** A row of soft hills as a parallax layer (top at 'height' × screen height). */
export function hills(colour: string, height = 0.6, bumps = 3): (ctx: CanvasRenderingContext2D, w: number, h: number) => void {
  return (ctx, w, h) => {
    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 0; i <= 32; i++) {
      const x = (i / 32) * w;
      ctx.lineTo(x, h * height - Math.sin((i / 32) * Math.PI * 2 * bumps) * h * 0.06 - h * 0.04);
    }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  };
}
`;

const PARTICLES = String.raw`/**
 * 2D PARTICLES — the dust when the player lands, the sparks on a hit, the coins that pop. A fixed pool, so a big
 * explosion never stalls the frame.
 *
 *   const fx = new Particles2D();
 *   fx.burst('dust', player.x, player.y + 14);   fx.update(dt);   fx.draw(ctx);   // inside cam.begin()/end()
 */
export type Particle2DPreset = 'dust' | 'spark' | 'coin' | 'hit' | 'explosion' | 'smoke';

interface Spec { count: number; speed: [number, number]; life: [number, number]; size: [number, number]; colours: string[]; gravity: number; spread: number; angle: number; drag: number; grow: number }

export const PARTICLE_2D_PRESETS: Readonly<Record<Particle2DPreset, Spec>> = {
  dust:      { count: 8,  speed: [40, 110],  life: [0.25, 0.5], size: [2, 4], colours: ['#d6d3d1', '#a8a29e'], gravity: -60, spread: Math.PI * 0.8, angle: -Math.PI / 2, drag: 3, grow: 1.5 },
  spark:     { count: 10, speed: [120, 320], life: [0.15, 0.35], size: [1.5, 3], colours: ['#fde047', '#fb923c', '#ffffff'], gravity: 400, spread: Math.PI * 2, angle: 0, drag: 2, grow: -1 },
  coin:      { count: 6,  speed: [60, 160],  life: [0.3, 0.6], size: [2, 3.5], colours: ['#facc15', '#fef08a'], gravity: 300, spread: Math.PI * 0.9, angle: -Math.PI / 2, drag: 1, grow: -0.5 },
  hit:       { count: 12, speed: [80, 260],  life: [0.2, 0.4], size: [2, 4], colours: ['#ef4444', '#fca5a5', '#ffffff'], gravity: 500, spread: Math.PI * 2, angle: 0, drag: 2, grow: -1 },
  explosion: { count: 36, speed: [80, 420],  life: [0.35, 0.9], size: [3, 7], colours: ['#fde047', '#f97316', '#ef4444', '#57534e'], gravity: 120, spread: Math.PI * 2, angle: 0, drag: 2.5, grow: 0.8 },
  smoke:     { count: 10, speed: [15, 50],   life: [0.6, 1.4], size: [5, 9], colours: ['rgba(87,83,78,0.6)', 'rgba(120,113,108,0.5)'], gravity: -40, spread: Math.PI * 0.6, angle: -Math.PI / 2, drag: 1, grow: 2 },
};

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; colour: string; gravity: number; drag: number; grow: number }

export class Particles2D {
  private pool: P[] = [];
  private seed = 7;
  constructor(public readonly max = 600) {}
  private rand(a: number, b: number): number { this.seed = (this.seed * 16807) % 2147483647; return a + (this.seed / 2147483647) * (b - a); }
  get count(): number { return this.pool.length; }
  burst(preset: Particle2DPreset, x: number, y: number, scale = 1): void {
    const s = PARTICLE_2D_PRESETS[preset];
    if (!s || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const n = Math.round(s.count * Math.max(0, scale));
    for (let i = 0; i < n; i++) {
      if (this.pool.length >= this.max) this.pool.shift();   // the oldest goes first: the newest burst is the one being looked at
      const a = s.angle + this.rand(-s.spread / 2, s.spread / 2);
      const v = this.rand(s.speed[0], s.speed[1]) * Math.sqrt(Math.max(0.25, scale));
      const life = this.rand(s.life[0], s.life[1]);
      this.pool.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: this.rand(s.size[0], s.size[1]) * Math.sqrt(Math.max(0.25, scale)), colour: s.colours[Math.floor(this.rand(0, s.colours.length)) % s.colours.length], gravity: s.gravity, drag: s.drag, grow: s.grow });
    }
  }
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let w = 0;
    for (const p of this.pool) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.size = Math.max(0.2, p.size + p.grow * dt * p.size);
      this.pool[w++] = p;
    }
    this.pool.length = w;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.colour;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
  clear(): void { this.pool.length = 0; }
}
`;

const TOUCH = String.raw`/**
 * ON-SCREEN CONTROLS FOR A 2D GAME ON A PHONE (game audit 2, 2026-11-20: failedbr #2435 — a Mario-style platformer —
 * found no touch support in the kit, hand-rolled its own buttons, and scored Phone 0). These are the SAME joystick and
 * buttons the 3D shell uses (ui/touchControls.ts): multi-touch, safe-area aware, shown only on a touch screen, and they
 * drive the same Input the keyboard does — so input.axis() and input.isDown('jump') just work on a phone.
 *
 *   const input = new Input(stage);
 *   const touch = mountTouchControls2D(stage, input);                     // joystick + Jump + Attack
 *   // a runner: mountTouchControls2D(stage, input, { buttons: [{ action: 'jump', label: 'Jump' }] })
 *   // when the game ends: touch.dispose();
 */
import type { Input } from '../core/input';
import { TouchControls, DEFAULT_TOUCH_BUTTONS, type TouchControlsOptions } from '../ui/touchControls';

export { TouchControls, DEFAULT_TOUCH_BUTTONS };
export type { TouchControlsOptions };

/** The usual 2D set: the joystick on the left, Jump and Attack on the right, and no camera drag (a 2D camera follows by itself). */
export function mountTouchControls2D(stage: HTMLElement, input: Input, options: TouchControlsOptions = {}): TouchControls {
  return new TouchControls(stage, input, { look: false, buttons: [{ action: 'jump', label: 'Jump' }, { action: 'attack', label: 'Attack' }], ...options });
}
`;

const INDEX = String.raw`// The 2D game kit: sprites and animation, camera, tilemap, platformer physics, parallax and particles.
export { loadImage, SpriteSheet, Animator, drawFrame } from './sprite';
export type { Clip, DrawOptions } from './sprite';
export { Camera2D } from './camera';
export type { CameraOptions } from './camera';
export { Tilemap, DEFAULT_LEGEND } from './tilemap';
export type { TileType, TileStyle } from './tilemap';
export { createBody, moveBody, overlaps, touchesHazard, PlatformerController } from './physics';
export type { Body, WorldOptions, PlatformerTuning, PlatformerInput } from './physics';
export { Parallax, hills } from './parallax';
export type { ParallaxLayer } from './parallax';
export { Particles2D, PARTICLE_2D_PRESETS } from './particles';
export type { Particle2DPreset } from './particles';
export { mountTouchControls2D, TouchControls, DEFAULT_TOUCH_BUTTONS } from './touch';
export type { TouchControlsOptions } from './touch';
`;

const FILES: Record<string, string> = {
  [`${GAME_2D_DIR}/sprite.ts`]: SPRITE,
  [`${GAME_2D_DIR}/camera.ts`]: CAMERA,
  [`${GAME_2D_DIR}/tilemap.ts`]: TILEMAP,
  [`${GAME_2D_DIR}/physics.ts`]: PHYSICS,
  [`${GAME_2D_DIR}/parallax.ts`]: PARALLAX,
  [`${GAME_2D_DIR}/particles.ts`]: PARTICLES,
  [`${GAME_2D_DIR}/touch.ts`]: TOUCH,
  [`${GAME_2D_DIR}/index.ts`]: INDEX,
};

export const GAME_2D_MODULES: readonly string[] = ['sprite', 'camera', 'tilemap', 'physics', 'parallax', 'particles', 'touch'];

const EXAMPLE = [
  "import { Tilemap, Camera2D, PlatformerController, createBody, touchesHazard, Parallax, hills, Particles2D, mountTouchControls2D } from './game/2d';",
  "import { Input } from './game/core/input';",
  '',
  "const canvas = document.createElement('canvas');",
  'canvas.width = 800; canvas.height = 450;',
  "const ctx = canvas.getContext('2d')!;",
  '// Keyboard, gamepad AND, on a phone, the on-screen joystick and Jump / Attack buttons all drive this one Input.',
  'const controls = new Input(canvas);',
  'mountTouchControls2D(document.body, controls);',
  "const map = Tilemap.fromRows(['....................', '.......====....C....', '..P.........###..^^.', '####################'], 32);",
  "const start = map.markers('P')[0];",
  'const player = new PlatformerController(createBody(start.x, start.y, 22, 30));',
  'const cam = new Camera2D(canvas.width, canvas.height, { bounds: { x: 0, y: 0, w: map.width, h: map.height }, lookAhead: 60 });',
  "const sky = new Parallax([{ factor: 0, draw: (c, w, h) => { c.fillStyle = '#7dd3fc'; c.fillRect(0, 0, w, h); } }, { factor: 0.3, draw: hills('#16a34a') }]);",
  'const fx = new Particles2D();',
  '',
  '// The FIXED update — input from core/input.ts: x = axis().x, jump = wasPressed / isDown(\'jump\'), down = isDown(\'down\').',
  'export function update(dt: number, input: { x: number; jumpPressed: boolean; jumpHeld: boolean; down: boolean }): void {',
  '  player.step(input, map, dt);',
  "  if (player.landed) fx.burst('dust', player.body.x, player.body.y + 15);",
  '  if (touchesHazard(player.body, map)) { player.body.x = start.x; player.body.y = start.y; cam.shake(0.6); }',
  '  cam.follow(player.body.x, player.body.y, dt);',
  '  fx.update(dt);',
  '}',
  '',
  'export function render(): void {',
  '  sky.draw(ctx, cam.x, cam.y, canvas.width, canvas.height);',
  '  cam.begin(ctx);',
  '  map.draw(ctx, cam.view);',
  "  ctx.fillStyle = '#f59e0b'; ctx.fillRect(player.body.x - 11, player.body.y - 15, 22, 30);   // or an Animator",
  '  fx.draw(ctx);',
  '  cam.end(ctx);',
  '}',
].join('\n');

/** Generate the 2D kit (or a subset of it; physics brings the tilemap it moves through). PURE. */
export function generateGame2D(include?: string[]): Game2DResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;
  let files: Record<string, string>;
  if (!wanted) files = { ...FILES };
  else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.ts$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    if (files[`${GAME_2D_DIR}/physics.ts`]) files[`${GAME_2D_DIR}/tilemap.ts`] = FILES[`${GAME_2D_DIR}/tilemap.ts`];
    if (Object.keys(files).length === 0) files = { ...FILES };
    // The index re-exports every module, so a subset carries the full set or none of the index.
    if (Object.keys(files).length === Object.keys(FILES).length - 1) files[`${GAME_2D_DIR}/index.ts`] = INDEX;
  }
  return {
    files,
    dependencies: [],
    instructions:
      `Added the 2D game kit (${Object.keys(files).length} files under ${GAME_2D_DIR}): sprites and sprite-sheet animation, a camera that `
      + 'follows smoothly and shakes, a tilemap built from text rows, platformer physics that never tunnels through a wall, '
      + 'parallax backgrounds and 2D particles.\n'
      + '```ts\n' + EXAMPLE + '\n```\n'
      + 'RULES: build a 2D canvas game ON this kit — never hand-roll a jump, tile collision, a camera or a particle system. '
      + 'Movement goes in the FIXED update; drawing in render (core/loop.ts). Draw the world between cam.begin and cam.end and the '
      + 'HUD after. Animate every character with Animator (idle / run / jump / hit at least) and flip it to face where it moves; '
      + 'until there is art, the placeholder draws a coloured body, never nothing. On a phone, mountTouchControls2D(stage, input) from src/game/2d/touch.ts gives the joystick and buttons that drive that same Input — never hand-roll touch buttons. '
      + 'A big top-down map is the 2D world recipe (generate_world_2d), not this.',
  };
}
