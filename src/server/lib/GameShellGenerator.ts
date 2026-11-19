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

import { kitTypeContract } from './kitTypeContract';

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
import { settings, type GameSettings } from './core/settings';
import { setGameLanguage, t, type GameLanguage, type StringKey } from './core/strings';
import { showHint } from './core/levels';
import { dialogue } from './core/dialogue';
import { createRenderer, handleResize } from './three/renderer';
import { applyLighting, followShadow, type LightingPresetName, type AppliedLighting } from './three/lighting';
import { disposeMaterials } from './three/materials';
import { groundScene } from './three/surfaces';
import { interactHouseDoor, updateHouseDoors, type DoorOccupant } from './three/buildings';
import { setSceneColliders } from './three/collision';
import { CameraRig, type CameraKind } from './three/camera';
import { watchVehicles, isVehicle, setDriftInput, notePlayerAxis, onVehicleDrift } from './three/objects';
import { CharacterController } from './play/character';
import { createHumanoid, type Humanoid, type HumanoidAction } from './three/humanoid';
import { updateHealthBars } from './three/healthbar';
import { mapMarkers, type MarkerKind } from './three/markers';
import { ParticleSystem } from './fx/particles';
import { audio } from './fx/audio';
import { bindGameFeedback, type FeedbackContext } from './fx/feedback';
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
/** A finger is the main pointer (a phone or a tablet). */
function touchDevice(): boolean {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

export interface GameOptions {
  /** Additional world-space NPC/remote bodies that must block door swings. */
  doorOccupants?: (ctx: GameContext) => readonly DoorOccupant[];
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
  /** Add the world here. Return any extra custom colliders for the player, vehicles and camera. */
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
  /**
   * Which POSE the default body plays when an action button is pressed — so every button is SEEN doing its thing
   * (admin 2026-11-19: "jump, action, fight, fire etc me action ke movement dikhne chahiye"). Default:
   * { attack: 'auto', interact: 'use' } — 'auto' is the gun's recoil when a Weapon fired, a sword sweep when a
   * MeleeWeapon swung, a punch otherwise. Jumps, landings and hits are posed from their events. Add your own
   * actions ({ kick: 'kick', throw: 'throw' }); false turns one off. Poses: punch, swing, fire, kick, throw, jump,
   * land, hit, use. A body of your own (playerBody) is not posed: call its own animation on those presses.
   */
  actionPoses?: Record<string, HumanoidAction | 'auto' | false>;
  /**
   * The START SCREEN the game opens on (admin 2026-11-19 audit: games used to throw the player straight into play).
   * <GameCanvas> shows it by default, with the game's title, a one-line subtitle and the controls for the device in
   * hand; Play starts the round and Settings opens the same settings as the pause menu. Pass false to start playing
   * at once (a game with its own menu calls setStatus('playing') or game.play()). A Game constructed directly (with
   * its own HUD) has none unless this is given, so its start() still begins play at once.
   */
  startScreen?: false | { title?: string; subtitle?: string; controls?: { touch?: string; keyboard?: string } };
  /**
   * How a PHONE holds this game. Default 'landscape': going full screen (the Full screen button, or Play on a phone)
   * also locks the screen sideways where the browser allows it. 'portrait' locks upright; 'any' never locks.
   */
  orientation?: 'landscape' | 'portrait' | 'any';
  /**
   * The language of the game's own screens and buttons (start, pause, settings, game over, touch buttons). Default 'en';
   * 'hi' is Hindi; 'auto' follows the page. For any other language pass strings with every word you need — a key you
   * leave out stays English, never blank.
   */
  language?: GameLanguage | 'auto';
  strings?: Partial<Record<StringKey, string>>;
  /**
   * The aiming cross in the middle of the screen. Default: shown by itself the first time the player's own gun fires
   * (a game with a gun), with a hit marker when a shot lands. true shows it from the start; false never.
   */
  crosshair?: boolean;
  /** The minimap in a corner. Default: shown by itself as soon as something carries a map marker; true always; false never. */
  minimap?: boolean;
  /**
   * The music that follows the game (fx/music.ts: calm on the start screen, action in play, tense for a boss, a sting on a
   * win or a loss; lowered while paused or talking). false = none; a table changes cues, e.g. { GAME_STARTED: 'tense' }.
   */
  music?: false | Partial<Record<string, string | null>>;
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
  /**
   * The default player body (createHumanoid), or null when the game brought its own or is first-person. It already
   * plays the action poses for the buttons (see actionPoses); call ctx.hero.act('kick') yourself for anything else
   * the game does — a throw, a reach, a flinch.
   */
  hero: Humanoid | null;
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
  /** A gun fired / a sword swung during this step — what an 'auto' attack pose becomes. */
  private firedThisStep = false;
  private swungThisStep = false;
  /** The attack button is down or went down this step (read before the game's update). */
  private attackHeldThisStep = false;
  /** The pixel ratio the renderer chose for this device; quality scales DOWN from it, never up. */
  private basePixelRatio = 1;
  /** Look speed from the player's settings. */
  private lookSensitivity = 1;
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
    // The words first: everything built below (touch buttons, hints) reads them.
    setGameLanguage(options.language ?? 'en', options.strings);

    try {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    // Without this a drag on the canvas scrolls the page on mobile instead of moving the player.
    this.canvas.style.touchAction = 'none';
    options.container.appendChild(this.canvas);

    this.renderer = createRenderer({ canvas: this.canvas, shadows: options.shadows !== false });
    this.basePixelRatio = this.renderer.getPixelRatio();
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
    this.input.axis = () => { const a = readAxis(); this.playerAxes.add(a); notePlayerAxis(a); return a; };
    // A drifting car pours tyre smoke where its rear wheels are (driveVehicle reports it).
    this.disposers.push(onVehicleDrift((at) => this.particles.burst('smoke', at.x, at.y, at.z, 0.35)));
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
      music: options.music as FeedbackContext['music'],
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
    // 🎓 The first time ever this game is played, the controls for the device in hand are shown once (core/levels.ts).
    this.disposers.push(events.on('GAME_STARTED', () => { showHint('controls', touchDevice() ? t('controlsTouch') : t('controlsKeyboard'), 5); }));
    // 📱 THE NOTCH: safe-area insets read 0 on an iPhone unless the page asks for viewport-fit=cover. Asked for only
    // while a game is mounted (an ordinary page keeps its own viewport), and put back on dispose.
    const viewport = document.querySelector?.('meta[name="viewport"]') as HTMLMetaElement | null;
    if (viewport && !/viewport-fit/.test(viewport.content)) {
      const before = viewport.content;
      viewport.content = before ? before + ', viewport-fit=cover' : 'width=device-width, initial-scale=1, viewport-fit=cover';
      this.disposers.push(() => { viewport.content = before; });
    }
    const onFullscreen = () => events.emit('FULLSCREEN_CHANGED', { on: this.isFullscreen });
    document.addEventListener('fullscreenchange', onFullscreen);
    this.disposers.push(() => document.removeEventListener('fullscreenchange', onFullscreen));
    // 🔎 NavBharatAI's playtest reads the round through this (score, status) and ends one to prove Play again works.
    // Read-only except endRound, which only does what losing does — harmless in a single-player game.
    const hook = { status: () => state.status, score: () => state.score, endRound: () => { if (state.status === 'playing' || state.status === 'paused') setStatus('gameover'); } };
    if (typeof window !== 'undefined') {
      (window as unknown as { __nbKit?: typeof hook }).__nbKit = hook;
      this.disposers.push(() => {
        const w = window as unknown as { __nbKit?: typeof hook };
        if (w.__nbKit === hook) delete w.__nbKit;
      });
    }
    // ⚙️ THE PLAYER'S SETTINGS, APPLIED — now and on every change from the pause menu.
    this.applySettings(settings.get());
    this.disposers.push(settings.subscribe((s) => this.applySettings(s)));
    // 🎬 THE BODY SHOWS THE ACTION. A shot kicks the arms back on every round (an automatic weapon too), a swing
    // sweeps the arm, a jump throws the arms up and a hit makes the body flinch — whichever code fired the event.
    // Only the PLAYER's shot or swing: no owner or 'player', AND the attack button is pressed or held right now —
    // so an enemy firing the same Weapon class never makes the hero recoil.
    const playersOwn = (payload: unknown): boolean => {
      const owner = (payload as { ownerId?: unknown } | null)?.ownerId;
      return (owner === undefined || owner === 'player') && this.attackHeldThisStep;
    };
    this.disposers.push(events.on('WEAPON_FIRED', (p) => { if (playersOwn(p)) { this.firedThisStep = true; this.heroAct('fire'); } }));
    this.disposers.push(events.on('MELEE_SWING', (p) => { if (playersOwn(p)) { this.swungThisStep = true; this.heroAct('swing'); } }));
    this.disposers.push(events.on('PLAYER_JUMPED', () => this.heroAct('jump')));
    this.disposers.push(events.on('PLAYER_DAMAGED', () => this.heroAct('hit')));

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
    if (Array.isArray(colliders)) setSceneColliders(this.scene, colliders);
    this.rig.setCollisionScene(this.scene);

    this.loop = new GameLoop(
      (delta) => this.fixedUpdate(delta),
      (alpha, frameDelta) => this.render(alpha, frameDelta),
    );

    // THE LOOP FOLLOWS THE STATUS, WHOEVER SETS IT (autopsy 2026-11-17, a published battle royale). The
    // game's own setup() called setStatus('playing') itself, so the HUD showed a running game and hid the
    // Play menu, while start() — the only thing that ran the loop — was never called. Not one frame was
    // drawn: an empty page behind the HUD, every control ignored. Now 'playing' from anywhere runs the loop.
    // ...and UN-PAUSES it: a start screen freezes the world until Play, and a game whose own menu sets 'playing'
    // must not stay frozen behind it.
    const follow = () => { if (!this.disposed && state.status === 'playing') { this.loop.start(); this.loop.setPaused(false); } };
    this.disposers.push(events.on('GAME_STARTED', follow), events.on('GAME_RESUMED', follow));
    follow();
    // One frame now, so the world shows behind the menu instead of an empty page. The loop draws the rest.
    try { this.render(0, 0); } catch { /* the loop reports a render that keeps failing */ }
    } catch (error) {
      // A constructor can fail before its caller receives the instance. Roll back here.
      this.dispose();
      throw error;
    }
  }

  /**
   * ONE context for the game's whole life — the SAME object in setup() and in every update().
   *
   * 🔴 WHY (autopsy 8701aaa1 / 7aa2fe7c / c71e56de, 2026-11-02, admin: "50% vehicles chalti hi nahi hai").
   * This used to be a getter that built a NEW object on every access, so a game that kept its car on the
   * context — "ctx.car = car" or "(ctx as any).vehicleState = drive" in setup(), the most natural thing
   * a builder writes — read undefined in update(). driveVehicle(undefined, …) then threw every frame
   * ("Cannot read properties of undefined (reading 'rotation')" / "(reading 'speed')", 1,419 errors in
   * one playtest) and the car never moved. Whatever a game stores here now survives, and the members are
   * live getters, so nothing on it can go stale either.
   */
  private ctxObject: GameContext | null = null;
  get context(): GameContext {
    if (this.ctxObject) return this.ctxObject;
    const game = this;
    this.ctxObject = {
      get scene() { return game.scene; },
      get camera() { return game.rig.camera; },
      get renderer() { return game.renderer; },
      get player() { return game.player; },
      get particles() { return game.particles; },
      get feel() { return game.feel; },
      get input() { return game.input; },
      get lights() { return game.lights; },
      follow: (object) => { this.followTarget = object; this.followChosen = true; this.syncTouchLayout(); },
      get hero() { return game.hero; },
    };
    return this.ctxObject;
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
    // A gamepad is polled, not heard: read it before anything reads input this step.
    this.input.pollGamepads();
    this.feel.update(delta);
    combo.update(delta);

    // Mouse/stick look MUST be consumed here, not in render: endFrame() below zeroes it, and endFrame
    // runs before the next render. Read it there and the camera never turns at all.
    // Deliberately outside the hit-stop freeze — freezing the simulation should not make aiming sticky.
    if (this.input.lookX || this.input.lookY) this.rig.look(this.input.lookX * this.lookSensitivity, this.input.lookY * this.lookSensitivity);

    // Hit-stop: the simulation freezes for a few frames so a hit lands. Input still ticks, or the
    // press that happened during the freeze is swallowed.
    // While someone is talking the world holds still, and the step after the talk ends is skipped too — the press
    // that closed the dialogue box must not also jump or swing (core/dialogue.ts).
    const talking = dialogue.active || dialogue.takeJustEnded();
    if (!this.feel.frozen && !talking) {
      const doorActor = { feet: this.player.object.getWorldPosition(new THREE.Vector3()), radius: 0.4, height: 1.8 };
      if (!this.chased && this.input.wasPressed('interact')) interactHouseDoor(this.scene, doorActor);
      updateHouseDoors(this.scene, delta, [doorActor, ...(this.options.doorOccupants?.(this.context) ?? [])]);
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
      this.attackHeldThisStep = this.input.isDown('attack') || this.input.wasPressed('attack');
      setDriftInput(this.input.isDown('drift'));
      this.asGame(() => this.options.update?.(this.context, delta));
      this.poseActionButtons();
      // 🔒 NOTHING SINKS: every top-level object (car, NPC, animal, prop, train) is kept on the terrain
      // after the game moved it — the kit enforces it, so no generated game can forget it (2026-11-02).
      groundScene(this.scene);
      this.syncTouchLayout();   // back to the joystick if the car has left the scene
      this.particles.update(delta);
    }
    // During a hit-stop freeze the game did not run, so a press made now is KEPT for the step that does — wiping it
    // here was why a tap sometimes did nothing at all (the freeze follows every shot and every hit).
    this.input.endFrame(this.feel.frozen && !talking);
  }

  /** Play a pose on the default body, if there is one and the player is on foot. */
  private heroAct(pose: HumanoidAction): void {
    if (this.hero && !this.chased) this.hero.act(pose);
  }

  /**
   * Every action button the player pressed this step plays its pose (actionPoses). Runs AFTER the game's update, so
   * an 'auto' attack knows whether that press fired a gun (recoil), swung a sword (sweep) or neither (a punch).
   */
  private poseActionButtons(): void {
    const poses: Record<string, HumanoidAction | 'auto' | false> = { attack: 'auto', interact: 'use', ...(this.options.actionPoses ?? {}) };
    for (const [action, pose] of Object.entries(poses)) {
      if (!pose || !this.input.wasPressed(action)) continue;
      if (pose !== 'auto') { this.heroAct(pose); continue; }
      // The event already posed a shot or a swing this step; only a press that did neither is a punch.
      if (!this.firedThisStep && !this.swungThisStep) this.heroAct('punch');
    }
    this.firedThisStep = false;
    this.swungThisStep = false;
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
    updateHealthBars(this.rig.camera);   // enemy health bars face the camera (three/healthbar.ts)
    this.renderer.render(this.scene, this.rig.camera);
  }

  /**
   * Start the loop. With the start screen (the default) the world is drawn but frozen until the player presses Play
   * (game.play()); with startScreen: false the round begins at once, as before.
   */
  start(): void {
    if (this.disposed) return;
    this.loop.start();
    // No start screen asked for (a Game with its own HUD), or the game's own setup() already began the round.
    if (!this.options.startScreen || state.status === 'playing') { this.loop.setPaused(false); setStatus('playing'); return; }
    this.loop.setPaused(true);
    // The first start screen is already 'menu' (the initial state), so setStatus would announce nothing — and the
    // start-screen music (GAME_MENU) would never begin.
    if (state.status === 'menu') events.emit('GAME_MENU'); else setStatus('menu');
  }
  /** Leave the start screen and begin the round. On a phone it also goes full screen (the tap is the permission). */
  play(): void {
    if (this.disposed || state.status !== 'menu') return;
    audio.unlock();
    if (touchDevice() && !this.isFullscreen) void this.toggleFullscreen();
    this.loop.setPaused(false);
    setStatus('playing');
  }

  /** The game fills the whole screen right now. */
  get isFullscreen(): boolean {
    const d = document as Document & { webkitFullscreenElement?: Element | null };
    return Boolean(document.fullscreenElement || d.webkitFullscreenElement);
  }
  /** The browser lets this page go full screen (an iPhone's Safari does not, for anything but video). */
  get canFullscreen(): boolean {
    const d = document as Document & { webkitFullscreenEnabled?: boolean };
    return Boolean(document.fullscreenEnabled || d.webkitFullscreenEnabled);
  }
  /**
   * Full screen on or off, and on a phone lock the orientation the game is made for (options.orientation). Every
   * step is allowed to fail quietly: a browser that refuses still plays the game in the page.
   */
  async toggleFullscreen(): Promise<void> {
    try {
      if (this.isFullscreen) {
        const d = document as Document & { webkitExitFullscreen?: () => void };
        if (document.exitFullscreen) await document.exitFullscreen(); else d.webkitExitFullscreen?.();
        return;
      }
      const target = (this.options.container.parentElement ?? this.options.container) as HTMLElement & { webkitRequestFullscreen?: () => void };
      if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' }); else target.webkitRequestFullscreen?.();
      const want = this.options.orientation ?? 'landscape';
      const orientation = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
      if (want !== 'any' && orientation?.lock) await orientation.lock(want).catch(() => undefined);
    } catch { /* refused: the game keeps playing in the page */ }
    events.emit('FULLSCREEN_CHANGED', { on: this.isFullscreen });
  }
  /** Back to the start screen (pause menu → Menu, game over → Menu): the run is reset and the world freezes. */
  toMenu(): void {
    if (this.disposed) return;
    resetRun();
    this.feel.reset();
    this.player.reset();
    this.loop.setPaused(true);
    // resetRun() already put the status back to 'menu' WITHOUT announcing it, so setStatus('menu') would say nothing:
    // GAME_MENU (the start-screen music, the race overlay clearing) never happened on Menu.
    if (state.status === 'menu') events.emit('GAME_MENU'); else setStatus('menu');
  }
  /**
   * Where a world point is on screen, in pixels inside the game's box, and whether it is in front of the camera —
   * for anything drawn over the 3D view (damage numbers, a marker, a name tag).
   */
  worldToScreen(p: { x: number; y: number; z: number }): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.rig.camera);
    const box = this.options.container.getBoundingClientRect?.();
    const w = box?.width || window.innerWidth || 1; const h = box?.height || window.innerHeight || 1;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z > -1 && v.z < 1 };
  }

  private boss: { name: string; read: () => number } | null = null;
  /**
   * Show a BOSS bar across the top (name and health), or hide it with null. read returns 0..1 — a Health's fraction.
   *   game.setBossBar('Raavan', () => boss.hp.fraction);   …   game.setBossBar(null);
   */
  setBossBar(name: string | null, read?: () => number): void {
    this.boss = name && read ? { name, read } : null;
    events.emit('BOSS_BAR', { name: this.boss?.name ?? null });
  }
  /** The boss bar now, or null. */
  get bossBar(): { name: string; fraction: number } | null {
    if (!this.boss) return null;
    let f = 0;
    try { f = Math.max(0, Math.min(1, Number(this.boss.read()) || 0)); } catch { f = 0; }
    return { name: this.boss.name, fraction: f };
  }
  /** The crosshair setting the Hud reads. */
  get crosshairOption(): boolean | undefined { return this.options.crosshair; }
  get minimapOption(): boolean | undefined { return this.options.minimap; }

  /**
   * What the minimap draws: where the player (or the vehicle it drives) is, which way the camera looks (screen up),
   * which way the player faces, and every map marker (three/markers.ts).
   */
  mapView(): { x: number; z: number; forward: { x: number; z: number }; facing: number; markers: Array<{ x: number; z: number; kind: MarkerKind }> } {
    const f = new THREE.Vector3();
    this.rig.camera.getWorldDirection(f);
    const flat = Math.hypot(f.x, f.z) || 1;
    const body = this.chased ?? this.player.object;
    const p = body.getWorldPosition(new THREE.Vector3());
    const facing = this.chased ? this.chased.rotation.y : (this.hero?.root.rotation.y ?? 0);
    return { x: p.x, z: p.z, forward: { x: f.x / flat, z: f.z / flat }, facing, markers: mapMarkers() };
  }

  /** What the start screen shows; null when the game has its own. */
  get startScreenInfo(): { title: string; subtitle: string; controls: { touch: string; keyboard: string } } | null {
    const o = this.options.startScreen;
    if (!o) return null;
    return {
      title: o?.title || this.options.gameId || t('ready'),
      subtitle: o?.subtitle || '',
      controls: {
        touch: o?.controls?.touch || t('controlsTouch'),
        keyboard: o?.controls?.keyboard || t('controlsKeyboard'),
      },
    };
  }

  /** Apply the player's settings: sound, picture quality and look speed. */
  private applySettings(s: GameSettings): void {
    audio.setVolume('master', s.muted ? 0 : s.masterVolume);
    audio.setVolume('music', s.musicVolume);
    audio.setVolume('sfx', s.sfxVolume);
    audio.setVolume('ui', s.sfxVolume);
    // Fewer pixels is the biggest single saving on a weak phone; the base ratio already respects the device.
    const scale = s.quality === 'low' ? 0.55 : s.quality === 'medium' ? 0.8 : 1;
    this.renderer.setPixelRatio(Math.max(0.35, this.basePixelRatio * scale));
    this.lookSensitivity = s.lookSensitivity;
  }
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
    // Partial construction is valid here; one broken cleanup must not strand later resources.
    const safe = (release: () => void) => { try { release(); } catch { /* teardown must never throw */ } };
    if (this.loop) safe(() => this.loop.stop());
    for (const off of this.disposers.splice(0).reverse()) safe(off);
    if (this.input) safe(() => this.input.dispose());
    safe(() => audio.stopAll());
    safe(() => this.particles.dispose());
    safe(() => this.hero?.dispose());
    this.scene.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) safe(() => mesh.geometry.dispose());
    });
    safe(() => disposeMaterials());
    if (this.renderer) safe(() => this.renderer.dispose());
    if (this.canvas) safe(() => this.canvas.parentElement?.removeChild(this.canvas));
    // This is the game's bus, not the app's. Remove setup handlers on failed construction too.
    safe(() => events.clear());
  }
}
`;

const GAME_CANVAS = `import { useEffect, useRef, useState } from 'react';
import { Game, type GameOptions } from './Game';
import { Hud } from './ui/Hud';
import { t } from './core/strings';

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
      // The start screen is ON for a GameCanvas game (its Hud draws it); options.startScreen: false turns it off.
      instance = new Game({ startScreen: {}, ...(optionsRef.current || {}), container: host });
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
      <div style={{ ...fill, display: 'grid', placeItems: 'center', background: 'var(--bg, #f6f7fb)', color: 'var(--fg, #17171c)', padding: 24, textAlign: 'center' }}>
        <div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>This game needs 3D graphics (WebGL).</p>
          <p style={{ opacity: 0.7, fontSize: 14 }}>{failed}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className} style={{ ...fill, overflow: 'hidden', background: 'var(--game-bg, #eef1ff)' }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      {/* Building the world takes a moment on a phone: the player sees that it is coming, not a blank screen. */}
      {game ? <Hud game={game} /> : (
        <div role="status" aria-live="polite" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--fg, #17171c)', fontWeight: 600 }}>
          {t('loading') + '…'}
        </div>
      )}
    </div>
  );
}
`;

const HUD = `import { useEffect, useRef, useState } from 'react';
import { events } from '../core/events';
import { state, type GameState } from '../core/state';
import { meta, combo, summaryLines } from '../core/meta';
import type { Game } from '../Game';
import { settings, type GameSettings } from '../core/settings';
import { loading, type LoadingState } from '../core/loading';
import { t } from '../core/strings';
import { lastRaceResults } from '../three/race';
import { levels } from '../core/levels';
import { objectives, type Objective } from '../core/quests';
import { dialogue, type DialogueView } from '../core/dialogue';
import { inventory, type ItemStack } from '../core/inventory';
import { economy, type ShopEntry } from '../core/economy';

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
      'GAME_STARTED', 'GAME_OVER', 'GAME_WON', 'GAME_PAUSED', 'GAME_RESUMED', 'GAME_MENU',
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

