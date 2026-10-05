// The game shell — phase 5 of game building, and the one that makes the other four pay off.
//
// Phases 1–4 are four correct toolkits. A game only exists when they are COMPOSED, and composition is
// exactly where a first build goes wrong: the physics ends up in the render callback, the camera damps
// at a fixed step, only one particle layer gets added to the scene, audio is never unlocked, the HUD
// re-renders 60 times a second, and unmounting leaks a WebGL context. Every one of those is invisible
// in review and obvious the moment someone plays it.
//
// So the wiring is not left to be re-derived per build. It is written once, correctly, here.
//
// THE MISTAKES IT MAKES IMPOSSIBLE, each specific and each one a real bug:
//   • PHYSICS IN RENDER. Gameplay in the render callback is frame-rate dependent — the character
//     literally jumps higher on a 144Hz monitor. Gameplay goes in the FIXED update, only interpolation
//     and camera go in render.
//   • REACT STRICTMODE DOUBLE-MOUNT. React 18 mounts twice in development. Without full teardown you
//     get two renderers, two loops and doubled input, and the game runs at double speed — in dev only,
//     which is the most confusing possible place for it to happen.
//   • LEAKED WEBGL CONTEXTS. Browsers cap live contexts (~16). A game route entered and left a few
//     times without renderer.dispose() takes the whole tab down with "too many contexts".
//   • CONTEXT LOSS NEVER HANDLED. A GPU reset or a backgrounded mobile tab fires webglcontextlost; if
//     it is not preventDefault()ed the canvas stays black forever and the game looks crashed.
//   • A HUD DRIVEN BY THE FRAME. Calling setState every frame re-renders React 60 times a second and
//     costs more than the game. The HUD subscribes to CHANGE events instead.
//   • AUDIO NEVER UNLOCKED. Browsers suspend audio until a gesture. Unlocking belongs in the shell,
//     once, not in whatever gameplay file happens to remember.
//
// PURE builder → the caller writes the files.

