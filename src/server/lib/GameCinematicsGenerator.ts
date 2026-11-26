/**
 * 🎬 CAMERA SHOTS THE USER DESCRIBES (admin 2026-11-26, list #9): "hero marne ke baad ek dam cinematic style me camera
 * zoom in / zoom out ho, aur animation aur 'game over' … game start hone se pahle pura map ka drone shot, ya hero ki action,
 * kuch bhi user bole, woh video bane".
 *
 * Root cause: the camera had one owner (CameraRig: chase, first person) and no way to be TOLD where to go for a few seconds.
 * Each request for a death cam or an intro fly-over asked the builder to take the camera away from the rig by hand, inside
 * a game loop that set it back every frame — so it never showed.
 *
 * `src/game/play/cinematics.ts`, owned by the shell: a shot list is DATA (what to look at, from how far and how high, which
 * way round, how wide, for how long, with what title), and the Director plays it on the real camera in the render loop
 * (which runs on the game-over screen too). Three ready shots — DEATH_CAM, introDrone(radius), HERO_SHOT — and any list the
 * user describes (ctx.cinematic(shots)). Skippable: a tap, a click or a key ends it.
 *
 * String.raw: no backticks and no dollar-brace sequences inside the module text.
 */
export const GAME_CINEMATICS_PATH = 'src/game/play/cinematics.ts';