const secondary: React.CSSProperties = { ...button, background: 'rgba(255,255,255,0.14)', color: '#fff', border: '2px solid rgba(255,255,255,0.55)' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '10px 0', textAlign: 'left' };
const roundIcon: React.CSSProperties = { pointerEvents: 'auto', width: 44, height: 44, borderRadius: 999, border: '2px solid rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'grid', placeItems: 'center' };

/** The player's settings, live: re-renders when the pause menu (or the game) changes them. */
function useSettings(): GameSettings {
  const [value, setValue] = useState<GameSettings>(settings.get());
  useEffect(() => settings.subscribe(setValue), []);
  return value;
}

/** What is still loading, live (core/loading.ts) — real downloads and builds only. */
function useLoading(): LoadingState {
  const [value, setValue] = useState<LoadingState>(loading.get());
  useEffect(() => events.on('LOADING_PROGRESS', () => setValue(loading.get())), []);
  return value;
}

/** Full screen on or off, live. */
function useFullscreen(game: Game): boolean {
  const [on, setOn] = useState(game.isFullscreen);
  useEffect(() => events.on('FULLSCREEN_CHANGED', () => setOn(game.isFullscreen)), [game]);
  return on;
}

/** The loading bar: a label and a real fraction. Shown only while something is still loading. */
export function LoadingBar({ state: l }: { state: LoadingState }) {
  if (!l.active) return null;
  const pct = Math.round(Math.max(0, Math.min(1, l.fraction)) * 100);
  return (
    <div role="progressbar" aria-label={l.label || t('loading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
      style={{ position: 'absolute', left: '50%', bottom: 'max(24px, env(safe-area-inset-bottom))', transform: 'translateX(-50%)', width: 'min(70vw, 320px)', color: '#fff', textAlign: 'center', zIndex: 12, pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>{(l.label || t('loading')) + ' ' + pct + '%'}</div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.25)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: '#fde047', transition: 'width 160ms ease-out' }} />
      </div>
    </div>
  );
}

/** Four corners pointing out (in) — full screen (leave full screen). */
function FullscreenIcon({ on }: { on: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      {on
        ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
    </svg>
  );
}

/** The player's own weapon event (no owner, or 'player') — an enemy's gun never moves the player's HUD. */
const mine = (p: unknown): boolean => { const o = (p as { ownerId?: unknown } | null)?.ownerId; return o === undefined || o === 'player'; };

interface DamageNumber { id: number; x: number; y: number; text: string; kill: boolean }

/**
 * THE SHOOTER'S HUD (admin 2026-11-19 game-gap audit: crosshair, ammo, hit markers, damage numbers and a boss bar were
 * all missing). Driven by the kit's events, never by the frame: the crosshair appears the first time the player's own
 * gun fires (or always, with options.crosshair), a hit marker flashes when a shot lands, the ammo count follows the
 * Weapon, damage numbers rise from where the enemy was hit, and a boss bar shows while game.setBossBar is set.
 */
export function ShooterOverlay({ game, playing }: { game: Game; playing: boolean }) {
  const forced = game.crosshairOption;
  const [armed, setArmed] = useState(forced === true);
  const [ammo, setAmmo] = useState<{ ammo: number; magazine: number; reloading: boolean } | null>(null);
  const [hit, setHit] = useState<'hit' | 'kill' | null>(null);
  const [numbers, setNumbers] = useState<DamageNumber[]>([]);
  const [boss, setBoss] = useState<{ name: string; fraction: number } | null>(game.bossBar);
  const seq = useRef(0);

  useEffect(() => {
    let hitTimer: ReturnType<typeof setTimeout> | undefined;
    const flash = (kind: 'hit' | 'kill') => { setHit(kind); clearTimeout(hitTimer); hitTimer = setTimeout(() => setHit(null), kind === 'kill' ? 260 : 150); };
    const number = (p: { position?: { x: number; y: number; z: number }; amount?: unknown }, kill: boolean) => {
      if (!p?.position) return;
      const at = game.worldToScreen(p.position);
      if (!at.visible) return;
      const id = ++seq.current;
      const text = kill ? '✖' : typeof p.amount === 'number' ? '-' + Math.round(p.amount) : '';
      if (!text) return;
      setNumbers((list) => [...list.slice(-11), { id, x: at.x, y: at.y, text, kill }]);
      setTimeout(() => setNumbers((list) => list.filter((n) => n.id !== id)), 800);
    };
    const ammoFrom = (p: { ammo?: unknown; magazine?: unknown } | null, reloading: boolean) => {
      if (typeof p?.ammo === 'number' && typeof p?.magazine === 'number') setAmmo({ ammo: p.ammo, magazine: p.magazine, reloading });
    };
    const offs = [
      events.on('WEAPON_FIRED', (p) => { if (!mine(p)) return; if (forced !== false) setArmed(true); ammoFrom(p, false); }),
      events.on('WEAPON_RELOADING', (p) => { if (mine(p)) ammoFrom(p, true); }),
      events.on('WEAPON_RELOADED', (p) => { if (mine(p)) ammoFrom(p, false); }),
      events.on('WEAPON_EMPTY', (p) => { if (mine(p)) ammoFrom(p, false); }),
      events.on('ENEMY_DAMAGED', (p) => { flash('hit'); number(p, false); }),
      events.on('ENEMY_DIED', (p) => { flash('kill'); number(p, true); }),
      events.on('MELEE_HIT', () => flash('hit')),
      events.on('BOSS_BAR', () => setBoss(game.bossBar)),
    ];
    return () => { clearTimeout(hitTimer); for (const off of offs) off(); };
  }, [game, forced]);

  // The boss bar follows the boss's health while it is shown (10 times a second is smooth and cheap).
  useEffect(() => {
    if (!boss) return;
    const timer = setInterval(() => setBoss(game.bossBar), 100);
    return () => clearInterval(timer);
  }, [game, boss !== null]);

  const showCross = playing && armed && forced !== false;
  const crossColour = hit === 'kill' ? '#f87171' : '#fff';
  return (
    <>
      <style>{'@keyframes nbDmg{from{transform:translate(-50%,-50%);opacity:1}to{transform:translate(-50%,-160%);opacity:0}}'}</style>
      {showCross ? (
        <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 28, height: 28, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 6 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke={crossColour} strokeWidth="2" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,.9))' }}>
            <path d="M14 3v6M14 19v6M3 14h6M19 14h6" />
            {hit ? <path d="M7 7l4 4M21 7l-4 4M7 21l4-4M21 21l-4-4" stroke={hit === 'kill' ? '#f87171' : '#fde047'} strokeWidth="2.6" /> : null}
          </svg>
        </div>
      ) : null}
      {numbers.map((n) => (
        <div key={n.id} aria-hidden="true" style={{ position: 'absolute', left: n.x, top: n.y, transform: 'translate(-50%,-50%)', color: n.kill ? '#f87171' : '#fde047', fontWeight: 900, fontSize: n.kill ? 22 : 18, textShadow: '0 1px 3px rgba(0,0,0,.9)', pointerEvents: 'none', zIndex: 6, animation: 'nbDmg 0.8s ease-out forwards' }}>
          {n.text}
        </div>
      ))}
      {playing && ammo ? (
        <div role="status" aria-label={'Ammo ' + ammo.ammo + ' of ' + ammo.magazine} style={{ position: 'absolute', right: 'max(16px, env(safe-area-inset-right))', bottom: 'max(150px, calc(env(safe-area-inset-bottom) + 150px))', color: ammo.ammo === 0 ? '#f87171' : '#fff', fontWeight: 900, fontSize: 26, textShadow: '0 1px 3px rgba(0,0,0,.9)', pointerEvents: 'none', zIndex: 5 }}>
          {ammo.reloading ? '⟳ ' : ''}{ammo.ammo}<span style={{ fontSize: 16, opacity: 0.75 }}> / {ammo.magazine}</span>
        </div>
      ) : null}
      {boss ? (
        <div role="progressbar" aria-label={boss.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(boss.fraction * 100)}
          style={{ position: 'absolute', top: 'max(64px, calc(env(safe-area-inset-top) + 56px))', left: '50%', transform: 'translateX(-50%)', width: 'min(80vw, 520px)', color: '#fff', textAlign: 'center', pointerEvents: 'none', zIndex: 5, textShadow: '0 1px 3px rgba(0,0,0,.9)' }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>{boss.name}</div>
          <div style={{ height: 12, background: 'rgba(0,0,0,0.5)', borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.4)' }}>
            <div style={{ width: Math.round(boss.fraction * 100) + '%', height: '100%', background: '#ef4444', transition: 'width 120ms linear' }} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * THE RACE ON SCREEN (admin 2026-11-19 game-gap audit): a big 3-2-1-GO!, the player's place and time while racing,
 * from three/race.ts's events. The finish's results are listed on the game-over screen.
 */
export function RaceOverlay() {
  const [call, setCall] = useState<string | null>(null);
  const [standing, setStanding] = useState<{ position: number; total: number; time: number; distance: number; finish: number | null } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => { setCall('GO!'); clearTimeout(timer); timer = setTimeout(() => setCall(null), 700); };
    const offs = [
      events.on('RACE_COUNTDOWN', (p: { n?: number }) => { if (p?.n) { setCall(String(p.n)); clearTimeout(timer); } else go(); }),
      events.on('RACE_STARTED', go),
      events.on('RACE_STATUS', (p) => setStanding(p)),
      events.on('GAME_MENU', () => setStanding(null)),
    ];
    return () => { clearTimeout(timer); for (const off of offs) off(); };
  }, []);
  const clock = (sec: number) => Math.floor(sec / 60) + ':' + (sec % 60).toFixed(1).padStart(4, '0');
  return (
    <>
      {call ? <div role="status" aria-live="assertive" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fde047', fontSize: 'min(28vw, 140px)', fontWeight: 900, textShadow: '0 4px 14px rgba(0,0,0,.85)', pointerEvents: 'none', zIndex: 8 }}>{call}</div> : null}
      {standing && standing.total > 1 ? (
        <div aria-label="Race position" style={{ position: 'absolute', top: 'max(56px, calc(env(safe-area-inset-top) + 48px))', left: '50%', transform: 'translateX(-50%)', color: '#fff', fontWeight: 900, fontSize: 22, textShadow: '0 1px 3px rgba(0,0,0,.9)', pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap' }}>
          {'P' + standing.position + '/' + standing.total}
          <span style={{ fontSize: 16, opacity: 0.85, marginLeft: 12 }}>{clock(standing.time)}</span>
          {standing.finish ? <span style={{ fontSize: 14, opacity: 0.75, marginLeft: 12 }}>{(standing.distance / 1000).toFixed(1) + ' / ' + (standing.finish / 1000).toFixed(1) + ' km'}</span> : null}
        </div>
      ) : null}
    </>
  );
}

/** Live level list and progress (core/levels.ts). */
function useLevels(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const offs = ['LEVELS_CHANGED', 'LEVEL_STARTED', 'LEVEL_COMPLETED'].map((e) => events.on(e, bump));
    return () => { for (const off of offs) off(); };
  }, []);
  return tick;
}

/** A first-time hint (showHint in core/levels.ts): shown once per game, then never again. */
export function HintBar() {
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = events.on('HINT', (p: { text?: string; seconds?: number }) => {
      if (!p?.text) return;
      setHint(p.text); clearTimeout(timer);
      timer = setTimeout(() => setHint(null), (p.seconds ?? 4) * 1000);
    });
    return () => { off(); clearTimeout(timer); };
  }, []);
  if (!hint) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: 'absolute', left: '50%', bottom: 'max(120px, calc(env(safe-area-inset-bottom) + 112px))', transform: 'translateX(-50%)', maxWidth: 'min(90vw, 460px)', padding: '10px 16px', borderRadius: 12, background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 15, textAlign: 'center', pointerEvents: 'none', zIndex: 7 }}>
      {hint}
    </div>
  );
}

const starRow = (n: number): string => '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);

/**
 * Where a world point lands on a round minimap of size px showing radius metres around the player, turned so the
 * camera's forward is up. Points beyond the edge are pinned to it (edge: true) — a far goal still points the way.
 */
export function minimapPoint(view: { x: number; z: number; forward: { x: number; z: number } }, p: { x: number; z: number }, radius: number, size: number): { x: number; y: number; edge: boolean } {
  const dx = p.x - view.x, dz = p.z - view.z;
  const fx = view.forward.x, fz = view.forward.z;
  let right = -dx * fz + dz * fx;           // along the camera's right
  let up = dx * fx + dz * fz;               // along the camera's forward
  const d = Math.hypot(right, up);
  const edge = d > radius;
  if (edge) { right = (right / d) * radius; up = (up / d) * radius; }
  const half = size / 2, k = (half - 6) / radius;
  return { x: half + right * k, y: half - up * k, edge };
}

const MARKER_COLOUR: Record<string, string> = { enemy: '#f87171', goal: '#fde047', pickup: '#4ade80', friend: '#60a5fa' };

/** The round minimap: the player's arrow in the middle, markers around it, turning with the camera. */
export function Minimap({ game }: { game: Game }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(game.minimapOption === true);
  useEffect(() => {
    if (game.minimapOption === false) return;
    const size = 128, radius = 60;
    const draw = () => {
      const view = game.mapView();
      if (!visible && view.markers.length > 0) setVisible(true);
      const c = canvas.current?.getContext('2d');
      if (!c) return;
      c.clearRect(0, 0, size, size);
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2; c.stroke();
      for (const m of view.markers) {
        const at = minimapPoint(view, m, radius, size);
        c.fillStyle = MARKER_COLOUR[m.kind] ?? '#fff';
        c.beginPath(); c.arc(at.x, at.y, at.edge ? 3 : 4, 0, Math.PI * 2); c.fill();
      }
      // The player's arrow, pointing where they face (relative to the camera).
      const face = minimapPoint(view, { x: view.x + Math.sin(view.facing), z: view.z + Math.cos(view.facing) }, radius, size);
      const ang = Math.atan2(face.x - size / 2, -(face.y - size / 2));
      c.save(); c.translate(size / 2, size / 2); c.rotate(ang);
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 6); c.lineTo(0, 3); c.lineTo(-6, 6); c.closePath(); c.fill();
      c.restore();
    };
    const timer = setInterval(draw, 100);
    draw();
    return () => clearInterval(timer);
  }, [game, visible]);
  if (game.minimapOption === false || !visible) return null;
  return <canvas ref={canvas} width={128} height={128} aria-label="Minimap" role="img"
    style={{ position: 'absolute', left: 'max(12px, env(safe-area-inset-left))', top: 'max(56px, calc(env(safe-area-inset-top) + 48px))', width: 128, height: 128, pointerEvents: 'none', zIndex: 5 }} />;
}