export interface GameShellResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const GAME = `import * as THREE from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { GameFeel } from './core/feel';
import { events } from './core/events';
import { state, setStatus, resetRun } from './core/state';
import { createRenderer, handleResize } from './three/renderer';
import { applyLighting, followShadow, type LightingPresetName, type AppliedLighting } from './three/lighting';
import { disposeMaterials } from './three/materials';
import { CameraRig, type CameraKind } from './three/camera';
import { CharacterController } from './play/character';
import { ParticleSystem } from './fx/particles';
import { audio } from './fx/audio';
import { bindGameFeedback } from './fx/feedback';
import { TouchControls, type TouchControlsOptions } from './ui/touchControls';

/**
 * THE COMPOSITION ROOT. Everything the other five layers expose is wired together here, in the one
 * order that is correct, so no build has to re-derive it.
 *
 * The split that matters:
 *   fixedUpdate(dt) — gameplay, physics, the character, particles. Constant 60Hz.
 *   render(alpha)   — camera, shake, draw. Whatever the display can manage.
 *
 * Put gameplay in render and the character jumps higher on a 144Hz monitor. Put the camera in the
 * fixed step and it stutters on any display that is not exactly 60Hz. Both look like "bad performance"
 * and neither is.
 */
export interface GameOptions {
  container: HTMLElement;
  lighting?: LightingPresetName;
  camera?: CameraKind;
  shadows?: boolean;
  /** Build the world here: add meshes, return the ones the player collides with. */
  setup?: (ctx: GameContext) => THREE.Object3D[] | void;
  /** Your gameplay. Runs at a FIXED 60Hz. */
  update?: (ctx: GameContext, delta: number) => void;
  /**
   * On-screen joystick + buttons on a touch screen (shown only there). Pass options to choose the
   * buttons, or false ONLY for a game that has its own touch controls — never to "simplify".
   */
  touchControls?: TouchControlsOptions | false;
}

export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  player: CharacterController;
  particles: ParticleSystem;
  feel: GameFeel;
  input: Input;
  lights: AppliedLighting;
  /**
   * Put the camera BEHIND this object (a car, a bike, a horse) and keep it there through every turn —
   * CameraRig.follow(). Pass null to go back to following the player. ANY game where the player drives
   * or rides calls this in setup(): without it the camera sits in FRONT of a +Z-facing vehicle, the
   * player sees its face, and every control feels reversed.
   */
  follow: (object: THREE.Object3D | null) => void;
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  readonly player: CharacterController;
  readonly particles = new ParticleSystem();
  readonly feel = new GameFeel();
  readonly input: Input;
  readonly lights: AppliedLighting;

  private readonly loop: GameLoop;
  private readonly canvas: HTMLCanvasElement;
  private readonly disposers: Array<() => void> = [];
  private readonly options: GameOptions;
  private disposed = false;
  private followTarget: THREE.Object3D | null = null;

  constructor(options: GameOptions) {
    this.options = options;

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    // Without this a drag on the canvas scrolls the page on mobile instead of moving the player.
    this.canvas.style.touchAction = 'none';
    options.container.appendChild(this.canvas);

    this.renderer = createRenderer({ canvas: this.canvas, shadows: options.shadows !== false });
    this.rig = new CameraRig({ kind: options.camera ?? 'third-person' });
    this.lights = applyLighting(this.scene, this.renderer, options.lighting ?? 'day');
    this.player = new CharacterController();
    this.scene.add(this.player.object);
    // BOTH blend layers. Adding one is how half the effects end up invisible.
    this.particles.addTo(this.scene);

    // Input is bound to the CANVAS, not the window, so a game embedded in a page does not swallow the
    // keyboard from the rest of the app — typing WASD in a form field must not move the player.
    // The cost of that choice: a canvas only receives key events while FOCUSED. So it is made focusable
    // and focused on mount and on every pointerdown, otherwise the game silently ignores the keyboard
    // until the player happens to click it, and reads as broken.
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';
    this.canvas.focus({ preventScroll: true });
    const refocus = () => this.canvas.focus({ preventScroll: true });
    this.canvas.addEventListener('pointerdown', refocus);
    this.disposers.push(() => this.canvas.removeEventListener('pointerdown', refocus));
    this.input = new Input(this.canvas);
    // Most players hold a phone. Without these, a game built for WASD + mouse renders and cannot be played.
    if (options.touchControls !== false) {
      const touch = new TouchControls(options.container, this.input, options.touchControls || {});
      this.disposers.push(() => touch.dispose());
    }

    this.disposers.push(handleResize(this.renderer, this.rig.camera, options.container));
    this.disposers.push(bindGameFeedback({
      particles: this.particles,
      feel: this.feel,
      positionOf: (p) => p?.position ?? null,
    }));

    // A GPU reset or a backgrounded mobile tab fires this. Unprevented, the canvas stays black forever
    // and the game looks crashed to the player.
    const onLost = (e: Event) => { e.preventDefault(); this.loop.setPaused(true); };
    const onRestored = () => { this.loop.setPaused(false); };
    this.canvas.addEventListener('webglcontextlost', onLost);
    this.canvas.addEventListener('webglcontextrestored', onRestored);
    this.disposers.push(() => {
      this.canvas.removeEventListener('webglcontextlost', onLost);
      this.canvas.removeEventListener('webglcontextrestored', onRestored);
    });

    // Switching tabs must not leave the game running unheard in the background.
    const onVisibility = () => { if (document.hidden) this.pause(); };
    document.addEventListener('visibilitychange', onVisibility);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // Once, here — not in whichever gameplay file remembers. Browsers suspend audio until a gesture.
    audio.unlock();

    const colliders = options.setup?.(this.context) || [];
    if (Array.isArray(colliders)) {
      this.player.setColliders(colliders);
      this.rig.setCollidables(colliders);
    }

    this.loop = new GameLoop(
      (delta) => this.fixedUpdate(delta),
      (alpha, frameDelta) => this.render(alpha, frameDelta),
    );
  }

  get context(): GameContext {
    return {
      scene: this.scene,
      camera: this.rig.camera,
      renderer: this.renderer,
      player: this.player,
      particles: this.particles,
      feel: this.feel,
      input: this.input,
      lights: this.lights,
      follow: (object) => { this.followTarget = object; },
    };
  }

  /** FIXED 60Hz. Everything that affects the simulation lives here and nowhere else. */
  private fixedUpdate(delta: number): void {
    this.feel.update(delta);

    // Mouse/stick look MUST be consumed here, not in render: endFrame() below zeroes it, and endFrame
    // runs before the next render. Read it there and the camera never turns at all.
    // Deliberately outside the hit-stop freeze — freezing the simulation should not make aiming sticky.
    if (this.input.lookX || this.input.lookY) this.rig.look(this.input.lookX, this.input.lookY);

    // Hit-stop: the simulation freezes for a few frames so a hit lands. Input still ticks, or the
    // press that happened during the freeze is swallowed.
    if (!this.feel.frozen) {
      const axis = this.input.axis();
      this.player.update(
        delta,
        {
          moveX: axis.x,
          moveZ: axis.y,
          sprint: this.input.isDown('sprint'),
          jumpPressed: this.input.wasPressed('jump'),
          jumpHeld: this.input.isDown('jump'),
        },
        this.rig.yaw,
      );
      this.options.update?.(this.context, delta);
      this.particles.update(delta);
    }
    this.input.endFrame();
  }

  /** Display rate. Camera and drawing only — never gameplay. */
  private render(_alpha: number, frameDelta: number): void {
    // Driving or riding: the camera sits behind the VEHICLE's own front, whatever its heading.
    const p = this.followTarget ? this.followTarget.position : this.player.object.position;
    if (this.followTarget) this.rig.follow(this.followTarget, frameDelta);
    else this.rig.update(p, frameDelta);
    // Defaults, NOT small 3D-looking numbers: applyShake already scales the offset into world units
    // (×0.02). Passing 0.35 here would produce a 0.007-unit shake — mathematically present, invisible.
    this.rig.applyShake(this.feel.shake());
    // Shadows follow the player, or they blur out as soon as they walk away on a large map.
    followShadow(this.lights.key, p);
    audio.setListener(p.x, p.y, p.z);
    this.renderer.render(this.scene, this.rig.camera);
  }

  start(): void { if (!this.disposed) { setStatus('playing'); this.loop.start(); } }
  pause(): void { if (state.status === 'playing') { this.loop.setPaused(true); setStatus('paused'); } }
  resume(): void { if (state.status === 'paused') { this.loop.setPaused(false); setStatus('playing'); } }

  restart(): void {
    resetRun();
    this.feel.reset();
    this.player.reset();
    this.loop.setPaused(false);
    setStatus('playing');
  }

  /**
   * TEAR EVERYTHING DOWN. Browsers cap live WebGL contexts at around 16, so a game route entered and
   * left a handful of times without this takes the whole tab down with "too many contexts".
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    for (const off of this.disposers) { try { off(); } catch { /* teardown must never throw */ } }
    this.input.dispose();
    audio.stopAll();
    this.particles.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    disposeMaterials();
    this.renderer.dispose();
    this.canvas.parentElement?.removeChild(this.canvas);
    // This is the GAME's bus (src/game/core/events), not the app's. Clearing it is what stops handlers
    // registered in setup() from stacking up every time the player re-enters the game route — by the
    // third visit every hit would fire three sounds.
    events.clear();
  }
}
`;

