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
import { startMeta, mountMetaToasts, combo } from './core/meta';
import { createRenderer, handleResize } from './three/renderer';
import { applyLighting, followShadow, type LightingPresetName, type AppliedLighting } from './three/lighting';
import { disposeMaterials } from './three/materials';
import { CameraRig, type CameraKind } from './three/camera';
import { watchVehicles, isVehicle } from './three/objects';
import { CharacterController } from './play/character';
import { createHumanoid, type Humanoid } from './three/humanoid';
import { ParticleSystem } from './fx/particles';
import { audio } from './fx/audio';
import { bindGameFeedback } from './fx/feedback';
import { TouchControls, DEFAULT_TOUCH_BUTTONS, type TouchControlsOptions } from './ui/touchControls';

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
  /**
   * 'third-person' (default) for a character on foot; 'chase' for anything driven or ridden — then a game
   * with ONE vehicle given createVehicleState() has it chased from BEHIND from the first frame (on foot it
   * frames the player exactly like 'third-person'; with a rival or a parked car, or a game that reads
   * Use, nothing is guessed — call ctx.follow(car)). Whatever this says, the vehicle the player drives
   * with driveVehicle(…, ctx.input.axis(), …) is chased from behind.
   */
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
  /**
   * Names this game's save (best score, XP, level, achievements, daily streak — meta.ts). Give every
   * game its own id, or two games on one site share one best score.
   */
  gameId?: string;
  /** Rewards unlocked at a level, shown when it is reached: { 3: 'Red car', 5: 'Night track' }. */
  unlocks?: Record<number, string>;
  /**
   * The player's BODY. Default: a jointed human (createHumanoid) that faces where it walks and animates
   * from its real speed. Pass your own Object3D (a character, an animal, a ball), or false for none —
   * first-person games get none by default, since the camera is inside it.
   */
  playerBody?: THREE.Object3D | false;
  /** Shirt colour of the default body, so the hero stands out from the world. */
  playerColor?: number;
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
   * CameraRig.follow(). Pass null to go back to following the player on foot. Call it in setup() for
   * whatever the player drives or rides. A car the player drives with driveVehicle(…, ctx.input.axis(),
   * …) is followed even if you forget (the shell sees it), but a horse or anything you move by hand is
   * only followed when you say so — and once you call this, your choice wins, null included.
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
  /** The game called ctx.follow(): from then on its choice wins, null included. */
  private followChosen = false;
  /**
   * 🔴 THE VEHICLE THE GAME DRIVES, SEEN BY THE SHELL ITSELF (admin 2026-10-11, build 46e2d74b: "car ulti
   * chal rahi hai" — the car showed its HEADLIGHTS and LEFT turned it RIGHT). The camera used to follow
   * a vehicle only when the game remembered ctx.follow(); otherwise render() framed the on-foot player
   * from the rig's resting yaw, which sits IN FRONT of a +Z car — face-on, and face-on the driver's
   * left is the screen's right. The kit's own usage example never called ctx.follow, so following the
   * example produced exactly the admin's game. Now the shell sees it itself:
   *   • the vehicle driveVehicle() moves with the PLAYER's own input (the axis ctx.input.axis() returned)
   *     is chased from behind, with no call at all — that is the player's car, whatever else is driven;
   *   • with camera: 'chase' declared, the ONE vehicle given a state is chased from the very first
   *     frame — a start screen included, before the player has touched anything (Q-864: never when there
   *     are two, or when the game reads Use — then it waits for the player's own car).
   * A car the game drives with its OWN axis (an opponent, a bus crossing the road) never takes the
   * camera from a player on foot. ctx.follow() overrides all of it, and a vehicle that leaves the scene
   * (a respawn builds a new car) hands over to the next one.
   */
  private playerVehicle: THREE.Object3D | null = null;
  private firstVehicle: THREE.Object3D | null = null;
  /**
   * Every vehicle given a state that is NOT the player's — so the camera: 'chase' guess ("the first vehicle")
   * is made only when it cannot be the wrong one (Q-864): exactly one such vehicle in the scene, in a game
   * that does not read the action buttons. A racer whose rival got its state first, or a walk-and-drive game
   * with a parked car, used to have that car chased from the first frame.
   */
  private readonly otherVehicles = new Set<THREE.Object3D>();
  /** Every axis object ctx.input.axis() has handed out — how a driveVehicle() call is known to be the player's. */
  private readonly playerAxes = new WeakSet<object>();
  private setupDone = false;
  /** The default body (createHumanoid), when the game did not bring its own. */
  private hero: Humanoid | null = null;
  private touch: TouchControls | null = null;
  /** The game left the touch layout to us (no buttons, no layout of its own) — so a car gets pedals. */
  private readonly touchLayoutIsOurs: boolean;
  /** True while the GAME's own setup()/update() runs — so a button read by the shell itself does not count. */
  private inGameCode = false;
  /**
   * The game's own code reads one of the action buttons (Attack / Jump / Use / Run). Then the pedals never
   * replace them: an open-world game reads Use to get OUT of the car, and with the 'drive' layout up a
   * phone had no Use button at all — the player was stuck in the car (verifier, 2026-10-11).
   */
  private gameReadsButtons = false;

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
    // camera: 'chase' is the SHELL's job (see \`chased\`): it chases the vehicle from behind. On foot the
    // rig stays third-person — a camera that chases the walker's own heading turns with every step the
    // walker takes relative to it, so S spun the hero on the spot and a joystick held a little off-centre
    // walked it in circles (verifier, 2026-10-11).
    this.rig = new CameraRig({ kind: options.camera === 'chase' ? 'third-person' : (options.camera ?? 'third-person') });
    this.lights = applyLighting(this.scene, this.renderer, options.lighting ?? 'day');
    this.player = new CharacterController();
    this.scene.add(this.player.object);
    // 🔴 THE PLAYER HAS A BODY. The controller is an empty Object3D, and nothing gave it one — so in every
    // third-person game the hero was invisible unless the model happened to add a mesh, and the player
    // saw a camera drifting over the ground. (Found by PLAYING the shell: gamePlaytest.ts.)
    const firstPerson = (options.camera ?? 'third-person') === 'first-person';
    if (options.playerBody) {
      this.player.object.add(options.playerBody);
    } else if (options.playerBody !== false && !firstPerson) {
      this.hero = createHumanoid({ height: 1.75, shirt: options.playerColor ?? 0x2e5a87 });
      this.player.object.add(this.hero.root);
    }
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
    // Remember what the player's input looks like, so driveVehicle(car, s, ctx.input.axis(), dt) names
    // the PLAYER's car (see playerVehicle). Same values, same object — only now it is recognisable.
    const readAxis = this.input.axis.bind(this.input);
    this.input.axis = () => { const a = readAxis(); this.playerAxes.add(a); return a; };
    // And which action buttons the GAME reads (see gameReadsButtons). Same answers as before.
    const buttonActions = new Set(DEFAULT_TOUCH_BUTTONS.map((b) => b.action));
    for (const m of ['isDown', 'wasPressed', 'wasReleased'] as const) {
      const read = this.input[m].bind(this.input);
      this.input[m] = (action: string) => {
        if (this.inGameCode && buttonActions.has(action) && !this.gameReadsButtons) { this.gameReadsButtons = true; this.syncTouchLayout(); }
        return read(action);
      };
    }
    // Most players hold a phone. Without these, a game built for WASD + mouse renders and cannot be played.
    const touchOptions = options.touchControls || {};
    this.touchLayoutIsOurs = !touchOptions.buttons && !touchOptions.layout;
    if (options.touchControls !== false) {
      const touch = new TouchControls(options.container, this.input, touchOptions);
      this.touch = touch;
      this.disposers.push(() => touch.dispose());
    }

    this.disposers.push(handleResize(this.renderer, this.rig.camera, options.container));
    this.disposers.push(bindGameFeedback({
      particles: this.particles,
      feel: this.feel,
      positionOf: (p) => p?.position ?? null,
    }));

    // WHAT BRINGS THE PLAYER BACK: best score that survives a reload, XP + levels, achievements, a daily
    // streak and goals, and the announcements for each (meta.ts). Started here so no game can forget it.
    // Re-started on every construction because dispose() clears the event bus it listens on.
    startMeta({ gameId: options.gameId, unlocks: options.unlocks });
    this.disposers.push(mountMetaToasts(options.container));
    // Taking a hit ends the combo — that is what makes a clean run worth more than a long one.
    this.disposers.push(events.on('PLAYER_DAMAGED', () => combo.break()));

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

    const colliders = this.asGame(() => options.setup?.(this.context)) || [];
    this.setupDone = true;
    this.syncTouchLayout();
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
      follow: (object) => { this.followTarget = object; this.followChosen = true; this.syncTouchLayout(); },
    };
  }

  /** Run the game's own code, listening for the vehicles it drives and the buttons it reads. */
  private asGame<T>(fn: () => T): T {
    this.inGameCode = true;
    try { return watchVehicles((v, axis) => this.noteVehicle(v, axis), fn); } finally { this.inGameCode = false; }
  }

  /** createVehicleState()/driveVehicle() was handed this vehicle inside setup() or update(). */
  private noteVehicle(vehicle: THREE.Object3D, axis: { x: number; y: number } | null): void {
    // The one already chosen stays until it leaves the scene; during setup nothing is in the scene yet.
    const keep = (current: THREE.Object3D | null) => !!current && current !== vehicle && (!this.setupDone || this.inScene(current));
    if (axis && this.playerAxes.has(axis)) {
      if (vehicle !== this.playerVehicle && !keep(this.playerVehicle)) this.playerVehicle = vehicle;
    } else {
      if (this.otherVehicles.size < 64) this.otherVehicles.add(vehicle);
      if (vehicle !== this.firstVehicle && !keep(this.firstVehicle)) this.firstVehicle = vehicle;
    }
    this.syncTouchLayout();
  }

  private inScene(object: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) if (o === this.scene) return true;
    return false;
  }

  /**
   * What the camera chases this frame: the game's own choice (ctx.follow), else the vehicle the player
   * drives, else — only when the game declared camera: 'chase' AND that guess cannot pick the wrong car — the
   * one vehicle it set up; else nothing.
   *
   * The guess stands down (Q-864) when the game reads an action button — a walk-and-drive game reads Use to get
   * in and out, so its player starts on foot beside a PARKED car — or when more than one vehicle in the scene
   * has a state that is not the player's, so a rival given its state first is never chased. Either way the
   * player's own car takes the camera the moment the game drives it with ctx.input.axis().
   */
  private get chased(): THREE.Object3D | null {
    if (this.followChosen) return this.followTarget;
    if (this.playerVehicle && this.inScene(this.playerVehicle)) return this.playerVehicle;
    if (this.options.camera === 'chase' && this.firstVehicle && this.inScene(this.firstVehicle)
      && !this.gameReadsButtons && this.vehiclesInScene() === 1) return this.firstVehicle;
    return null;
  }

  private vehiclesInScene(): number {
    let n = 0;
    for (const v of this.otherVehicles) if (this.inScene(v)) n += 1;
    return n;
  }

  /**
   * A phone in a car gets Left/Right and Brake/Gas instead of a joystick and Attack/Jump/Use/Run — the
   * buttons feed the SAME actions as the arrow keys, so LEFT on the screen is LEFT on the keyboard.
   * Not when the game reads one of those buttons itself: then the joystick (which steers the car just as
   * well) and the buttons stay, because hiding Use would leave the player no way out of the car.
   */
  private syncTouchLayout(): void {
    if (!this.touch || !this.touchLayoutIsOurs) return;
    const chased = this.chased;
    this.touch.setLayout(chased && isVehicle(chased) && !this.gameReadsButtons ? 'drive' : 'move');
  }

  /** FIXED 60Hz. Everything that affects the simulation lives here and nowhere else. */
  private fixedUpdate(delta: number): void {
    this.feel.update(delta);
    combo.update(delta);

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
      if (this.hero) {
        // Face where it walks (every model faces +Z), turning smoothly, and walk at its real speed.
        const v = this.player.velocity;
        const speed = Math.hypot(v.x, v.z);
        if (speed > 0.2) {
          const want = Math.atan2(v.x, v.z);
          let d = want - this.hero.root.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          this.hero.root.rotation.y += d * Math.min(1, delta * 12);
        }
        this.hero.update(delta, speed, this.player.isGrounded);
        // In a vehicle the camera follows the vehicle; a body standing at the spawn point would read as a bug.
        this.hero.root.visible = !this.chased;
      }
      // The shell listens while the game runs, so a vehicle it drives is known without being declared.
      this.asGame(() => this.options.update?.(this.context, delta));
      this.syncTouchLayout();   // back to the joystick if the car has left the scene
      this.particles.update(delta);
    }
    this.input.endFrame();
  }

  /** Display rate. Camera and drawing only — never gameplay. */
  private render(_alpha: number, frameDelta: number): void {
    // Driving or riding: the camera sits behind the VEHICLE's own front, whatever its heading — the one
    // the game named with ctx.follow(), or the one it drives. On foot the player is framed as it always
    // has been (a 'chase' game too: its rig is third-person on foot, see the constructor).
    const chased = this.chased;
    const p = chased ? chased.position : this.player.object.position;
    if (chased) this.rig.follow(chased, frameDelta);
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
    this.hero?.dispose();
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

const HUD = `import { useEffect, useRef, useState } from 'react';
import { events } from '../core/events';
import { state, type GameState } from '../core/state';
import { meta, combo, summaryLines } from '../core/meta';
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
      'LEVEL_STARTED', 'LEVEL_COMPLETED', 'ITEM_COLLECTED', 'COMBO_CHANGED', 'RUN_SUMMARY',
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
  const again = useRef<HTMLButtonElement>(null);
  const over = s.status === 'gameover' || s.status === 'won';

  // ONE TAP TO PLAY AGAIN. The button takes focus the moment the round ends, and Enter, Space or R
  // restart from anywhere. Every extra step between "I lost" and "again" is where a player stops.
  useEffect(() => {
    if (!over) return;
    again.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'r' || e.key === 'R') { e.preventDefault(); game.restart(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [over, game]);

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
        <div style={{ fontWeight: 700, fontSize: 18 }}>
          Score {s.score}
          <span style={{ opacity: 0.7, fontSize: 13, marginLeft: 10 }}>Best {s.highScore}</span>
          {combo.multiplier > 1 ? <span style={{ marginLeft: 10, color: '#fde047' }}>x{combo.multiplier}</span> : null}
        </div>
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

      {over ? (
        <div style={overlay}>
          <div style={{ maxWidth: 420, padding: '0 16px' }}>
            <h2 style={{ fontSize: 30, fontWeight: 800 }}>{s.status === 'won' ? 'You win' : 'Game over'}</h2>
            {/* The run summary: the first line is the hook — a new best, or exactly how close it was. */}
            {(meta.lastSummary ? summaryLines(meta.lastSummary) : ['Score ' + s.score]).map((line, i) => (
              <p key={i} style={i === 0 ? { fontSize: 20, fontWeight: 800, marginTop: 8, color: '#fde047' } : { opacity: 0.88, marginTop: 4 }}>{line}</p>
            ))}
            <button ref={again} style={button} onClick={() => game.restart()}>Play again</button>
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
 *   • A CAR GETS PEDALS ('drive' layout, 2026-10-11): Left/Right under the left thumb, Brake/Gas under
 *     the right, on the same actions as the arrow keys. The game shell switches to it by itself when
 *     the game drives a vehicle — unless the game reads Attack/Jump/Use/Run itself (Use to get out of
 *     the car), when the joystick and those buttons stay.
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

/**
 * 'move': a joystick under the left thumb, camera drag on the right, action buttons bottom-right.
 * 'drive': Left / Right bottom-left and Brake / Gas bottom-right — no joystick, no camera drag (the
 * camera chases the vehicle). The game shell switches to 'drive' by itself the moment the game drives a
 * vehicle, unless the game chose its own buttons or layout, or reads one of the action buttons itself.
 */
export type TouchLayout = 'move' | 'drive';

export interface TouchControlsOptions {
  /** Which buttons to draw, bottom-right. Default: Attack, Jump, Use, Run. */
  buttons?: TouchButton[];
  /** Which set to show. Default 'move'; see TouchLayout. */
  layout?: TouchLayout;
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

/**
 * 🔴 A CAR ON A PHONE (admin 2026-10-11, build 46e2d74b). A driving game used to get Attack/Jump/Use/Run
 * and a joystick, so builders hand-rolled their own Gas/Brake pads — and a hand-rolled pad is one more
 * place to get LEFT backwards. These are the SAME actions the keyboard uses ('left' is A / ArrowLeft,
 * 'up' is W / ArrowUp), so a tap on Left gives exactly the axis.x a press of A gives, and driveVehicle
 * decides what that means. Left/Right sit under the left thumb, Brake/Gas under the right.
 */
export const DRIVE_TOUCH_BUTTONS: { steer: TouchButton[]; pedals: TouchButton[] } = {
  steer: [{ action: 'left', label: 'Left' }, { action: 'right', label: 'Right' }],
  pedals: [{ action: 'down', label: 'Brake' }, { action: 'up', label: 'Gas' }],
};

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
  // The 'drive' layout: two pads in the bottom corners, bigger than the action buttons (a thumb rests
  // on them for the whole race), and the move/look/action set hidden while it is up.
  '.nbg-tc-steer,.nbg-tc-pedals{position:absolute;bottom:max(16px,env(safe-area-inset-bottom));display:none;gap:16px;pointer-events:none}',
  '.nbg-tc-steer{left:max(16px,env(safe-area-inset-left))}',
  '.nbg-tc-pedals{right:max(16px,env(safe-area-inset-right))}',
  '.nbg-tc-steer .nbg-tc-btn,.nbg-tc-pedals .nbg-tc-btn{width:76px;height:76px;border-radius:18px}',
  '.nbg-tc.drive .nbg-tc-steer,.nbg-tc.drive .nbg-tc-pedals{display:flex}',
  '.nbg-tc.drive .nbg-tc-move,.nbg-tc.drive .nbg-tc-look,.nbg-tc.drive .nbg-tc-buttons{display:none}',
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
  private current: TouchLayout = 'move';

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
    for (const b of options.buttons ?? DEFAULT_TOUCH_BUTTONS) this.addButton(buttons, b);
    this.root.appendChild(buttons);

    // The 'drive' pads exist from the start (hidden by CSS) so switching layout is one class, not a rebuild.
    const steer = document.createElement('div');
    steer.className = 'nbg-tc-steer';
    for (const b of DRIVE_TOUCH_BUTTONS.steer) this.addButton(steer, b);
    this.root.appendChild(steer);
    const pedals = document.createElement('div');
    pedals.className = 'nbg-tc-pedals';
    for (const b of DRIVE_TOUCH_BUTTONS.pedals) this.addButton(pedals, b);
    this.root.appendChild(pedals);
    if (options.layout === 'drive') this.setLayout('drive');

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

  /** Which set is up: 'move' (joystick + actions) or 'drive' (Left/Right + Brake/Gas). */
  get layout(): TouchLayout { return this.current; }

  /**
   * Switch sets. Everything held is released first — a thumb that was on the joystick must not keep the
   * car steering after the pads change under it.
   */
  setLayout(layout: TouchLayout): void {
    if (layout === this.current) return;
    this.releaseAll();
    this.current = layout;
    if (layout === 'drive') this.root.classList.add('drive');
    else this.root.classList.remove('drive');
  }

  private addButton(parent: HTMLElement, b: TouchButton): void {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'nbg-tc-btn';
    el.textContent = b.label;
    el.setAttribute('aria-label', b.label);
    this.on(el, 'pointerdown', (e) => this.pressButton(e, b.action, el));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(el, t, (e) => this.releaseButton(e));
    parent.appendChild(el);
  }

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
/**
 * 🧪 THE CONTROLS TEST EVERY 3D GAME SHIPS WITH (Q-843, build 46e2d74b). No game had a behaviour test, so the
 * readiness gate reported "No tests at all" and nothing a test runner could run ever checked that LEFT turns
 * left, W accelerates, or that the camera sits behind the car — the two defects the admin found by playing.
 * It ships beside the shell (the shell is what drives a vehicle), it checks the kit the game drives with, and
 * the recipe declares vitest so it runs (ToolDispatcher.declareVitestForRecipeTests). Proven against the real
 * generated kit in tests/aGameShipsItsControlsTest.test.ts, including that it FAILS on a mirrored kit.
 */
export const GAME_CONTROLS_TEST_PATH = 'src/game/controls.test.ts';
export const GAME_CONTROLS_TEST = `// THE CONTROLS DO WHAT THE KEYS SAY — shipped with every 3D game the NavBharatAI kit builds (Q-843).
// Run it with "npm test" (or "npx vitest run"). It checks the kit your game drives with: W speeds the
// car up and moves it the way its nose points, LEFT turns it to the driver's left, RIGHT to the right, and
// the chase camera sits BEHIND the car, so the player sees its tail lights. If your game moves a vehicle with
// its own code instead of driveVehicle(), copy these checks for that code.
import { describe, it, expect } from 'vitest';
import { createCar, createVehicleState, driveVehicle } from './three/objects';
import { CameraRig } from './three/camera';

const UP = { x: 0, y: -1 };           // up / W, as the runtime's input.axis() reports it
const UP_LEFT = { x: -1, y: -1 };     // up + left / A
const UP_RIGHT = { x: 1, y: -1 };     // up + right / D

function drive(axis: { x: number; y: number }, seconds: number) {
  const car = createCar();
  let state = createVehicleState(car);
  const startSpeed = state.speed;
  for (let i = 0; i < Math.round(seconds * 60); i++) state = driveVehicle(car, state, axis, 1 / 60);
  return { car, state, startSpeed };
}

describe('the controls do what the keys say', () => {
  it('W speeds the car up', () => {
    const { state, startSpeed } = drive(UP, 1);
    expect(state.speed).toBeGreaterThan(startSpeed);
  });

  it('W moves the car the way its nose points (+Z)', () => {
    expect(drive(UP, 1).car.position.z).toBeGreaterThan(0);
  });

  it("LEFT turns the car to the driver's left (+X)", () => {
    expect(drive(UP_LEFT, 1).car.position.x).toBeGreaterThan(0);
  });

  it("RIGHT turns the car to the driver's right (-X)", () => {
    expect(drive(UP_RIGHT, 1).car.position.x).toBeLessThan(0);
  });

  it('the chase camera sits BEHIND the car (tail lights toward the player)', () => {
    // The rig sizes its camera from the window; a test runs without one, so it gets a screen-sized stand-in.
    const g = globalThis as unknown as { window?: { innerWidth: number; innerHeight: number } };
    g.window ??= { innerWidth: 800, innerHeight: 600 };
    const car = createCar();
    createVehicleState(car);
    const rig = new CameraRig({ kind: 'chase' });
    for (let i = 0; i < 120; i++) rig.follow(car, 1 / 60);
    expect(rig.camera.position.z).toBeLessThan(car.position.z);
  });
});
`;

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
  // The shell drives the vehicle, so it carries the test that the vehicle does what the keys say (Q-843).
  if (files['src/game/Game.ts']) files[GAME_CONTROLS_TEST_PATH] = GAME_CONTROLS_TEST;

  return {
    files,
    dependencies: [], // three comes from the 3D layer; react is already the app's
    // 🔒 THE EXAMPLE BELOW IS COMPILED IN CI (tests/aRecipeExampleCompiles.test.ts). It used to pass
    // camera: 'thirdPerson' — not a CameraKind, so it failed tsc (TS2820) — and it never showed a vehicle,
    // so a racing game written from it framed the car from the FRONT (admin 2026-10-11, build 46e2d74b:
    // headlights toward the player, LEFT turning the car RIGHT). Keep it a whole, importable module.
    instructions:
      `Added the game shell (${Object.keys(files).length} files). This COMPOSES the runtime, 3D, ` +
      'controller and VFX layers — render it and you have a running game.\n' +
      '```tsx\n' +
      "import { GameCanvas } from './game/GameCanvas';\n" +
      "import { createTerrain } from './game/three/world';\n" +
      "import { createCar, createRoad, createVehicleState, driveVehicle, ROAD_SURFACE_Y, type VehicleState } from './game/three/objects';\n" +
      '\n' +
      '// ON FOOT: the shell already has a player that walks, jumps and is followed by the camera.\n' +
      'export function AdventureGame() {\n' +
      '  return <GameCanvas options={{\n' +
      "    lighting: 'sunset',\n" +
      "    camera: 'third-person',\n" +
      '    setup: (ctx) => {\n' +
      '      const ground = createTerrain({ size: 120 });\n' +
      '      ctx.scene.add(ground);\n' +
      '      return [ground];            // what the player collides with\n' +
      '    },\n' +
      '    update: (ctx, dt) => {\n' +
      '      // YOUR GAMEPLAY. Fixed 60Hz. Emit events; never call particles or audio directly.\n' +
      '    },\n' +
      '  }} />;\n' +
      '}\n' +
      '\n' +
      '// DRIVING / RIDING: every model faces +Z. driveVehicle owns the control signs, ctx.follow keeps the\n' +
      '// camera BEHIND the car (tail lights toward the player), and a phone gets Left/Right + Brake/Gas.\n' +
      'export function RacingGame() {\n' +
      '  let car: ReturnType<typeof createCar>;\n' +
      '  let drive: VehicleState;\n' +
      '  return <GameCanvas options={{\n' +
      "    camera: 'chase',\n" +
      '    setup: (ctx) => {\n' +
      '      const road = createRoad({ length: 400 });\n' +
      '      car = createCar({ color: 0xb42b2b });\n' +
      '      car.position.y = ROAD_SURFACE_Y;   // wheels ON the asphalt\n' +
      '      ctx.scene.add(road, car);\n' +
      '      drive = createVehicleState(car);   // starts moving, pointing where the model points (+Z)\n' +
      '      ctx.follow(car);                   // the camera sits behind the car through every turn\n' +
      '      return [road];\n' +
      '    },\n' +
      '    update: (ctx, dt) => {\n' +
      '      drive = driveVehicle(car, drive, ctx.input.axis(), dt);   // W forward, LEFT turns left\n' +
      '    },\n' +
      '  }} />;\n' +
      '}\n' +
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
      "- A CAR THE PLAYER DRIVES with driveVehicle(car, state, ctx.input.axis(), dt) is recognised by the\n" +
      "  shell: the camera chases it from BEHIND even if you forget ctx.follow (with camera: 'chase' and a\n" +
      "  single car, from the first frame; with rivals or a parked car, call ctx.follow(car)), and a phone\n" +
      '  gets Left/Right bottom-left and Brake/Gas bottom-right, wired to the\n' +
      '  same actions as the arrow keys (a game that reads Attack/Jump/Use/Run itself — Use to get out of\n' +
      '  the car — keeps the joystick and those buttons instead). Never write your own steering pad or chase\n' +
      '  camera — a hand-written one is how LEFT ends up turning RIGHT.\n' +
      '- No WebGL on the device gives an honest message, never a blank screen.',
  };
}