/** What the player is trying to do (core/quests.ts), with progress — under the score. */
export function ObjectiveList() {
  const [list, setList] = useState<readonly Objective[]>(objectives.list);
  useEffect(() => events.on('OBJECTIVES_CHANGED', () => setList(objectives.list)), []);
  if (list.length === 0) return null;
  return (
    <ul aria-label="Objectives" style={{ position: 'absolute', right: 'max(12px, env(safe-area-inset-right))', top: 'max(64px, calc(env(safe-area-inset-top) + 56px))', listStyle: 'none', margin: 0, padding: '8px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 14, maxWidth: 'min(46vw, 260px)', pointerEvents: 'none', zIndex: 5, textShadow: '0 1px 2px rgba(0,0,0,.8)' }}>
      {list.map((o) => (
        <li key={o.id} style={{ opacity: o.done ? 0.65 : 1, textDecoration: o.done ? 'line-through' : 'none', marginTop: 2 }}>
          {(o.done ? '✓ ' : '• ') + o.text + (o.target > 1 ? ' ' + o.progress + '/' + o.target : '')}
        </li>
      ))}
    </ul>
  );
}


/**
 * The dialogue box: who is speaking, the line, and the choices (1–9 on a keyboard). Tap the box, or Enter / Space / E,
 * for the next line. A choice that needs an item the player lacks is shown, greyed, with what it needs.
 */
export function DialogueBox() {
  const [view, setView] = useState<DialogueView | null>(dialogue.current);
  useEffect(() => {
    const sync = () => setView(dialogue.current);
    const offs = [events.on('DIALOGUE_LINE', sync), events.on('DIALOGUE_ENDED', sync), events.on('INVENTORY_CHANGED', sync)];
    return () => offs.forEach((o) => o());
  }, []);
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (view.choices.length && Number.isInteger(n) && n >= 1 && n <= view.choices.length) { e.preventDefault(); dialogue.choose(n - 1); return; }
      if (!view.choices.length && (e.key === 'Enter' || e.key === ' ' || e.key === 'e' || e.key === 'E')) { e.preventDefault(); dialogue.advance(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);
  if (!view) return null;
  return (
    <div role="dialog" aria-label={view.speaker || t('continue')} onClick={() => { if (!view.choices.length) dialogue.advance(); }}
      style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'max(16px, env(safe-area-inset-bottom))', width: 'min(92vw, 620px)', padding: '14px 18px', borderRadius: 14, background: 'rgba(10,12,20,0.88)', border: '2px solid rgba(255,255,255,0.35)', color: '#fff', zIndex: 8, pointerEvents: 'auto', cursor: view.choices.length ? 'default' : 'pointer' }}>
      {view.speaker ? <div style={{ fontWeight: 800, color: '#fde047', marginBottom: 4 }}>{view.speaker}</div> : null}
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.4 }}>{view.text}</p>
      {view.choices.length ? (
        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          {view.choices.map((c, i) => (
            <button key={i} type="button" disabled={!c.available} onClick={(e) => { e.stopPropagation(); dialogue.choose(i); }}
              style={{ ...secondary, marginTop: 0, minWidth: 0, textAlign: 'left', padding: '8px 12px', fontSize: 15, opacity: c.available ? 1 : 0.5, cursor: c.available ? 'pointer' : 'not-allowed' }}>
              {(i + 1) + '. ' + c.text + (c.needs ? ' (' + t('needs', { name: c.needs }) + ')' : '')}
            </button>
          ))}
        </div>
      ) : <div aria-hidden="true" style={{ textAlign: 'right', opacity: 0.75, fontSize: 13, marginTop: 6 }}>{t('continue') + ' ▶'}</div>}
    </div>
  );
}