const GAME_CANVAS = `import { useEffect, useRef, useState } from 'react';
import { Game, type GameOptions } from './Game';
import { Hud } from './ui/Hud';

/**
 * Mount a Game into React, correctly.
 *
 * REACT 18 STRICTMODE MOUNTS EVERY COMPONENT TWICE IN DEVELOPMENT. Without a complete teardown between
 * the two mounts you get two renderers, two loops and doubled input — the game runs at double speed,
 * in development only, which is the most confusing possible place for a bug to live. The cleanup below
 * is what makes the second mount identical to the first.
 *
 * The effect deliberately depends on NOTHING. A game must not be rebuilt because a parent re-rendered;
 * pass gameplay in through setup/update, which are read once at construction.
 */
export interface GameCanvasProps {
  options?: Omit<GameOptions, 'container'>;
  onReady?: (game: Game) => void;
  className?: string;
  /** Set false to embed the game inside a page layout instead of filling the screen. */
  fullscreen?: boolean;
}

export function GameCanvas({ options, onReady, className = '', fullscreen = true }: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Read once at construction: changing them later must not rebuild the world mid-play.
  const optionsRef = useRef(options);
  const onReadyRef = useRef(onReady);
  optionsRef.current = options;
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let instance: Game | null = null;
    try {
      instance = new Game({ ...(optionsRef.current || {}), container: host });
      instance.start();
      gameRef.current = instance;
      setGame(instance);
      onReadyRef.current?.(instance);
    } catch (err) {
      // A device with no WebGL must see an honest message, not a blank screen.
      setFailed(err instanceof Error ? err.message : 'This device could not start the 3D view.');
    }

    return () => {
      instance?.dispose();
      gameRef.current = null;
      setGame(null);
    };
  }, []);

  const fill = fullscreen ? { position: 'fixed' as const, inset: 0 } : { width: '100%', height: '100%' };

  if (failed) {
    return (
      <div style={{ ...fill, display: 'grid', placeItems: 'center', background: '#111', color: '#eee', padding: 24, textAlign: 'center' }}>
        <div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>This game needs 3D graphics (WebGL).</p>
          <p style={{ opacity: 0.7, fontSize: 14 }}>{failed}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className} style={{ ...fill, overflow: 'hidden', background: '#000' }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      {game ? <Hud game={game} /> : null}
    </div>
  );
}
`;

