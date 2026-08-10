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
    const p = this.player.object.position;
    this.rig.update(p, frameDelta);
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
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)', zIndex: 5 }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Score {s.score}</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 120, height: 10, background: 'rgba(255,255,255,0.25)', borderRadius: 999, overflow: 'hidden' }}>
            {/* health is an ABSOLUTE value, not a percentage — a game with 250 max HP would peg the
                bar at full for the first 150 damage if this divided by 100 instead of maxHealth. */}
            <div style={{ width: \`\${Math.max(0, Math.min(100, (s.health / Math.max(1, s.maxHealth)) * 100))}%\`, height: '100%', background: s.health > s.maxHealth * 0.3 ? '#4ade80' : '#f87171', transition: 'width 160ms ease-out' }} />
          </div>
          <div style={{ fontWeight: 700 }}>x{s.lives}</div>
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

const FILES: Record<string, string> = {
  'src/game/Game.ts': GAME,
  'src/game/GameCanvas.tsx': GAME_CANVAS,
  'src/game/ui/Hud.tsx': HUD,
};

export const GAME_SHELL_MODULES: readonly string[] = ['game', 'gamecanvas', 'hud'];

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
      '- No WebGL on the device gives an honest message, never a blank screen.',
  };
}