/** Re-render on every bag change. */
function useInventory(): ItemStack[] {
  const [items, setItems] = useState<ItemStack[]>(inventory.list);
  useEffect(() => events.on('INVENTORY_CHANGED', () => setItems(inventory.list)), []);
  return items;
}

/** The bag: every item with its icon, name and count; a usable one has a Use button. */
export function InventoryPanel({ onBack }: { onBack: () => void }) {
  const items = useInventory();
  return (
    <div style={{ width: 'min(92vw, 460px)' }}>
      <h2 style={{ fontSize: 26, fontWeight: 800 }}>{t('inventory')}</h2>
      {items.length === 0 ? <p style={{ opacity: 0.8, marginTop: 10 }}>{t('inventoryEmpty')}</p> : (
        <ul aria-label={t('inventory')} style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8, textAlign: 'left' }}>
          {items.map((it) => (
            <li key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.10)' }}>
              <span aria-hidden="true" style={{ fontSize: 26, width: 32, textAlign: 'center' }}>{it.icon}</span>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 700 }}>{it.name}</span>{it.count > 1 ? <span style={{ opacity: 0.8 }}>{' ×' + it.count}</span> : null}
                {it.description ? <span style={{ display: 'block', fontSize: 13, opacity: 0.75 }}>{it.description}</span> : null}
              </span>
              {it.usable ? <button type="button" style={{ ...button, marginTop: 0, minWidth: 0, padding: '6px 14px', fontSize: 14 }} onClick={() => inventory.use(it.id)}>{t('use')}</button> : null}
            </li>
          ))}
        </ul>
      )}
      <button type="button" style={secondary} onClick={onBack}>{t('close')}</button>
    </div>
  );
}