const HUD = `import { useEffect, useState } from 'react';
import { events } from '../core/events';
import { state, type GameState } from '../core/state';
import type { Game } from '../Game';

/**
 * The HUD, driven by EVENTS rather than by the frame.
 *
 * The obvious implementation subscribes to the loop and calls setState every frame. That re-renders
 * React 60 times a second and costs more than the game itself does — a HUD showing three numbers
 * becomes the reason the game drops frames.
 *
 * A score only changes when the score changes. Subscribing to CHANGE events makes the HUD free.
 */
function useGameState(): GameState {
  const [snapshot, setSnapshot] = useState<GameState>({ ...state });

  useEffect(() => {
    const sync = () => setSnapshot({ ...state });
    const offs = [
      'SCORE_CHANGED', 'PLAYER_DAMAGED', 'PLAYER_HEALED', 'PLAYER_DIED',
      'GAME_STARTED', 'GAME_OVER', 'GAME_WON', 'GAME_PAUSED', 'GAME_RESUMED',
      'LEVEL_STARTED', 'LEVEL_COMPLETED', 'ITEM_COLLECTED',
    ].map((e) => events.on(e, sync));
    sync(); // an event fired between render and subscribe would otherwise be missed
    return () => { for (const off of offs) off(); };
  }, []);

  return snapshot;
}

const overlay: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
  background: 'rgba(0,0,0,0.62)', color: '#fff', textAlign: 'center', zIndex: 10,
};

const button: React.CSSProperties = {
  marginTop: 16, padding: '12px 28px', fontSize: 16, fontWeight: 600, borderRadius: 10,
  border: 'none', background: '#fff', color: '#111', cursor: 'pointer',
  // Big enough to hit with a thumb. A 32px button is a desktop assumption.
  minWidth: 140, minHeight: 48,
};

export function Hud({ game }: { game: Game }) {
  const s = useGameState();

  // Esc pauses. Bound to the window because the player expects it to work wherever focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (s.status === 'playing') game.pause();
      else if (s.status === 'paused') game.resume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, s.status]);

  return (
    <>
      {/* pointerEvents none, or the HUD silently eats clicks meant for the game */}
      <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', left: 'max(12px, env(safe-area-inset-left))', right: 'max(12px, env(safe-area-inset-right))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)', zIndex: 5 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Score {s.score}</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 120, height: 10, background: 'rgba(255,255,255,0.25)', borderRadius: 999, overflow: 'hidden' }}>
            {/* health is an ABSOLUTE value, not a percentage — a game with 250 max HP would peg the
                bar at full for the first 150 damage if this divided by 100 instead of maxHealth. */}
            <div style={{ width: \`\${Math.max(0, Math.min(100, (s.health / Math.max(1, s.maxHealth)) * 100))}%\`, height: '100%', background: s.health > s.maxHealth * 0.3 ? '#4ade80' : '#f87171', transition: 'width 160ms ease-out' }} />
          </div>
          <div style={{ fontWeight: 700 }}>x{s.lives}</div>
          {/* Esc is a keyboard; a phone has none. Without this a player on a phone can never pause. */}
          {s.status === 'playing' ? (
            <button type="button" aria-label="Pause" onClick={() => game.pause()} style={{ pointerEvents: 'auto', width: 44, height: 44, borderRadius: 999, border: '2px solid rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>II</button>
          ) : null}
        </div>
      </div>

      {s.status === 'paused' ? (
        <div style={overlay}>
          <div>
            <h2 style={{ fontSize: 30, fontWeight: 800 }}>Paused</h2>
            <button style={button} onClick={() => game.resume()}>Resume</button>
          </div>
        </div>
      ) : null}

      {s.status === 'gameover' || s.status === 'won' ? (
        <div style={overlay}>
          <div>
            <h2 style={{ fontSize: 30, fontWeight: 800 }}>{s.status === 'won' ? 'You win' : 'Game over'}</h2>
            <p style={{ opacity: 0.85, marginTop: 6 }}>Score {s.score}</p>
            <button style={button} onClick={() => game.restart()}>Play again</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
`;