export const GAME_CINEMATICS = String.raw`import * as THREE from 'three';
import { events } from '../core/events';

export interface Point { x: number; y: number; z: number }

/** One camera shot. Every [from, to] pair is eased across the shot's seconds. */
export interface Shot {
  /** How long, seconds (0.2–30). */
  seconds: number;
  /** What the camera looks at: the player (default) or a point in the scene. */
  target?: 'player' | Point;
  /** Metres from the target, start → end ([9, 3] zooms in; [3, 12] pulls out). Default [6, 6]. */
  distance?: [number, number];
  /** Metres above the target, start → end ([80, 3] comes down from the sky). Default [2, 2]. */
  height?: [number, number];
  /** Degrees around the target, start → end ([0, 180] circles half way round). Default [0, 0]: behind it. */
  angle?: [number, number];
  /** Field of view, degrees, start → end ([60, 30] is a lens zoom). Default: the camera's own. */
  fov?: [number, number];
  /** Big text on the screen during the shot ('GAME OVER', the game's name). */
  title?: string;
  subtitle?: string;
  /** Black bars top and bottom (default true). */
  bars?: boolean;
}

/** After the player dies: close in round the body from wide to near, then hold on GAME OVER. */
export const DEATH_CAM: Shot[] = [
  { seconds: 2.4, distance: [10, 3.2], height: [6, 1.4], angle: [0, 140], fov: [60, 42] },
  { seconds: 1.8, distance: [3.2, 4.2], height: [1.4, 2.4], angle: [140, 170], fov: [42, 48], title: 'GAME OVER' },
];

/** Before play: a drone high over the map, circling down to the hero. radius: how much map to show (metres). */
export function introDrone(radius = 150, title?: string): Shot[] {
  const r = Math.max(20, Math.min(2000, radius));
  return [
    { seconds: 3.5, distance: [r, r * 0.55], height: [r * 0.7, r * 0.35], angle: [0, 120], title },
    { seconds: 2.5, distance: [r * 0.55, 6], height: [r * 0.35, 2.2], angle: [120, 180] },
  ];
}

/** The hero in action: a low angle circling round. */
export const HERO_SHOT: Shot[] = [
  { seconds: 3.5, distance: [3.5, 4.5], height: [0.6, 1.2], angle: [-60, 60], fov: [50, 44] },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (pair: [number, number] | undefined, t: number, d: number) => (pair ? pair[0] + (pair[1] - pair[0]) * t : d);

/** A shot list as the user wrote it (numbers out of range are brought in; a bad shot is left out). */
export function cleanShots(list: unknown): Shot[] {
  if (!Array.isArray(list)) return [];
  const pair = (p: unknown, lo: number, hi: number): [number, number] | undefined =>
    Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [clamp(p[0], lo, hi), clamp(p[1], lo, hi)] : undefined;
  const out: Shot[] = [];
  for (const s of list.slice(0, 20)) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    if (typeof r.seconds !== 'number' || !Number.isFinite(r.seconds)) continue;
    const t = r.target;
    const target = t && typeof t === 'object' && ['x', 'y', 'z'].every((k) => typeof (t as Record<string, unknown>)[k] === 'number') ? (t as Point) : 'player';
    out.push({
      seconds: clamp(r.seconds, 0.2, 30), target,
      distance: pair(r.distance, 0.5, 3000), height: pair(r.height, -5, 3000), angle: pair(r.angle, -3600, 3600), fov: pair(r.fov, 5, 120),
      title: typeof r.title === 'string' ? r.title.slice(0, 60) : undefined,
      subtitle: typeof r.subtitle === 'string' ? r.subtitle.slice(0, 80) : undefined,
      bars: r.bars !== false,
    });
  }
  return out;
}

/** What the screen shows during a shot (the HUD draws it). */
export interface CinematicFrame { title?: string; subtitle?: string; bars: boolean }

/** Plays shot lists on a camera. The shell calls update() each drawn frame; while it returns true it owns the camera. */
export class Director {
  private shots: Shot[] = [];
  private index = 0;
  private time = 0;
  private baseFov = 0;
  private done: (() => void) | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private readonly look = new THREE.Vector3();

  get active(): boolean { return this.index < this.shots.length; }
  /** The current shot's title and bars, or null when nothing plays. */
  get frame(): CinematicFrame | null {
    const s = this.shots[this.index];
    return s ? { title: s.title, subtitle: s.subtitle, bars: s.bars !== false } : null;
  }

  /** Play a list (it replaces one that is playing). Resolves when it ends or is skipped. */
  play(shots: Shot[]): Promise<void> {
    this.finish();
    const list = cleanShots(shots);
    if (!list.length) return Promise.resolve();
    this.shots = list; this.index = 0; this.time = 0;
    events.emit('CINEMATIC_STARTED', { shots: list.length });
    return new Promise((resolve) => { this.done = resolve; });
  }

  /** End now (a tap, a key, Restart). */
  skip(): void { this.finish(); }

  /** Move the camera for this frame. player: where the player stands. Returns true while it owns the camera. */
  update(delta: number, camera: THREE.PerspectiveCamera, player: Point): boolean {
    if (!this.active) return false;
    this.camera = camera;
    if (!this.baseFov) this.baseFov = camera.fov;
    this.time += Math.max(0, Math.min(delta, 0.1));
    let s = this.shots[this.index];
    while (s && this.time >= s.seconds) { this.time -= s.seconds; this.index++; s = this.shots[this.index]; }
    if (!s) { this.finish(camera); return false; }
    const t = ease(this.time / s.seconds);
    const at = s.target && s.target !== 'player' ? s.target : player;
    const d = lerp(s.distance, t, 6), h = lerp(s.height, t, 2), a = THREE.MathUtils.degToRad(lerp(s.angle, t, 0));
    camera.position.set(at.x - Math.sin(a) * d, at.y + h, at.z - Math.cos(a) * d);
    camera.lookAt(this.look.set(at.x, at.y + 1, at.z));
    const fov = lerp(s.fov, t, this.baseFov);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return true;
  }

  private finish(camera: THREE.PerspectiveCamera | null = this.camera): void {
    const was = this.shots.length > 0;
    if (camera && this.baseFov && camera.fov !== this.baseFov) { camera.fov = this.baseFov; camera.updateProjectionMatrix(); }
    this.shots = []; this.index = 0; this.time = 0;
    const done = this.done; this.done = null;
    if (was) events.emit('CINEMATIC_ENDED');
    done?.();
  }
}
`;