/** Re-render on every coin or shop change. */
function useShop(): { coins: number; list: ShopEntry[] } {
  const read = () => ({ coins: economy.coins, list: economy.list });
  const [v, setV] = useState(read);
  useEffect(() => {
    const sync = () => setV(read());
    const offs = [events.on('COINS_CHANGED', sync), events.on('SHOP_CHANGED', sync)];
    return () => offs.forEach((o) => o());
  }, []);
  return v;
}

/** The coin count — shown wherever the game has a shop. */
export function CoinPill({ coins }: { coins: number }) {
  return <span aria-label={t('coins') + ' ' + coins} style={{ fontWeight: 800, color: '#fde047', whiteSpace: 'nowrap' }}>🪙 {coins}</span>;
}

/**
 * The shop and garage: every item with its price; slot items (a car, a character) are chosen with Use; an upgrade shows its
 * level and the next price; an item the player cannot afford is shown, greyed — the goal to play for.
 */
export function ShopPanel({ onBack }: { onBack: () => void }) {
  const { coins, list } = useShop();
  return (
    <div style={{ width: 'min(92vw, 520px)' }}>
      <h2 style={{ fontSize: 26, fontWeight: 800 }}>{t('shop')} · <CoinPill coins={coins} /></h2>
      <ul aria-label={t('shop')} style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8, textAlign: 'left', maxHeight: '58vh', overflowY: 'auto' }}>
        {list.map((it) => {
          const upgrade = (it.levels ?? 1) > 1;
          // Exactly one of: in use · choose it · bought out · buy (greyed while the coins are short — the goal to play for).
          const choose = it.owned && !!it.slot && !upgrade && !it.inUse;
          const label = it.inUse ? t('equipped') : choose ? t('equip') : it.nextPrice === null ? (upgrade ? t('maxed') : t('owned')) : t('buy') + ' 🪙' + it.nextPrice;
          const disabled = it.inUse || (!choose && (it.nextPrice === null || it.nextPrice > coins));
          const act = () => { if (choose) economy.equip(it.id); else economy.buy(it.id); };
          return (
            <li key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: it.inUse ? 'rgba(253,224,71,0.18)' : 'rgba(255,255,255,0.10)' }}>
              <span aria-hidden="true" style={{ fontSize: 26, width: 32, textAlign: 'center' }}>{it.icon ?? (it.slot === 'car' ? '🚗' : it.kind === 'item' ? '🎁' : upgrade ? '⬆️' : '⭐')}</span>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 700 }}>{it.name}</span>
                {upgrade ? <span style={{ opacity: 0.8, marginLeft: 6 }}>{t('levelShort', { n: it.level }) + '/' + it.levels}</span> : null}
                {it.description ? <span style={{ display: 'block', fontSize: 13, opacity: 0.75 }}>{it.description}</span> : null}
              </span>
              <button type="button" disabled={disabled} onClick={act}
                style={{ ...button, marginTop: 0, minWidth: 0, padding: '6px 12px', fontSize: 14, opacity: disabled && !it.inUse ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}>{label}</button>
            </li>
          );
        })}
      </ul>
      <button type="button" style={secondary} onClick={onBack}>{t('back')}</button>
    </div>
  );
}