const TOUCH_CONTROLS = `import type { Input } from '../core/input';

/**
 * ON-SCREEN CONTROLS FOR A TOUCH SCREEN — the difference between a game and a picture of one on a phone.
 *
 * Most people who play what NavBharatAI builds hold a phone. The input layer has always accepted a
 * touch joystick and virtual buttons (setAnalogueMove / setVirtualButton), but nothing DREW them, so a
 * game built for "WASD + mouse" rendered beautifully on a phone and could not be played at all.
 *
 * What this draws, and why each piece is shaped the way it is:
 *   • A JOYSTICK where the left thumb lands (anywhere in the left half), not at one fixed spot a
 *     thumb has to find. Its resting ghost sits in the bottom-left corner so the player knows it exists.
 *   • CAMERA LOOK by dragging anywhere in the right half — the same lookX/lookY a mouse feeds.
 *   • ACTION BUTTONS in the bottom-right corner, 64px (a 44px minimum is a thumb's, not a finger-tip's),
 *     spaced so a thumb pressing one never brushes another.
 *   • MULTI-TOUCH by construction: every control tracks its OWN pointer id, so moving and attacking at
 *     the same time works — the one thing a single-touch implementation always gets wrong.
 *
 * Shown only where it belongs: a device whose PRIMARY pointer is coarse (a phone, a tablet), or the
 * moment a touch lands on a laptop with a touch screen. A desktop with a mouse never sees it.
 * Everything is released on blur / tab hide, or the player keeps running after they come back.
 */
export interface TouchButton {
  /** An Input action name — the same names the keyboard uses ('jump', 'attack', …). */
  action: string;
  label: string;
}

export interface TouchControlsOptions {
  /** Which buttons to draw, bottom-right. Default: Attack, Jump, Use, Run. */
  buttons?: TouchButton[];
  /** Drag in the right half to turn the camera. Default true; set false for a fixed-camera game. */
  look?: boolean;
  /** Camera pixels per finger pixel. Default 1.6 (a thumb covers less ground than a mouse). */
  lookSensitivity?: number;
  /** Show even on a device with no touch screen — for testing on a desktop. */
  force?: boolean;
}

export const DEFAULT_TOUCH_BUTTONS: TouchButton[] = [
  { action: 'attack', label: 'Attack' },
  { action: 'jump', label: 'Jump' },
  { action: 'interact', label: 'Use' },
  { action: 'sprint', label: 'Run' },
];

/** Is the PRIMARY pointer a finger? A touch-screen laptop answers no until it is actually touched. */
export function prefersTouch(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia('(pointer: coarse)').matches;
  return 'ontouchstart' in window;
}

const STICK_RADIUS = 56;
const DEAD_ZONE = 0.15;

const CSS = [
  '.nbg-tc{position:absolute;inset:0;z-index:4;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;display:none}',
  '.nbg-tc.on{display:block}',
  '.nbg-tc *{-webkit-tap-highlight-color:transparent;touch-action:none;box-sizing:border-box}',
  '.nbg-tc-move{position:absolute;left:0;bottom:0;width:50%;height:65%;pointer-events:auto}',
  '.nbg-tc-look{position:absolute;right:0;top:0;width:50%;height:100%;pointer-events:auto}',
  '.nbg-tc-base{position:absolute;width:' + STICK_RADIUS * 2 + 'px;height:' + STICK_RADIUS * 2 + 'px;margin:-' + STICK_RADIUS + 'px 0 0 -' + STICK_RADIUS + 'px;border-radius:50%;background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.35);opacity:0.55;transition:opacity 120ms}',
  '.nbg-tc-base.live{opacity:1}',
  '.nbg-tc-knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:rgba(255,255,255,0.55)}',
  '.nbg-tc-buttons{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(2,64px);gap:14px;pointer-events:none}',
  '.nbg-tc-btn{pointer-events:auto;width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,0.5);background:rgba(0,0,0,0.35);color:#fff;font:600 13px/1 system-ui,sans-serif;display:grid;place-items:center;padding:0}',
  '.nbg-tc-btn.down{background:rgba(255,255,255,0.45);color:#111}',
  '.nbg-tc-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:10px 16px;border-radius:10px;background:rgba(0,0,0,0.6);color:#fff;font:500 14px/1.3 system-ui,sans-serif;text-align:center;pointer-events:none;display:none}',
  '@media (orientation: portrait){.nbg-tc.hinting .nbg-tc-hint{display:block}}',
].join('');

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly detach: Array<() => void> = [];
  private readonly buttonsDown = new Map<number, { action: string; el: HTMLElement }>();
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private shown = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly input: Input,
    private readonly options: TouchControlsOptions = {},
  ) {
    // The overlay is positioned against the game's own container, never the page.
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const style = document.createElement('style');
    style.textContent = CSS;
    this.root = document.createElement('div');
    this.root.className = 'nbg-tc';
    this.root.appendChild(style);

    const look = document.createElement('div');
    look.className = 'nbg-tc-look';
    if (options.look !== false) this.root.appendChild(look);

    const move = document.createElement('div');
    move.className = 'nbg-tc-move';
    this.base = document.createElement('div');
    this.base.className = 'nbg-tc-base';
    this.knob = document.createElement('div');
    this.knob.className = 'nbg-tc-knob';
    this.base.appendChild(this.knob);
    move.appendChild(this.base);
    this.root.appendChild(move);
    this.restStick();

    const buttons = document.createElement('div');
    buttons.className = 'nbg-tc-buttons';
    for (const b of options.buttons ?? DEFAULT_TOUCH_BUTTONS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'nbg-tc-btn';
      el.textContent = b.label;
      el.setAttribute('aria-label', b.label);
      this.on(el, 'pointerdown', (e) => this.pressButton(e, b.action, el));
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(el, t, (e) => this.releaseButton(e));
      buttons.appendChild(el);
    }
    this.root.appendChild(buttons);

    const hint = document.createElement('div');
    hint.className = 'nbg-tc-hint';
    hint.textContent = 'Turn your phone sideways to play';
    this.root.appendChild(hint);

    this.on(move, 'pointerdown', (e) => this.startStick(e, move));
    this.on(move, 'pointermove', (e) => this.moveStick(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(move, t, (e) => this.endStick(e));
    this.on(look, 'pointerdown', (e) => this.startLook(e, look));
    this.on(look, 'pointermove', (e) => this.moveLook(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(look, t, (e) => this.endLook(e));
    // A long press must not open the browser's menu over the game.
    this.on(this.root, 'contextmenu', (e) => e.preventDefault());

    const releaseAll = () => this.releaseAll();
    const onVisibility = () => { if (document.hidden) this.releaseAll(); };
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    this.detach.push(() => window.removeEventListener('blur', releaseAll));
    this.detach.push(() => document.removeEventListener('visibilitychange', onVisibility));

    container.appendChild(this.root);

    if (options.force || prefersTouch()) this.show();
    else {
      // A touch-screen laptop: stay hidden until a finger actually touches the game.
      const onFirstTouch = (e: PointerEvent) => { if (e.pointerType === 'touch') this.show(); };
      container.addEventListener('pointerdown', onFirstTouch, true);
      this.detach.push(() => container.removeEventListener('pointerdown', onFirstTouch, true));
    }
  }

  /** Is the overlay on screen? */
  get visible(): boolean { return this.shown; }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.classList.add('on', 'hinting');
    const t = setTimeout(() => this.root.classList.remove('hinting'), 4000);
    this.detach.push(() => clearTimeout(t));
  }

  private on(el: EventTarget, type: string, fn: (e: PointerEvent) => void): void {
    const h = (e: Event) => fn(e as PointerEvent);
    el.addEventListener(type, h);
    this.detach.push(() => el.removeEventListener(type, h));
  }

  private capture(el: HTMLElement, e: PointerEvent): void {
    // preventDefault on pointerdown also suppresses the compatibility mouse events a browser fires
    // after a tap — without it a tap on Jump would ALSO be read as a click on the game.
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* an old browser simply loses the capture */ }
  }

  private restStick(): void {
    this.base.classList.remove('live');
    this.base.style.left = 'calc(max(16px, env(safe-area-inset-left)) + ' + STICK_RADIUS + 'px)';
    this.base.style.top = 'calc(100% - max(16px, env(safe-area-inset-bottom)) - ' + STICK_RADIUS + 'px)';
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  private startStick(e: PointerEvent, zone: HTMLElement): void {
    if (this.stickId !== -1) return;
    this.capture(zone, e);
    this.stickId = e.pointerId;
    const r = zone.getBoundingClientRect();
    // The joystick appears under the thumb, kept whole inside its zone.
    this.stickX = Math.min(Math.max(e.clientX, r.left + STICK_RADIUS), r.right - STICK_RADIUS);
    this.stickY = Math.min(Math.max(e.clientY, r.top + STICK_RADIUS), r.bottom - STICK_RADIUS);
    this.base.style.left = this.stickX - r.left + 'px';
    this.base.style.top = this.stickY - r.top + 'px';
    this.base.classList.add('live');
    this.moveStick(e);
  }

  private moveStick(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    let dx = e.clientX - this.stickX;
    let dy = e.clientY - this.stickY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) { dx = (dx / len) * STICK_RADIUS; dy = (dy / len) * STICK_RADIUS; }
    this.knob.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    const nx = dx / STICK_RADIUS;
    const ny = dy / STICK_RADIUS;
    // Screen-down is +y, which is exactly what Input.axis() calls "down": no sign flip.
    if (Math.hypot(nx, ny) < DEAD_ZONE) this.input.setAnalogueMove(0, 0);
    else this.input.setAnalogueMove(nx, ny);
  }

  private endStick(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = -1;
    this.input.setAnalogueMove(0, 0);
    this.restStick();
  }

  private startLook(e: PointerEvent, zone: HTMLElement): void {
    if (this.lookId !== -1) return;
    this.capture(zone, e);
    this.lookId = e.pointerId;
    this.lookX = e.clientX;
    this.lookY = e.clientY;
  }

  private moveLook(e: PointerEvent): void {
    if (e.pointerId !== this.lookId) return;
    const k = this.options.lookSensitivity ?? 1.6;
    this.input.lookX += (e.clientX - this.lookX) * k;
    this.input.lookY += (e.clientY - this.lookY) * k;
    this.lookX = e.clientX;
    this.lookY = e.clientY;
  }

  private endLook(e: PointerEvent): void {
    if (e.pointerId === this.lookId) this.lookId = -1;
  }

  private pressButton(e: PointerEvent, action: string, el: HTMLElement): void {
    this.capture(el, e);
    this.buttonsDown.set(e.pointerId, { action, el });
    el.classList.add('down');
    this.input.setVirtualButton(action, true);
  }

  private releaseButton(e: PointerEvent): void {
    const held = this.buttonsDown.get(e.pointerId);
    if (!held) return;
    this.buttonsDown.delete(e.pointerId);
    held.el.classList.remove('down');
    // Another finger may still hold the same action; release it only when none does.
    if (![...this.buttonsDown.values()].some((b) => b.action === held.action)) this.input.setVirtualButton(held.action, false);
  }

  private releaseAll(): void {
    for (const held of this.buttonsDown.values()) { held.el.classList.remove('down'); this.input.setVirtualButton(held.action, false); }
    this.buttonsDown.clear();
    this.stickId = -1;
    this.lookId = -1;
    this.input.setAnalogueMove(0, 0);
    this.restStick();
  }

  dispose(): void {
    this.releaseAll();
    for (const off of this.detach) { try { off(); } catch { /* teardown never throws */ } }
    this.detach.length = 0;
    this.root.parentElement?.removeChild(this.root);
  }
}
`;

const FILES: Record<string, string> = {
  'src/game/Game.ts': GAME,
  'src/game/GameCanvas.tsx': GAME_CANVAS,
  'src/game/ui/Hud.tsx': HUD,
  'src/game/ui/touchControls.ts': TOUCH_CONTROLS,
};

export const GAME_SHELL_MODULES: readonly string[] = ['game', 'gamecanvas', 'hud', 'touchcontrols'];

/**
 * Generate the shell. `gamecanvas` renders the HUD and constructs the Game, so a subset that would not
 * compile is completed. Pure; never throws.
 */
export function generateGameShell(include?: string[]): GameShellResult {
  const wanted = Array.isArray(include) && include.length
    ? new Set(include.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
    : null;

  let files: Record<string, string>;
  if (!wanted) {
    files = { ...FILES };
  } else {
    files = {};
    for (const [path, content] of Object.entries(FILES)) {
      const base = (path.split('/').pop() || '').replace(/\.tsx?$/i, '').toLowerCase();
      if (wanted.has(base)) files[path] = content;
    }
    // GameCanvas constructs Game and renders Hud; Hud imports Game's type. Neither compiles alone.
    if (files['src/game/GameCanvas.tsx'] || files['src/game/ui/Hud.tsx']) {
      files['src/game/Game.ts'] = FILES['src/game/Game.ts'];
    }
    // Game draws the touch controls, so it never ships without them (and they are useless alone).
    if (files['src/game/Game.ts']) files['src/game/ui/touchControls.ts'] = FILES['src/game/ui/touchControls.ts'];
    if (files['src/game/GameCanvas.tsx']) files['src/game/ui/Hud.tsx'] = FILES['src/game/ui/Hud.tsx'];
    if (Object.keys(files).length === 0) files = { ...FILES };
  }

  return {
    files,
    dependencies: [], // three comes from the 3D layer; react is already the app's
    instructions:
      `Added the game shell (${Object.keys(files).length} files). This COMPOSES the runtime, 3D, ` +
      'controller and VFX layers — render it and you have a running game.\n' +
      '```tsx\n' +
      "import { GameCanvas } from './game/GameCanvas';\n" +
      '\n' +
      '<GameCanvas options={{\n' +
      "  lighting: 'sunset',\n" +
      "  camera: 'thirdPerson',\n" +
      '  setup: (ctx) => {\n' +
      '    const ground = createTerrain({ size: 120 });\n' +
      '    ctx.scene.add(ground);\n' +
      '    return [ground];            // what the player collides with\n' +
      '  },\n' +
      '  update: (ctx, dt) => {\n' +
      '    // YOUR GAMEPLAY. Fixed 60Hz. Emit events; never call particles or audio directly.\n' +
      '  },\n' +
      '}} />\n' +
      '```\n' +
      'WHAT THE SHELL ALREADY GUARANTEES — do not re-implement these:\n' +
      '- Gameplay runs at a FIXED 60Hz and the camera at the display rate. Physics in render makes the\n' +
      '  character jump higher on a 144Hz monitor; the camera in the fixed step stutters everywhere else.\n' +
      '- dispose() tears down the renderer, loop, input, audio and geometry. Browsers cap live WebGL\n' +
      '  contexts, so a game route entered a few times without it takes the tab down.\n' +
      '- React StrictMode double-mount is handled; the game is built once and torn down completely.\n' +
      '- WebGL context loss is caught and the game pauses instead of going permanently black.\n' +
      '- The HUD updates on EVENTS, never per frame. Do not add per-frame setState — it costs more than\n' +
      '  the game does.\n' +
      '- Audio is unlocked on the first gesture, and the canvas takes touch without scrolling the page.\n' +
      '- ON A PHONE OR TABLET the shell draws the controls itself: a joystick under the left thumb, camera\n' +
      '  drag on the right, Attack/Jump/Use/Run buttons bottom-right, and a Pause button in the HUD. They\n' +
      '  drive the same Input actions as the keyboard. Choose the buttons with\n' +
      "  touchControls: { buttons: [{ action: 'attack', label: 'Punch' }, …] } — never hand-roll a joystick.\n" +
      '- No WebGL on the device gives an honest message, never a blank screen.',
  };
}