/** A bag icon — an icon, so it reads in any language. */
function BagIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8h12l-1 12H7L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

/** A speaker icon, crossed out when muted — an icon, so it reads in any language. */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
    </svg>
  );
}

function Slider({ label, value, min = 0, max = 1, step = 0.05, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label style={row}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.currentTarget.value))} style={{ width: 160, accentColor: '#fde047' }} />
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={row}>
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        style={{ ...secondary, marginTop: 0, minWidth: 84, minHeight: 40, padding: '6px 14px', background: on ? '#fde047' : 'rgba(255,255,255,0.14)', color: on ? '#111' : '#fff' }}>
        {on ? t('on') : t('off')}
      </button>
    </div>
  );
}

/**
 * SETTINGS — every control here is APPLIED at once by the shell (Game.applySettings) and saved on this device:
 * sound (mute, master, music, effects), picture quality, look speed, vibration.
 */
function SettingsPanel({ onBack }: { onBack: () => void }) {
  const s = useSettings();
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus(); }, []);
  return (
    <div style={{ width: 'min(92vw, 380px)', maxHeight: '86dvh', overflowY: 'auto', padding: '8px 4px' }}>
      <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>{t('settings')}</h2>
      <Toggle label={t('sound')} on={!s.muted} onChange={(v) => settings.set({ muted: !v })} />
      <Slider label={t('volume')} value={s.masterVolume} onChange={(v) => settings.set({ masterVolume: v })} />
      <Slider label={t('music')} value={s.musicVolume} onChange={(v) => settings.set({ musicVolume: v })} />
      <Slider label={t('effects')} value={s.sfxVolume} onChange={(v) => settings.set({ sfxVolume: v })} />
      <div style={row}>
        <span>{t('graphics')}</span>
        <div role="radiogroup" aria-label={t('graphicsQuality')} style={{ display: 'flex', gap: 6 }}>
          {(['low', 'medium', 'high'] as const).map((q) => (
            <button key={q} type="button" role="radio" aria-checked={s.quality === q} onClick={() => settings.set({ quality: q })}
              style={{ ...secondary, marginTop: 0, minWidth: 0, minHeight: 40, padding: '6px 10px', background: s.quality === q ? '#fde047' : 'rgba(255,255,255,0.14)', color: s.quality === q ? '#111' : '#fff' }}>
              {q === 'low' ? t('smooth') : q === 'medium' ? t('balanced') : t('sharp')}
            </button>
          ))}
        </div>
      </div>
      <Slider label={t('lookSpeed')} value={s.lookSensitivity} min={0.25} max={3} step={0.25} onChange={(v) => settings.set({ lookSensitivity: v })} />
      <Toggle label={t('vibration')} on={s.vibration} onChange={(v) => settings.set({ vibration: v })} />
      <div style={row}>
        <span>{t('difficulty')}</span>
        <div role="radiogroup" aria-label={t('difficulty')} style={{ display: 'flex', gap: 6 }}>
          {(['easy', 'normal', 'hard'] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={s.difficulty === d} onClick={() => settings.set({ difficulty: d })}
              style={{ ...secondary, marginTop: 0, minWidth: 0, minHeight: 40, padding: '6px 10px', background: s.difficulty === d ? '#fde047' : 'rgba(255,255,255,0.14)', color: s.difficulty === d ? '#111' : '#fff' }}>
              {t(d)}
            </button>
          ))}
        </div>
      </div>
      <button ref={back} type="button" style={button} onClick={onBack}>{t('back')}</button>
    </div>
  );
}

export function Hud({ game }: { game: Game }) {
  const s = useGameState();
  const prefs = useSettings();
  const load = useLoading();
  const fullscreen = useFullscreen(game);
  useLevels();
  const hasLevels = levels.count > 0;
  /** Begin play on the chosen (or current) level — the game builds it on LEVEL_STARTED. */
  const playLevel = (i: number) => { if (hasLevels && !levels.start(i)) return; game.play(); };
  const replayLevel = () => { if (hasLevels) levels.start(levels.index); game.restart(); };
  const nextLevel = () => { if (levels.next()) game.restart(); };
  const [panel, setPanel] = useState<'settings' | 'inventory' | 'shop' | null>(null);
  const bag = useInventory();
  const shop = useShop();
  const again = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const over = s.status === 'gameover' || s.status === 'won';
  const info = game.startScreenInfo;
  const touch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  // A settings panel belongs to the screen it was opened from; leaving that screen closes it.
  useEffect(() => { if (s.status === 'playing') setPanel(null); }, [s.status]);

  // ONE TAP TO PLAY. The Play button takes focus, and Enter or Space starts from anywhere.
  useEffect(() => {
    if (s.status !== 'menu' || panel || !info) return;
    playRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); game.play(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.status, panel, info, game]);

  // ONE TAP TO PLAY AGAIN. The button takes focus the moment the round ends, and Enter, Space or R
  // restart from anywhere. Every extra step between "I lost" and "again" is where a player stops.
  useEffect(() => {
    if (!over || panel) return;
    again.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'r' || e.key === 'R') { e.preventDefault(); game.restart(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [over, panel, game]);

  // Esc pauses (and closes Settings first). Bound to the window because the player expects it to work wherever focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // I opens the bag during play (and closes it again).
      if ((e.key === 'i' || e.key === 'I') && !dialogue.active) {
        if (s.status === 'playing') { game.pause(); setPanel('inventory'); return; }
        if (panel === 'inventory') { setPanel(null); game.resume(); return; }
      }
      if (e.key !== 'Escape') return;
      if (panel === 'inventory') { setPanel(null); game.resume(); return; }
      if (panel) { setPanel(null); return; }
      if (s.status === 'playing') game.pause();
      else if (s.status === 'paused') game.resume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, s.status, panel]);

  const settingsOrScreen = (screen: React.ReactNode) => (
    <div style={overlay}>{panel === 'settings' ? <SettingsPanel onBack={() => setPanel(null)} /> : panel === 'inventory' ? <InventoryPanel onBack={() => { setPanel(null); game.resume(); }} /> : panel === 'shop' ? <ShopPanel onBack={() => setPanel(null)} /> : screen}</div>
  );

  return (
    <>
      {/* pointerEvents none, or the HUD silently eats clicks meant for the game */}
      {s.status !== 'menu' ? (
        <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', left: 'max(12px, env(safe-area-inset-left))', right: 'max(12px, env(safe-area-inset-right))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)', zIndex: 5 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {t('score')} {s.score}
            <span style={{ opacity: 0.7, fontSize: 13, marginLeft: 10 }}>{t('best')} {s.highScore}</span>
            {combo.multiplier > 1 ? <span style={{ marginLeft: 10, color: '#fde047' }}>x{combo.multiplier}</span> : null}
            {economy.ready ? <span style={{ marginLeft: 12, fontSize: 16 }}><CoinPill coins={shop.coins} /></span> : null}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 120, height: 10, background: 'rgba(255,255,255,0.25)', borderRadius: 999, overflow: 'hidden' }}>
              {/* health is an ABSOLUTE value, not a percentage — a game with 250 max HP would peg the
                  bar at full for the first 150 damage if this divided by 100 instead of maxHealth. */}
              <div style={{ width: \`\${Math.max(0, Math.min(100, (s.health / Math.max(1, s.maxHealth)) * 100))}%\`, height: '100%', background: s.health > s.maxHealth * 0.3 ? '#4ade80' : '#f87171', transition: 'width 160ms ease-out' }} />
            </div>
            <div style={{ fontWeight: 700 }}>x{s.lives}</div>
            {game.canFullscreen ? (
              <button type="button" aria-label={fullscreen ? t('exitFullScreen') : t('fullScreen')} onClick={() => { void game.toggleFullscreen(); }} style={roundIcon}>
                <FullscreenIcon on={fullscreen} />
              </button>
            ) : null}
            {/* One tap silences the game — the most-asked-for control on a phone in a quiet room. */}
            <button type="button" aria-label={prefs.muted ? t('soundOn') : t('mute')} aria-pressed={prefs.muted} onClick={() => settings.toggleMute()} style={roundIcon}>
              <SpeakerIcon muted={prefs.muted} />
            </button>
            {/* The bag appears once there is something in it. */}
            {s.status === 'playing' && bag.length > 0 ? (
              <button type="button" aria-label={t('inventory')} onClick={() => { game.pause(); setPanel('inventory'); }} style={roundIcon}><BagIcon /></button>
            ) : null}
            {/* Esc is a keyboard; a phone has none. Without this a player on a phone can never pause. */}
            {s.status === 'playing' ? (
              <button type="button" aria-label={t('pause')} onClick={() => game.pause()} style={roundIcon}>II</button>
            ) : null}
          </div>
        </div>
      ) : null}

      <LoadingBar state={load} />
      {s.status === 'playing' ? <HintBar /> : null}
      {s.status === 'playing' || s.status === 'paused' ? <Minimap game={game} /> : null}
      {s.status === 'playing' || s.status === 'paused' ? <ObjectiveList /> : null}
      <ShooterOverlay game={game} playing={s.status === 'playing'} />
      {s.status === 'playing' ? <DialogueBox /> : null}
      {s.status === 'playing' || s.status === 'paused' ? <RaceOverlay /> : null}

      {s.status === 'menu' && info ? settingsOrScreen(
        <div style={{ maxWidth: 440, padding: '0 16px' }}>
          <h1 style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.1 }}>{info.title}</h1>
          {info.subtitle ? <p style={{ opacity: 0.9, marginTop: 8, fontSize: 17 }}>{info.subtitle}</p> : null}
          <p style={{ opacity: 0.75, marginTop: 12, fontSize: 14 }}>{touch ? info.controls.touch : info.controls.keyboard}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button ref={playRef} type="button" style={button} onClick={() => playLevel(levels.index)}>{t('play')}</button>
            {economy.ready ? <button type="button" style={secondary} onClick={() => setPanel('shop')}>{t('shop')} · 🪙{shop.coins}</button> : null}
            <button type="button" style={secondary} onClick={() => setPanel('settings')}>{t('settings')}</button>
          </div>
          {levels.count > 1 ? (
            <div role="list" aria-label={t('levels')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginTop: 16 }}>
              {levels.list.map((l, i) => {
                const open = levels.isUnlocked(i);
                return (
                  <button key={i} role="listitem" type="button" disabled={!open} aria-label={t('level') + ' ' + (i + 1) + ' ' + l.name + (open ? '' : ' (' + t('locked') + ')')}
                    onClick={() => playLevel(i)}
                    style={{ ...secondary, marginTop: 0, minWidth: 0, padding: '8px 6px', opacity: open ? 1 : 0.45, cursor: open ? 'pointer' : 'not-allowed', outline: i === levels.index ? '2px solid #fde047' : 'none' }}>
                    <div style={{ fontWeight: 800 }}>{open ? i + 1 : '🔒'}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{l.name}</div>
                    <div aria-hidden="true" style={{ fontSize: 12, color: '#fde047' }}>{starRow(levels.stars(i))}</div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>,
      ) : null}

      {s.status === 'paused' ? settingsOrScreen(
        <div>
          <h2 style={{ fontSize: 30, fontWeight: 800 }}>{t('paused')}</h2>
          <div style={{ display: 'grid', gap: 0, justifyItems: 'center' }}>
            <button type="button" style={button} onClick={() => game.resume()}>{t('resume')}</button>
            <button type="button" style={secondary} onClick={() => game.restart()}>{t('restart')}</button>
            <button type="button" style={secondary} onClick={() => setPanel('settings')}>{t('settings')}</button>
            {info ? <button type="button" style={secondary} onClick={() => game.toMenu()}>{t('menu')}</button> : null}
          </div>
        </div>,
      ) : null}

      {over ? settingsOrScreen(
        <div style={{ maxWidth: 420, padding: '0 16px' }}>
          <h2 style={{ fontSize: 30, fontWeight: 800 }}>{s.status === 'won' ? (hasLevels ? t('levelComplete') : t('youWin')) : t('gameOver')}</h2>
          {s.status === 'won' && hasLevels ? <p aria-label={levels.stars(levels.index) + ' / 3'} style={{ fontSize: 28, color: '#fde047', marginTop: 4 }}>{starRow(levels.stars(levels.index))}</p> : null}
          {/* The run summary: the first line is the hook — a new best, or exactly how close it was. */}
          {lastRaceResults ? (
            <ol aria-label="Race results" style={{ textAlign: 'left', margin: '12px auto 0', maxWidth: 280, paddingLeft: 24 }}>
              {lastRaceResults.map((r, i) => (
                <li key={i} style={{ fontWeight: r.player ? 900 : 500, color: r.player ? '#fde047' : '#fff', marginTop: 2 }}>
                  {r.name + ' — ' + (r.time === null ? 'DNF' : Math.floor(r.time / 60) + ':' + (r.time % 60).toFixed(1).padStart(4, '0'))}
                </li>
              ))}
            </ol>
          ) : (meta.lastSummary ? summaryLines(meta.lastSummary) : [t('score') + ' ' + s.score]).map((line, i) => (
            <p key={i} style={i === 0 ? { fontSize: 20, fontWeight: 800, marginTop: 8, color: '#fde047' } : { opacity: 0.88, marginTop: 4 }}>{line}</p>
          ))}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {s.status === 'won' && hasLevels && levels.hasNext ? <button type="button" style={button} onClick={nextLevel}>{t('nextLevel')}</button> : null}
            <button ref={again} type="button" style={s.status === 'won' && hasLevels && levels.hasNext ? secondary : button} onClick={replayLevel}>{t('playAgain')}</button>
            {economy.ready ? <button type="button" style={secondary} onClick={() => setPanel('shop')}>{t('shop')} · 🪙{shop.coins}</button> : null}
            {info ? <button type="button" style={secondary} onClick={() => game.toMenu()}>{t('menu')}</button> : null}
          </div>
        </div>,
      ) : null}
    </>
  );
}
`;

const TOUCH_CONTROLS = `import type { Input } from '../core/input';
import { t, type StringKey } from '../core/strings';

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

/** The kit's own button labels and the word each one is in the game's language (core/strings.ts). */
const KIT_LABEL_KEYS: Record<string, StringKey> = {
  Attack: 'attack', Jump: 'jump', Use: 'use', Run: 'run', Left: 'left', Right: 'right', Brake: 'brake', Drift: 'drift', Gas: 'gas',
};

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
  pedals: [{ action: 'down', label: 'Brake' }, { action: 'drift', label: 'Drift' }, { action: 'up', label: 'Gas' }],
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
  '.nbg-tc-knob{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;background:rgba(255,255,255,0.55)}',
  '.nbg-tc-buttons{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(2,64px);gap:16px;pointer-events:none}',
  '.nbg-tc-btn{pointer-events:auto;width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,0.5);background:rgba(0,0,0,0.35);color:#fff;font:600 13px/1 system-ui,sans-serif;display:grid;place-items:center;padding:0}',
  '.nbg-tc-btn.down{background:rgba(255,255,255,0.45);color:#111}',
  '.nbg-tc-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 16px;border-radius:10px;background:rgba(0,0,0,0.6);color:#fff;font:500 14px/1.3 system-ui,sans-serif;text-align:center;pointer-events:none;display:none}',
  '@media (orientation: portrait){.nbg-tc.hinting .nbg-tc-hint{display:block}}',
  // The 'drive' layout: two pads in the bottom corners, bigger than the action buttons (a thumb rests
  // on them for the whole race), and the move/look/action set hidden while it is up.
  '.nbg-tc-steer,.nbg-tc-pedals{position:absolute;bottom:max(16px,env(safe-area-inset-bottom));display:none;gap:16px;pointer-events:none}',
  '.nbg-tc-steer{left:max(16px,env(safe-area-inset-left))}',
  '.nbg-tc-pedals{right:max(16px,env(safe-area-inset-right))}',
  '.nbg-tc-steer .nbg-tc-btn,.nbg-tc-pedals .nbg-tc-btn{width:76px;height:76px;border-radius:18px}',
  '.nbg-tc.drive .nbg-tc-steer,.nbg-tc.drive .nbg-tc-pedals{display:flex}',
  // Drift rides ABOVE Brake/Gas as a wide strip, so the pedal row stays two buttons wide on a 360 px phone.
  '.nbg-tc.drive .nbg-tc-pedals{display:grid;grid-template-columns:76px 76px;gap:12px 16px}',
  '.nbg-tc-pedals .nbg-tc-btn[data-action="drift"]{grid-column:1/span 2;grid-row:1;width:auto;height:46px}',
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
    hint.textContent = t('rotateHint');
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
    el.setAttribute('data-action', b.action);
    // The kit's own labels follow the game's language; a label the game chose is shown as it wrote it.
    const label = KIT_LABEL_KEYS[b.label] ? t(KIT_LABEL_KEYS[b.label]) : b.label;
    el.textContent = label;
    el.setAttribute('aria-label', label);
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

const RACING_ROAD_GAME = `import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Game } from './Game';
import { events } from './core/events';
import { state } from './core/state';
import { createCar, createTrackStream, createVehicleState, driveVehicle, RACING_ROAD_MAPS, type TrackPlan, type TrackStream, type VehicleState } from './three/objects';
import { createRace, type Race } from './three/race';

/** Original racing starter. New plan identity restarts the game (all settings apply).
 * Keep plan identity stable for ordinary rerenders; onReady exposes seamless live setPlan. */
export function RacingRoadGame({ plan, onReady, opponents = 3, finishKm = null }: {
  plan?: TrackPlan; onReady?: (stream: TrackStream) => void;
  /** Rival cars on the road (0 to 7); 0 is a solo drive. */
  opponents?: number;
  /** A finish line this many km from the start; null (default) keeps the endless road endless. */
  finishKm?: number | null;
} = {}) {
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const live = useRef<Game | null>(null);
  const config = useRef({ plan, onReady });
  config.current = { plan, onReady };
  const [failure, setFailure] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [call, setCall] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current) return;
    setFailure(null);
    let game: Game | null = null, stream: TrackStream | null = null;
    let car: ReturnType<typeof createCar> | undefined, drive: VehicleState, race: Race | null = null;
    // 3-2-1-GO! big in the middle; GO! clears itself.
    let callTimer: ReturnType<typeof setTimeout> | undefined;
    const offCount = events.on('RACE_COUNTDOWN', (p: { n?: number }) => {
      setCall(p?.n ? String(p.n) : 'GO!'); clearTimeout(callTimer);
      if (!p?.n) callTimer = setTimeout(() => setCall(null), 700);
    });
    const offGo = events.on('RACE_STARTED', () => { setCall('GO!'); clearTimeout(callTimer); callTimer = setTimeout(() => setCall(null), 700); });
    let lastMap = -1, hudTime = 0;
    const skies = [0x9bcde6, 0xb8d9dc, 0x9dc3b9, 0xa9bfdf, 0xb7c4cf, 0x83b3b1,
      0xb6b9c3, 0x8da4ba, 0x8dd5df, 0xf2d6a2, 0x5d7a52, 0x10162f];
    const syncPause = () => setPaused(state.status === 'paused');
    const offs = ['GAME_PAUSED', 'GAME_RESUMED', 'GAME_STARTED'].map(event => events.on(event, syncPause));
    let released = false;
    const release = () => {
      if (released) return; released = true;
      for (const off of offs) off();
      offCount(); offGo(); clearTimeout(callTimer);
      race?.dispose(); stream?.dispose(); car?.userData.disposeOwnedMaterials?.(); game?.dispose();
    };
    try {
      game = new Game({ container: host.current, camera: 'chase', playerBody: false, gameId: 'road-library',
        setup: (ctx) => {
          stream = createTrackStream(config.current.plan, { detail: 'lite' });
          car = createCar({ color: 0xb42b2b, detail: 'lite' });
          car.position.set(stream.startPose.x, stream.startPose.y, stream.startPose.z);
          car.rotation.y = stream.startPose.heading;
          drive = createVehicleState(car);
          ctx.scene.add(stream.root, car); ctx.follow(car);
          race = createRace(ctx.scene, { stream, opponents, finishDistance: finishKm != null && finishKm > 0 ? finishKm * 1000 : null });
        },
        update: (ctx, dt) => {
          if (!stream || !car) return;
          // Held at the line through the countdown; the car keeps its starting speed for the moment GO comes.
          if (!race || race.canDrive()) drive = driveVehicle(car, drive, ctx.input.axis(), dt);
          const status = stream.update(car);
          const standing = race?.update(dt, status.distance);
          if (status.rebased) { const p = ctx.player.object.position.clone().sub(status.rebased); ctx.player.reset(p.x, p.y, p.z); ctx.camera.position.sub(status.rebased); }
          const piece = status.segment?.piece;
          const id = piece?.mapId ?? 0, map = RACING_ROAD_MAPS[id - 1];
          if (id !== lastMap) {
            lastMap = id;
            ctx.scene.background = new THREE.Color(skies[id - 1] ?? skies[0]);
            ctx.scene.fog = new THREE.Fog(skies[id - 1] ?? skies[0], 70, 450);
            ctx.lights.key.intensity = map?.lighting === 'night' ? 0.6 : 2.2;
            ctx.lights.hemisphere.intensity = map?.lighting === 'night' ? 0.6 : 1;
            ctx.lights.ambient.intensity = map?.lighting === 'night' ? 0.35 : 0.2;
          }
          hudTime += dt;
          if (hud.current && hudTime >= 0.2) {
            hudTime = 0;
            const km = ((piece?.mapOffsetMetres ?? 0) + status.distance - (status.segment?.startDistance ?? 0)) / 1000;
            const place = standing && standing.total > 1 ? 'P' + standing.position + '/' + standing.total + ' · ' : '';
            const clock = standing ? Math.floor(standing.time / 60) + ':' + (standing.time % 60).toFixed(1).padStart(4, '0') + ' · ' : '';
            hud.current.textContent = place + clock + (map ? String(id).padStart(2, '0') + '/12 · ' + map.name : piece?.name ?? 'Custom course') + ' · ' + km.toFixed(1) + '/' + ((piece?.mapLengthMetres ?? status.segment?.length ?? 0) / 1000).toFixed(1) + ' km · Loop ' + (status.lap + 1) + ' · ' + Math.round(Math.abs(drive.speed) * 3.6) + ' km/h';
          }
        },
      });
      live.current = game; game.start();
      const ready = () => { if (stream) config.current.onReady?.(stream); }; ready();
    } catch (error) {
      release();
      setFailure(error instanceof Error ? error.message : 'This device could not start the 3D road.');
    }
    return () => { live.current = null; release(); };
  }, [plan, opponents, finishKm]);
  return <div style={{ position: 'relative', width: '100%', height: '100dvh', minHeight: 320, background: '#10162f' }}>
    <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    <div style={{ position: 'absolute', left: 16, top: 16, color: 'white', background: '#10162fcc', padding: 12, borderRadius: 12, pointerEvents: 'none' }}>
      <div ref={hud}>01/12 · Highway Straight · 0/10 km · Loop 1</div>
      <small>W/S or arrows: gas/brake · A/D: steer · Touch controls on phones</small>
    </div>
    <button type="button" style={{ position: 'absolute', right: 16, top: 16 }} onClick={() => {
      if (!live.current) return;
      if (state.status === 'paused') {
        live.current.resume();
        // Keyboard input belongs to the canvas; activating this button moved focus away.
        host.current?.querySelector('canvas')?.focus({ preventScroll: true });
      } else live.current.pause();
    }}>{paused ? 'Resume' : 'Pause'}</button>
    {call && <div role="status" aria-live="assertive" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fde047', fontSize: 96, fontWeight: 900, textShadow: '0 4px 12px rgba(0,0,0,.8)', pointerEvents: 'none' }}>{call}</div>}
    {failure && <div role="alert" style={{ position: 'absolute', top: '40%', padding: 24, color: 'white' }}>{failure}</div>}
  </div>;
}
`;

const FILES: Record<string, string> = {
  'src/game/Game.ts': GAME,
  'src/game/RacingRoadGame.tsx': RACING_ROAD_GAME,
  'src/game/GameCanvas.tsx': GAME_CANVAS,
  'src/game/ui/Hud.tsx': HUD,
  'src/game/ui/touchControls.ts': TOUCH_CONTROLS,
};

export const GAME_SHELL_MODULES: readonly string[] = ['game', 'gamecanvas', 'hud', 'touchcontrols', 'racingroadgame'];

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
    if (files['src/game/GameCanvas.tsx'] || files['src/game/ui/Hud.tsx'] || files['src/game/RacingRoadGame.tsx']) {
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
      'For racing without a specified course, render <RacingRoadGame /> from ./game/RacingRoadGame: it actually runs the 12-map 10–100 km looping library, HUD, touch driving, distinct sky themes and pause/resume. Custom routes still use your own setup.\n' +
      // 🔴 THE TYPES FIRST, AND FIRST ON PURPOSE (Q-909, autopsy 50378049). The example below touches
      // three of GameContext's nine members, so for the rest the reported build GUESSED — ctx.canvas,
      // ctx.followTarget (both private fields of Game) and ctx.crosshairTarget (nothing at all) — and
      // paid four read_file slices of Game.ts to find out. It also passed TouchButton as a string.
      // The block is extracted from the files just written, so it cannot drift from them, and it sits
      // ABOVE the example because the handoff clips a recipe's instructions at HANDOFF_RECIPE_CHARS
      // (gameKitSeed.ts) — a contract at the bottom is a contract the builder may never see.
      `${kitTypeContract(files)}\n` +
      '```tsx\n' +
      "import { GameCanvas } from './game/GameCanvas';\n" +
      "import { RacingRoadGame } from './game/RacingRoadGame';\n" +
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
      '      return [ground];            // extra colliders share the same scene physics\n' +
      '    },\n' +
      '    update: (ctx, dt) => {\n' +
      '      // YOUR GAMEPLAY. Fixed 60Hz. Emit events; never call particles or audio directly.\n' +
      '    },\n' +
      '  }} />;\n' +
      '}\n' +
      '\n' +
      '// DRIVING / RIDING: every model faces +Z. driveVehicle owns the control signs, ctx.follow keeps the\n' +
      '// camera BEHIND the car (tail lights toward the player), and a phone gets Left/Right + Brake/Gas.\n' +
      '// No custom road requested: use the ready-made twelve-map library.\n' +
      'export function RacingGame() { return <RacingRoadGame />; }\n' +
      '// A user-requested custom road stays custom.\n' +
      'export function CustomDrivingGame() {\n' +
      '  let car: ReturnType<typeof createCar>;\n' +
      '  let drive: VehicleState;\n' +
      '  return <GameCanvas options={{\n' +
      "    camera: 'chase',\n" +
      '    setup: (ctx) => {\n' +
      '      const road = createRoad({ length: 400 });\n' +
      '      car = createCar({ color: 0xb42b2b });\n' +
      '      car.rotation.y = Math.PI;       // local +Z nose faces world -Z, into the screen\n' +
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
