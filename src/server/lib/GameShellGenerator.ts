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
import { GAME_PLAYER_BODY, GAME_PLAYER_BODY_PATH } from './GamePlayerBodyGenerator';
import { GAME_ACTIONS, GAME_ACTIONS_PATH } from './GameActionsGenerator';
import { GAME_AIM, GAME_AIM_PATH } from './GameAimGenerator';
import { GAME_BOUNDARY, GAME_BOUNDARY_PATH } from './GameBoundaryGenerator';
import { RACE_CUSTOM, RACE_CUSTOM_PATH } from './GameRaceCustomGenerator';

export interface GameShellResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const GAME = `import * as THREE from 'three';
import { GameLoop } from './core/loop';
import { Input, PLAYER1_ACTIONS, PLAYER2_ACTIONS, type ActionMap } from './core/input';
import { loadKeyBindings } from './core/keybinds';
import { GameFeel } from './core/feel';
import { events } from './core/events';
import { state, setStatus, resetRun, save as saveState, load as loadState, hasSave, clearSave } from './core/state';
import { startMeta, mountMetaToasts, combo } from './core/meta';
import { settings, type GameSettings } from './core/settings';
import { createPerfGovernor, steppedQuality, budgetDevice } from './core/perf';
import { setGameLanguage, t, type GameLanguage, type StringKey } from './core/strings';
import { showHint } from './core/levels';
import { dialogue } from './core/dialogue';
import { powerUps } from './core/powerups';
import { leaderboard } from './core/leaderboard';
import { createRenderer, handleResize } from './three/renderer';
import { applyLighting, followShadow, type LightingPresetName, type AppliedLighting } from './three/lighting';
import { disposeMaterials } from './three/materials';
import { groundScene, softwareRenderer } from './three/surfaces';
import { interactHouseDoor, updateHouseDoors, updateIndoorCamera, type DoorOccupant } from './three/buildings';
import { setSceneColliders } from './three/collision';
import { CameraRig, type CameraKind } from './three/camera';
import { watchVehicles, isVehicle, setDriftInput, notePlayerAxis, onVehicleDrift, onVehicleCrash, createVehicleState, driveVehicle, type VehicleState } from './three/objects';
import { CharacterController } from './play/character';
import { createHumanoid, type Humanoid, type HumanoidAction, type HumanoidOptions } from './three/humanoid';
import { applyPlayerChoice, resolvePlayerChoice, findBones, playerModelRoot, type PlayerBody, type PlayerChoice } from './play/playerBody';
import { updateActions } from './play/actions';
import { aimFrom, type AimResult } from './play/aim';
import { WorldBoundary, type WorldBounds, type BoundaryOptions } from './play/boundary';
import { updateHealthBars } from './three/healthbar';
import { mapMarkers, type MarkerKind } from './three/markers';
import { renderSplit } from './three/splitscreen';
import { ParticleSystem } from './fx/particles';
import { updateBreakables, clearBreakables } from './three/breakable';
import { audio } from './fx/audio';
import { bindGameFeedback, type FeedbackContext } from './fx/feedback';
// NavBharatAI's recorded sounds when this game was seeded with them; otherwise a stand-in that keeps built-in voices.
import { loadSoundLibrary } from './fx/soundLibrary';
import { TouchControls, DEFAULT_TOUCH_BUTTONS, type TouchControlsOptions, type HudElementSpec } from './ui/touchControls';
import type { MinimapOptions } from './ui/worldMap';
// Every type GameOptions names is exported from here too, so the app can type its options without guessing their module
// (failedbr #1334: "Module './game/Game' declares 'LightingPresetName' locally, but it is not exported" — 4 errors, 4 builds).
export type { LightingPresetName, CameraKind, TouchControlsOptions, DoorOccupant, HumanoidAction, HumanoidOptions, GameLanguage, StringKey, PlayerChoice, MinimapOptions, WorldBounds, BoundaryOptions };

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
/**
 * A browser driven by automation (navigator.webdriver: the build's playtest, explorer and screenshot browsers), where no
 * person holds the mouse. Pointer lock there floods the page with synthetic input: measured on the open-world starter in the
 * build sandbox's headless Chromium (queue Q-2698), 36,000 input messages a second and 4–6 frames a second with the lock,
 * 14–16 without it, same scene. A person's own browser never sets the flag, so their mouse is captured exactly as before.
 */
function automatedBrowser(): boolean {
  try { return typeof navigator !== 'undefined' && (navigator as Navigator & { webdriver?: boolean }).webdriver === true; } catch { return false; }
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
  playerBody?: THREE.Object3D | boolean;
  /** Shirt colour of the default body, so the hero stands out from the world. */
  playerColor?: number;
  /**
   * How the default body LOOKS: { height, build, skin, hair, shirt, trousers, shoes } (colours as 0xRRGGBB; build 0.85 slight
   * … 1.2 heavy; height in metres). It stays the kit's animated person — it walks, runs, jumps and plays every action pose.
   */
  playerLook?: HumanoidOptions;
  /**
   * WHO THE PLAYER IS — the kit person's look, a library character (model) or the user's own model file (file). Left
   * out, the shell reads src/game/player.ts BY ITSELF, so every game on the kit changes its character in that one file
   * and nothing has to wire it. The model takes the default body's place, plays its own clips for the way it moves and
   * for every pose (ctx.hero.act), and says on screen which move it lacks. A game with no default body (first-person, or
   * playerBody given) says so when a model is asked.
   */
  player?: PlayerChoice;
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
   * 'hi' Hindi, 'ta' Tamil, 'te' Telugu, 'bn' Bangla, 'mr' Marathi, 'gu' Gujarati, 'kn' Kannada, 'ml' Malayalam,
   * 'pa' Punjabi, 'or' Odia; 'auto' follows the page. For any other language pass strings with every word you need — a
   * key you leave out stays English, never blank. The player can change it in Settings → Language (saved on the device).
   */
  language?: GameLanguage | 'auto';
  strings?: Partial<Record<StringKey, string>>;
  /**
   * The aiming cross in the middle of the screen. Default: shown by itself the first time the player's own gun fires
   * (a game with a gun), with a hit marker when a shot lands. true shows it from the start; false never.
   */
  crosshair?: boolean;
  /**
   * The minimap in a corner. Default: shown by itself as soon as something carries a map marker (or the game has a world
   * map); true always; false never. Pass options to shape it — they are the user's to choose:
   * { corner: 'right', size: 200, names: false, range: 400, fullMap: false } (ui/worldMap.ts). With a world map (the open
   * world registers one) it draws the roads and named places, and a tap on it (or M) opens the whole map full screen.
   */
  minimap?: boolean | MinimapOptions;
  /**
   * Where the map ends (play/boundary.ts): the player, the vehicle they drive and every character stay inside, behind real
   * walls (walls: 'invisible' when the map's own mountains or sea are the edge). Same as ctx.world.setBounds in setup().
   */
  bounds?: WorldBounds & BoundaryOptions;
  /**
   * Keep the player's progress between visits: the kit's state (level, score, lives, the bag, unlocks) is saved when the
   * game pauses, a round ends or the page is hidden, and the start screen offers Continue / New game. Turn it on when the
   * game's progress lives in that state (an RPG, a level game) — a world the game builds itself is not saved.
   */
  save?: boolean;
  /** People and assets to thank, shown from a Credits button on the start screen. */
  credits?: Array<string | { role: string; name: string }>;
  /**
   * Two players on one device: player 1 keeps the keys but the arrows (and gamepad 1), player 2 gets the arrows and the keys
   * by them (and gamepad 2) — ctx.players[0] / [1]. The game builds player 2's body and passes its camera to
   * ctx.splitScreen(camera) for a split screen. Touch controls drive player 1 only.
   */
  players?: 1 | 2;
  /** Capture the mouse for looking around on a desktop (click to capture, Esc to let go). Default true. */
  pointerLock?: boolean;
  /**
   * The music that follows the game (fx/music.ts: calm on the start screen, action in play, tense for a boss, a sting on a
   * win or a loss; lowered while paused or talking). false = none; a table changes cues, e.g. { GAME_STARTED: 'tense' }.
   */
  music?: false | Partial<Record<string, string | null>>;
}

/** ctx.vehicles — see GameContext.vehicles. */
export interface VehicleSeats {
  /** A vehicle the player may get into. */
  add: (vehicle: THREE.Object3D) => void;
  /** Put the player in this vehicle now (it must have been added). */
  enter: (vehicle: THREE.Object3D) => boolean;
  /** Get out now, beside the vehicle (a fast one brakes to a stop first). */
  exit: () => boolean;
  /** The vehicle the player is in, or null on foot. */
  readonly seated: THREE.Object3D | null;
  /** The added vehicle near enough to get into, or null — show "Press E to get in" while it is set. */
  readonly inReach: THREE.Object3D | null;
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
   * Where the player aims (play/aim.ts) — every gun's direction; never hand-write one. The crosshair point, the real
   * muzzle, the shot between: gun.update(dt, fire, a.muzzle, a.shot, bullets). Top-down: the way the player faces.
   */
  aim: (options?: { holder?: THREE.Object3D | null; range?: number }) => AimResult;
  /**
   * Run fn(dt) every game step, after update() — paused and frozen with the game. Returns the way to stop it. The kit's
   * own systems tick through it (Entities, systems/entities.ts), so a system cannot be forgotten in update().
   */
  onStep: (fn: (delta: number) => void) => () => void;
  /**
   * The default player body (createHumanoid), or null when the game brought its own or is first-person. It already
   * plays the action poses for the buttons (see actionPoses); call ctx.hero.act('kick') yourself for anything else
   * the game does — a throw, a reach, a flinch.
   */
  hero: Humanoid | null;
  /** Every player's input: [player 1] normally, [player 1, player 2] with options.players = 2. ctx.input is player 1. */
  players: Input[];
  /** Split the screen: player 1's camera on the left (or top), this one on the right (or bottom). null = one view. */
  splitScreen: (camera: THREE.Camera | null) => void;
  /**
   * GET IN AND OUT OF VEHICLES (2026-11-20 game-gap audit: every walk-and-drive game hand-wrote it, and the walking body
   * kept moving, unseen, while the player drove). Call ctx.vehicles.add(car) once in setup() for each car or bike the
   * player may take. The player walks up to it and presses Use (E, or the Use button) to get in: the body is hidden and
   * held still, the camera chases the vehicle and the same keys or joystick drive it. Use again gets out beside it — a
   * fast vehicle brakes to a stop first. The shell drives the vehicle the player is in; if your own code drives it with
   * driveVehicle(), your code wins and the shell stops driving that vehicle.
   */
  vehicles: VehicleSeats;
  /** The map's edge (play/boundary.ts): setBounds(area, { walls }) in setup(); inside(x, z) before putting anything somewhere. */
  world: { readonly bounds: WorldBounds | null; setBounds: (area: WorldBounds | null, options?: BoundaryOptions) => boolean; inside: (x: number, z: number) => boolean };
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  readonly player: CharacterController;
  readonly particles = new ParticleSystem();
  readonly feel = new GameFeel();
  readonly input: Input;
  /** Player 2's input, with options.players = 2. */
  readonly input2: Input | null = null;
  /**
   * The keys the player chose (Settings → Controls), read by the same Input object, so a change applies at once.
   * null with two players: each player's keys are fixed so the two halves of the keyboard never overlap.
   */
  readonly keys: ActionMap | null = null;
  private secondCamera: THREE.Camera | null = null;
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
  /** ctx.vehicles: what the player may get into, its driving state, and whether the shell drives it. */
  private readonly seats = new Map<THREE.Object3D, { state: VehicleState; shellDrives: boolean }>();
  /** The vehicle the player is in. */
  private seated: THREE.Object3D | null = null;
  /** Use was pressed at speed: brake to a stop, then get out. */
  private leaving = false;
  /** Every axis object ctx.input.axis() has handed out — how a driveVehicle() call is known to be the player's. */
  private readonly playerAxes = new WeakSet<object>();
  private setupDone = false;
  /** The default body (createHumanoid), when the game did not bring its own. */
  private hero: Humanoid | null = null;
  /** Who the player is (options.player, or src/game/player.ts), and the model standing in the default body's place. */
  private readonly playerChoice: PlayerChoice | undefined;
  private playerModel: PlayerBody | null = null;
  /** A gun fired / a sword swung during this step — what an 'auto' attack pose becomes. */
  private firedThisStep = false;
  private swungThisStep = false;
  /** The attack button is down or went down this step (read before the game's update). */
  private attackHeldThisStep = false;
  /** The pixel ratio the renderer chose for this device; quality scales DOWN from it, never up. */
  private basePixelRatio = 1;
  /** Watches the frame rate and steps the picture down when the device cannot keep up (core/perf.ts). */
  // A budget phone starts one picture level lower (core/perf budgetDevice) instead of stuttering for its first seconds.
  private readonly perf = createPerfGovernor({ startDrop: budgetDevice() ? 1 : 0 });
  private chosenQuality: GameSettings['quality'] = 'high';
  private autoQuality = true;
  private reduceMotion = false;
  private effectiveQuality: GameSettings['quality'] = 'high';
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
  /** Which of those action buttons the game reads (Use alone still lets a car get the drive pads, with Use on them). */
  private readonly gameReadActions = new Set<string>();

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
    this.playerChoice = resolvePlayerChoice(options.player);
    // true means "the default body", the same as leaving it out (failedbr #1334: a boolean was passed and failed to compile).
    if (options.playerBody && typeof options.playerBody === 'object') {
      this.player.object.add(options.playerBody);
    } else if (options.playerBody !== false && !firstPerson) {
      this.hero = createHumanoid({ height: 1.75, shirt: options.playerColor ?? 0x2e5a87, ...(options.playerLook || { ...(this.playerChoice?.look || {}), ...(options.playerColor !== undefined ? { shirt: options.playerColor } : {}) }) });
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
    if (options.players === 2) {
      this.input = new Input(this.canvas, PLAYER1_ACTIONS, { padIndex: 0 });
      this.input2 = new Input(this.canvas, PLAYER2_ACTIONS, { padIndex: 1 });
      const second = this.input2;
      this.disposers.push(() => second.dispose());
    } else {
      this.keys = loadKeyBindings();
      this.input = new Input(this.canvas, this.keys);
    }
    // Remember what the player's input looks like, so driveVehicle(car, s, ctx.input.axis(), dt) names
    // the PLAYER's car (see playerVehicle). Same values, same object — only now it is recognisable.
    const readAxis = this.input.axis.bind(this.input);
    this.input.axis = () => { const a = readAxis(); this.playerAxes.add(a); notePlayerAxis(a); return a; };
    // A drifting car pours tyre smoke where its rear wheels are (driveVehicle reports it).
    this.disposers.push(onVehicleDrift((at) => this.particles.burst('smoke', at.x, at.y, at.z, 0.35)));
    // The PLAYER's crash is felt (sparks, crunch, jolt, buzz — the feedback table); a rival's crash is not the player's.
    this.disposers.push(onVehicleCrash((at, vehicle, impact) => {
      if (vehicle === this.playerVehicle) events.emit('VEHICLE_CRASHED', { position: at, impact });
    }));
    // And which action buttons the GAME reads (see gameReadsButtons). Same answers as before.
    const buttonActions = new Set(DEFAULT_TOUCH_BUTTONS.map((b) => b.action));
    for (const m of ['isDown', 'wasPressed', 'wasReleased'] as const) {
      const read = this.input[m].bind(this.input);
      this.input[m] = (action: string) => {
        if (this.inGameCode && buttonActions.has(action) && !this.gameReadActions.has(action)) {
          this.gameReadActions.add(action);
          this.gameReadsButtons = true;
          this.syncTouchLayout();
        }
        return read(action);
      };
    }
    // Most players hold a phone. Without these, a game built for WASD + mouse renders and cannot be played.
    const touchOptions = options.touchControls || {};
    this.touchLayoutIsOurs = !touchOptions.buttons && !touchOptions.layout;
    if (options.touchControls !== false) {
      // The player's own layout (Settings → Edit controls) is saved per game, under the same id as its leaderboard.
      const touch = new TouchControls(options.container, this.input, { gameId: options.gameId, ...touchOptions });
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
    // Every finished round goes on this device's leaderboard (core/leaderboard.ts) — recorded here so no game can forget.
    const recordRound = () => { leaderboard.record(this.leaderboardId, state.score); };
    this.disposers.push(events.on('GAME_OVER', recordRound), events.on('GAME_WON', recordRound));
    // 🖱️ POINTER LOCK: a click on the canvas during play captures the mouse; any screen that is not play lets it go. The
    // browser drops the lock itself on Esc and never delivers that Esc to the page — so losing it mid-play IS the pause.
    const onCanvasClick = () => { if (state.status === 'playing') this.capturePointer(); };
    this.canvas.addEventListener('click', onCanvasClick);
    this.disposers.push(() => this.canvas.removeEventListener('click', onCanvasClick));
    for (const e of ['GAME_PAUSED', 'GAME_OVER', 'GAME_WON', 'GAME_MENU'] as const) this.disposers.push(events.on(e, () => this.releasePointer()));
    const onLockChange = () => {
      const d = document as Document & { pointerLockElement?: Element | null };
      if (d.pointerLockElement !== this.canvas && state.status === 'playing' && this.options.pointerLock !== false && !touchDevice()) this.pause();
    };
    document.addEventListener('pointerlockchange', onLockChange);
    this.disposers.push(() => { document.removeEventListener('pointerlockchange', onLockChange); this.releasePointer(); });
    // 💾 SAVE: progress is kept between visits when the game asks for it (options.save).
    if (this.options.save === true) {
      loadState();
      const keep = () => { saveState(); };
      for (const e of ['GAME_PAUSED', 'GAME_OVER', 'GAME_WON', 'LEVEL_COMPLETED'] as const) this.disposers.push(events.on(e, keep));
      const onHide = () => { if (document.hidden && state.status === 'playing') saveState(); };
      document.addEventListener('visibilitychange', onHide);
      this.disposers.push(() => document.removeEventListener('visibilitychange', onHide));
    }
    // 💀 The player's body falls when they die and stands back up for the next life or round (Humanoid.die / revive).
    this.disposers.push(events.on('PLAYER_DIED', () => { this.hero?.die(); }));
    this.disposers.push(events.on('GAME_STARTED', () => { this.hero?.revive(); }), events.on('PLAYER_SPAWNED', () => { this.hero?.revive(); }));
    // A new round starts with no power-ups left over from the last one.
    this.disposers.push(events.on('GAME_STARTED', () => powerUps.clear()));
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
    // Models the loader is still fetching, and how many have sat at 0% for over 20 s (the playtest's "stuck loading" read).
    // Counted from the loader's own ASSET_LOADING events only; nothing here changes how a model loads.
    const modelJobs = new Map<number, { since: number; fraction: number }>();
    this.disposers.push(events.on('ASSET_LOADING', (p: { id?: unknown; fraction?: unknown; done?: unknown } | undefined) => {
      if (!p || typeof p.id !== 'number') return;
      if (p.done === true) { modelJobs.delete(p.id); return; }
      const job = modelJobs.get(p.id) ?? { since: performance.now(), fraction: 0 };
      if (typeof p.fraction === 'number' && Number.isFinite(p.fraction)) job.fraction = p.fraction;
      modelJobs.set(p.id, job);
    }));
    const hook = { status: () => state.status, score: () => state.score, fps: () => this.fps, quality: () => this.effectiveQuality,
      // How much the last frame asked of the GPU — what decides whether a cheap phone keeps up (the playtest's budget check).
      load: () => { const i = this.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures }; },
      models: () => { const now = performance.now(); let stuck = 0; for (const j of modelJobs.values()) if (j.fraction <= 0 && now - j.since > 20000) stuck++; return { pending: modelJobs.size, stuck }; },
      endRound: () => { if (state.status === 'playing' || state.status === 'paused') setStatus('gameover'); } };
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
    loadSoundLibrary();

    // The player's own character (src/game/player.ts) takes the default body's place before the game's setup runs.
    this.playerModel = applyPlayerChoice(this.context, this.playerChoice);
    // The map's edge from the options first, so setup() can still change it (ctx.world.setBounds).
    if (options.bounds) this.boundary.set(options.bounds, options.bounds);
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
  /** The map's edge: walls and the per-step keep-inside (play/boundary.ts). */
  readonly boundary = new WorldBoundary(this.scene);
  /** What ctx.onStep registered, run each step after the game's update. */
  private readonly stepHooks = new Set<(delta: number) => void>();
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
      aim: (o = {}) => {
        const model = playerModelRoot(game.context);
        const hand = o.holder !== undefined ? o.holder : model ? (findBones(model).rightHand ?? null) : (game.hero?.joints.rightHand ?? null);
        return aimFrom(game.rig.camera, game.scene, {
          range: o.range, own: [game.player.object, game.chased], holder: hand, body: game.player.object,
          topDownFacing: game.options.camera === 'top-down' ? (game.hero?.root.rotation.y ?? game.player.object.rotation.y) : null,
        });
      },
      onStep: (fn) => { game.stepHooks.add(fn); return () => { game.stepHooks.delete(fn); }; },
      world: {
        get bounds() { return game.boundary.bounds; },
        setBounds: (area, o) => game.boundary.set(area, o),
        inside: (x, z) => game.boundary.inside(x, z),
      },
      get hero() { return game.hero; },
      get players() { return game.input2 ? [game.input, game.input2] : [game.input]; },
      splitScreen: (camera) => { this.secondCamera = camera; },
      vehicles: {
        add: (vehicle) => game.addSeat(vehicle),
        enter: (vehicle) => game.enterSeat(vehicle),
        exit: () => game.leaveSeat(),
        get seated() { return game.seated; },
        get inReach() { return game.seatInReach(); },
      },
    };
    return this.ctxObject;
  }

  /**
   * Nobody leaves the map (play/boundary.ts): the player, the vehicle the player drives — stopped at the edge, or it would
   * keep pushing — and every object marked userData.bounded (Entities characters, dispatched cars). A no-op without bounds.
   */
  private keepInsideMap(): void {
    if (!this.boundary.bounds) return;
    this.boundary.keep(this.player.object, 0.4);
    const v = this.seated;
    if (v && this.boundary.keep(v, 1.2)) { const seat = this.seats.get(v); if (seat) seat.state = { ...seat.state, speed: 0 }; }
    for (const o of this.scene.children) if (o.userData.bounded && o !== v) this.boundary.keep(o, 0.4);
  }

  /** Run the game's own code, listening for the vehicles it drives and the buttons it reads. */
  private asGame<T>(fn: () => T): T {
    this.inGameCode = true;
    try { return watchVehicles((v, axis) => this.noteVehicle(v, axis), fn); } finally { this.inGameCode = false; }
  }

  /** createVehicleState()/driveVehicle() was handed this vehicle inside setup() or update(). */
  private noteVehicle(vehicle: THREE.Object3D, axis: { x: number; y: number } | null): void {
    // The game drives a vehicle it gave to ctx.vehicles itself: its code wins, the shell stops driving it.
    const seat = this.seats.get(vehicle);
    if (seat) seat.shellDrives = false;
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
    if (this.seated && this.inScene(this.seated)) return this.seated;
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
    const inCar = !!chased && isVehicle(chased);
    // 🚗 (admin 2026-11-23: "car control hardcore joystick se nahi honi chahiye"). A player who got into a car (ctx.vehicles)
    // used to keep the joystick, because the pedal set had no Use button and Use is the way out. The pedals now carry Use,
    // so a seated player gets them — unless the game reads another action button (it fires from the car, say): then the
    // joystick and those buttons stay, as before. touchControls.drive: 'joystick' keeps the joystick everywhere.
    const othersRead = [...this.gameReadActions].some((a) => a !== 'interact');
    const seatedHere = !!this.seated && chased === this.seated;
    let drive = false;
    if (inCar && this.touch.driveMode !== 'joystick') {
      drive = seatedHere ? !othersRead : !this.gameReadsButtons && this.seats.size === 0;
    }
    this.touch.setLayout(drive ? 'drive' : 'move');
    this.touch.setExitButton(drive && seatedHere);
  }

  /** FIXED 60Hz. Everything that affects the simulation lives here and nowhere else. */
  private fixedUpdate(delta: number): void {
    // A gamepad is polled, not heard: read it before anything reads input this step.
    this.input.pollGamepads();
    this.input2?.pollGamepads();
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
      // Use gets in or out of a vehicle first (ctx.vehicles); only a press that did neither opens a door.
      const usedSeat = this.input.wasPressed('interact') && this.useSeat();
      if (!this.chased && !usedSeat && this.input.wasPressed('interact')) interactHouseDoor(this.scene, doorActor);
      updateHouseDoors(this.scene, delta, [doorActor, ...(this.options.doorOccupants?.(this.context) ?? [])]);
      const axis = this.input.axis();
      // In a vehicle the body is held still (it used to keep walking, unseen); the vehicle is driven instead.
      if (this.seated) this.driveSeat(delta, axis);
      else this.player.update(
        delta,
        {
          moveX: axis.x,
          moveZ: axis.y,
          sprint: this.input.isDown('sprint'),
          jumpPressed: this.input.wasPressed('jump'),
          jumpHeld: this.input.isDown('jump'),
          // Dive while swimming (ctx.player.setWater): C, Left Ctrl or the right stick.
          diveHeld: this.input.isDown('crouch'),
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
      this.playerModel?.update(delta);
      // Any action the game plays on the player (performAction: pick-up, open-door, eat, or one NavBharatAI made), after the
      // body has posed itself, so the action's pose is the one drawn.
      updateActions(this.context, delta);
      // The shell listens while the game runs, so a vehicle it drives is known without being declared.
      this.attackHeldThisStep = this.input.isDown('attack') || this.input.wasPressed('attack');
      setDriftInput(this.input.isDown('drift'));
      // Power-ups count down in game time only: frozen by a hit-stop, a conversation or the pause menu (core/powerups.ts).
      powerUps.update(delta);
      this.asGame(() => this.options.update?.(this.context, delta));
      // ctx.onStep: the kit's systems (and the game's own) tick here. One that throws is dropped and said, never a dead loop.
      for (const fn of [...this.stepHooks]) {
        try { this.asGame(() => fn(delta)); } catch (error) { this.stepHooks.delete(fn); console.error('[game] a step hook failed and was stopped', error); }
      }
      this.poseActionButtons();
      // 🔒 NOTHING SINKS: every top-level object (car, NPC, animal, prop, train) is kept on the terrain
      // after the game moved it — the kit enforces it, so no generated game can forget it (2026-11-02).
      groundScene(this.scene);
      this.keepInsideMap();
      this.syncTouchLayout();   // back to the joystick if the car has left the scene
      this.particles.update(delta);
      // Debris from broken crates and walls flies, falls, settles and goes (three/breakable.ts).
      updateBreakables(delta);
    }
    // During a hit-stop freeze the game did not run, so a press made now is KEPT for the step that does — wiping it
    // here was why a tap sometimes did nothing at all (the freeze follows every shot and every hit).
    this.input.endFrame(this.feel.frozen && !talking);
    this.input2?.endFrame(this.feel.frozen && !talking);
  }

  /** What Use would do now with ctx.vehicles — 'in', 'out' or null. The Hud shows it as a prompt. */
  get seatPrompt(): 'in' | 'out' | null {
    if (this.seated) return this.leaving ? null : 'out';
    return this.seatInReach() ? 'in' : null;
  }

  /** The furthest a player can be from a vehicle's side and still get in, in metres. */
  private static readonly SEAT_REACH = 2.2;

  private addSeat(vehicle: THREE.Object3D): void {
    if (!vehicle || this.seats.has(vehicle)) return;
    // Parked: speed 0 (a new state starts rolling at 5 m/s). Made outside the watch, so it is not read as the game driving it.
    const state = watchVehicles(() => undefined, () => createVehicleState(vehicle, { startSpeed: 0 }));
    this.seats.set(vehicle, { state, shellDrives: true });
    this.syncTouchLayout();
  }

  /** The nearest added vehicle whose side is within reach of the player on foot. */
  private seatInReach(): THREE.Object3D | null {
    if (this.seated) return null;
    const feet = this.player.object.getWorldPosition(new THREE.Vector3());
    let best: THREE.Object3D | null = null;
    let bestGap = Infinity;
    const box = new THREE.Box3();
    for (const v of this.seats.keys()) {
      if (!this.inScene(v)) continue;
      box.setFromObject(v);
      if (box.isEmpty()) continue;
      const gap = Math.hypot(Math.max(box.min.x - feet.x, 0, feet.x - box.max.x), Math.max(box.min.z - feet.z, 0, feet.z - box.max.z));
      if (gap <= Game.SEAT_REACH && gap < bestGap) { best = v; bestGap = gap; }
    }
    return best;
  }

  private enterSeat(vehicle: THREE.Object3D): boolean {
    if (!this.seats.has(vehicle) || !this.inScene(vehicle) || this.seated) return false;
    this.seated = vehicle;
    this.leaving = false;
    this.syncTouchLayout();
    return true;
  }

  /** Get out beside the vehicle now, or brake first when it is moving fast. */
  private leaveSeat(): boolean {
    const v = this.seated;
    if (!v) return false;
    const seat = this.seats.get(v);
    if (seat && Math.abs(seat.state.speed) > 1.5) { this.leaving = true; return true; }
    // Beside the vehicle on its right, clear of its body: half its width plus a step.
    const box = new THREE.Box3().setFromObject(v);
    const size = box.getSize(new THREE.Vector3());
    const side = Math.min(size.x, size.z) / 2 + 0.9;
    const h = v.rotation.y;
    const at = v.getWorldPosition(new THREE.Vector3());
    this.player.reset(at.x + Math.cos(h) * side, at.y + 0.1, at.z - Math.sin(h) * side);
    if (seat) seat.state = { ...seat.state, speed: 0 };
    // A game that drove it with the player's keys made it "the player's car"; on foot, the camera follows the player again.
    if (this.playerVehicle === v) this.playerVehicle = null;
    this.seated = null;
    this.leaving = false;
    this.syncTouchLayout();
    return true;
  }

  /** Use: out of the vehicle the player is in, or into the one in reach. True when it did either. */
  private useSeat(): boolean {
    if (this.seated) return this.leaveSeat();
    const v = this.seatInReach();
    return v ? this.enterSeat(v) : false;
  }

  /** Drive the vehicle the player is in (unless the game drives it itself); brake to a stop while getting out. */
  private driveSeat(delta: number, axis: { x: number; y: number }): void {
    const v = this.seated;
    const seat = v ? this.seats.get(v) : undefined;
    if (!v || !seat) return;
    if (!this.inScene(v)) { this.seated = null; this.leaving = false; this.syncTouchLayout(); return; }
    if (seat.shellDrives) {
      // The axis's y is -1 for forward; braking is +1 (driveVehicle brakes before it reverses).
      const brake = { x: 0, y: seat.state.speed > 0 ? 1 : -1 };
      seat.state = driveVehicle(v, seat.state, this.leaving ? brake : axis, delta, {}, { drift: !this.leaving && this.input.isDown('drift') });
    }
    if (this.leaving && Math.abs(seat.state.speed) <= 1.5) this.leaveSeat();
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
    // Only play is measured: a frozen start screen or pause menu says nothing about how the game itself runs.
    if (state.status === 'playing' && this.perf.feed(frameDelta) && this.autoQuality) this.applyQuality();
    // Driving or riding: the camera sits behind the VEHICLE's own front, whatever its heading — the one
    // the game named with ctx.follow(), or the one it drives. On foot the player is framed as it always
    // has been (a 'chase' game too: its rig is third-person on foot, see the constructor).
    const chased = this.chased;
    const p = chased ? chased.position : this.player.object.position;
    if (chased) this.rig.follow(chased, frameDelta);
    else this.rig.update(p, frameDelta);
    if (!chased) updateIndoorCamera(this.scene, this.rig.camera, p);
    // Defaults, NOT small 3D-looking numbers: applyShake already scales the offset into world units
    // (×0.02). Passing 0.35 here would produce a 0.007-unit shake — mathematically present, invisible.
    // Reduce motion (Settings, or the device's own setting on a first visit): the camera never shakes.
    this.rig.applyShake(this.reduceMotion ? { x: 0, y: 0, roll: 0 } : this.feel.shake());
    // Shadows follow the player, or they blur out as soon as they walk away on a large map.
    followShadow(this.lights.key, p);
    audio.setListener(p.x, p.y, p.z);
    updateHealthBars(this.rig.camera);   // enemy health bars face the camera (three/healthbar.ts)
    // Two players: each camera in its own half of the screen (three/splitscreen.ts).
    if (this.secondCamera) renderSplit(this.renderer, this.scene, [this.rig.camera, this.secondCamera]);
    else this.renderer.render(this.scene, this.rig.camera);
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
    this.capturePointer();
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
  /** true / false when the game said; options count as true (shown). undefined: shown once something is on the map. */
  get minimapOption(): boolean | undefined { const m = this.options.minimap; return m === undefined ? undefined : m !== false; }
  /** The minimap's look as the game asked for it (corner, size, names, range, fullMap); {} for the defaults. */
  get minimapStyle(): MinimapOptions { const m = this.options.minimap; return m && typeof m === 'object' ? m : {}; }
  /**
   * Put a HUD element in the player's layout editor (Settings → Edit controls), saved with the controls. Without touch
   * controls (a desktop with no touch screen) nothing edits it: apply is called once with size 1, and the element keeps its spot.
   */
  registerHud(id: string, spec: HudElementSpec): () => void {
    if (this.touch) return this.touch.addHudElement(id, spec);
    try { spec.apply({ size: 1 }); } catch { /* best-effort */ }
    return () => undefined;
  }

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
    if (s.quality !== this.chosenQuality || s.autoQuality !== this.autoQuality) this.perf.reset();
    this.chosenQuality = s.quality;
    this.autoQuality = s.autoQuality;
    this.applyQuality();
    this.lookSensitivity = s.lookSensitivity;
    this.reduceMotion = s.reduceMotion === true;
  }

  /**
   * The picture actually drawn: the player's choice, stepped down by the governor when Auto quality is on. Fewer pixels
   * is the biggest single saving on a weak phone (the base ratio already respects the device); 'low' also drops the sun's
   * shadows — which the Graphics setting always promised and never did.
   */
  private applyQuality(): void {
    // 🖥️ A browser with no GPU starts at the bottom (failedbr #2487: the open-world city drew 1–3 frames a second in a software
    // renderer, so Play could not even be pressed and the playtest never played). Measured on that game: 5 → 15 fps on the start
    // screen, 1.3 → 6 while playing, with the map's phone tier. Only with Auto quality on; a phone or laptop WITH a GPU is unaffected.
    const q = this.autoQuality ? (softwareRenderer() ? 'low' : steppedQuality(this.chosenQuality, this.perf.drop)) : this.chosenQuality;
    this.effectiveQuality = q;
    const scale = q === 'low' ? 0.55 : q === 'medium' ? 0.8 : 1;
    this.renderer.setPixelRatio(Math.max(0.35, this.basePixelRatio * scale));
    if (this.lights?.key) this.lights.key.castShadow = q !== 'low';
    events.emit('PERF_CHANGED', { fps: Math.round(this.perf.fps), quality: q, chosen: this.chosenQuality, auto: this.autoQuality });
  }

  /** The on-screen touch controls, or null when the game turned them off. Settings → Edit controls opens their editor. */
  get touchControls(): TouchControls | null { return this.touch; }

  /** The key this game's leaderboard is saved under (the gameId option, or 'game'). */
  get leaderboardId(): string { return this.options.gameId ?? 'game'; }

  /** Frames drawn per second, smoothed. */
  get fps(): number { return Math.round(this.perf.fps); }
  /** The quality being drawn right now (may be below the player's choice when Auto quality stepped it down). */
  get quality(): GameSettings['quality'] { return this.effectiveQuality; }
  pause(): void { if (state.status === 'playing') { this.loop.setPaused(true); setStatus('paused'); } }

  /** Start over: the saved game is forgotten and the run begins from nothing. */
  newGame(): void {
    clearSave();
    resetRun();
    this.play();
  }
  /** The start screen offers Continue: saving is on and there is a save. */
  get canContinue(): boolean { return this.options.save === true && hasSave(); }
  get creditsList(): Array<{ role: string; name: string }> {
    return (this.options.credits ?? []).map((c) => (typeof c === 'string' ? { role: '', name: c } : { role: String(c.role ?? ''), name: String(c.name ?? '') })).filter((c) => c.name);
  }

  /** Desktop mouse-look: capture the pointer on a click during play (a phone has no pointer to capture). */
  private capturePointer(): void {
    if (this.options.pointerLock === false || touchDevice() || automatedBrowser()) return;
    const c = this.canvas as HTMLCanvasElement & { requestPointerLock?: () => unknown };
    try { const r = c.requestPointerLock?.(); if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined); } catch { /* refused: the mouse still looks, just not captured */ }
  }
  private releasePointer(): void {
    const d = document as Document & { exitPointerLock?: () => void; pointerLockElement?: Element | null };
    if (d.pointerLockElement === this.canvas) { try { d.exitPointerLock?.(); } catch { /* already free */ } }
  }
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
    this.stepHooks.clear();
    this.boundary.dispose();
    this.disposed = true;
    // Partial construction is valid here; one broken cleanup must not strand later resources.
    const safe = (release: () => void) => { try { release(); } catch { /* teardown must never throw */ } };
    if (this.loop) safe(() => this.loop.stop());
    for (const off of this.disposers.splice(0).reverse()) safe(off);
    if (this.input) safe(() => this.input.dispose());
    safe(() => audio.stopAll());
    safe(() => this.particles.dispose());
    safe(() => this.playerModel?.dispose());
    safe(() => this.hero?.dispose());
    safe(() => clearBreakables());   // a reloaded game starts with no breakables or debris from this one
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
import { t, choosePlayerLanguage, currentGameLanguage, GAME_LANGUAGES, GAME_LANGUAGE_NATIVE_NAMES, type GameLanguage, type StringKey } from '../core/strings';
import { REBINDABLE_ACTIONS, rebindKey, resetKeyBindings, primaryKey, keyLabel, captureKey } from '../core/keybinds';
import { prefersTouch } from './touchControls';
import { lastRaceResults } from '../three/race';
import { levels } from '../core/levels';
import { objectives, type Objective } from '../core/quests';
import { dialogue, type DialogueView } from '../core/dialogue';
import { inventory, type ItemStack } from '../core/inventory';
import { economy, type ShopEntry } from '../core/economy';
import { powerUps, type ActivePowerUp } from '../core/powerups';
import { leaderboard } from '../core/leaderboard';
import { crafting, type RecipeView } from '../core/crafting';
import {
  worldMapSource, readWorldMap, minimapStyle, cornerPoint, roadsNear, shortName, formatDistance, placeColour, getWaypoint, setWaypoint,
  boundsOf, fitCamera, clampCamera, zoomAt, panBy, worldToMap, mapToWorld, gridStep, WAYPOINT_COLOUR, WAYPOINT_COLOUR_SAFE,
  type MinimapStyle, type MapCamera, type WorldMapPoint, type WorldMapPlace,
} from './worldMap';

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

/** The language on screen, live: every kit screen re-renders in the new words the moment it changes. */
function useLanguage(): GameLanguage {
  const [value, setValue] = useState<GameLanguage>(currentGameLanguage());
  useEffect(() => events.on('LANGUAGE_CHANGED', () => setValue(currentGameLanguage())), []);
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
/** The Okabe–Ito palette: told apart by every common kind of colour blindness (Settings → Colour-blind colours). */
const MARKER_COLOUR_SAFE: Record<string, string> = { enemy: '#e69f00', goal: '#f0e442', pickup: '#56b4e9', friend: '#ffffff' };
export const HEALTH_COLOURS = { ok: '#4ade80', low: '#f87171' } as const;
export const HEALTH_COLOURS_SAFE = { ok: '#56b4e9', low: '#e69f00' } as const;
export function markerColour(kind: string, safe: boolean): string { return (safe ? MARKER_COLOUR_SAFE : MARKER_COLOUR)[kind] ?? '#fff'; }

/** Whether the game has a world map (play/openWorld.ts registers one — ui/worldMap.ts), live. */
function useWorldMap(): boolean {
  const [on, setOn] = useState(() => worldMapSource() !== null);
  useEffect(() => {
    setOn(worldMapSource() !== null);
    return events.on('WORLD_MAP_CHANGED', () => setOn(worldMapSource() !== null));
  }, []);
  return on;
}

const pixelRatio = (): number => Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);

/** What the maps see: the player (or the vehicle it drives) and the markers, moved into WORLD metres, with the world's places and roads. */
function worldView(game: Game) {
  const view = game.mapView();
  const data = readWorldMap();
  const o = data.origin;
  return {
    data, facing: view.facing,
    me: { x: view.x + o.x, z: view.z + o.z, forward: view.forward },
    markers: view.markers.map((m) => ({ x: m.x + o.x, z: m.z + o.z, kind: m.kind })),
  };
}

/** A place's outline: a square for a place on a grid (turned with the map), a circle for a land. */
function tracePlace(c: CanvasRenderingContext2D, p: WorldMapPlace, at: (q: WorldMapPoint) => { x: number; y: number }, scale: number): void {
  c.beginPath();
  if (p.shape === 'square') {
    const r = p.radius;
    const pts = [at({ x: p.x - r, z: p.z - r }), at({ x: p.x + r, z: p.z - r }), at({ x: p.x + r, z: p.z + r }), at({ x: p.x - r, z: p.z + r })];
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) c.lineTo(pts[i].x, pts[i].y);
    c.closePath();
  } else {
    const q = at(p);
    c.arc(q.x, q.y, Math.max(2, p.radius * scale), 0, Math.PI * 2);
  }
}
/** A road: a dark edge with a light surface, as wide as the real road (9 m) or at least visible. */
function strokeRoad(c: CanvasRenderingContext2D, line: ReadonlyArray<WorldMapPoint>, at: (q: WorldMapPoint) => { x: number; y: number }, scale: number): void {
  c.beginPath();
  line.forEach((q, i) => { const a = at(q); if (i) c.lineTo(a.x, a.y); else c.moveTo(a.x, a.y); });
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = 'rgba(20,22,26,0.95)'; c.lineWidth = Math.max(3.5, 9 * scale + 2); c.stroke();
  c.strokeStyle = '#cbd5e1'; c.lineWidth = Math.max(1.5, 9 * scale); c.stroke();
}
function mapLabel(c: CanvasRenderingContext2D, text: string, x: number, y: number, px: number): void {
  c.font = '700 ' + px + 'px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(text, x, y);
  c.fillStyle = '#fff'; c.fillText(text, x, y);
}
/** The player: an arrow pointing the way it faces (angle on the canvas, 0 = up). */
function mapArrow(c: CanvasRenderingContext2D, x: number, y: number, angle: number, s: number): void {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.beginPath(); c.moveTo(0, -s); c.lineTo(s * 0.75, s * 0.75); c.lineTo(0, s * 0.375); c.lineTo(-s * 0.75, s * 0.75); c.closePath();
  c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.stroke();
  c.restore();
}
/** The waypoint: a pin standing on the marked spot. */
function mapPin(c: CanvasRenderingContext2D, x: number, y: number, colour: string, s: number): void {
  c.beginPath(); c.moveTo(x, y); c.lineTo(x - s * 0.6, y - s * 1.3); c.arc(x, y - s * 1.6, s * 0.7, Math.PI * 0.85, Math.PI * 2.15); c.closePath();
  c.fillStyle = colour; c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.stroke();
  c.beginPath(); c.arc(x, y - s * 1.6, s * 0.28, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
}

/**
 * The round minimap: the player's arrow in the middle, markers around it, turning with the camera. With a world map (the open
 * world registers one) it also draws the roads and the places near the player with their names, and a tap opens the full map.
 * Its corner, size, range and names are the game's options (GameOptions.minimap); the player may hide it in Settings.
 */
export function Minimap({ game, onOpen }: { game: Game; onOpen?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const prefs = useSettings();
  const hasWorld = useWorldMap();
  const [visible, setVisible] = useState(game.minimapOption === true);
  const [distance, setDistance] = useState('');
  const off = game.minimapOption === false || prefs.showMinimap === false;
  const style = minimapStyle(off ? {} : game.minimapStyle, hasWorld);
  // The player's own place and size for it (Settings → Edit controls — the same editor and saved layout as the buttons).
  const [place, setPlace] = useState<{ x?: number; y?: number; size: number }>({ size: 1 });
  const box = useRef<HTMLDivElement>(null);
  const size = Math.round(Math.max(64, Math.min(320, style.size * place.size)));
  const { range, names } = style;
  useEffect(() => {
    if (off || !visible) return;
    return game.registerHud('minimap', {
      label: t('minimap'), width: style.size, height: style.size,
      home: () => { const r = box.current?.getBoundingClientRect(); return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.width / 2 } : null; },
      apply: (p) => setPlace((was) => (was.x === p.x && was.y === p.y && was.size === p.size ? was : p)),
    });
  }, [game, off, visible, style.size]);
  const tappable = !off && style.fullMap && !!onOpen;
  useEffect(() => {
    if (off) return;
    let shown = visible, said = '';
    const draw = () => {
      const w = worldView(game);
      const wp = getWaypoint();
      if (!shown && (w.markers.length > 0 || hasWorld || wp)) { shown = true; setVisible(true); }
      // How far the marked spot is, under the map — set only when it changes (never a re-render per frame).
      const far = wp ? formatDistance(Math.hypot(wp.x - w.me.x, wp.z - w.me.z)) : '';
      if (far !== said) { said = far; setDistance(far); }
      const el = canvas.current;
      const c = el?.getContext('2d');
      if (!el || !c) return;
      const dpr = el.width / size || 1, half = size / 2, k = (half - 6) / range, safe = settings.get().colourSafe;
      const at = (q: WorldMapPoint) => cornerPoint(w.me, q, range, size);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, size, size);
      c.save();
      c.beginPath(); c.arc(half, half, half - 1, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill(); c.clip();
      // The world near the player: places and lands as coloured shapes, then the roads, then the names on top.
      const near = w.data.places.filter((p) => Math.hypot(p.x - w.me.x, p.z - w.me.z) - p.radius * 1.42 < range * 1.1);
      for (const p of near) { tracePlace(c, p, at, k); c.globalAlpha = 0.45; c.fillStyle = placeColour(p.kind); c.fill(); c.globalAlpha = 1; }
      for (const line of roadsNear(w.data.roads, w.me, range * 1.5)) strokeRoad(c, line, at, k);
      if (names) for (const p of near) {
        if (!p.name || Math.hypot(p.x - w.me.x, p.z - w.me.z) > range) continue;
        const q = at(p); mapLabel(c, shortName(p.name), q.x, q.y, 10);
      }
      c.restore();
      c.beginPath(); c.arc(half, half, half - 1, 0, Math.PI * 2); c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 2; c.stroke();
      for (const m of w.markers) {
        const q = minimapPoint(w.me, m, range, size);
        c.fillStyle = markerColour(m.kind, safe);
        c.beginPath(); c.arc(q.x, q.y, q.edge ? 3 : 4, 0, Math.PI * 2); c.fill();
      }
      if (wp) { const q = minimapPoint(w.me, wp, range, size); mapPin(c, q.x, q.y, safe ? WAYPOINT_COLOUR_SAFE : WAYPOINT_COLOUR, q.edge ? 5 : 6); }
      // The player's arrow, pointing where they face (relative to the camera).
      const face = minimapPoint(w.me, { x: w.me.x + Math.sin(w.facing), z: w.me.z + Math.cos(w.facing) }, range, size);
      mapArrow(c, half, half, Math.atan2(face.x - half, -(face.y - half)), 8);
      // A tappable map says so: a small "open" mark at its lower right.
      if (tappable) {
        const x = half + (half - 14) * 0.7071, y = half + (half - 14) * 0.7071;
        c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.6; c.beginPath();
        c.moveTo(x - 5, y - 1); c.lineTo(x - 5, y - 5); c.lineTo(x - 1, y - 5);
        c.moveTo(x + 5, y + 1); c.lineTo(x + 5, y + 5); c.lineTo(x + 1, y + 5);
        c.stroke();
      }
    };
    const timer = setInterval(draw, 100);
    draw();
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, off, hasWorld, size, range, names, tappable]);
  if (off || !visible) return null;
  const px = Math.round(size * pixelRatio());
  const side = style.corner === 'right' ? { right: 'max(12px, env(safe-area-inset-right))' } : { left: 'max(12px, env(safe-area-inset-left))' };
  // Placed by the player: its centre where they put it; otherwise the game's corner.
  const where = place.x !== undefined && place.y !== undefined
    ? { left: place.x * 100 + '%', top: place.y * 100 + '%', transform: 'translate(-50%, ' + (-size / 2) + 'px)' }
    : { ...side, top: 'max(56px, calc(env(safe-area-inset-top) + 48px))' };
  const picture = <canvas ref={canvas} width={px} height={px} aria-label="Minimap" role="img" style={{ display: 'block', width: size, height: size }} />;
  return (
    <div ref={box} style={{ position: 'absolute', ...where, width: size, pointerEvents: 'none', zIndex: 5 }}>
      {tappable ? (
        <button type="button" aria-label={t('openMap')} title={t('openMap') + ' (M)'} onClick={onOpen}
          style={{ display: 'block', width: size, height: size, padding: 0, margin: 0, border: 'none', borderRadius: 999, background: 'transparent', cursor: 'pointer', pointerEvents: 'auto', touchAction: 'manipulation' }}>
          {picture}
        </button>
      ) : picture}
      {distance ? <div style={{ marginTop: 4, textAlign: 'center', color: '#fff', fontWeight: 700, fontSize: 13, textShadow: '0 1px 2px rgba(0,0,0,.9)' }}>{distance}</div> : null}
    </div>
  );
}

/**
 * THE FULL MAP (a tap on the corner map, or M — admin 2026-11-22, "jaise PUBG/Free Fire me"): the whole world, north up —
 * every place and land as a coloured area with its name, the roads, the user's own maps, the player and its heading, and the
 * markers. Drag to move, pinch or scroll to zoom, tap to mark a spot (tap it again to clear it). The world waits while it is
 * open (the Hud pauses the game), so no move meant for the map ever walks the player.
 */
export function FullMap({ game, style, onClose }: { game: Game; style: MinimapStyle; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<MapCamera | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; t: number; moved: boolean; pinch: number } | null>(null);
  const [marked, setMarked] = useState<WorldMapPoint | null>(getWaypoint());
  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => events.on('WAYPOINT_CHANGED', () => setMarked(getWaypoint())), []);

  /** What is on the map now, how big the screen is, and the view (opened on the player, zoomed out to show the world). */
  const frame = () => {
    const w = worldView(game);
    const wp = getWaypoint();
    const bounds = w.data.bounds ?? boundsOf(w.data.places, w.data.roads, [w.me, ...w.markers, ...(wp ? [wp] : [])]);
    const width = box.current?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0) || 800;
    const height = box.current?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0) || 600;
    if (!cam.current) cam.current = { ...fitCamera(bounds, width, height), cx: w.me.x, cz: w.me.z };
    cam.current = clampCamera(cam.current, bounds, width, height);
    return { w, wp, bounds, width, height, cam: cam.current };
  };
  const draw = () => {
    const el = canvas.current;
    const c = el?.getContext('2d');
    if (!el || !c) return;
    const f = frame();
    const dpr = pixelRatio(), pw = Math.round(f.width * dpr), ph = Math.round(f.height * dpr);
    if (el.width !== pw || el.height !== ph) { el.width = pw; el.height = ph; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = f.cam.scale, safe = settings.get().colourSafe;
    const at = (q: WorldMapPoint) => worldToMap(f.cam, f.width, f.height, q);
    c.fillStyle = '#14231a'; c.fillRect(0, 0, f.width, f.height);
    // A grid of round distances, so the map reads as a size.
    const step = gridStep(s), tl = mapToWorld(f.cam, f.width, f.height, { x: 0, y: 0 }), br = mapToWorld(f.cam, f.width, f.height, { x: f.width, y: f.height });
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1; c.beginPath();
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) { const sx = at({ x, z: 0 }).x; c.moveTo(sx, 0); c.lineTo(sx, f.height); }
    for (let z = Math.ceil(tl.z / step) * step; z <= br.z; z += step) { const sy = at({ x: 0, z }).y; c.moveTo(0, sy); c.lineTo(f.width, sy); }
    c.stroke();
    for (const p of f.w.data.places) {
      tracePlace(c, p, at, s);
      c.globalAlpha = 0.55; c.fillStyle = placeColour(p.kind); c.fill(); c.globalAlpha = 1;
      c.strokeStyle = placeColour(p.kind); c.lineWidth = 2; if (p.kind === 'custom') c.setLineDash([6, 4]); c.stroke(); c.setLineDash([]);
    }
    for (const line of f.w.data.roads) strokeRoad(c, line, at, s);
    if (style.names) for (const p of f.w.data.places) {
      if (!p.name) continue;
      const q = at(p); mapLabel(c, p.name, q.x, q.y, Math.round(Math.max(11, Math.min(22, p.radius * s * 0.3))));
    }
    for (const m of f.w.markers) { const q = at(m); c.fillStyle = markerColour(m.kind, safe); c.beginPath(); c.arc(q.x, q.y, 5, 0, Math.PI * 2); c.fill(); }
    if (f.wp) {
      const q = at(f.wp);
      mapPin(c, q.x, q.y, safe ? WAYPOINT_COLOUR_SAFE : WAYPOINT_COLOUR, 10);
      mapLabel(c, formatDistance(Math.hypot(f.wp.x - f.w.me.x, f.wp.z - f.w.me.z)), q.x, q.y - 32, 12);
    }
    const me = at(f.w.me);
    c.beginPath(); c.arc(me.x, me.y, 16, 0, Math.PI * 2); c.fillStyle = 'rgba(253,224,71,0.25)'; c.fill();
    mapArrow(c, me.x, me.y, Math.atan2(Math.sin(f.w.facing), -Math.cos(f.w.facing)), 11);
    // A scale bar at the lower left.
    const bar = gridStep(s, 60), len = bar * s, bx = 16, by = f.height - 64;
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(bx, by - 5); c.lineTo(bx, by); c.lineTo(bx + len, by); c.lineTo(bx + len, by - 5); c.stroke();
    mapLabel(c, formatDistance(bar), bx + len / 2, by - 12, 11);
  };
  const drawRef = useRef(draw); drawRef.current = draw;
  const frameRef = useRef(frame); frameRef.current = frame;
  useEffect(() => {
    const redraw = () => drawRef.current();
    redraw();
    const timer = setInterval(redraw, 250);
    window.addEventListener('resize', redraw);
    // Scroll zooms around the mouse. Bound by hand: React's wheel listener is passive, and the page must not scroll instead.
    const el = canvas.current;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = frameRef.current(); const r = el!.getBoundingClientRect();
      cam.current = zoomAt(f.cam, f.bounds, f.width, f.height, Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
      redraw();
    };
    el?.addEventListener('wheel', onWheel, { passive: false });
    return () => { clearInterval(timer); window.removeEventListener('resize', redraw); el?.removeEventListener('wheel', onWheel); };
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  /** A tap marks the spot under it — or clears the marked spot when it lands on it. */
  const tap = (q: { x: number; y: number }) => {
    const f = frame();
    if (f.wp) {
      const s = worldToMap(f.cam, f.width, f.height, f.wp);
      if (Math.hypot(s.x - q.x, s.y - q.y - 16) < 26) { setWaypoint(null); draw(); return; }
    }
    setWaypoint(mapToWorld(f.cam, f.width, f.height, q)); draw();
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable: moves still arrive while over the map */ }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) gesture.current = { x: p.x, y: p.y, t: Date.now(), moved: false, pinch: 0 };
    else if (gesture.current) { gesture.current.moved = true; gesture.current.pinch = 0; }
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const f = frame(), g = gesture.current;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g && g.pinch > 0 && d > 0) cam.current = zoomAt(f.cam, f.bounds, f.width, f.height, d / g.pinch, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      if (g) g.pinch = d;
    } else {
      cam.current = panBy(f.cam, f.bounds, f.width, f.height, p.x - prev.x, p.y - prev.y);
      if (g && Math.hypot(p.x - g.x, p.y - g.y) > 8) g.moved = true;
    }
    draw();
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const had = pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (had && pointers.current.size === 0 && g && !g.moved && Date.now() - g.t < 500 && e.type === 'pointerup') tap(local(e));
    if (pointers.current.size === 0) gesture.current = null; else if (g) g.pinch = 0;
  };
  const zoomBy = (factor: number) => { const f = frame(); cam.current = zoomAt(f.cam, f.bounds, f.width, f.height, factor, { x: f.width / 2, y: f.height / 2 }); draw(); };
  const centre = () => { const f = frame(); cam.current = clampCamera({ ...f.cam, cx: f.w.me.x, cz: f.w.me.z }, f.bounds, f.width, f.height); draw(); };
  const corner = { position: 'absolute' as const, top: 'max(12px, env(safe-area-inset-top))' };
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label={t('map')} style={{ position: 'absolute', inset: 0, zIndex: 30, background: '#14231a', color: '#fff', touchAction: 'none', userSelect: 'none' }}>
      <canvas ref={canvas} role="img" aria-label={t('map')} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }} />
      <div style={{ ...corner, left: 'max(16px, env(safe-area-inset-left))', fontWeight: 800, fontSize: 22, textShadow: '0 1px 3px rgba(0,0,0,.9)', pointerEvents: 'none' }}>{t('map')}</div>
      <button ref={closeButton} type="button" aria-label={t('close')} onClick={onClose} style={{ ...roundIcon, ...corner, right: 'max(12px, env(safe-area-inset-right))', fontSize: 24 }}>×</button>
      {marked ? (
        <button type="button" onClick={() => { setWaypoint(null); draw(); }}
          style={{ ...secondary, ...corner, left: '50%', transform: 'translateX(-50%)', marginTop: 0, minWidth: 0, minHeight: 40, padding: '6px 14px', fontSize: 14 }}>
          {t('clearMarker')}
        </button>
      ) : null}
      <div style={{ position: 'absolute', right: 'max(12px, env(safe-area-inset-right))', bottom: 'max(56px, calc(env(safe-area-inset-bottom) + 48px))', display: 'grid', gap: 10 }}>
        <button type="button" aria-label={t('zoomIn')} onClick={() => zoomBy(1.6)} style={{ ...roundIcon, fontSize: 22 }}>+</button>
        <button type="button" aria-label={t('zoomOut')} onClick={() => zoomBy(1 / 1.6)} style={{ ...roundIcon, fontSize: 22 }}>−</button>
        <button type="button" aria-label={t('centreMap')} onClick={centre} style={roundIcon}>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="10" cy="10" r="2" fill="currentColor" /><path d="M10 0v4M10 16v4M0 10h4M16 10h4" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
      </div>
      <div style={{ position: 'absolute', left: '50%', bottom: 'max(14px, env(safe-area-inset-bottom))', transform: 'translateX(-50%)', maxWidth: '86vw', textAlign: 'center', fontSize: 13, opacity: 0.85, textShadow: '0 1px 2px rgba(0,0,0,.9)', pointerEvents: 'none' }}>
        {t('mapHint')}
      </div>
    </div>
  );
}

/** What the player is trying to do (core/quests.ts), with progress — under the score. */
export function ObjectiveList({ below = 0 }: { below?: number }) {
  const [list, setList] = useState<readonly Objective[]>(objectives.list);
  useEffect(() => events.on('OBJECTIVES_CHANGED', () => setList(objectives.list)), []);
  if (list.length === 0) return null;
  // below: pixels to move down — the minimap stands in the right corner (minimap: { corner: 'right' }).
  const top = 'max(64px, calc(env(safe-area-inset-top) + 56px))';
  return (
    <ul aria-label="Objectives" style={{ position: 'absolute', right: 'max(12px, env(safe-area-inset-right))', top: below > 0 ? 'calc(' + top + ' + ' + below + 'px)' : top, listStyle: 'none', margin: 0, padding: '8px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 14, maxWidth: 'min(46vw, 260px)', pointerEvents: 'none', zIndex: 5, textShadow: '0 1px 2px rgba(0,0,0,.8)' }}>
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
  // Recipes re-read on every bag change (useInventory re-renders this panel).
  const recipes: RecipeView[] = crafting.list;
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
      {recipes.length ? (
        <>
          <h3 style={{ fontSize: 18, fontWeight: 800, marginTop: 14 }}>{t('crafting')}</h3>
          <ul aria-label={t('crafting')} style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 6, textAlign: 'left' }}>
            {recipes.map((r) => (
              <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.08)' }}>
                <span aria-hidden="true" style={{ fontSize: 22, width: 28, textAlign: 'center' }}>{r.icon ?? '🛠️'}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 700 }}>{r.name}</span>
                  <span style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>
                    {Object.entries(r.needs).map(([item, n]) => inventory.nameOf(item) + ' ' + Math.min(inventory.count(item), n) + '/' + n).join(' · ')}
                  </span>
                </span>
                <button type="button" disabled={!r.can} onClick={() => crafting.craft(r.id)}
                  style={{ ...button, marginTop: 0, minWidth: 0, padding: '6px 12px', fontSize: 14, opacity: r.can ? 1 : 0.5, cursor: r.can ? 'pointer' : 'not-allowed' }}>{t('craft')}</button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <button type="button" style={secondary} onClick={onBack}>{t('close')}</button>
    </div>
  );
}


/** Frames per second, read twice a second, with the quality being drawn (Settings → FPS counter). */
export function FpsCounter({ game }: { game: Pick<Game, 'fps' | 'quality'> }) {
  const [v, setV] = useState({ fps: game.fps, quality: game.quality });
  useEffect(() => {
    const id = setInterval(() => setV({ fps: game.fps, quality: game.quality }), 500);
    return () => clearInterval(id);
  }, [game]);
  const colour = v.fps >= 50 ? '#4ade80' : v.fps >= 30 ? '#fde047' : '#f87171';
  return (
    <div aria-label={'FPS ' + v.fps} style={{ position: 'absolute', left: 'max(12px, env(safe-area-inset-left))', bottom: 'max(12px, env(safe-area-inset-bottom))', padding: '2px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: colour, font: '700 12px ui-monospace, monospace', pointerEvents: 'none', zIndex: 6 }}>
      {v.fps + ' FPS · ' + t(v.quality === 'low' ? 'smooth' : v.quality === 'medium' ? 'balanced' : 'sharp')}
    </div>
  );
}

/**
 * Share the score: the phone's own share sheet where there is one (WhatsApp, Instagram…), otherwise the text is copied.
 * Resolves 'shared', 'copied', or 'unavailable' (no way to share at all — the button then hides).
 */
export async function shareScore(text: string, url: string): Promise<'shared' | 'copied' | 'unavailable'> {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (typeof nav.share === 'function') {
    try { await nav.share({ text, url }); return 'shared'; } catch { /* dismissed or refused: try copying */ }
  }
  if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try { await nav.clipboard.writeText(text + ' ' + url); return 'copied'; } catch { /* blocked */ }
  }
  return 'unavailable';
}

export function canShare(): boolean {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { share?: unknown };
  return typeof nav.share === 'function' || !!(nav.clipboard && typeof nav.clipboard.writeText === 'function');
}

function ShareButton({ score, title }: { score: number; title: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'gone'>('idle');
  if (state === 'gone' || !canShare() || score <= 0) return null;
  const go = async () => {
    const r = await shareScore(t('shareText', { score, game: title }), typeof location !== 'undefined' ? location.href : '');
    setState(r === 'copied' ? 'copied' : r === 'unavailable' ? 'gone' : 'idle');
  };
  return <button type="button" style={secondary} onClick={() => { void go(); }}>{state === 'copied' ? t('copied') : t('share')}</button>;
}

/** The best five on this device, the round just played highlighted. Shown once there are at least two. */
export function DeviceLeaderboard({ gameId }: { gameId: string }) {
  const list = leaderboard.top(gameId, 5);
  if (list.length < 2) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, opacity: 0.8 }}>{t('bestOnDevice')}</div>
      <ol aria-label={t('bestOnDevice')} style={{ textAlign: 'left', margin: '4px auto 0', maxWidth: 220, paddingLeft: 24 }}>
        {list.map((e, i) => {
          const mine = leaderboard.isLatest(gameId, e);
          return <li key={i} style={{ fontWeight: mine ? 900 : 500, color: mine ? '#fde047' : '#fff' }}>{e.score}</li>;
        })}
      </ol>
    </div>
  );
}

/** The active power-ups: an icon each, a ring for the time left, the level when it stacks. */
export function PowerUpBar() {
  const [list, setList] = useState<ActivePowerUp[]>(powerUps.list);
  useEffect(() => {
    const sync = () => setList(powerUps.list);
    const off = events.on('POWERUPS_CHANGED', sync);
    const id = setInterval(sync, 200);   // the rings move between changes
    return () => { off(); clearInterval(id); };
  }, []);
  if (list.length === 0) return null;
  return (
    <div aria-label="Power-ups" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 'max(56px, calc(env(safe-area-inset-top) + 48px))', display: 'flex', gap: 8, pointerEvents: 'none', zIndex: 5 }}>
      {list.map((p) => {
        const f = p.total > 0 ? Math.max(0, Math.min(1, p.remaining / p.total)) : 0;
        return (
          <div key={p.id} role="img" aria-label={p.name + ' ' + Math.ceil(p.remaining) + 's'} style={{ position: 'relative', width: 40, height: 40, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 20, background: 'conic-gradient(#fde047 ' + Math.round(f * 360) + 'deg, rgba(255,255,255,0.18) 0deg)', opacity: p.remaining < 2 ? 0.6 + 0.4 * Math.abs(Math.sin(p.remaining * 8)) : 1 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 999, background: 'rgba(0,0,0,0.6)' }}>{p.icon}</span>
            {p.level > 1 ? <span style={{ position: 'absolute', right: -4, bottom: -4, fontSize: 11, fontWeight: 800, color: '#111', background: '#fde047', borderRadius: 999, padding: '0 4px' }}>{'x' + p.level}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Thanks to the people and assets behind the game (options.credits). */
export function CreditsPanel({ list, onBack }: { list: Array<{ role: string; name: string }>; onBack: () => void }) {
  return (
    <div style={{ width: 'min(92vw, 420px)' }}>
      <h2 style={{ fontSize: 26, fontWeight: 800 }}>{t('credits')}</h2>
      <ul aria-label={t('credits')} style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 6, maxHeight: '55vh', overflowY: 'auto' }}>
        {list.map((c, i) => (
          <li key={i}>{c.role ? <span style={{ opacity: 0.75, marginRight: 8 }}>{c.role}</span> : null}<span style={{ fontWeight: 700 }}>{c.name}</span></li>
        ))}
      </ul>
      <button type="button" style={secondary} onClick={onBack}>{t('back')}</button>
    </div>
  );
}

/** Which events get a caption, and the words (Settings → Captions). */
export const CAPTIONED: Readonly<Record<string, StringKey>> = {
  PLAYER_DAMAGED: 'capHit', ENEMY_DIED: 'capEnemyDown', ITEM_COLLECTED: 'capPickup', WEAPON_RELOADING: 'capReload',
  WEAPON_EMPTY: 'capEmpty', BOSS_SPAWNED: 'capBoss', BOSS_DEFEATED: 'capBossDown', LEVEL_UP: 'capLevelUp',
  GOAL_COMPLETED: 'capCoin', ENEMY_ALERTED: 'capDanger',
};

/** Captions: the last two important sounds as words, each for a moment. */
export function CaptionBar() {
  const [lines, setLines] = useState<Array<{ id: number; text: string }>>([]);
  useEffect(() => {
    let n = 0;
    const offs = Object.entries(CAPTIONED).map(([event, key]) => events.on(event, () => {
      const id = ++n;
      setLines((cur) => [...cur.filter((l) => l.text !== t(key)), { id, text: t(key) }].slice(-2));
      setTimeout(() => setLines((cur) => cur.filter((l) => l.id !== id)), 1600);
    }));
    return () => offs.forEach((o) => o());
  }, []);
  if (lines.length === 0) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'max(170px, calc(env(safe-area-inset-bottom) + 160px))', display: 'grid', gap: 4, justifyItems: 'center', pointerEvents: 'none', zIndex: 6 }}>
      {lines.map((l) => <span key={l.id} style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.75)', color: '#fff', fontSize: 15 }}>{'[' + l.text + ']'}</span>)}
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
/** Each rebindable action's label in the game's language. */
const ACTION_LABEL: Record<string, StringKey> = {
  up: 'up', down: 'down', left: 'left', right: 'right', jump: 'jump', sprint: 'run', crouch: 'crouch', attack: 'attack', interact: 'use', reload: 'reload', drift: 'drift',
};

/**
 * CONTROLS — change a key: tap the key shown beside an action, then press the new key (Esc cancels). Shown on a keyboard
 * device in a one-player game; a phone plays with the touch buttons, and two players keep fixed halves of the keyboard.
 */
function ControlsSection({ game }: { game: Game }) {
  const keys = game.keys;
  const [waiting, setWaiting] = useState<string | null>(null);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!waiting || !keys) return;
    return captureKey(window, (code) => {
      if (code) rebindKey(keys, waiting, code);
      setWaiting(null);
      redraw((n) => n + 1);
    });
  }, [waiting, keys]);
  if (!keys || prefersTouch()) return null;
  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 800, margin: '14px 0 4px' }}>{t('controls')}</h3>
      {REBINDABLE_ACTIONS.filter((a) => keys[a]).map((a) => (
        <div key={a} style={row}>
          <span>{t(ACTION_LABEL[a] ?? 'use')}</span>
          <button type="button" aria-label={t(ACTION_LABEL[a] ?? 'use') + ': ' + (waiting === a ? t('pressKey') : keyLabel(primaryKey(keys, a)))}
            onClick={() => setWaiting(waiting === a ? null : a)}
            style={{ ...secondary, marginTop: 0, minWidth: 84, minHeight: 40, padding: '6px 14px', background: waiting === a ? '#fde047' : 'rgba(255,255,255,0.14)', color: waiting === a ? '#111' : '#fff' }}>
            {waiting === a ? t('pressKey') : keyLabel(primaryKey(keys, a))}
          </button>
        </div>
      ))}
      <button type="button" style={secondary} onClick={() => { resetKeyBindings(keys); setWaiting(null); redraw((n) => n + 1); }}>{t('resetControls')}</button>
    </div>
  );
}

/**
 * EDIT CONTROLS — on a touch screen the player moves and resizes every on-screen control (each action button, the
 * joystick, the drive pads) and sets how see-through they are; saved for this game on this device (ui/touchControls.ts).
 */
function TouchLayoutSection({ game, onBack }: { game: Game; onBack: () => void }) {
  const touch = game.touchControls;
  if (!touch || !touch.visible) return null;
  return (
    <button type="button" style={secondary} onClick={() => { onBack(); touch.editLayout(); }}>{t('editControls')}</button>
  );
}

function SettingsPanel({ game, onBack }: { game: Game; onBack: () => void }) {
  const s = useSettings();
  const lang = useLanguage();
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
      <Toggle label={t('autoQuality')} on={s.autoQuality} onChange={(v) => settings.set({ autoQuality: v })} />
      <Toggle label={t('fpsCounter')} on={s.showFps} onChange={(v) => settings.set({ showFps: v })} />
      <Toggle label={t('reduceMotion')} on={s.reduceMotion} onChange={(v) => settings.set({ reduceMotion: v })} />
      <Toggle label={t('largeText')} on={s.largeText} onChange={(v) => settings.set({ largeText: v })} />
      <Toggle label={t('colourSafe')} on={s.colourSafe} onChange={(v) => settings.set({ colourSafe: v })} />
      <Toggle label={t('captions')} on={s.captions} onChange={(v) => settings.set({ captions: v })} />
      {game.minimapOption !== false ? <Toggle label={t('minimap')} on={s.showMinimap} onChange={(v) => settings.set({ showMinimap: v })} /> : null}
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
      <div style={row}>
        <span>{t('language')}</span>
        <select aria-label={t('language')} value={lang} onChange={(e) => choosePlayerLanguage(e.target.value as GameLanguage)}
          style={{ minHeight: 40, padding: '6px 10px', borderRadius: 8, border: '2px solid rgba(255,255,255,0.55)', background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 15 }}>
          {GAME_LANGUAGES.map((l) => <option key={l} value={l} style={{ color: '#111' }}>{GAME_LANGUAGE_NATIVE_NAMES[l]}</option>)}
        </select>
      </div>
      <ControlsSection game={game} />
      <TouchLayoutSection game={game} onBack={onBack} />
      <button ref={back} type="button" style={button} onClick={onBack}>{t('back')}</button>
    </div>
  );
}

/** "E — get in" beside a vehicle the player may take (ctx.vehicles), "E — get out" inside one. */
function SeatPrompt({ game }: { game: Game }) {
  const [what, setWhat] = useState<'in' | 'out' | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setWhat(game.seatPrompt), 200);
    return () => window.clearInterval(id);
  }, [game]);
  if (!what) return null;
  const key = prefersTouch() ? t('use') : 'E';
  return (
    <div role="status" style={{ position: 'absolute', left: '50%', bottom: '22%', transform: 'translateX(-50%)', padding: '8px 16px', borderRadius: 999, background: 'rgba(0,0,0,0.6)', color: '#fff', fontWeight: 700, pointerEvents: 'none' }}>
      {t(what === 'in' ? 'getIn' : 'getOut', { key })}
    </div>
  );
}

export function Hud({ game }: { game: Game }) {
  const s = useGameState();
  const prefs = useSettings();
  useLanguage();   // a new language re-renders every screen in its words
  // Large text (Settings): the menus and the top bar drawn a quarter bigger.
  const zoom = prefs.largeText ? 1.25 : 1;
  const load = useLoading();
  const fullscreen = useFullscreen(game);
  useLevels();
  const hasLevels = levels.count > 0;
  /** Begin play on the chosen (or current) level — the game builds it on LEVEL_STARTED. */
  const playLevel = (i: number) => { if (hasLevels && !levels.start(i)) return; game.play(); };
  const replayLevel = () => { if (hasLevels) levels.start(levels.index); game.restart(); };
  const nextLevel = () => { if (levels.next()) game.restart(); };
  const [panel, setPanel] = useState<'settings' | 'inventory' | 'shop' | 'credits' | 'map' | null>(null);
  // 🗺️ THE MAP (admin 2026-11-22): a tap on the corner map, or M, opens the whole map; the world waits while it is open.
  const hasWorld = useWorldMap();
  const mapStyle = minimapStyle(game.minimapOption === false ? {} : game.minimapStyle, hasWorld);
  const canOpenMap = game.minimapOption !== false && mapStyle.fullMap;
  const openMap = () => { if (state.status !== 'playing') return; game.pause(); setPanel('map'); };
  const closeMap = () => { setPanel(null); game.resume(); };
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
      // M opens the whole map during play (and closes it again) — the corner map's tap, on a keyboard.
      if ((e.key === 'm' || e.key === 'M') && !dialogue.active && canOpenMap) {
        if (s.status === 'playing') { openMap(); return; }
        if (panel === 'map') { closeMap(); return; }
      }
      if (e.key !== 'Escape') return;
      if (panel === 'inventory' || panel === 'map') { setPanel(null); game.resume(); return; }
      if (panel) { setPanel(null); return; }
      if (s.status === 'playing') game.pause();
      else if (s.status === 'paused') game.resume();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, s.status, panel, canOpenMap]);

  const settingsOrScreen = (screen: React.ReactNode) => (
    <div style={overlay}><div style={{ zoom }}>{panel === 'settings' ? <SettingsPanel game={game} onBack={() => setPanel(null)} /> : panel === 'inventory' ? <InventoryPanel onBack={() => { setPanel(null); game.resume(); }} /> : panel === 'shop' ? <ShopPanel onBack={() => setPanel(null)} /> : panel === 'credits' ? <CreditsPanel list={game.creditsList} onBack={() => setPanel(null)} /> : screen}</div></div>
  );

  return (
    <>
      {/* pointerEvents none, or the HUD silently eats clicks meant for the game */}
      {s.status !== 'menu' ? (
        <div style={{ position: 'absolute', top: 'max(12px, env(safe-area-inset-top))', left: 'max(12px, env(safe-area-inset-left))', right: 'max(12px, env(safe-area-inset-right))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)', zIndex: 5, zoom }}>
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
              <div style={{ width: \`\${Math.max(0, Math.min(100, (s.health / Math.max(1, s.maxHealth)) * 100))}%\`, height: '100%', background: (prefs.colourSafe ? HEALTH_COLOURS_SAFE : HEALTH_COLOURS)[s.health > s.maxHealth * 0.3 ? 'ok' : 'low'], transition: 'width 160ms ease-out' }} />
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
      {prefs.showFps && s.status !== 'menu' ? <FpsCounter game={game} /> : null}
      {s.status === 'playing' ? <HintBar /> : null}
      {s.status === 'playing' || (s.status === 'paused' && panel !== 'map') ? <Minimap game={game} onOpen={canOpenMap ? openMap : undefined} /> : null}
      {s.status === 'playing' || s.status === 'paused' ? <ObjectiveList below={mapStyle.corner === 'right' && game.minimapOption !== false && prefs.showMinimap !== false ? mapStyle.size + 12 : 0} /> : null}
      <ShooterOverlay game={game} playing={s.status === 'playing'} />
      {s.status === 'playing' ? <DialogueBox /> : null}
      {s.status === 'playing' ? <SeatPrompt game={game} /> : null}
      {s.status === 'playing' || s.status === 'paused' ? <PowerUpBar /> : null}
      {prefs.captions && s.status === 'playing' ? <CaptionBar /> : null}
      {s.status === 'playing' || s.status === 'paused' ? <RaceOverlay /> : null}

      {s.status === 'menu' && info ? settingsOrScreen(
        <div style={{ maxWidth: 440, padding: '0 16px' }}>
          <h1 style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.1 }}>{info.title}</h1>
          {info.subtitle ? <p style={{ opacity: 0.9, marginTop: 8, fontSize: 17 }}>{info.subtitle}</p> : null}
          <p style={{ opacity: 0.75, marginTop: 12, fontSize: 14 }}>{touch ? info.controls.touch : info.controls.keyboard}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {game.canContinue ? (
              <>
                <button ref={playRef} type="button" style={button} onClick={() => playLevel(levels.index)}>{t('continueGame')}</button>
                <button type="button" style={secondary} onClick={() => game.newGame()}>{t('newGame')}</button>
              </>
            ) : <button ref={playRef} type="button" style={button} onClick={() => playLevel(levels.index)}>{t('play')}</button>}
            {economy.ready ? <button type="button" style={secondary} onClick={() => setPanel('shop')}>{t('shop')} · 🪙{shop.coins}</button> : null}
            <button type="button" style={secondary} onClick={() => setPanel('settings')}>{t('settings')}</button>
            {game.creditsList.length ? <button type="button" style={secondary} onClick={() => setPanel('credits')}>{t('credits')}</button> : null}
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

      {s.status === 'paused' && panel === 'map' ? <FullMap game={game} style={mapStyle} onClose={closeMap} /> : null}
      {s.status === 'paused' && panel !== 'map' ? settingsOrScreen(
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
          {lastRaceResults ? null : <DeviceLeaderboard gameId={game.leaderboardId} />}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {s.status === 'won' && hasLevels && levels.hasNext ? <button type="button" style={button} onClick={nextLevel}>{t('nextLevel')}</button> : null}
            <button ref={again} type="button" style={s.status === 'won' && hasLevels && levels.hasNext ? secondary : button} onClick={replayLevel}>{t('playAgain')}</button>
            {economy.ready ? <button type="button" style={secondary} onClick={() => setPanel('shop')}>{t('shop')} · 🪙{shop.coins}</button> : null}
            <ShareButton score={s.score} title={info?.title || (typeof document !== 'undefined' ? document.title : '') || 'NavBharatAI'} />
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

/** How a car is driven on a touch screen (TouchControlsOptions.drive). */
export type DriveControls = 'pads' | 'tilt' | 'auto' | 'joystick';

/** Any value → a known DriveControls; unknown or missing → 'pads'. */
export function resolveDriveControls(value: unknown): DriveControls {
  return value === 'tilt' || value === 'auto' || value === 'joystick' || value === 'pads' ? value : 'pads';
}

/** Tilt-to-steer: degrees of tilt for full lock, and the dead zone around level (as a fraction of full lock). */
export const TILT_FULL_LOCK_DEG = 28;
export const TILT_DEAD_ZONE = 0.08;

/**
 * The steering a tilt reading gives, -1 (full left) .. 1 (full right). The phone's tilt about the axis that points
 * along the screen's width: gamma held upright (portrait), beta held sideways (landscape; its sign follows which way
 * the phone was turned). PURE.
 */
export function steerFromTilt(beta: number | null | undefined, gamma: number | null | undefined, screenAngle: number): number {
  const a = ((Math.round(Number(screenAngle) || 0) % 360) + 360) % 360;
  const b = Number.isFinite(beta as number) ? (beta as number) : 0;
  const g = Number.isFinite(gamma as number) ? (gamma as number) : 0;
  const deg = a === 90 ? b : a === 270 ? -b : a === 180 ? -g : g;
  const v = Math.max(-1, Math.min(1, deg / TILT_FULL_LOCK_DEG));
  if (Math.abs(v) < TILT_DEAD_ZONE) return 0;
  return Math.sign(v) * ((Math.abs(v) - TILT_DEAD_ZONE) / (1 - TILT_DEAD_ZONE));
}

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
  /** From the prompt: side 'right' swaps halves (buttons go left); size 0.6..2; 'fixed' or 'floating' (default); position x/y 0..1. */
  joystick?: TouchJoystickOptions;
  /**
   * 🚗 HOW A CAR IS DRIVEN ON A PHONE — from the user's words (admin 2026-11-23: "car control hardcore joystick se nahi honi
   * chahiye, user jo prompt de usse ho"). Default 'pads'. The keyboard (W/A/S/D, arrows) always works on a computer.
   *   'pads'     — Left / Right under the left thumb, Brake / Gas under the right ("buttons se chalao").
   *   'tilt'     — tilt the phone to steer ("phone jhuka ke", "tilt", "gyro"), Brake / Gas buttons. Until the phone's
   *                tilt sensor answers (or where it never does) the Left / Right pads stay on screen.
   *   'auto'     — the car drives itself forward; the player only steers and brakes ("easy", "simple", "sirf steering").
   *   'joystick' — the analogue stick steers and drives, as before. Only when the user asks for a joystick.
   */
  drive?: DriveControls;
  /** By action name, or 'steer' / 'pedals': CENTRE x/y as a fraction of the screen (0..1), size 0.6..2. */
  buttonPositions?: Record<string, TouchPlacement>;
  /** How see-through the controls are, 0.2..1 (default 1). */
  opacity?: number;
  /** The player's Settings → Edit controls layout is saved per gameId and always wins over the three options above. */
  gameId?: string;
}

/** Where a control sits: its CENTRE as a fraction of the game area (0..1), and a size multiplier (1 = the kit's size). */
export interface TouchPlacement {
  x: number;
  y: number;
  size?: number;
}

export interface TouchJoystickOptions {
  side?: 'left' | 'right';
  size?: number;
  mode?: 'floating' | 'fixed';
  position?: { x: number; y: number };
}

/** The layout a player saved in Settings → Edit controls. Each field is optional: a missing one keeps the default. */
/** A HUD element the layout editor can move and resize (TouchControls.addHudElement). */
export interface HudElementSpec {
  /** The name shown on its box in the editor. */
  label: string;
  /** Its size in pixels at size 1. */
  width: number;
  height: number;
  /** Where its centre is now, in page pixels (getBoundingClientRect), when the layout has not placed it. */
  home: () => { x: number; y: number } | null;
  /** Called with where to draw it: x and y (0..1 of the screen) when placed, and always its size (1 = its own). */
  apply: (placement: { x?: number; y?: number; size: number }) => void;
}

export interface SavedTouchLayout {
  controls: Record<string, { x?: number; y?: number; size?: number }>;
  opacity?: number;
  /** The player's own choice in the editor; it beats the game's joystick.mode. */
  joystickMode?: 'floating' | 'fixed';
}

/** A control's place after the defaults, the prompt's options and the player's layout are merged. No x/y = the kit's spot. */
export interface ResolvedTouchPlacement {
  x?: number;
  y?: number;
  size: number;
}

export interface ResolvedTouchLayout {
  controls: Record<string, ResolvedTouchPlacement>;
  opacity: number;
  joystickMode: 'floating' | 'fixed';
}

/** The joystick's id in a layout. The drive pads are 'steer' and 'pedals'; every action button is its action name. */
export const JOYSTICK_CONTROL = 'joystick';
export const TOUCH_SIZE_MIN = 0.6;
export const TOUCH_SIZE_MAX = 2;
export const TOUCH_OPACITY_MIN = 0.2;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Anything read from storage (or written by a builder) is untrusted: bad numbers are dropped, good ones kept in range. */
export function sanitizeTouchLayout(raw: unknown): SavedTouchLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SavedTouchLayout = { controls: {} };
  const controls = (r.controls && typeof r.controls === 'object' ? r.controls : {}) as Record<string, unknown>;
  for (const id of Object.keys(controls).slice(0, 40)) {
    // A key that names the object's own machinery is never a control (a hand-edited value could carry one).
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
    const c = controls[id];
    if (!c || typeof c !== 'object') continue;
    const p = c as Record<string, unknown>;
    const entry: { x?: number; y?: number; size?: number } = {};
    // A position is a pair: half of one is no position at all.
    if (finite(p.x) && finite(p.y)) { entry.x = clampNum(p.x, 0, 1); entry.y = clampNum(p.y, 0, 1); }
    if (finite(p.size)) entry.size = clampNum(p.size, TOUCH_SIZE_MIN, TOUCH_SIZE_MAX);
    if (entry.x !== undefined || entry.size !== undefined) out.controls[id] = entry;
  }
  if (finite(r.opacity)) out.opacity = clampNum(r.opacity, TOUCH_OPACITY_MIN, 1);
  if (r.joystickMode === 'floating' || r.joystickMode === 'fixed') out.joystickMode = r.joystickMode;
  return out;
}

/**
 * The layout the controls are drawn with: the kit's defaults, then what the BUILDER chose from the user's prompt
 * (joystick, buttonPositions, opacity), then what the PLAYER saved — the player always has the last word.
 */
export function resolveTouchLayout(options: TouchControlsOptions, saved: SavedTouchLayout | null): ResolvedTouchLayout {
  const prompt: SavedTouchLayout = { controls: {} };
  for (const [id, p] of Object.entries(options.buttonPositions ?? {})) prompt.controls[id] = { ...p };
  const j = options.joystick;
  if (j) prompt.controls[JOYSTICK_CONTROL] = { ...(j.position ?? {}), size: j.size };
  prompt.opacity = options.opacity;
  prompt.joystickMode = j?.mode;
  const clean = sanitizeTouchLayout(prompt);
  const mine = saved ? sanitizeTouchLayout(saved) : { controls: {} } as SavedTouchLayout;
  const controls: Record<string, ResolvedTouchPlacement> = {};
  for (const id of new Set([...Object.keys(clean.controls), ...Object.keys(mine.controls)])) {
    const a = clean.controls[id] ?? {};
    const b = mine.controls[id] ?? {};
    const at = b.x !== undefined ? b : a.x !== undefined ? a : null;
    controls[id] = { size: b.size ?? a.size ?? 1, ...(at ? { x: at.x, y: at.y } : {}) };
  }
  return { controls, opacity: mine.opacity ?? clean.opacity ?? 1, joystickMode: mine.joystickMode ?? clean.joystickMode ?? 'floating' };
}

/** Space the device keeps for itself at each edge (notch, home bar), in pixels. */
export interface ScreenInset { left: number; top: number; right: number; bottom: number }

/**
 * Keep a control's centre where the WHOLE control stays on screen and outside the safe-area inset. halfW / halfH are
 * half the control's size in pixels. A control bigger than the screen is centred. An unmeasured screen (0 × 0) only
 * keeps the fraction inside 0..1.
 */
export function clampTouchPlacement(x: number, y: number, halfW: number, halfH: number, w: number, h: number, inset: ScreenInset = { left: 0, top: 0, right: 0, bottom: 0 }): { x: number; y: number } {
  const axis = (v: number, half: number, size: number, lo: number, hi: number): number => {
    if (!(size > 0)) return clampNum(v, 0, 1);
    const min = (lo + half) / size;
    const max = (size - hi - half) / size;
    return min > max ? 0.5 : clampNum(v, min, max);
  };
  return { x: axis(x, halfW, w, inset.left, inset.right), y: axis(y, halfH, h, inset.top, inset.bottom) };
}

/** One control on screen for the overlap solver: its CENTRE in pixels and half its width / height in pixels. */
export interface TouchBox { id: string; x: number; y: number; hw: number; hh: number }

/** The clear space kept between two controls, in pixels. */
export const TOUCH_GAP = 4;
/** On a screen too small for every control, they shrink together by up to this much (0.4 = 40% of their size). */
export const TOUCH_FIT_MIN = 0.4;

/**
 * No control covers another, every control is whole on screen and outside the inset. Boxes come in PRIORITY order: the
 * first keeps its spot (the one the player just dropped or resized), each later one keeps its spot when that is free, or
 * moves to the NEAREST free spot. When some box has no free spot at all, every box shrinks by the same factor and the
 * search runs again, down to TOUCH_FIT_MIN; fits is false only when even that is not enough (then the boxes are left at
 * their wanted spots, kept on screen). Pure and deterministic: the same boxes and screen always give the same answer.
 */
export function separateTouchControls(boxes: TouchBox[], w: number, h: number, inset: ScreenInset, gap: number = TOUCH_GAP): { boxes: TouchBox[]; scale: number; fits: boolean } {
  // Two boxes overlap when they are closer than their halves plus the gap; 1 px of slack absorbs saved rounding.
  const hits = (a: TouchBox, b: TouchBox): boolean => Math.abs(a.x - b.x) < a.hw + b.hw + gap - 1 && Math.abs(a.y - b.y) < a.hh + b.hh + gap - 1;
  const fitAxis = (v: number, half: number, size: number, lo: number, hi: number): number | null => {
    const min = lo + half;
    const max = size - hi - half;
    return min > max ? null : clampNum(v, min, max);
  };
  const attempt = (scale: number): TouchBox[] | null => {
    const done: TouchBox[] = [];
    for (const b of boxes) {
      const hw = b.hw * scale;
      const hh = b.hh * scale;
      const x0 = fitAxis(b.x, hw, w, inset.left, inset.right);
      const y0 = fitAxis(b.y, hh, h, inset.top, inset.bottom);
      if (x0 === null || y0 === null) return null;
      const want: TouchBox = { id: b.id, x: x0, y: y0, hw, hh };
      if (!done.some((d) => hits(want, d))) { done.push(want); continue; }
      // A free spot, if one exists, touches an edge of the screen or of a placed box on each axis: try exactly those.
      const xs = [x0, inset.left + hw, w - inset.right - hw];
      const ys = [y0, inset.top + hh, h - inset.bottom - hh];
      for (const d of done) { xs.push(d.x - d.hw - gap - hw, d.x + d.hw + gap + hw); ys.push(d.y - d.hh - gap - hh, d.y + d.hh + gap + hh); }
      let best: TouchBox | null = null;
      let bestD = Infinity;
      for (const y of ys) {
        if (y < inset.top + hh - 0.001 || y > h - inset.bottom - hh + 0.001) continue;
        for (const x of xs) {
          if (x < inset.left + hw - 0.001 || x > w - inset.right - hw + 0.001) continue;
          const c: TouchBox = { id: b.id, x, y, hw, hh };
          if (done.some((d) => hits(c, d))) continue;
          const dist = (x - x0) * (x - x0) + (y - y0) * (y - y0);
          // Ties go to the spot higher up, then further left: a fixed rule, so the answer never depends on luck.
          if (dist < bestD - 1e-9 || (best && Math.abs(dist - bestD) <= 1e-9 && (y < best.y || (y === best.y && x < best.x)))) { best = c; bestD = dist; }
        }
      }
      if (!best) return null;
      done.push(best);
    }
    return done;
  };
  if (!(w > 0) || !(h > 0)) return { boxes: boxes.map((b) => ({ ...b })), scale: 1, fits: true };
  for (const scale of [1, 0.9, 0.8, 0.7, 0.6, 0.5, TOUCH_FIT_MIN]) {
    const placed = attempt(scale);
    if (placed) return { boxes: placed, scale, fits: true };
  }
  // Nothing fits even at the smallest size: smallest size, every box kept on screen, and fits says so.
  const s = TOUCH_FIT_MIN;
  return {
    boxes: boxes.map((b) => {
      const c = clampTouchPlacement(b.x / w, b.y / h, b.hw * s, b.hh * s, w, h, inset);
      return { id: b.id, x: c.x * w, y: c.y * h, hw: b.hw * s, hh: b.hh * s };
    }),
    scale: s,
    fits: false,
  };
}

/** A two-finger pinch: the size grows with the distance between the fingers, kept inside TOUCH_SIZE_MIN..MAX. */
export function touchPinchSize(startSize: number, startDistance: number, distance: number): number {
  if (!(startDistance > 0) || !Number.isFinite(distance)) return startSize;
  return Math.round(clampNum(startSize * (distance / startDistance), TOUCH_SIZE_MIN, TOUCH_SIZE_MAX) * 100) / 100;
}

/** A fraction of the game area to pixels inside it, and back. */
export function touchFractionToPixels(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return { x: x * w, y: y * h };
}
export function touchPixelsToFraction(px: number, py: number, w: number, h: number): { x: number; y: number } {
  return { x: w > 0 ? clampNum(px / w, 0, 1) : 0.5, y: h > 0 ? clampNum(py / h, 0, 1) : 0.5 };
}

/** Where a game's layout is kept on this device. */
export function touchLayoutStorageKey(gameId: string): string {
  return 'nbg-touch-layout-v1:' + (gameId || 'game');
}

export function loadTouchLayout(gameId: string): SavedTouchLayout | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(touchLayoutStorageKey(gameId));
    return raw ? sanitizeTouchLayout(JSON.parse(raw)) : null;
  } catch { return null; /* private mode or a corrupt value: the defaults */ }
}

/** Save (or, with null, forget) a game's layout. Never throws: an unsaved layout still applies until the page closes. */
export function saveTouchLayout(gameId: string, layout: SavedTouchLayout | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = touchLayoutStorageKey(gameId);
    if (!layout || (Object.keys(layout.controls).length === 0 && layout.opacity === undefined && layout.joystickMode === undefined)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(sanitizeTouchLayout(layout)));
  } catch { /* not saved, still applied */ }
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

/** In a car the player got into (ctx.vehicles), the drive pads carry Use too: the way out of the car. */
export const DRIVE_EXIT_BUTTON: TouchButton = { action: 'interact', label: 'Use' };

/** Is the PRIMARY pointer a finger? A touch-screen laptop answers no until it is actually touched. */
export function prefersTouch(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia('(pointer: coarse)').matches;
  return 'ontouchstart' in window;
}

const STICK_RADIUS = 56;
const DEAD_ZONE = 0.15;
// The kit's control sizes in pixels. The CSS below is built from these same numbers, so the overlap solver's idea of
// where an unplaced control sits can never drift from where the browser draws it.
const BTN = 64;
const BTN_GAP = 16;
const PAD = 76;
const PAD_ROW_GAP = 12;
const DRIFT_H = 46;

const isPlaced = (p: ResolvedTouchPlacement | undefined): p is ResolvedTouchPlacement & { x: number; y: number } => !!p && p.x !== undefined && p.y !== undefined;

const CSS = [
  '.nbg-tc{position:absolute;inset:0;z-index:4;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;display:none}',
  '.nbg-tc.on{display:block}',
  '.nbg-tc *{-webkit-tap-highlight-color:transparent;touch-action:none;box-sizing:border-box}',
  '.nbg-tc-move{position:absolute;left:0;bottom:0;width:50%;height:65%;pointer-events:auto}',
  '.nbg-tc-look{position:absolute;right:0;top:0;width:50%;height:100%;pointer-events:auto}',
  '.nbg-tc-base{position:absolute;width:' + STICK_RADIUS * 2 + 'px;height:' + STICK_RADIUS * 2 + 'px;margin:-' + STICK_RADIUS + 'px 0 0 -' + STICK_RADIUS + 'px;border-radius:50%;background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.35);opacity:0.55;transition:opacity 120ms}',
  '.nbg-tc-base.live{opacity:1}',
  '.nbg-tc-knob{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;background:rgba(255,255,255,0.55)}',
  '.nbg-tc-buttons{position:absolute;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(2,' + BTN + 'px);gap:' + BTN_GAP + 'px;pointer-events:none}',
  '.nbg-tc-btn{pointer-events:auto;width:' + BTN + 'px;height:' + BTN + 'px;border-radius:50%;border:2px solid rgba(255,255,255,0.5);background:rgba(0,0,0,0.35);color:#fff;font:600 13px/1 system-ui,sans-serif;display:grid;place-items:center;padding:0}',
  '.nbg-tc-btn.down{background:rgba(255,255,255,0.45);color:#111}',
  '.nbg-tc-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 16px;border-radius:10px;background:rgba(0,0,0,0.6);color:#fff;font:500 14px/1.3 system-ui,sans-serif;text-align:center;pointer-events:none;display:none}',
  '@media (orientation: portrait){.nbg-tc.hinting .nbg-tc-hint{display:block}}',
  // The 'drive' layout: two pads in the bottom corners, bigger than the action buttons (a thumb rests
  // on them for the whole race), and the move/look/action set hidden while it is up.
  '.nbg-tc-steer,.nbg-tc-pedals{position:absolute;bottom:max(16px,env(safe-area-inset-bottom));display:none;gap:' + BTN_GAP + 'px;pointer-events:none}',
  '.nbg-tc-steer{left:max(16px,env(safe-area-inset-left))}',
  '.nbg-tc-pedals{right:max(16px,env(safe-area-inset-right))}',
  '.nbg-tc-steer .nbg-tc-btn,.nbg-tc-pedals .nbg-tc-btn{width:' + PAD + 'px;height:' + PAD + 'px;border-radius:18px}',
  '.nbg-tc.drive .nbg-tc-steer,.nbg-tc.drive .nbg-tc-pedals{display:flex}',
  // Drift rides ABOVE Brake/Gas as a wide strip, so the pedal row stays two buttons wide on a 360 px phone.
  '.nbg-tc.drive .nbg-tc-pedals{display:grid;grid-template-columns:' + PAD + 'px ' + PAD + 'px;gap:' + PAD_ROW_GAP + 'px ' + BTN_GAP + 'px}',
  '.nbg-tc-pedals .nbg-tc-btn[data-action="drift"]{grid-column:1/span 2;grid-row:1;width:auto;height:' + DRIFT_H + 'px}',
  '.nbg-tc.drive .nbg-tc-move,.nbg-tc.drive .nbg-tc-look,.nbg-tc.drive .nbg-tc-buttons{display:none}',
  // Use (out of the car) shares the Drift row, only in a car the player got into; Drift takes the other half.
  '.nbg-tc-pedals .nbg-tc-btn[data-action="interact"]{display:none;grid-column:1;grid-row:1;width:auto;height:' + DRIFT_H + 'px}',
  '.nbg-tc.exit .nbg-tc-pedals .nbg-tc-btn[data-action="interact"]{display:grid}',
  '.nbg-tc.exit .nbg-tc-pedals .nbg-tc-btn[data-action="drift"]{grid-column:2/span 1}',
  // 'auto': the car drives itself forward, so there is no Gas pedal; 'tilt': once the sensor answers, no Left / Right pads.
  '.nbg-tc.auto .nbg-tc-pedals .nbg-tc-btn[data-action="up"]{display:none}',
  '.nbg-tc.drive.tilting .nbg-tc-steer{display:none}',
  // The joystick under the RIGHT thumb (options.joystick.side, or the player dragged it there): the halves swap.
  '.nbg-tc.stick-right .nbg-tc-move{left:auto;right:0}',
  '.nbg-tc.stick-right .nbg-tc-look{right:auto;left:0}',
  // The builder asked for the joystick on the right: the action buttons move to the left, out of its way.
  '.nbg-tc.mirror .nbg-tc-buttons{right:auto;left:max(16px,env(safe-area-inset-left))}',
  // Reads the device's safe-area inset in pixels, so a dragged control can be kept out of the notch.
  '.nbg-tc-safe{position:absolute;inset:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);visibility:hidden;pointer-events:none}',
  // Settings → Edit controls: every control can be dragged, the game behind it is dimmed and the camera drag is off.
  '.nbg-tc.editing{z-index:40;pointer-events:auto;touch-action:none;background:rgba(0,0,0,0.35)}',
  '.nbg-tc.editing .nbg-tc-look,.nbg-tc.editing .nbg-tc-hint{display:none}',
  '.nbg-tc.editing .nbg-tc-move{pointer-events:none;outline:2px dashed rgba(255,255,255,0.25);outline-offset:-2px}',
  '.nbg-tc.editing .nbg-tc-base{pointer-events:auto;opacity:1;cursor:move}',
  '.nbg-tc.editing .nbg-tc-btn{cursor:move}',
  // A HUD element's box (the minimap): only while editing, dragged and pinched like a control.
  '.nbg-tc-hud{display:none}',
  '.nbg-tc.editing .nbg-tc-hud{display:flex;align-items:center;justify-content:center;border-radius:999px;border:2px dashed rgba(255,255,255,0.8);background:rgba(0,0,0,0.35);color:#fff;font:600 13px system-ui,sans-serif;pointer-events:auto;cursor:move;touch-action:none}',
  '.nbg-tc.editing .nbg-tc-sel{outline:3px solid #fde047;outline-offset:3px}',
  '.nbg-tc-edit{position:absolute;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;padding:8px 12px;border-radius:12px;background:rgba(0,0,0,0.78);color:#fff;font:600 14px/1.2 system-ui,sans-serif;pointer-events:auto;width:max-content;max-width:calc(100% - 24px);z-index:1}',
  '.nbg-tc-edit button{min-height:40px;padding:8px 12px;border-radius:8px;border:2px solid rgba(255,255,255,0.55);background:rgba(255,255,255,0.14);color:#fff;font:inherit;cursor:pointer}',
  '.nbg-tc-edit button.nbg-tc-done{background:#fde047;color:#111;border-color:#fde047}',
  '.nbg-tc-edit label{display:flex;gap:8px;align-items:center}',
  '.nbg-tc-edit p{margin:0;width:100%;text-align:center;font-weight:500;opacity:0.85}',
  '.nbg-tc-edit p.nbg-tc-fit{color:#fde047;opacity:1;display:none}',
  '.nbg-tc-fixed-row{cursor:pointer}',
  '.nbg-tc-fixed{width:22px;height:22px;margin:0;accent-color:#fde047}',
  '.nbg-tc.editing .nbg-tc-base:focus-visible,.nbg-tc.editing .nbg-tc-btn:focus-visible{outline:3px solid #fff;outline-offset:3px}',
].join('');

export class TouchControls {
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly moveZone: HTMLDivElement;
  private readonly probe: HTMLDivElement;
  private readonly steer: HTMLDivElement;
  private readonly pedals: HTMLDivElement;
  private readonly detach: Array<() => void> = [];
  private readonly buttonsDown = new Map<number, { action: string; el: HTMLElement }>();
  /** Each movable control by its layout id: an action button, 'joystick' (its base), 'steer', 'pedals'. */
  private readonly controls = new Map<string, HTMLElement>();
  /**
   * HUD ELEMENTS IN THE SAME EDITOR (master audit 2026-11-25, Part H — "the touch controls can be moved and resized, the map
   * cannot"). The minimap (and any HUD element) registers here by id; the editor shows a proxy box for it that is dragged,
   * pinched, nudged, reset and saved exactly like a button, in the SAME saved layout, and the real element follows.
   */
  private readonly hud = new Map<string, { proxy: HTMLElement; spec: HudElementSpec }>();
  /** The action buttons in the order they were drawn, with the grid they live in when they are not placed. */
  private readonly homes: Array<{ id: string; el: HTMLElement; home: HTMLElement }> = [];
  private readonly placed = new Set<HTMLElement>();
  private readonly gameId: string;
  private saved: SavedTouchLayout;
  private layoutNow: ResolvedTouchLayout;
  /** What is actually drawn: layoutNow with overlaps pushed apart and, on a too-small screen, everything shrunk. */
  private drawn: ResolvedTouchLayout;
  private fitScale = 1;
  /** Each visible control as drawn: centre and half size in pixels inside the game area. */
  private boxesNow: TouchBox[] = [];
  private radius = STICK_RADIUS;
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private shown = false;
  private current: TouchLayout = 'move';
  /** How a car is driven on this screen (options.drive). */
  readonly driveMode: DriveControls = 'pads';
  private exitShown = false;
  private tiltOff: (() => void) | null = null;
  private editor: { el: HTMLDivElement; wasShown: boolean; off: () => void; fit: HTMLElement; fixed: HTMLInputElement; fixedRow: HTMLElement } | null = null;
  private selected: string | null = null;
  private drag: { id: string; pointerId: number } | null = null;
  /** Every finger (or mouse) down while editing, by pointer id: two of them make a pinch. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { a: number; b: number; dist: number; size: number; id: string } | null = null;

  constructor(
    // A plain parameter, not a field: it is only used here, and an unread field fails an app whose tsconfig has
    // noUnusedLocals (TS6138, failedbr #2036).
    container: HTMLElement,
    private readonly input: Input,
    private readonly options: TouchControlsOptions = {},
  ) {
    // The overlay is positioned against the game's own container, never the page.
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.gameId = options.gameId || 'game';
    this.saved = loadTouchLayout(this.gameId) ?? { controls: {} };
    this.layoutNow = resolveTouchLayout(options, this.saved);
    this.drawn = this.layoutNow;

    const style = document.createElement('style');
    style.textContent = CSS;
    this.root = document.createElement('div');
    this.root.className = 'nbg-tc';
    this.root.appendChild(style);
    this.probe = document.createElement('div');
    this.probe.className = 'nbg-tc-safe';
    this.root.appendChild(this.probe);

    const look = document.createElement('div');
    look.className = 'nbg-tc-look';
    if (options.look !== false) this.root.appendChild(look);

    const move = document.createElement('div');
    move.className = 'nbg-tc-move';
    this.moveZone = move;
    this.base = document.createElement('div');
    this.base.className = 'nbg-tc-base';
    this.knob = document.createElement('div');
    this.knob.className = 'nbg-tc-knob';
    this.base.appendChild(this.knob);
    move.appendChild(this.base);
    this.root.appendChild(move);
    this.controls.set(JOYSTICK_CONTROL, this.base);

    const buttons = document.createElement('div');
    buttons.className = 'nbg-tc-buttons';
    for (const b of options.buttons ?? DEFAULT_TOUCH_BUTTONS) {
      const id = this.controls.has(b.action) ? b.action + '#' + this.controls.size : b.action;
      const el = this.addButton(buttons, b, id);
      this.controls.set(id, el);
      this.homes.push({ id, el, home: buttons });
    }
    this.root.appendChild(buttons);

    // The 'drive' pads exist from the start (hidden by CSS) so switching layout is one class, not a rebuild.
    this.steer = document.createElement('div');
    this.steer.className = 'nbg-tc-steer';
    for (const b of DRIVE_TOUCH_BUTTONS.steer) this.addButton(this.steer, b, 'steer');
    this.root.appendChild(this.steer);
    this.controls.set('steer', this.steer);
    this.pedals = document.createElement('div');
    this.pedals.className = 'nbg-tc-pedals';
    for (const b of DRIVE_TOUCH_BUTTONS.pedals) this.addButton(this.pedals, b, 'pedals');
    this.addButton(this.pedals, DRIVE_EXIT_BUTTON, 'pedals');
    this.root.appendChild(this.pedals);
    this.controls.set('pedals', this.pedals);
    this.driveMode = resolveDriveControls(options.drive);
    if (this.driveMode === 'auto') this.root.classList.add('auto');
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
    // While editing, the joystick is picked up by its base — never started.
    this.on(this.base, 'pointerdown', (e) => { if (this.editor) this.editDown(e, JOYSTICK_CONTROL, this.base); });
    this.base.addEventListener('focus', () => { if (this.editor) this.select(JOYSTICK_CONTROL); });
    // While editing, a press on the dimmed background is tracked too: a second finger anywhere pinches the picked control.
    this.on(this.root, 'pointerdown', (e) => { if (this.editor) this.editDown(e, null, this.root); });
    // A dragged control follows the pointer that picked it up (pointer capture brings its events here).
    this.on(this.root, 'pointermove', (e) => this.editMove(e));
    for (const t of ['pointerup', 'pointercancel']) this.on(this.root, t, (e) => this.editUp(e));
    // A long press must not open the browser's menu over the game.
    this.on(this.root, 'contextmenu', (e) => e.preventDefault());

    const releaseAll = () => this.releaseAll();
    const onVisibility = () => { if (document.hidden) this.releaseAll(); };
    // A turned phone is a new screen: every control is fitted to it again, none covering another.
    const relayout = () => this.applyLayout();
    window.addEventListener('blur', releaseAll);
    window.addEventListener('resize', relayout);
    document.addEventListener('visibilitychange', onVisibility);
    this.detach.push(() => window.removeEventListener('blur', releaseAll));
    this.detach.push(() => window.removeEventListener('resize', relayout));
    this.detach.push(() => document.removeEventListener('visibilitychange', onVisibility));
    // The game area can change size without the window doing so (a side panel, a split screen).
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(relayout);
      ro.observe(container);
      this.detach.push(() => ro.disconnect());
    }

    container.appendChild(this.root);
    this.applyLayout();

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

  /** Is the layout editor (Settings → Edit controls) open? */
  get editing(): boolean { return this.editor !== null; }

  /** The layout being drawn: defaults, then the game's options, then the player's own saved layout. */
  get placement(): ResolvedTouchLayout { return { controls: { ...this.layoutNow.controls }, opacity: this.layoutNow.opacity, joystickMode: this.layoutNow.joystickMode }; }

  /** 1, or less when the screen is too small for every control at its size and they were all shrunk to fit. */
  get fit(): number { return this.fitScale; }

  /** Every control on screen in the current set, as drawn: centre and half size in pixels. None overlaps another. */
  get onScreen(): TouchBox[] { return this.boxesNow.map((b) => ({ ...b })); }

  /** The player's own layout, as saved for this game. */
  get playerLayout(): SavedTouchLayout { return sanitizeTouchLayout(this.saved); }

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
    if (layout === 'drive' && this.driveMode === 'tilt') this.startTilt(); else this.stopTilt();
    this.holdAutoGas();
    // The pads were hidden until now, so their size is only known from here on.
    if (this.root.parentElement) this.applyLayout();
    if (this.editor) {
      // The editor follows: the picked control is one that is on screen, and the joystick switch only shows with it.
      this.drag = null;
      this.pinch = null;
      this.select(layout === 'drive' ? 'steer' : JOYSTICK_CONTROL);
      this.editor.fixedRow.style.display = layout === 'drive' ? 'none' : '';
    }
  }

  /** Replace the player's layout (and save it for this game). null goes back to the game's own layout. */
  setPlayerLayout(layout: SavedTouchLayout | null): void {
    this.saved = layout ? sanitizeTouchLayout(layout) : { controls: {} };
    saveTouchLayout(this.gameId, layout ? this.saved : null);
    this.layoutNow = resolveTouchLayout(this.options, this.saved);
    this.applyLayout();
    if (this.editor) this.editor.fixed.checked = this.layoutNow.joystickMode === 'fixed';
  }

  /** Floating (appears under the thumb) or fixed (stays where it rests), saved for this game; it beats the game's choice. */
  setJoystickMode(mode: 'floating' | 'fixed'): void {
    if (mode !== 'floating' && mode !== 'fixed') return;
    this.releaseAll();
    this.setPlayerLayout({ ...this.saved, joystickMode: mode });
  }

  private addButton(parent: HTMLElement, b: TouchButton, id: string): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'nbg-tc-btn';
    el.setAttribute('data-action', b.action);
    // The kit's own labels follow the game's language; a label the game chose is shown as it wrote it.
    const label = KIT_LABEL_KEYS[b.label] ? t(KIT_LABEL_KEYS[b.label]) : b.label;
    el.textContent = label;
    el.setAttribute('aria-label', label);
    this.on(el, 'pointerdown', (e) => {
      // While editing, a press picks the control up instead of pressing it (a drive pad moves as one piece).
      if (this.editor) { this.editDown(e, id, el); return; }
      this.pressButton(e, b.action, el);
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(el, t, (e) => this.releaseButton(e));
    // A keyboard player picks a control by moving focus to it (Tab), then moves it with the arrow keys.
    el.addEventListener('focus', () => { if (this.editor) this.select(id); });
    parent.appendChild(el);
    return el;
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.classList.add('on', 'hinting');
    const t = setTimeout(() => this.root.classList.remove('hinting'), 4000);
    this.detach.push(() => clearTimeout(t));
    // Hidden, the overlay measured 0 × 0; on screen, every control is fitted to the real size.
    this.applyLayout();
    this.holdAutoGas();
  }

  // ── Layout ──────────────────────────────────────────────────────────────────────────────────────

  /** The game area in pixels (0 × 0 before it is on a page). */
  private screen(): { w: number; h: number; left: number; top: number } {
    const r = typeof this.root.getBoundingClientRect === 'function' ? this.root.getBoundingClientRect() : null;
    return r ? { w: r.width || 0, h: r.height || 0, left: r.left || 0, top: r.top || 0 } : { w: 0, h: 0, left: 0, top: 0 };
  }

  /** The device's safe-area inset (notch, home bar) in pixels. */
  private safeInset(): ScreenInset {
    const cs = getComputedStyle(this.probe) as Partial<CSSStyleDeclaration>;
    const px = (v: string | undefined) => Math.max(0, parseFloat(v ?? '') || 0);
    return { left: px(cs.paddingLeft), top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom) };
  }

  /** Where a control may go: outside the safe area, and never closer than 8 px to the very edge. */
  private inset(): ScreenInset {
    const s = this.safeInset();
    return { left: Math.max(8, s.left), top: Math.max(8, s.top), right: Math.max(8, s.right), bottom: Math.max(8, s.bottom) };
  }

  /** Half the width and height, in pixels, of a control drawn at a size multiplier. */
  private halfPx(id: string, size: number): { hw: number; hh: number } {
    const extra = this.hud.get(id);
    if (extra) return { hw: (extra.spec.width * size) / 2, hh: (extra.spec.height * size) / 2 };
    if (id === 'steer' || id === 'pedals') {
      const el = id === 'steer' ? this.steer : this.pedals;
      const w = el.offsetWidth || PAD * 2 + BTN_GAP;
      const h = el.offsetHeight || (id === 'steer' ? PAD : PAD + PAD_ROW_GAP + DRIFT_H);
      return { hw: (w * size) / 2, hh: (h * size) / 2 };
    }
    const half = id === JOYSTICK_CONTROL ? Math.round(STICK_RADIUS * size) : (BTN * size) / 2;
    return { hw: half, hh: half };
  }

  /** The centre, in pixels, of a control the layout does not place: the kit's own spot, exactly where the CSS draws it. */
  private homeSpot(id: string, L: ResolvedTouchLayout, w: number, h: number, safe: ScreenInset): { x: number; y: number } {
    const left = Math.max(16, safe.left);
    const right = Math.max(16, safe.right);
    const bottom = Math.max(16, safe.bottom);
    const stickRight = this.options.joystick?.side === 'right';
    const extra = this.hud.get(id);
    if (extra) {
      // Where the element really is (its own default corner), in the editor's own coordinates.
      const at = (() => { try { return extra.spec.home(); } catch { return null; } })();
      const scr = this.screen();
      const { hw, hh } = this.halfPx(id, 1);
      return at ? { x: at.x - scr.left, y: at.y - scr.top } : { x: left + hw, y: Math.max(16, safe.top) + 48 + hh };
    }
    if (id === JOYSTICK_CONTROL) {
      const R = this.halfPx(id, L.controls[id]?.size ?? 1).hw;
      return { x: stickRight ? w - right - R : left + R, y: h - bottom - R };
    }
    if (id === 'steer' || id === 'pedals') {
      const { hw, hh } = this.halfPx(id, 1);
      return { x: id === 'steer' ? left + hw : w - right - hw, y: h - bottom - hh };
    }
    // An action button in the kit's two-column grid, bottom-right (bottom-left when the joystick is on the right).
    const inGrid = this.homes.filter((b) => !isPlaced(L.controls[b.id]));
    const i = Math.max(0, inGrid.findIndex((b) => b.id === id));
    const rows = Math.ceil(inGrid.length / 2);
    const gridLeft = stickRight ? left : w - right - (BTN * 2 + BTN_GAP);
    const gridTop = h - bottom - (rows * BTN + (rows - 1) * BTN_GAP);
    return { x: gridLeft + (i % 2) * (BTN + BTN_GAP) + BTN / 2, y: gridTop + Math.floor(i / 2) * (BTN + BTN_GAP) + BTN / 2 };
  }

  /**
   * Draw every control, none covering another (separateTouchControls). pin is the control the player just moved or
   * resized: it keeps its spot and the others make room. Called on start, on every edit, on resize and rotation, on a
   * layout switch. Returns, as fractions, the spots the others were moved to, so an edit can save them.
   */
  private applyLayout(pin?: string): Record<string, { x: number; y: number }> {
    const L = this.layoutNow;
    const scr = this.screen();
    const inset = this.inset();
    const moved: Record<string, { x: number; y: number }> = {};
    let drawn = L;
    let scale = 1;
    this.boxesNow = [];
    if (scr.w > 0 && scr.h > 0) {
      const safe = this.safeInset();
      // The HUD elements (the minimap) take part in BOTH layouts, so nothing is ever put on top of them.
      const ids = [...(this.current === 'drive' ? ['steer', 'pedals'] : [JOYSTICK_CONTROL, ...this.homes.map((b) => b.id)]), ...this.hud.keys()];
      const boxes = ids.map((id) => {
        const p = L.controls[id];
        const { hw, hh } = this.halfPx(id, p ? p.size : 1);
        if (isPlaced(p)) {
          const c = clampTouchPlacement(p.x, p.y, hw, hh, scr.w, scr.h, inset);
          return { id, x: c.x * scr.w, y: c.y * scr.h, hw, hh, placed: true };
        }
        const s = this.homeSpot(id, L, scr.w, scr.h, safe);
        return { id, x: s.x, y: s.y, hw, hh, placed: false };
      });
      // Priority: the control just edited, then the ones somebody placed, then the kit's own spots, each in drawing order.
      const order = [...boxes.filter((b) => b.id === pin), ...boxes.filter((b) => b.id !== pin && b.placed), ...boxes.filter((b) => b.id !== pin && !b.placed)];
      const solved = separateTouchControls(order, scr.w, scr.h, inset);
      scale = solved.scale;
      const by = new Map(solved.boxes.map((b) => [b.id, b]));
      this.boxesNow = ids.map((id) => ({ ...by.get(id)! }));
      const shifted = boxes.filter((b) => { const s = by.get(b.id)!; return Math.abs(s.x - b.x) > 0.5 || Math.abs(s.y - b.y) > 0.5; });
      // A button that leaves the kit's grid reflows the ones still in it, so once any of those has to move (or all
      // shrink), every control is drawn at the spot the solver gave it.
      const take = scale < 1 || shifted.some((b) => !b.placed) ? boxes : shifted;
      if (take.length) {
        const controls: Record<string, ResolvedTouchPlacement> = { ...L.controls };
        for (const b of take) {
          const s = by.get(b.id)!;
          const f = { x: s.x / scr.w, y: s.y / scr.h };
          moved[b.id] = f;
          controls[b.id] = { size: (controls[b.id]?.size ?? 1) * scale, x: f.x, y: f.y };
        }
        drawn = { ...L, controls };
      }
    }
    this.drawn = drawn;
    this.fitScale = scale;
    this.render(scr, inset);
    if (this.editor) this.editor.fit.style.display = scale < 1 ? '' : 'none';
    return moved;
  }

  /** Put every element where this.drawn says. */
  private render(scr: { w: number; h: number }, inset: ScreenInset): void {
    const L = this.drawn;
    const opacity = String(L.opacity);
    const at = (id: string): ResolvedTouchPlacement | undefined => L.controls[id];

    // The action buttons: a placed one leaves the grid for the overlay; an unplaced one goes back, in its first order.
    if (this.homes.some(({ id, el }) => this.placed.has(el) && !isPlaced(at(id)))) {
      for (const { id, el, home } of this.homes) {
        if (isPlaced(at(id))) continue;
        this.placed.delete(el);
        this.clearPlace(el);
        home.appendChild(el);
      }
    }
    for (const { id, el } of this.homes) {
      el.style.opacity = opacity;
      const p = at(id);
      if (!isPlaced(p)) { el.style.transform = p && p.size !== 1 ? 'scale(' + p.size + ')' : ''; continue; }
      if (!this.placed.has(el)) { this.placed.add(el); this.root.appendChild(el); }
      this.place(el, id, p, scr, inset);
    }

    // The drive pads move as one piece each.
    for (const [id, el] of [['steer', this.steer], ['pedals', this.pedals]] as const) {
      el.style.opacity = opacity;
      const p = at(id);
      if (!isPlaced(p)) { this.clearPlace(el); if (p && p.size !== 1) el.style.transform = 'scale(' + p.size + ')'; continue; }
      this.place(el, id, p, scr, inset);
    }

    // The joystick: its size changes its reach, so it is drawn by radius, not scaled.
    const j = at(JOYSTICK_CONTROL);
    this.radius = Math.round(STICK_RADIUS * (j ? j.size : 1));
    const knob = Math.round(48 * (this.radius / STICK_RADIUS));
    this.base.style.width = this.radius * 2 + 'px';
    this.base.style.height = this.radius * 2 + 'px';
    this.base.style.margin = '-' + this.radius + 'px 0 0 -' + this.radius + 'px';
    this.knob.style.width = knob + 'px';
    this.knob.style.height = knob + 'px';
    this.knob.style.margin = '-' + knob / 2 + 'px 0 0 -' + knob / 2 + 'px';
    this.moveZone.style.opacity = opacity;
    const right = isPlaced(j) ? j.x > 0.5 : this.options.joystick?.side === 'right';
    if (right) this.root.classList.add('stick-right');
    else this.root.classList.remove('stick-right');
    if (this.options.joystick?.side === 'right') this.root.classList.add('mirror');
    else this.root.classList.remove('mirror');
    // A joystick placed high up needs its half of the screen to reach that high.
    this.moveZone.style.height = isPlaced(j) ? '100%' : '';
    if (this.stickId === -1) this.restStick();
    this.renderHud(scr, inset);
  }

  /** The HUD elements: the editor's proxy box where the layout puts it, and the real element told where to draw. */
  private renderHud(scr: { w: number; h: number }, inset: ScreenInset): void {
    for (const [id, { proxy, spec }] of this.hud) {
      const p = this.drawn.controls[id];
      const size = p ? p.size : 1;
      const box = this.boxesNow.find((b) => b.id === id);
      if (box && scr.w > 0 && scr.h > 0) this.place(proxy, id, { x: box.x / scr.w, y: box.y / scr.h, size: 1 }, scr, inset);
      proxy.style.width = Math.round(spec.width * size) + 'px';
      proxy.style.height = Math.round(spec.height * size) + 'px';
      try { spec.apply(isPlaced(p) ? { x: p.x, y: p.y, size } : { size }); } catch { /* a HUD element's own drawing never breaks the controls */ }
    }
  }

  /**
   * Put a HUD element (the minimap, a compass, a health bar…) in this editor: it is moved, resized, reset and saved with the
   * controls, in the same layout. Returns the way to take it out again.
   */
  addHudElement(id: string, spec: HudElementSpec): () => void {
    if (!id || this.controls.has(id) && !this.hud.has(id)) return () => undefined;
    { const old = this.hud.get(id)?.proxy; old?.parentElement?.removeChild(old); }
    const proxy = document.createElement('div');
    proxy.className = 'nbg-tc-hud';
    proxy.textContent = spec.label;
    proxy.setAttribute('aria-label', spec.label);
    proxy.setAttribute('tabindex', '0'); // hidden (display:none) except while editing, so Tab reaches it only then
    proxy.setAttribute('role', 'button');
    this.on(proxy, 'pointerdown', (e) => { if (this.editor) this.editDown(e, id, proxy); });
    proxy.addEventListener('focus', () => { if (this.editor) this.select(id); });
    this.root.appendChild(proxy);
    this.controls.set(id, proxy);
    this.hud.set(id, { proxy, spec });
    this.applyLayout();
    return () => {
      if (this.hud.get(id)?.proxy !== proxy) return;
      this.hud.delete(id);
      this.controls.delete(id);
      proxy.parentElement?.removeChild(proxy);
      if (this.selected === id) this.select(null);
    };
  }

  private place(el: HTMLElement, id: string, p: { x: number; y: number; size: number }, scr: { w: number; h: number }, inset: ScreenInset): void {
    const { hw, hh } = this.halfPx(id, p.size);
    const c = clampTouchPlacement(p.x, p.y, hw, hh, scr.w, scr.h, inset);
    el.style.position = 'absolute';
    el.style.left = c.x * 100 + '%';
    el.style.top = c.y * 100 + '%';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'translate(-50%, -50%) scale(' + p.size + ')';
  }

  private clearPlace(el: HTMLElement): void {
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    el.style.transform = '';
  }

  /**
   * After an edit: draw with pin keeping its spot, then SAVE every spot the others were pushed to — so the layout the
   * player saw when they let go is exactly the one a reload (or the next game) opens with.
   */
  private commit(pin: string | undefined): void {
    this.layoutNow = resolveTouchLayout(this.options, this.saved);
    const moved = this.applyLayout(pin);
    const ids = Object.keys(moved);
    if (ids.length) {
      const controls = { ...this.saved.controls };
      for (const id of ids) controls[id] = { ...controls[id], x: Math.round(moved[id].x * 10000) / 10000, y: Math.round(moved[id].y * 10000) / 10000 };
      this.saved = sanitizeTouchLayout({ ...this.saved, controls });
      this.layoutNow = resolveTouchLayout(this.options, this.saved);
      this.applyLayout(pin);
    }
    saveTouchLayout(this.gameId, this.saved);
  }

  // ── The layout editor (Settings → Edit controls) ────────────────────────────────────────────────

  /**
   * Open the editor over the game: drag any control to move it, pinch with two fingers (or Smaller / Bigger) to resize
   * the one picked, the slider sets how see-through the controls are, the switch makes the joystick fixed or floating,
   * Reset goes back to the game's layout, Done (or Esc) closes it. A keyboard works too: Tab picks a control, the arrow
   * keys move it (Shift for bigger steps), + and - resize it. Controls never end up covering one another. Every change
   * is saved for this game at once.
   */
  editLayout(): void {
    if (this.editor) return;
    this.releaseAll();
    const wasShown = this.shown;
    this.root.classList.add('on', 'editing');
    const el = document.createElement('div');
    el.className = 'nbg-tc-edit';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t('editControls'));
    // The toolbar's own presses must never reach the drag handlers behind it.
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    const hint = document.createElement('p');
    hint.textContent = t('editControlsHint');
    el.appendChild(hint);
    const more = document.createElement('p');
    more.textContent = t('editControlsMore');
    el.appendChild(more);
    const fit = document.createElement('p');
    fit.className = 'nbg-tc-fit';
    fit.setAttribute('role', 'status');
    fit.textContent = t('controlsShrunk');
    el.appendChild(fit);
    const button = (label: string, fn: () => void, cls = ''): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', fn);
      el.appendChild(b);
      return b;
    };
    button(t('smaller'), () => this.resizeSelected(-0.15), 'nbg-tc-smaller');
    button(t('bigger'), () => this.resizeSelected(0.15), 'nbg-tc-bigger');
    const label = document.createElement('label');
    label.textContent = t('controlsOpacity');
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(TOUCH_OPACITY_MIN);
    range.max = '1';
    range.step = '0.05';
    range.value = String(this.layoutNow.opacity);
    range.setAttribute('aria-label', t('controlsOpacity'));
    range.addEventListener('input', () => this.setOpacity(Number(range.value)));
    label.appendChild(range);
    el.appendChild(label);
    // Floating (appears under the thumb) or fixed: the game's choice is the default, the player's wins.
    const fixedRow = document.createElement('label');
    fixedRow.className = 'nbg-tc-fixed-row';
    const fixed = document.createElement('input');
    fixed.type = 'checkbox';
    fixed.className = 'nbg-tc-fixed';
    fixed.checked = this.layoutNow.joystickMode === 'fixed';
    fixed.setAttribute('aria-label', t('fixedJoystick'));
    fixed.addEventListener('change', () => this.setJoystickMode(fixed.checked ? 'fixed' : 'floating'));
    fixedRow.appendChild(fixed);
    const fixedText = document.createElement('span');
    fixedText.textContent = t('fixedJoystick');
    fixedRow.appendChild(fixedText);
    if (this.current === 'drive') fixedRow.style.display = 'none';
    el.appendChild(fixedRow);
    button(t('resetControls'), () => { this.setPlayerLayout(null); range.value = String(this.layoutNow.opacity); }, 'nbg-tc-reset');
    button(t('done'), () => this.finishEditing(), 'nbg-tc-done');
    this.root.appendChild(el);
    // Esc closes the editor first — before the game's own Esc (pause / resume) sees it. The arrow keys and + / - edit
    // the picked control and never reach the game behind; keys typed into the slider or the switch stay theirs.
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.finishEditing();
        return;
      }
      const target = e.target as { tagName?: string } | null;
      if (target && target.tagName === 'INPUT') return;
      const step = steps[e.key];
      const px = e.shiftKey ? 32 : 8;
      if (step) this.nudgeSelected(step[0] * px, step[1] * px);
      else if (e.key === '+' || e.key === '=') this.resizeSelected(0.15);
      else if (e.key === '-' || e.key === '_') this.resizeSelected(-0.15);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    this.editor = { el, wasShown, fit, fixed, fixedRow, off: () => window.removeEventListener('keydown', onKey, true) };
    // The joystick is a plain element: while editing it can take keyboard focus and has a name.
    this.base.setAttribute('tabindex', '0');
    this.base.setAttribute('role', 'button');
    this.base.setAttribute('aria-label', t('joystick'));
    // The overlay may have been hidden (0 × 0) until now: fit every control to the real screen.
    this.applyLayout();
    const first = this.current === 'drive' ? 'steer' : JOYSTICK_CONTROL;
    this.select(first);
    const focusEl = first === 'steer' ? this.steer.querySelector?.('button') : this.base;
    if (focusEl && typeof (focusEl as HTMLElement).focus === 'function') (focusEl as HTMLElement).focus({ preventScroll: true });
  }

  /** Close the editor. Every change was already saved; a drag or pinch still under a finger is saved now. */
  finishEditing(): void {
    const ed = this.editor;
    if (!ed) return;
    const pending = this.pinch ? this.pinch.id : this.drag ? this.drag.id : null;
    this.drag = null;
    this.pinch = null;
    this.touches.clear();
    if (pending) this.commit(pending);
    this.editor = null;
    ed.off();
    ed.el.parentElement?.removeChild(ed.el);
    this.select(null);
    if (typeof this.base.removeAttribute === 'function') {
      this.base.removeAttribute('tabindex');
      this.base.removeAttribute('role');
      this.base.removeAttribute('aria-label');
    }
    this.root.classList.remove('editing');
    if (!ed.wasShown) this.root.classList.remove('on');
    this.applyLayout();
  }

  /** How see-through the controls are (0.2..1), saved for this game. */
  setOpacity(value: number): void {
    if (!Number.isFinite(value)) return;
    this.setPlayerLayout({ ...this.saved, opacity: clampNum(value, TOUCH_OPACITY_MIN, 1) });
  }

  private select(id: string | null): void {
    if (this.selected) this.controls.get(this.selected)?.classList.remove('nbg-tc-sel');
    this.selected = id;
    if (id) this.controls.get(id)?.classList.add('nbg-tc-sel');
  }

  private setSize(id: string, size: number): void {
    this.saved = { ...this.saved, controls: { ...this.saved.controls, [id]: { ...this.saved.controls[id], size } } };
  }

  private resizeSelected(step: number): void {
    const id = this.selected;
    if (!id) return;
    const now = this.layoutNow.controls[id]?.size ?? 1;
    this.setSize(id, Math.round(clampNum(now + step, TOUCH_SIZE_MIN, TOUCH_SIZE_MAX) * 100) / 100);
    this.commit(id);
  }

  /** Move the picked control by a number of pixels (the arrow keys), kept whole on screen. */
  private nudgeSelected(dx: number, dy: number): void {
    const id = this.selected;
    const spot = id ? this.boxesNow.find((b) => b.id === id) : undefined;
    if (!id || !spot) return;
    const scr = this.screen();
    const { hw, hh } = this.halfPx(id, this.layoutNow.controls[id]?.size ?? 1);
    const f = touchPixelsToFraction(spot.x + dx, spot.y + dy, scr.w, scr.h);
    const c = clampTouchPlacement(f.x, f.y, hw, hh, scr.w, scr.h, this.inset());
    this.saved = { ...this.saved, controls: { ...this.saved.controls, [id]: { ...this.saved.controls[id], x: Math.round(c.x * 10000) / 10000, y: Math.round(c.y * 10000) / 10000 } } };
    this.commit(id);
  }

  /**
   * A finger (or the mouse) goes down while editing, on a control (id) or on the background (null). The first one picks
   * a control up; a second one, anywhere, pinches the picked control instead — it never picks up or presses another.
   */
  private editDown(e: PointerEvent, id: string | null, el: HTMLElement): void {
    e.stopPropagation();
    // The first finger of a new touch (or any mouse press) starts afresh: a release the page never saw cannot leave a
    // ghost finger behind that would turn the next drag into a pinch.
    if (e.isPrimary) { this.touches.clear(); this.pinch = null; }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) { this.capture(el, e); return; }   // a third finger changes nothing
    const other = [...this.touches.keys()].find((k) => k !== e.pointerId);
    const target = this.drag ? this.drag.id : this.selected;
    if (other !== undefined && target) {
      this.capture(el, e);
      const a = this.drag ? this.drag.pointerId : other;
      const pa = this.touches.get(a);
      const dist = pa ? Math.hypot(pa.x - e.clientX, pa.y - e.clientY) : 0;
      // Fingers that land almost together would make the first millimetre a huge jump: start from at least 24 px apart.
      this.pinch = { a, b: e.pointerId, dist: Math.max(24, dist), size: this.layoutNow.controls[target]?.size ?? 1, id: target };
      this.drag = null;
      return;
    }
    if (id) this.startDrag(e, id, el);
    else this.capture(el, e);
  }

  private editMove(e: PointerEvent): void {
    if (!this.editor) return;
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = this.pinch;
    if (p) {
      if (e.pointerId !== p.a && e.pointerId !== p.b) return;
      const A = this.touches.get(p.a);
      const B = this.touches.get(p.b);
      if (!A || !B) return;
      const size = touchPinchSize(p.size, p.dist, Math.hypot(A.x - B.x, A.y - B.y));
      if (size === (this.layoutNow.controls[p.id]?.size ?? 1)) return;
      this.setSize(p.id, size);
      this.layoutNow = resolveTouchLayout(this.options, this.saved);
      this.applyLayout(p.id);
      return;
    }
    this.moveDrag(e);
  }

  private editUp(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    const p = this.pinch;
    if (p && (e.pointerId === p.a || e.pointerId === p.b)) {
      this.pinch = null;
      this.commit(p.id);
      return;
    }
    this.endDrag(e);
  }

  private startDrag(e: PointerEvent, id: string, el: HTMLElement): void {
    this.capture(el, e);
    this.select(id);
    this.drag = { id, pointerId: e.pointerId };
  }

  private moveDrag(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const scr = this.screen();
    const f = touchPixelsToFraction(e.clientX - scr.left, e.clientY - scr.top, scr.w, scr.h);
    const id = this.drag.id;
    const { hw, hh } = this.halfPx(id, this.layoutNow.controls[id]?.size ?? 1);
    // What is saved is already on screen, so a layout made on a big tablet still opens inside a small phone.
    const c = clampTouchPlacement(f.x, f.y, hw, hh, scr.w, scr.h, this.inset());
    const x = Math.round(c.x * 1000) / 1000;
    const y = Math.round(c.y * 1000) / 1000;
    this.saved = { ...this.saved, controls: { ...this.saved.controls, [id]: { ...this.saved.controls[id], x, y } } };
    this.layoutNow = resolveTouchLayout(this.options, this.saved);
    // The others make room as it moves; where they end up is saved when it is let go.
    this.applyLayout(id);
  }

  private endDrag(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const id = this.drag.id;
    this.drag = null;
    this.commit(id);
  }

  // ── Playing ─────────────────────────────────────────────────────────────────────────────────────

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
    const R = this.radius;
    this.base.classList.remove('live');
    const j = this.drawn.controls[JOYSTICK_CONTROL];
    if (isPlaced(j)) {
      // A placed joystick rests where it was put, kept whole on screen; its zone is the half of the screen it sits in.
      const scr = this.screen();
      const c = clampTouchPlacement(j.x, j.y, R, R, scr.w, scr.h, this.inset());
      const zone = typeof this.moveZone.getBoundingClientRect === 'function' ? this.moveZone.getBoundingClientRect() : null;
      if (scr.w > 0 && zone) {
        this.base.style.left = c.x * scr.w - ((zone.left || 0) - scr.left) + 'px';
        this.base.style.top = c.y * scr.h - ((zone.top || 0) - scr.top) + 'px';
      } else {
        // Not measured yet: the zone is half the screen wide and the whole height.
        this.base.style.left = (c.x > 0.5 ? c.x - 0.5 : c.x) * 200 + '%';
        this.base.style.top = c.y * 100 + '%';
      }
    } else if (this.root.classList.contains('stick-right')) {
      this.base.style.left = 'calc(100% - max(16px, env(safe-area-inset-right)) - ' + R + 'px)';
      this.base.style.top = 'calc(100% - max(16px, env(safe-area-inset-bottom)) - ' + R + 'px)';
    } else {
      this.base.style.left = 'calc(max(16px, env(safe-area-inset-left)) + ' + R + 'px)';
      this.base.style.top = 'calc(100% - max(16px, env(safe-area-inset-bottom)) - ' + R + 'px)';
    }
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  private startStick(e: PointerEvent, zone: HTMLElement): void {
    if (this.stickId !== -1 || this.editor) return;
    this.capture(zone, e);
    this.stickId = e.pointerId;
    const R = this.radius;
    // The player's switch in the editor beats the game's joystick.mode (resolveTouchLayout).
    if (this.layoutNow.joystickMode === 'fixed') {
      // A fixed joystick never moves: the thumb steers from its resting centre.
      const b = this.base.getBoundingClientRect();
      this.stickX = b.left + b.width / 2;
      this.stickY = b.top + b.height / 2;
    } else {
      const r = zone.getBoundingClientRect();
      // The joystick appears under the thumb, kept whole inside its zone.
      this.stickX = Math.min(Math.max(e.clientX, r.left + R), r.right - R);
      this.stickY = Math.min(Math.max(e.clientY, r.top + R), r.bottom - R);
      this.base.style.left = this.stickX - r.left + 'px';
      this.base.style.top = this.stickY - r.top + 'px';
    }
    this.base.classList.add('live');
    this.moveStick(e);
  }

  private moveStick(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const R = this.radius;
    let dx = e.clientX - this.stickX;
    let dy = e.clientY - this.stickY;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    this.knob.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    const nx = dx / R;
    const ny = dy / R;
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
    if (this.lookId !== -1 || this.editor) return;
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

  /** Show Use on the drive pads (the shell does, while the player sits in a car it got into). */
  setExitButton(show: boolean): void {
    if (show === this.exitShown) return;
    this.exitShown = show;
    if (show) this.root.classList.add('exit'); else this.root.classList.remove('exit');
    if (this.root.parentElement && this.current === 'drive') this.applyLayout();
  }

  /** 'auto': Gas is held for the player whenever the drive pads are up and Brake is not pressed. */
  private holdAutoGas(): void {
    if (this.driveMode !== 'auto') return;
    // Only with the pads on screen (a phone): a keyboard player on a computer drives with W / ArrowUp as always.
    const braking = [...this.buttonsDown.values()].some((b) => b.action === 'down');
    this.input.setVirtualButton('up', this.shown && this.current === 'drive' && !braking);
  }

  /**
   * 'tilt': listen to the phone's tilt sensor and steer with it. iOS asks the player first — that question can only be asked
   * from a tap, so it is asked on the first press of a pedal. The Left / Right pads stay until a real reading arrives.
   */
  private startTilt(): void {
    if (this.tiltOff || typeof window === 'undefined') return;
    const onTilt = (e: Event): void => {
      const o = e as DeviceOrientationEvent;
      if (o.beta === null && o.gamma === null) return;
      if (this.current !== 'drive') return;
      this.root.classList.add('tilting');
      const scr = window.screen;
      const angle = (scr && scr.orientation && typeof scr.orientation.angle === 'number')
        ? scr.orientation.angle
        : Number((window as unknown as { orientation?: number }).orientation) || 0;
      // Steering only: the pedals (virtual buttons) keep their own y.
      this.input.setAnalogueMove(steerFromTilt(o.beta, o.gamma, angle), 0);
    };
    const ask = (): void => {
      const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => 'denied');
    };
    window.addEventListener('deviceorientation', onTilt);
    this.pedals.addEventListener('pointerdown', ask, { once: true });
    this.tiltOff = () => {
      window.removeEventListener('deviceorientation', onTilt);
      this.pedals.removeEventListener('pointerdown', ask);
      this.root.classList.remove('tilting');
    };
  }

  private stopTilt(): void {
    if (!this.tiltOff) return;
    const off = this.tiltOff;
    this.tiltOff = null;
    off();
    this.input.setAnalogueMove(0, 0);
  }

  private pressButton(e: PointerEvent, action: string, el: HTMLElement): void {
    this.capture(el, e);
    this.buttonsDown.set(e.pointerId, { action, el });
    el.classList.add('down');
    this.input.setVirtualButton(action, true);
    if (action === 'down') this.holdAutoGas();
  }

  private releaseButton(e: PointerEvent): void {
    const held = this.buttonsDown.get(e.pointerId);
    if (!held) return;
    this.buttonsDown.delete(e.pointerId);
    held.el.classList.remove('down');
    // Another finger may still hold the same action; release it only when none does.
    if (![...this.buttonsDown.values()].some((b) => b.action === held.action)) this.input.setVirtualButton(held.action, false);
    if (held.action === 'down') this.holdAutoGas();
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
    // An open editor holds a window key listener that swallows Esc: it must never outlive the controls.
    this.finishEditing();
    this.stopTilt();
    this.releaseAll();
    if (this.driveMode === 'auto') this.input.setVirtualButton('up', false);
    for (const off of this.detach) { try { off(); } catch { /* teardown never throws */ } }
    this.detach.length = 0;
    this.root.parentElement?.removeChild(this.root);
  }
}
`;

const RACING_ROAD_GAME = `// STARTING POINT. A later request may change the car, the track, the rules, a level, the graphics, the sounds or the genre. Edit this file when its props do not reach the ask.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Game } from './Game';
import { events } from './core/events';
import { state } from './core/state';
import { createCar, createTrackStream, createVehicleState, driveVehicle, RACING_ROAD_MAPS, type TrackPlan, type TrackStream, type VehicleState, type VehicleTuning } from './three/objects';
import { createRace, type Race } from './three/race';
import { applyCarChoice, loadModelTrack, loadWorldRace, projectRaceChoices, type CarChoice, type CarModelHandle, type ModelTrack, type TrackChoice, type WorldRaceHandle, type WorldRaceModule } from './play/raceCustom';

/** Original racing starter. New plan identity restarts the game (all settings apply).
 * Keep plan identity stable for ordinary rerenders; onReady exposes seamless live setPlan.
 * THE CAR AND THE TRACK ARE THE USER'S: src/game/car.ts (export const CAR) and src/game/track.ts (export const TRACK) are
 * read by themselves when they exist (play/raceCustom.ts); the car and track props win over them. */
export function RacingRoadGame({ plan, onReady, opponents = 3, finishKm = null, car: carProp, track: trackProp }: {
  plan?: TrackPlan; onReady?: (stream: TrackStream) => void;
  /** Rival cars on the road (0 to 7); 0 is a solo drive. */
  opponents?: number;
  /** A finish line this many km from the start; null (default) keeps the endless road endless. */
  finishKm?: number | null;
  /** The player's car: colour, size, how it drives, or a 3D model. Default: src/game/car.ts, else the kit car. */
  car?: CarChoice;
  /** Race on a 3D track model instead of the road library (laps, its own racing line). Default: src/game/track.ts. */
  track?: TrackChoice;
} = {}) {
  const own = projectRaceChoices();
  const carChoice = carProp ?? own.car ?? undefined;
  const trackChoice = trackProp ?? own.track ?? undefined;
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const live = useRef<Game | null>(null);
  const config = useRef({ plan, onReady });
  config.current = { plan, onReady };
  const [failure, setFailure] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [call, setCall] = useState<string | null>(null);
  // What the player must be told about their own car or track (loading, scaled, or why it could not be used).
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current) return;
    setFailure(null); setNotice(null);
    let game: Game | null = null, stream: TrackStream | null = null, course: ModelTrack | null = null;
    let car: ReturnType<typeof createCar> | undefined, drive: VehicleState, race: Race | null = null, look: CarModelHandle | null = null;
    // TRACK.world: the race on the open world's highways (play/worldRace.ts), only when the game has that file.
    let worldRace: WorldRaceHandle | null = null;
    const tuning: VehicleTuning = { ...(carChoice?.tuning ?? {}) };
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
      look?.dispose(); if (worldRace) { worldRace.dispose(); race = null; } race?.dispose(); stream?.dispose(); course?.dispose(); car?.userData.disposeOwnedMaterials?.(); game?.dispose();
    };
    const begin = (custom: ModelTrack | null, worldMod: WorldRaceModule | null = null) => {
      if (released || !host.current) return;
      course = custom;
      if (custom) tuning.ground = custom.heightAt;
      try {
        game = new Game({ container: host.current, camera: 'chase', playerBody: false, gameId: 'road-library',
          setup: (ctx) => {
            if (worldMod && !custom) {
              car = createCar({ color: carChoice?.color ?? 0xb42b2b, detail: 'lite' });
              try { worldRace = worldMod.startWorldRace(ctx, { car, opponents, finishKm }); tuning.ground = worldRace.groundAt; }
              catch (error) { worldRace = null; setNotice('This race cannot run on the world (' + (error instanceof Error ? error.message : 'the world could not be made') + '), so it runs on the road library.'); }
            }
            if (!custom && !worldRace) stream = createTrackStream(config.current.plan, { detail: 'lite' });
            const start = worldRace ? worldRace.startPose : custom ? custom.startPose : stream!.startPose;
            car = car ?? createCar({ color: carChoice?.color ?? 0xb42b2b, detail: 'lite' });
            car.position.set(start.x, start.y, start.z);
            car.rotation.y = start.heading;
            drive = createVehicleState(car, tuning);
            if (worldRace) ctx.scene.add(car); else ctx.scene.add(custom ? custom.root : stream!.root, car);
            ctx.follow(car);
            // The user's own car model, when they chose one: the kit car keeps driving, the model is its look.
            look = applyCarChoice(car, carChoice, undefined, setNotice);
            if (worldRace) {
              race = worldRace.race;
            } else if (custom) {
              ctx.scene.background = new THREE.Color(skies[0]);
              ctx.scene.fog = new THREE.Fog(skies[0], 120, 900);
              race = createRace(ctx.scene, { stream: custom, opponents, finishDistance: custom.laps * custom.length });
            } else {
              race = createRace(ctx.scene, { stream: stream!, opponents, finishDistance: finishKm != null && finishKm > 0 ? finishKm * 1000 : null });
            }
          },
          update: (ctx, dt) => {
            if (!car) return;
            if (worldRace) {
              // The race on the world's highways: the world streams round the car, the route gives its distance.
              if (!race || race.canDrive()) drive = driveVehicle(car, drive, ctx.input.axis(), dt, tuning);
              const w = worldRace.update(ctx, dt);
              hudTime += dt;
              if (hud.current && hudTime >= 0.2) {
                hudTime = 0;
                const st = w.standing;
                const place = st.total > 1 ? 'P' + st.position + '/' + st.total + ' · ' : '';
                const clock = Math.floor(st.time / 60) + ':' + (st.time % 60).toFixed(1).padStart(4, '0') + ' · ';
                hud.current.textContent = place + clock + 'World race · ' + w.km.toFixed(1) + '/' + w.totalKm.toFixed(1) + ' km · ' + Math.round(Math.abs(drive.speed) * 3.6) + ' km/h';
              }
              return;
            }
            if (course) {
              // A lap race on the user's own track: the race holds the car at the line, then laps count to the finish.
              if (!race || race.canDrive()) drive = driveVehicle(car, drive, ctx.input.axis(), dt, tuning);
              const lapStatus = course.update(car);
              const lapStanding = race?.update(dt, lapStatus.distance);
              hudTime += dt;
              if (hud.current && hudTime >= 0.2) {
                hudTime = 0;
                const place = lapStanding && lapStanding.total > 1 ? 'P' + lapStanding.position + '/' + lapStanding.total + ' · ' : '';
                const clock = lapStanding ? Math.floor(lapStanding.time / 60) + ':' + (lapStanding.time % 60).toFixed(1).padStart(4, '0') + ' · ' : '';
                hud.current.textContent = place + clock + course.name + ' · Lap ' + Math.min(course.laps, lapStatus.lap + 1) + '/' + course.laps + ' · ' + Math.round(Math.abs(drive.speed) * 3.6) + ' km/h';
              }
              return;
            }
            if (!stream) return;
            // Held at the line through the countdown; the car keeps its starting speed for the moment GO comes.
            if (!race || race.canDrive()) drive = driveVehicle(car, drive, ctx.input.axis(), dt, tuning);
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
        if (stream) {
          // Play again: the race has laid the road again from its first piece (race.ts calls stream.reset()); the car
          // goes back to the start line on it.
          const road = stream;
          road.onReset = () => {
            if (!car) return;
            car.position.set(road.startPose.x, road.startPose.y, road.startPose.z);
            car.rotation.y = road.startPose.heading;
            drive = createVehicleState(car, tuning);
            lastMap = -1;
          };
        }
        if (worldRace) {
          // Play again after the finish starts the same world race from the line.
          offs.push(events.on('GAME_STARTED', () => {
            if (!car || !worldRace) return;
            worldRace.reset();
            drive = createVehicleState(car, tuning);
          }));
        }
        if (custom) {
          // Play again after the finish starts the same lap race from the line.
          offs.push(events.on('GAME_STARTED', () => {
            if (!car || !course) return;
            course.reset();
            car.position.set(course.startPose.x, course.startPose.y, course.startPose.z);
            car.rotation.y = course.startPose.heading;
            drive = createVehicleState(car, tuning);
          }));
        }
        if (stream) config.current.onReady?.(stream);
      } catch (error) {
        release();
        setFailure(error instanceof Error ? error.message : 'This device could not start the 3D road.');
      }
    };
    const trackName = typeof trackChoice?.model === 'string' ? trackChoice.model.trim() : '';
    if (trackChoice && !trackName && trackChoice.world === true) {
      // TRACK.world: the race on the open world, when the game has the world race (written after the user said yes).
      setNotice('Loading the world...');
      void loadWorldRace().then((mod) => {
        if (released) return;
        setNotice(mod ? null : 'This game does not have the world race yet, so it runs on the road library.');
        begin(null, mod);
      });
    } else if (trackChoice && trackName) {
      // The user's own track: loaded and read first, then raced on — or the reason it cannot be, said on screen.
      setNotice('Loading your track...');
      void loadModelTrack(trackChoice).then((built) => {
        if (released) { if (built.ok) built.track.dispose(); return; }
        if (built.ok) { setNotice(built.notes.length ? built.notes.join(' ') : null); begin(built.track); }
        else { setNotice('Your track "' + trackName + '" cannot be raced on: ' + built.reason + '. This race runs on the road library instead.'); begin(null); }
      });
    } else begin(null);
    return () => { live.current = null; release(); };
  }, [plan, opponents, finishKm, carChoice, trackChoice]);
  return <div style={{ position: 'relative', width: '100%', height: '100dvh', minHeight: 320, background: '#10162f' }}>
    <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    <div style={{ position: 'absolute', left: 16, top: 16, color: 'white', background: '#10162fcc', padding: 12, borderRadius: 12, pointerEvents: 'none' }}>
      <div ref={hud}>{trackChoice?.model ? 'Your track' : '01/12 · Highway Straight · 0/10 km · Loop 1'}</div>
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
    {notice && <div role="status" aria-live="polite" style={{ position: 'absolute', left: 16, right: 16, bottom: 16, color: 'white', background: '#7f1d1dd9', padding: 12, borderRadius: 12, pointerEvents: 'none' }}>{notice}</div>}
    {failure && <div role="alert" style={{ position: 'absolute', top: '40%', padding: 24, color: 'white' }}>{failure}</div>}
  </div>;
}
`;

const LANE_RUNNER_GAME = `import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GameCanvas } from './GameCanvas';
import type { GameContext, GameOptions } from './Game';
import { events } from './core/events';
import { state, setStatus, addScore } from './core/state';
import { LaneRunner, RunnerMissions, runnerInput, type RunnerMission, type RunnerOptions, type RunnerPowerKind } from './core/runner';
import { bindSwipe } from './core/swipe';
import { tunable } from './core/tuning';
import { createHumanoid } from './three/humanoid';
import { createPlayerCharacter, resolvePlayerChoice, type PlayerChoice } from './play/playerBody';

/**
 * ORIGINAL ENDLESS-RUNNER STARTER — a starting point, not a locked template. A later request may change the character,
 * the rules, a level, the graphics, the sounds, the language, the UI or the genre by editing this file.
 * The rules are the kit's LaneRunner (a row always has a way through; no tunnelling at speed); this file draws them
 * and wires the kit: start screen, pause, game over with Play again, settings, language, swipes and keys.
 * EXTRAS: power-ups on the road (🧲 magnet, 🛡 shield, ×2 coins), one revive per run ("Keep running" after a crash),
 * and missions — three goals at a time, saved on the device; finishing all three raises the score multiplier.
 *
 * 🔴 LEFT IS LEFT. LaneRunner's lane 0 is the player's LEFT and run.x grows to the RIGHT. The camera sits behind the
 * runner looking down +Z, and from there the screen's right is world -X — so the runner is drawn at x = -run.x
 * (runnerWorldX). Drawing it at +run.x makes Right move the runner LEFT on screen.
 */
export interface LaneRunnerGameProps {
  title?: string;
  subtitle?: string;
  /** Lanes across the track (1 to 5, default 3). */
  lanes?: number;
  /** Starting and top speed, metres per second (defaults 10 and 30). */
  startSpeed?: number;
  maxSpeed?: number;
  runnerColor?: number;
  trackColor?: number;
  skyColor?: number;
  /** The same seed gives the same course (default: a new course every run). */
  seed?: number;
  /**
   * WHO RUNS: the kit runner's look, a library character or the user's own model (see play/playerBody.ts). Left out, the
   * runner reads src/game/player.ts by itself — change the character there. The model runs, jumps, slides and falls with
   * its own clips, and says on screen which of those moves it lacks.
   */
  player?: PlayerChoice;
  /** Revives a run may use after a crash (default 1; 0 = straight to game over). */
  revives?: number;
  /** Seconds the "Keep running" offer stays up after a crash (default 3). */
  reviveSeconds?: number;
  /** Chance a row carries a power-up (default 0.12; 0 = none). */
  powerUpChance?: number;
  /** Missions and the score multiplier (default true). */
  missions?: boolean;
}

/** What the overlay shows: power-up timers, the revive offer, missions and the multiplier. */
export interface LaneRunnerHud {
  magnet: number; shield: number; double: number;
  /** Seconds left to take the revive (0 = no offer). */
  reviveOffer: number;
  revivesLeft: number;
  missions: RunnerMission[];
  missionLevel: number;
  multiplier: number;
  /** The last mission finished, shown for a moment. */
  toast: string;
}
const MISSIONS_KEY = 'lane-runner-missions-v1';
const MISSION_WORDS: Record<RunnerMission['kind'], string> = {
  distance: 'Run {n} m in one go', coins: 'Collect {n} coins', jumps: 'Jump {n} times', slides: 'Slide {n} times',
  powerups: 'Pick up {n} power-ups', lanes: 'Change lanes {n} times',
};
export function missionText(m: RunnerMission): string { return MISSION_WORDS[m.kind].replace('{n}', String(m.target)); }
function loadMissions(): RunnerMissions {
  try { return new RunnerMissions(JSON.parse(globalThis.localStorage?.getItem(MISSIONS_KEY) ?? 'null')); } catch { return new RunnerMissions(); }
}
function saveMissions(m: RunnerMissions): void {
  try { globalThis.localStorage?.setItem(MISSIONS_KEY, JSON.stringify(m.save())); } catch { /* storage can be blocked */ }
}

/** World x for a runner x: the camera looks down +Z, so the screen's right is world -X. */
export function runnerWorldX(x: number): number { return -x; }

const LANE_WIDTH = 2.2;

export interface LaneRunnerScene {
  run: LaneRunner;
  setup: (ctx: GameContext) => void;
  update: (ctx: GameContext, dt: number) => void;
  /** Begin a fresh run (Play and Play again call this through GAME_STARTED). */
  restart: () => void;
  /** Take the revive offered after a crash. Returns false when there is no offer. */
  revive: () => boolean;
  /** A snapshot for the overlay. */
  hud: () => LaneRunnerHud;
  missions: RunnerMissions | null;
  dispose: () => void;
}

/** The runner game without React: the GameCanvas starter below uses it, and so can a game of your own. */
export function createLaneRunnerScene(props: LaneRunnerGameProps = {}): LaneRunnerScene {
  const lanes = Math.max(1, Math.min(5, Math.round(props.lanes ?? 3)));
  const runnerOptions: RunnerOptions = {
    lanes, laneWidth: LANE_WIDTH, startSpeed: props.startSpeed ?? 10, maxSpeed: props.maxSpeed ?? 30, seed: props.seed ?? Date.now(),
    revives: props.revives ?? 1, powerUpChance: props.powerUpChance ?? 0.12,
  };
  const run = new LaneRunner(runnerOptions);
  const missions = props.missions === false ? null : loadMissions();
  const reviveSeconds = Math.max(0.5, props.reviveSeconds ?? 3);
  let reviveOffer = 0;
  let toast = '', toastT = 0;
  // The Tune panel in NavBharatAI's preview shows this as a slider (core/tuning): the whole run faster or slower.
  const pace = tunable('gameSpeed', 1, { label: 'Game speed', min: 0.5, max: 2, step: 0.05 });
  const width = lanes * LANE_WIDTH + 1;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T): T => { geometries.push(g); return g; };
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }); materials.push(m); return m; };
  const block = { geo: geo(new THREE.BoxGeometry(LANE_WIDTH * 0.85, 2.4, 1.2)), mat: mat(0xd94841) };
  const low = { geo: geo(new THREE.BoxGeometry(LANE_WIDTH * 0.9, 0.5, 0.4)), mat: mat(0xf2c14e) };
  const high = { geo: geo(new THREE.BoxGeometry(LANE_WIDTH * 0.95, 0.35, 0.4)), mat: mat(0x3d8bfd) };
  const post = { geo: geo(new THREE.BoxGeometry(0.15, 2.2, 0.15)), mat: mat(0x6b7280) };
  const coin = { geo: geo(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16)), mat: mat(0xffd23f, { metalness: 0.6, roughness: 0.3, emissive: 0x6b4f00 }) };
  // POWER-UPS: a red magnet ring, a blue shield ball, a green ×2 gem. Change their look here.
  const powerLooks: Record<RunnerPowerKind, { geo: THREE.BufferGeometry; mat: THREE.Material }> = {
    magnet: { geo: geo(new THREE.TorusGeometry(0.35, 0.12, 8, 16, Math.PI * 1.4)), mat: mat(0xe11d48, { emissive: 0x5b0718 }) },
    shield: { geo: geo(new THREE.SphereGeometry(0.4, 16, 12)), mat: mat(0x38bdf8, { emissive: 0x0b4a6b }) },
    double: { geo: geo(new THREE.OctahedronGeometry(0.42)), mat: mat(0x22c55e, { emissive: 0x0b5227 }) },
  };
  // The shield bubble around the runner while a shield is on.
  const bubble = new THREE.Mesh(geo(new THREE.SphereGeometry(1.1, 20, 14)), mat(0x7dd3fc, { transparent: true, opacity: 0.25 }));
  bubble.visible = false;
  const root = new THREE.Group();
  root.name = 'Lane runner';
  const track = new THREE.Group();
  const ground = new THREE.Mesh(geo(new THREE.BoxGeometry(width, 0.1, 400)), mat(props.trackColor ?? 0x4a4e57));
  ground.position.y = -0.05;
  track.add(ground);
  for (let i = 1; i < lanes; i++) {
    const line = new THREE.Mesh(geo(new THREE.BoxGeometry(0.08, 0.02, 400)), mat(0xf5f5f5));
    line.position.set(runnerWorldX((i - lanes / 2) * LANE_WIDTH), 0.01, 0);
    track.add(line);
  }
  for (const side of [-1, 1]) {
    const grass = new THREE.Mesh(geo(new THREE.BoxGeometry(60, 0.08, 400)), mat(0x5f9e4f));
    grass.position.set(side * (width / 2 + 30), -0.06, 0);
    track.add(grass);
  }
  root.add(track);
  // Posts beside the track every 8 m, recycled as the runner passes: what makes the speed visible.
  const POSTS = 30, SPACING = 8;
  const posts: THREE.Mesh[] = [];
  for (let i = 0; i < POSTS * 2; i++) { const p = new THREE.Mesh(post.geo, post.mat); posts.push(p); root.add(p); }
  const choice = resolvePlayerChoice(props.player);
  const runner = createHumanoid({ height: 1.7, shirt: 0x2563eb, ...(choice?.look || {}), ...(props.runnerColor !== undefined ? { shirt: props.runnerColor } : {}) });
  root.add(runner.root);
  // The player's own character (src/game/player.ts) runs in the kit runner's place once it has loaded.
  const body = new THREE.Group();
  body.name = 'Player character';
  root.add(body);
  const character = createPlayerCharacter(body, choice, () => { runner.root.visible = false; });
  const obstacleMeshes = new Map<number, THREE.Mesh | THREE.Group>();
  const coinMeshes = new Map<number, THREE.Mesh>();
  const powerMeshes = new Map<number, THREE.Mesh>();
  root.add(bubble);
  let scored = 0;

  const clearPieces = () => {
    for (const m of obstacleMeshes.values()) root.remove(m);
    for (const m of coinMeshes.values()) root.remove(m);
    for (const m of powerMeshes.values()) root.remove(m);
    obstacleMeshes.clear(); coinMeshes.clear(); powerMeshes.clear();
  };
  const restart = () => {
    run.reset(props.seed ?? Date.now());
    clearPieces();
    scored = 0;
    reviveOffer = 0;
    if (missions) { missions.newRun(); run.scoreMultiplier = missions.multiplier; }
    runner.revive();
    character.revive();
    runner.root.scale.set(1, 1, 1);
  };
  const revive = (): boolean => {
    if (reviveOffer <= 0 || !run.revive()) return false;
    reviveOffer = 0;
    runner.revive(); character.revive();
    return true;
  };
  const offStart = events.on('GAME_STARTED', restart);

  const obstacleMesh = (kind: string): THREE.Mesh | THREE.Group => {
    if (kind === 'block') { const m = new THREE.Mesh(block.geo, block.mat); m.position.y = 1.2; m.castShadow = true; return m; }
    if (kind === 'low') { const m = new THREE.Mesh(low.geo, low.mat); m.position.y = 0.25; return m; }
    // 'high': a bar on two posts — slide under it.
    const g = new THREE.Group();
    const bar = new THREE.Mesh(high.geo, high.mat); bar.position.y = 1.35; g.add(bar);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(post.geo, post.mat); p.position.set(s * LANE_WIDTH * 0.47, 1.1, 0); g.add(p); }
    return g;
  };

  const sync = () => {
    const x = runnerWorldX(run.x);
    runner.root.position.set(x, run.y, run.distance);
    runner.root.scale.y = run.sliding ? 0.55 : 1;
    // The character takes the move the run is in; it is squashed for a slide only when it has no slide clip of its own.
    const own = character.move(!run.alive ? 'idle' : run.sliding ? 'slide' : run.jumping ? 'jump' : state.status === 'playing' ? 'run' : 'idle');
    body.position.copy(runner.root.position);
    body.scale.y = run.sliding && !own ? 0.55 : 1;
    track.position.z = run.distance + 150;
    for (let i = 0; i < posts.length; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const slot = Math.floor(i / 2);
      const z = Math.floor(run.distance / SPACING) * SPACING + (slot - 4) * SPACING;
      posts[i].position.set(side * (width / 2 + 0.6), 1.1, z);
    }
    const seen = new Set<number>();
    for (const o of run.obstacles) {
      seen.add(o.id);
      let m = obstacleMeshes.get(o.id);
      if (!m) { m = obstacleMesh(o.kind); obstacleMeshes.set(o.id, m); root.add(m); }
      m.position.x = runnerWorldX(run.laneX(o.lane)); m.position.z = o.z;
    }
    for (const [id, m] of obstacleMeshes) if (!seen.has(id)) { root.remove(m); obstacleMeshes.delete(id); }
    const coinsSeen = new Set<number>();
    for (const c of run.pickups) {
      coinsSeen.add(c.id);
      let m = coinMeshes.get(c.id);
      if (!m) { m = new THREE.Mesh(coin.geo, coin.mat); m.rotation.z = Math.PI / 2; coinMeshes.set(c.id, m); root.add(m); }
      // A magnet draws the coins it is about to pull in toward the runner.
      const pull = run.magnet > 0 && c.z - run.distance < 8 ? Math.max(0, 1 - (c.z - run.distance) / 8) : 0;
      m.position.set(runnerWorldX(run.laneX(c.lane) + (run.x - run.laneX(c.lane)) * pull), 0.8, c.z);
      m.rotation.y += 0.08;
    }
    for (const [id, m] of coinMeshes) if (!coinsSeen.has(id)) { root.remove(m); coinMeshes.delete(id); }
    const powersSeen = new Set<number>();
    for (const p of run.powerUps) {
      powersSeen.add(p.id);
      let m = powerMeshes.get(p.id);
      if (!m) { m = new THREE.Mesh(powerLooks[p.kind].geo, powerLooks[p.kind].mat); powerMeshes.set(p.id, m); root.add(m); }
      m.position.set(runnerWorldX(run.laneX(p.lane)), 1, p.z);
      m.rotation.y += 0.05;
    }
    for (const [id, m] of powerMeshes) if (!powersSeen.has(id)) { root.remove(m); powerMeshes.delete(id); }
    bubble.visible = run.shield > 0 && run.alive;
    bubble.position.set(runner.root.position.x, run.y + 0.9, run.distance);
  };

  return {
    run,
    restart,
    revive,
    missions,
    hud: () => ({
      magnet: run.magnet, shield: run.shield, double: run.double, reviveOffer, revivesLeft: run.revivesLeft,
      missions: missions ? missions.goals.map((g) => ({ ...g })) : [], missionLevel: missions?.level ?? 0,
      multiplier: run.scoreMultiplier, toast: toastT > 0 ? toast : '',
    }),
    setup: (ctx) => {
      ctx.scene.background = new THREE.Color(props.skyColor ?? 0x9bd3f0);
      ctx.scene.fog = new THREE.Fog(props.skyColor ?? 0x9bd3f0, 40, 160);
      ctx.scene.add(root);
      sync();
      ctx.follow(runner.root);
    },
    update: (ctx, dt) => {
      if (state.status === 'playing' && !run.alive && reviveOffer > 0) {
        // The "Keep running" offer counts down while the game is playing; when it runs out it is game over.
        reviveOffer = Math.max(0, reviveOffer - dt);
        if (reviveOffer === 0) setStatus('gameover');
      }
      toastT = Math.max(0, toastT - dt);
      if (state.status !== 'playing' || !run.alive) { runner.update(dt, 0, true); character.update(dt); return; }
      const t = dt * pace.value;
      const happened = run.update(t, runnerInput(ctx.input));
      for (const ev of happened) {
        const at = { x: runnerWorldX(run.x), y: run.y + 1, z: run.distance };
        if (ev.type === 'jump') { runner.act('jump'); character.act('jump'); events.emit('PLAYER_JUMPED', { position: at }); }
        else if (ev.type === 'coin') events.emit('ITEM_COLLECTED', { position: { x: runnerWorldX(run.laneX(ev.coin.lane)), y: 0.8, z: ev.coin.z } });
        else if (ev.type === 'powerup') events.emit('ITEM_COLLECTED', { position: { x: runnerWorldX(run.laneX(ev.power.lane)), y: 1, z: ev.power.z } });
        else if (ev.type === 'crash') {
          runner.die(); character.act('die'); events.emit('PLAYER_DIED', { position: at });
          if (run.revivesLeft > 0) reviveOffer = reviveSeconds; else setStatus('gameover');
        }
      }
      if (missions) {
        const done = missions.track(happened, run);
        if (done.finished.length || done.levelledUp) {
          toast = done.levelledUp ? 'Missions done! Score ×' + missions.multiplier : '✓ ' + missionText(done.finished[0]);
          toastT = 2.5;
          if (done.levelledUp) run.scoreMultiplier = missions.multiplier;
          saveMissions(missions);
        }
      }
      runner.update(t, run.alive ? run.speed * pace.value : 0, !run.jumping);
      character.update(t);
      const score = run.score;
      if (score > scored) { addScore(score - scored); scored = score; }
      sync();
    },
    dispose: () => {
      offStart();
      if (missions) saveMissions(missions);
      clearPieces();
      root.removeFromParent();
      character.dispose();
      runner.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/** The ready runner: <LaneRunnerGame title="Mumbai Dash" />. Swipe or use arrows / A D (lanes), Space / W (jump), S (slide). */
export function LaneRunnerGame(props: LaneRunnerGameProps = {}) {
  const scene = useRef<LaneRunnerScene | null>(null);
  const unbind = useRef<(() => void) | null>(null);
  if (!scene.current) scene.current = createLaneRunnerScene(props);
  useEffect(() => () => { unbind.current?.(); scene.current?.dispose(); }, []);
  const s = scene.current;
  const [hud, setHud] = useState<LaneRunnerHud>(() => s.hud());
  useEffect(() => { const id = setInterval(() => setHud(s.hud()), 200); return () => clearInterval(id); }, [s]);
  const options: Omit<GameOptions, 'container'> = {
    camera: 'chase', playerBody: false, gameId: 'lane-runner-starter', touchControls: false, orientation: 'portrait',
    startScreen: {
      title: props.title ?? 'Endless Run', subtitle: props.subtitle ?? 'Dodge, jump and slide. How far can you go?',
      controls: { touch: 'Swipe left or right to change lanes · up to jump · down to slide', keyboard: 'Arrows or A / D to change lanes · Space or W to jump · S to slide · Esc to pause' },
    },
    setup: (ctx) => s.setup(ctx),
    update: (ctx, dt) => s.update(ctx, dt),
  };
  const chip = { background: '#0f172acc', color: 'white', borderRadius: 8, padding: '4px 8px', fontSize: 13 } as const;
  return <>
    <GameCanvas options={options} onReady={(game) => { unbind.current?.(); unbind.current = bindSwipe(window, game.input); }} />
    {/* THE RUN OVERLAY — power-up timers, missions and the revive offer. Move or restyle it here. */}
    <div style={{ position: 'fixed', left: 12, bottom: 12, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none', zIndex: 5 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {hud.magnet > 0 && <span style={chip}>🧲 {Math.ceil(hud.magnet)}</span>}
        {hud.shield > 0 && <span style={chip}>🛡 {Math.ceil(hud.shield)}</span>}
        {hud.double > 0 && <span style={chip}>×2 {Math.ceil(hud.double)}</span>}
        {hud.multiplier > 1 && <span style={chip}>Score ×{hud.multiplier}</span>}
      </div>
      {hud.missions.map((m) => <span key={m.kind} style={{ ...chip, opacity: m.progress >= m.target ? 0.6 : 1 }}>
        {m.progress >= m.target ? '✓' : '○'} {missionText(m)} · {m.progress}/{m.target}
      </span>)}
      {hud.toast && <span style={{ ...chip, background: '#15803dee' }}>{hud.toast}</span>}
    </div>
    {hud.reviveOffer > 0 && <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', zIndex: 6, background: '#0006' }}>
      <button type="button" onClick={() => { if (s.revive()) setHud(s.hud()); }} style={{ fontSize: 22, padding: '14px 22px', borderRadius: 12 }}>
        Keep running ({Math.ceil(hud.reviveOffer)})
      </button>
    </div>}
  </>;
}
`;

export const GAME_FEATURES = String.raw`// FEATURES — how a game grows from one thing to a hundred without breaking (admin 2026-11-21: "user jo chahe game me
// judwaye, usi game me judta chala jaye, kuch bhi tute na … 10-100 kitne bhi").
//
// A game is a LIST of features. Each feature is one small file that adds one thing (coins, police, a mission, rain) through
// the same two calls: setup() once, update() every step. Adding the 50th thing is the same work as adding the 1st: one new
// file and one line in the list. Nothing else is edited, so nothing else can break.
//
// And one feature cannot take the game down: each runs inside its own guard. If one throws, THAT feature is switched off
// and named in the console ("[feature police] …"); the world, the player and every other feature keep running.
import type { GameContext } from '../Game';
import { events } from '../core/events';

export interface FeatureApi {
  /** A value another feature shared (its coins counter, its list of enemies), or undefined when that feature is off. */
  get<T>(id: string): T | undefined;
  /** Is this feature set up and running? */
  has(id: string): boolean;
}

export interface GameFeature<W = unknown> {
  /** A short unique name: 'coins', 'police', 'day-night', 'mission-delivery'. */
  id: string;
  /**
   * The words a player would use for this thing, in English and in their own language: ['police', 'sipahi', 'cop', 'chase'].
   * NavBharatAI reads them to know which part of the game a later request is about.
   */
  about?: string[];
  /** Features this one builds on. They are set up first; if one of them is off, this one stays off too (and says why). */
  needs?: string[];
  /** Runs once. Add your objects here. Return a value to SHARE with other features (they read it with api.get(id)). */
  setup?(ctx: GameContext, world: W, api: FeatureApi): unknown;
  /** Runs every step (fixed 60 Hz), after the features it needs. */
  update?(ctx: GameContext, world: W, delta: number, api: FeatureApi): void;
  /** Remove what setup() added. */
  dispose?(): void;
}

/** Type helper: export default defineFeature({ id: 'coins', setup(ctx, world) { … }, update(ctx, world, dt) { … } }). */
export function defineFeature<W = unknown>(feature: GameFeature<W>): GameFeature<W> { return feature; }

export interface FeatureStatus { id: string; state: 'on' | 'off'; reason?: string }

export interface FeatureHost<W> {
  setup(ctx: GameContext, world: W): void;
  update(ctx: GameContext, world: W, delta: number): void;
  /** What is running and what was switched off, with the reason. */
  status(): FeatureStatus[];
  dispose(): void;
}

export function createFeatureHost<W = unknown>(list: ReadonlyArray<GameFeature<W> | null | undefined>): FeatureHost<W> {
  const off = new Map<string, string>();
  const shared = new Map<string, unknown>();
  const running: GameFeature<W>[] = [];
  const seen = new Set<string>();
  const all: GameFeature<W>[] = [];
  for (const f of list) {
    if (!f || typeof f.id !== 'string' || !f.id) continue;
    if (seen.has(f.id)) { console.error('[feature ' + f.id + '] is listed twice; the second one is ignored.'); continue; }
    seen.add(f.id); all.push(f);
  }
  const api: FeatureApi = { get: <T,>(id: string) => shared.get(id) as T | undefined, has: (id) => running.some((f) => f.id === id) };
  const fail = (f: GameFeature<W>, where: string, error: unknown): void => {
    const reason = where + ': ' + (error instanceof Error ? error.message : String(error));
    off.set(f.id, reason);
    const at = running.indexOf(f); if (at >= 0) running.splice(at, 1);
    shared.delete(f.id);
    console.error('[feature ' + f.id + '] switched off — ' + reason);
    try { events.emit('FEATURE_FAILED', { id: f.id, reason }); } catch { /* a listener must not undo the isolation */ }
  };
  return {
    setup(ctx, world) {
      // In the order of the list, but a feature waits for the ones it needs.
      const pending = [...all];
      let progressed = true;
      while (pending.length && progressed) {
        progressed = false;
        for (let i = 0; i < pending.length; i++) {
          const f = pending[i];
          const needs = f.needs || [];
          const missing = needs.find((id) => !seen.has(id) || off.has(id));
          if (missing) { off.set(f.id, 'needs "' + missing + '", which is not running'); console.error('[feature ' + f.id + '] switched off — needs "' + missing + '", which is not running'); pending.splice(i--, 1); progressed = true; continue; }
          if (needs.some((id) => !running.some((r) => r.id === id))) continue;   // its turn comes after them
          pending.splice(i--, 1); progressed = true;
          try { const value = f.setup ? f.setup(ctx, world, api) : undefined; running.push(f); if (value !== undefined) shared.set(f.id, value); }
          catch (error) { fail(f, 'setup', error); }
        }
      }
      for (const f of pending) { off.set(f.id, 'its needs form a circle'); console.error('[feature ' + f.id + '] switched off — its needs form a circle'); }
    },
    update(ctx, world, delta) {
      for (const f of [...running]) {
        if (!f.update) continue;
        if ((f.needs || []).some((id) => off.has(id))) { fail(f, 'update', new Error('a feature it needs was switched off')); continue; }
        try { f.update(ctx, world, delta, api); } catch (error) { fail(f, 'update', error); }
      }
    },
    status: () => all.map((f) => (off.has(f.id) ? { id: f.id, state: 'off' as const, reason: off.get(f.id) } : { id: f.id, state: 'on' as const })),
    dispose() {
      for (const f of running.splice(0).reverse()) { try { f.dispose?.(); } catch (error) { console.error('[feature ' + f.id + '] dispose: ' + String(error)); } }
      shared.clear();
    },
  };
}

/** For a game on <GameCanvas>: its options with the features run after its own setup() and update(). */
export function withFeatures<O extends { setup?: (ctx: GameContext) => unknown; update?: (ctx: GameContext, delta: number) => void }>(options: O, features: ReadonlyArray<GameFeature<undefined>>): O {
  const host = createFeatureHost<undefined>(features);
  return {
    ...options,
    setup(ctx: GameContext) { const out = options.setup?.(ctx); host.setup(ctx, undefined); return out; },
    update(ctx: GameContext, delta: number) { options.update?.(ctx, delta); host.update(ctx, undefined, delta); },
  } as O;
}
`;

const WORLD_MAP = String.raw`// THE WORLD MAP — what the corner map and the full map draw beyond the markers (admin 2026-11-22: "jaise PUBG/Free Fire me
// location map aa jata hai box me corner par — kya battle ground game me navigation par tap kar kar pura map aur location
// dikha sakte hai?" and "yeh sab user ke control me rahe, user jo kahe woh ho jaye").
//
// A game with a WORLD hands the map its places, lands and roads in WORLD metres with setWorldMapSource() — the open-world
// starter (play/openWorld.ts) does it by itself. The Hud then draws the roads and named places in the corner map, and a tap
// on it (or M) opens the whole world full screen, with pan, zoom and a waypoint. A game without a source keeps the
// markers-only minimap. Everything here is plain arithmetic, so it is tested without a screen.
import { events } from '../core/events';

export interface WorldMapPoint { x: number; z: number }
export interface WorldMapBounds { minX: number; minZ: number; maxX: number; maxZ: number }
/** A place on the map: a city, a town, a village, a land (desert, jungle …) or a user's own map, in WORLD metres. */
export interface WorldMapPlace {
  id: string;
  /** What the map writes on it; '' writes nothing (a tile of a bigger city). */
  name: string;
  kind: string;
  x: number;
  z: number;
  /** How far it reaches from its centre, in metres. */
  radius: number;
  /** 'square' for a place built on a grid (a city), 'circle' for a land. Default 'circle'. */
  shape?: 'square' | 'circle';
}
export interface WorldMapSource {
  places: () => ReadonlyArray<WorldMapPlace>;
  /** Road centre lines, in WORLD metres. */
  roads?: () => ReadonlyArray<ReadonlyArray<WorldMapPoint>>;
  /** The edge of the world the full map may show; left out, it is worked out from the places and roads. */
  bounds?: () => WorldMapBounds;
  /**
   * WORLD = render position + origin(). A world with a floating origin (the big map re-bases far from the start) says where
   * its origin is now, so the player, the vehicle and every marker land in the right place. Left out: 0, 0.
   */
  origin?: () => WorldMapPoint;
}

/**
 * How the minimap looks — every field is the USER's choice, said in chat and written into the game's options:
 * "map right corner me" (corner: 'right'), "bada minimap" (size: 200), "naam mat dikhao" (names: false),
 * "map band karo" (minimap: false), "full map nahi chahiye" (fullMap: false).
 */
export interface MinimapOptions {
  /** Which top corner: 'left' (default) or 'right'. */
  corner?: 'left' | 'right';
  /** Width of the round map in pixels, 80 to 240. Default 128. */
  size?: number;
  /** Write the names of places on the maps. Default true. */
  names?: boolean;
  /** Metres from the middle of the corner map to its edge, 20 to 2000. Default 220 with a world map, 60 without. */
  range?: number;
  /** A tap on the corner map (or M) opens the whole map full screen. Default true when the game has a world map. */
  fullMap?: boolean;
}
export interface MinimapStyle { corner: 'left' | 'right'; size: number; names: boolean; range: number; fullMap: boolean }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The minimap's options, checked: anything unknown or out of range falls back to its default. */
export function minimapStyle(raw: unknown, hasWorld: boolean): MinimapStyle {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    corner: o.corner === 'right' ? 'right' : 'left',
    size: finite(o.size) ? Math.round(clamp(o.size, 80, 240)) : 128,
    names: o.names !== false,
    range: finite(o.range) ? clamp(o.range, 20, 2000) : hasWorld ? 220 : 60,
    fullMap: typeof o.fullMap === 'boolean' ? o.fullMap : hasWorld,
  };
}

let source: WorldMapSource | null = null;
/**
 * Give the maps a world. Returns a function that takes it away again — only if it is still the one given (a remounted game
 * that registered a new world is never wiped by the old one's cleanup).
 */
export function setWorldMapSource(next: WorldMapSource | null): () => void {
  source = next;
  events.emit('WORLD_MAP_CHANGED', { on: next !== null });
  return () => { if (source === next && next !== null) { source = null; events.emit('WORLD_MAP_CHANGED', { on: false }); } };
}
export function worldMapSource(): WorldMapSource | null { return source; }

export interface WorldMapData { places: WorldMapPlace[]; roads: WorldMapPoint[][]; origin: WorldMapPoint; bounds: WorldMapBounds | null }
/** Read the world now. A game callback that throws or returns junk gives an empty map, never a broken HUD. */
export function readWorldMap(from: WorldMapSource | null = source): WorldMapData {
  const out: WorldMapData = { places: [], roads: [], origin: { x: 0, z: 0 }, bounds: null };
  if (!from) return out;
  try {
    for (const p of from.places() || []) {
      if (!p || !finite(p.x) || !finite(p.z)) continue;
      out.places.push({ id: String(p.id ?? ''), name: typeof p.name === 'string' ? p.name : placeName(String(p.id ?? '')), kind: String(p.kind ?? ''), x: p.x, z: p.z, radius: finite(p.radius) && p.radius > 0 ? p.radius : 50, shape: p.shape === 'square' ? 'square' : 'circle' });
    }
  } catch { /* no places */ }
  try {
    for (const line of from.roads?.() || []) {
      const pts = (line || []).filter((q) => q && finite(q.x) && finite(q.z)).map((q) => ({ x: q.x, z: q.z }));
      if (pts.length > 1) out.roads.push(pts);
    }
  } catch { /* no roads */ }
  try { const o = from.origin?.(); if (o && finite(o.x) && finite(o.z)) out.origin = { x: o.x, z: o.z }; } catch { /* origin 0, 0 */ }
  try { const b = from.bounds?.(); if (b && finite(b.minX) && finite(b.minZ) && finite(b.maxX) && finite(b.maxZ) && b.maxX > b.minX && b.maxZ > b.minZ) out.bounds = { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ }; } catch { /* worked out */ }
  return out;
}

/** A readable name from an id: 'old-town' is "Old Town", 'hill_village2' is "Hill Village 2". */
export function placeName(id: string): string {
  const words = String(id || '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 40);
}
/** A name short enough for the corner map. */
export function shortName(name: string, max = 12): string {
  const n = String(name || '').trim();
  return n.length <= max ? n : n.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}
/** '85 m', '1.2 km', '14 km'. */
export function formatDistance(metres: number): string {
  const m = Math.max(0, finite(metres) ? metres : 0);
  if (m < 1000) return Math.round(m) + ' m';
  return (m < 10000 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000))) + ' km';
}

const PLACE_COLOURS: Record<string, string> = {
  city: '#94a3b8', town: '#a8a29e', village: '#c8a97e', custom: '#c084fc',
  desert: '#e9c46a', jungle: '#2d6a4f', mountain: '#8d7b68', snow: '#e8f1ff', beach: '#f4dca2', grassland: '#7cb342',
};
export function placeColour(kind: string): string { return PLACE_COLOURS[kind] ?? '#9ca3af'; }
export const WAYPOINT_COLOUR = '#f472b6';
export const WAYPOINT_COLOUR_SAFE = '#cc79a7';

// ── THE WAYPOINT: a spot the player marked on the full map, shown on the corner map with its distance ──────────────────
let waypoint: WorldMapPoint | null = null;
/** Mark a spot (WORLD metres), or null to clear it. Announced as WAYPOINT_CHANGED, so a game can react to it. */
export function setWaypoint(p: WorldMapPoint | null): void {
  waypoint = p && finite(p.x) && finite(p.z) ? { x: p.x, z: p.z } : null;
  events.emit('WAYPOINT_CHANGED', { waypoint });
}
export function getWaypoint(): WorldMapPoint | null { return waypoint; }

// ── THE CORNER MAP: centred on the player, turned so the camera's forward is up ─────────────────────────────────────────
/** Where a WORLD point lands on the corner map (not pinned to the edge — shapes and roads are clipped by the circle). */
export function cornerPoint(view: { x: number; z: number; forward: WorldMapPoint }, p: WorldMapPoint, range: number, size: number): { x: number; y: number } {
  const dx = p.x - view.x, dz = p.z - view.z, fx = view.forward.x, fz = view.forward.z;
  const right = -dx * fz + dz * fx, up = dx * fx + dz * fz;
  const half = size / 2, k = (half - 6) / range;
  return { x: half + right * k, y: half - up * k };
}

/** The part of a segment inside the box (Liang–Barsky), or null. */
export function clipSegment(a: WorldMapPoint, b: WorldMapPoint, box: WorldMapBounds): [WorldMapPoint, WorldMapPoint] | null {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  const edges: Array<[number, number]> = [[-dx, a.x - box.minX], [dx, box.maxX - a.x], [-dz, a.z - box.minZ], [dz, box.maxZ - a.z]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [{ x: a.x + dx * t0, z: a.z + dz * t0 }, { x: a.x + dx * t1, z: a.z + dz * t1 }];
}

/** A road cut to the box: the pieces of it inside (a road that leaves and comes back is two pieces). */
export function clipRoad(line: ReadonlyArray<WorldMapPoint>, box: WorldMapBounds): WorldMapPoint[][] {
  const out: WorldMapPoint[][] = [];
  let cur: WorldMapPoint[] = [];
  const same = (p: WorldMapPoint, q: WorldMapPoint) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.z - q.z) < 1e-6;
  for (let i = 1; i < line.length; i++) {
    const s = clipSegment(line[i - 1], line[i], box);
    if (!s) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    if (cur.length && same(cur[cur.length - 1], s[0])) cur.push(s[1]);
    else { if (cur.length > 1) out.push(cur); cur = [s[0], s[1]]; }
    if (!same(s[1], line[i])) { out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** The roads within range of a point, cut to the square around it (what the corner map draws). */
export function roadsNear(roads: ReadonlyArray<ReadonlyArray<WorldMapPoint>>, at: WorldMapPoint, range: number): WorldMapPoint[][] {
  const box = { minX: at.x - range, minZ: at.z - range, maxX: at.x + range, maxZ: at.z + range };
  const out: WorldMapPoint[][] = [];
  for (const line of roads) for (const piece of clipRoad(line, box)) out.push(piece);
  return out;
}

// ── THE FULL MAP: north up (north is −z, east is +x), panned and zoomed by the player ───────────────────────────────────
export interface MapCamera { cx: number; cz: number; scale: number }
/** Everything worth showing, with room around it: places (with their reach), roads and any extra points (the player, markers). */
export function boundsOf(places: ReadonlyArray<WorldMapPlace>, roads: ReadonlyArray<ReadonlyArray<WorldMapPoint>>, points: ReadonlyArray<WorldMapPoint>, pad = 150): WorldMapBounds {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const take = (x: number, z: number, r = 0) => { if (!finite(x) || !finite(z)) return; minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r); minZ = Math.min(minZ, z - r); maxZ = Math.max(maxZ, z + r); };
  for (const p of places) take(p.x, p.z, p.radius);
  for (const line of roads) for (const q of line) take(q.x, q.z);
  for (const q of points) take(q.x, q.z);
  if (!finite(minX)) { minX = 0; maxX = 0; minZ = 0; maxZ = 0; }
  return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
}
export function worldToMap(cam: MapCamera, w: number, h: number, p: WorldMapPoint): { x: number; y: number } {
  return { x: w / 2 + (p.x - cam.cx) * cam.scale, y: h / 2 + (p.z - cam.cz) * cam.scale };
}
export function mapToWorld(cam: MapCamera, w: number, h: number, q: { x: number; y: number }): WorldMapPoint {
  return { x: cam.cx + (q.x - w / 2) / cam.scale, z: cam.cz + (q.y - h / 2) / cam.scale };
}
/** How far the player may zoom: out to a little more than the whole world, in to 4 pixels a metre. */
export function zoomLimits(b: WorldMapBounds, w: number, h: number): { min: number; max: number } {
  const fit = Math.min(Math.max(1, w) / Math.max(1, b.maxX - b.minX), Math.max(1, h) / Math.max(1, b.maxZ - b.minZ));
  return { min: fit * 0.8, max: Math.max(fit * 2, 4) };
}
/** The whole world in view, centred. */
export function fitCamera(b: WorldMapBounds, w: number, h: number): MapCamera {
  return { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, scale: zoomLimits(b, w, h).min / 0.8 };
}
/** Keep the zoom within its limits and the middle of the view on the world (the map can never be lost off screen). */
export function clampCamera(cam: MapCamera, b: WorldMapBounds, w: number, h: number): MapCamera {
  const z = zoomLimits(b, w, h);
  return { cx: clamp(finite(cam.cx) ? cam.cx : 0, b.minX, b.maxX), cz: clamp(finite(cam.cz) ? cam.cz : 0, b.minZ, b.maxZ), scale: clamp(finite(cam.scale) ? cam.scale : z.min, z.min, z.max) };
}
/** Zoom by factor around a screen point that stays under the finger (or the mouse). */
export function zoomAt(cam: MapCamera, b: WorldMapBounds, w: number, h: number, factor: number, anchor: { x: number; y: number }): MapCamera {
  const before = mapToWorld(cam, w, h, anchor);
  const z = zoomLimits(b, w, h);
  const scale = clamp(cam.scale * (finite(factor) && factor > 0 ? factor : 1), z.min, z.max);
  return clampCamera({ scale, cx: before.x - (anchor.x - w / 2) / scale, cz: before.z - (anchor.y - h / 2) / scale }, b, w, h);
}
/** Drag the map by dx, dy pixels. */
export function panBy(cam: MapCamera, b: WorldMapBounds, w: number, h: number, dx: number, dy: number): MapCamera {
  return clampCamera({ ...cam, cx: cam.cx - dx / cam.scale, cz: cam.cz - dy / cam.scale }, b, w, h);
}
/** A round grid step (100 m, 250 m, 500 m, 1 km …) at least minPx apart on screen at this zoom. */
export function gridStep(scale: number, minPx = 70): number {
  for (const s of [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000]) if (s * scale >= minPx) return s;
  return 50000;
}
`;

const FILES: Record<string, string> = {
  'src/game/Game.ts': GAME,
  'src/game/RacingRoadGame.tsx': RACING_ROAD_GAME,
  // The race's car and track are the user's to change (car.ts / track.ts, models included): read by the starter (2026-11-22).
  [RACE_CUSTOM_PATH]: RACE_CUSTOM,
  'src/game/LaneRunnerGame.tsx': LANE_RUNNER_GAME,
  'src/game/GameCanvas.tsx': GAME_CANVAS,
  'src/game/ui/Hud.tsx': HUD,
  'src/game/ui/touchControls.ts': TOUCH_CONTROLS,
  // What the corner map and the full map draw beyond the markers: a world's places and roads, and the waypoint (2026-11-22).
  'src/game/ui/worldMap.ts': WORLD_MAP,
  // How a game grows: a list of small features, each guarded, added one file at a time (2026-11-21).
  'src/game/play/features.ts': GAME_FEATURES,
  // Who the player is, for every game on the shell: src/game/player.ts swaps the character (2026-11-22).
  [GAME_PLAYER_BODY_PATH]: GAME_PLAYER_BODY,
  [GAME_ACTIONS_PATH]: GAME_ACTIONS,
  [GAME_AIM_PATH]: GAME_AIM,
  [GAME_BOUNDARY_PATH]: GAME_BOUNDARY,
};

export const GAME_SHELL_MODULES: readonly string[] = ['game', 'gamecanvas', 'hud', 'touchcontrols', 'worldmap', 'features', 'playerbody', 'actions', 'aim', 'boundary', 'racingroadgame', 'racecustom', 'lanerunnergame'];


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
    if (files['src/game/LaneRunnerGame.tsx']) files['src/game/GameCanvas.tsx'] = FILES['src/game/GameCanvas.tsx'];
    // The race starter reads the user's own car and track through play/raceCustom.ts; it never compiles without it.
    if (files['src/game/RacingRoadGame.tsx']) files[RACE_CUSTOM_PATH] = FILES[RACE_CUSTOM_PATH];
    if (files['src/game/GameCanvas.tsx'] || files['src/game/ui/Hud.tsx'] || files['src/game/RacingRoadGame.tsx']) {
      files['src/game/Game.ts'] = FILES['src/game/Game.ts'];
    }
    // Game draws the touch controls, so it never ships without them (and they are useless alone).
    if (files['src/game/Game.ts']) files['src/game/ui/touchControls.ts'] = FILES['src/game/ui/touchControls.ts'];
    // Game's options name the minimap's look, and the Hud draws the world map: both read ui/worldMap.ts.
    if (files['src/game/Game.ts']) files['src/game/ui/worldMap.ts'] = FILES['src/game/ui/worldMap.ts'];
    // The feature host types against Game's context, and every game on the shell may grow by features.
    if (files['src/game/Game.ts']) files['src/game/play/features.ts'] = FILES['src/game/play/features.ts'];
    // Game reads who the player is (src/game/player.ts) through it, so the two always ship together.
    if (files['src/game/Game.ts']) files[GAME_PLAYER_BODY_PATH] = FILES[GAME_PLAYER_BODY_PATH];
    if (files['src/game/Game.ts']) files[GAME_ACTIONS_PATH] = FILES[GAME_ACTIONS_PATH];
    if (files['src/game/Game.ts']) files[GAME_AIM_PATH] = FILES[GAME_AIM_PATH];
    if (files['src/game/Game.ts']) files[GAME_BOUNDARY_PATH] = FILES[GAME_BOUNDARY_PATH];
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
      (files[GAME_BOUNDARY_PATH] ? 'THE MAP HAS AN EDGE: pass bounds: { minX, maxX, minZ, maxZ } in the options (or ctx.world.setBounds in setup) — the player, the car they drive and every character stay inside behind real walls (walls: "invisible" when mountains or sea are the visible edge); never let anyone drive or walk off the map.\n' : '') +
      (files[GAME_AIM_PATH] ? 'EVERY GUN AIMS WITH ctx.aim(): const a = ctx.aim(); gun.update(dt, fire, a.muzzle, a.shot, bullets) — the crosshair point from the real muzzle; never a hand-written direction (a constant one fires the same way whatever the aim).\n' : '') +
      (files[GAME_ACTIONS_PATH] ? 'ANY ACTION THE USER NAMES (pick up the gun on the road, open the gate and go in, eat, climb…) is played on the player\'s chosen character with performAction(ctx, name) from ./game/play/actions (kit: pick-up, drop, eat, drink, open-door, wave, point, raise-hands, bow); for any other, run_recipe({ name: "compose_action" }) makes it. Never tell the user the character lacks a move. Mark a pickup with object.userData.pickup = true. ANY other character (an NPC, an enemy) holds an item with holdInHand(character, item) from ./game/play/playerBody — a library model by its hand bone, a kit person by its grip. ANY visual effect the user imagines (fire tornado, rainbow trail, magic): run_recipe({ name: \"compose_effect\" }), then ctx.particles.burst(name, x, y, z).\n' : '') +
      'For racing without a specified course, render <RacingRoadGame /> from ./game/RacingRoadGame: it actually runs the 12-map 10–100 km looping library, HUD, touch driving, distinct sky themes and pause/resume. Custom routes still use your own setup.\n' +
      (files[RACE_CUSTOM_PATH] ? 'The player\'s CAR and TRACK are the user\'s to change: RacingRoadGame reads src/game/car.ts (export const CAR: CarChoice — color, tuning, or a 3D model sized to the car) and src/game/track.ts (export const TRACK: TrackChoice — race laps on the user\'s own track model) by itself when they exist; see src/game/play/raceCustom.ts.\n' : '') +
      (files['src/game/LaneRunnerGame.tsx'] ? 'For an endless runner, render <LaneRunnerGame title="…" /> from ./game/LaneRunnerGame: three lanes, obstacles to dodge, jump and slide under (a row always has a way through), coins, rising speed, swipes and keys, and the kit\'s start screen, pause, game over with Play again, settings and language. Change the theme (colours, title, lanes, speed) through its props, or build your own scene with createLaneRunnerScene(); never hand-write the runner\'s rules, lanes or swipes.\n' : '') +
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
      '// WALK AND DRIVE (get in and out with E / the Use button): hand the car to ctx.vehicles — NEVER hand-write it.\n' +
      '//   setup: (ctx) => { const car = createCar(); car.position.set(4, 0, 0); ctx.scene.add(car); ctx.vehicles.add(car); }\n' +
      '// The shell shows "E — get in" beside it, hides and holds the body, chases and DRIVES the car, and puts the player\n' +
      '// beside it on the way out (braking first). Read ctx.vehicles.seated for whether the player is in one.\n' +
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
      '- WHEN THE USER ASKS WHERE THE CONTROLS GO, set it in touchControls — never move them with your own CSS:\n' +
      "  \"joystick on the right\" / \"buttons on the left\" → joystick: { side: 'right' } (the buttons and camera drag swap\n" +
      "  sides with it); \"bigger joystick\" → joystick: { size: 1.4 } (0.6..2); \"fixed joystick\" → joystick: { mode: 'fixed' }\n" +
      '  (default floating: it appears under the thumb); a spot → joystick: { position: { x: 0.2, y: 0.75 } }.\n' +
      "  One button somewhere, or bigger → buttonPositions: { attack: { x: 0.88, y: 0.7, size: 1.4 } } (keys are action\n" +
      "  names, or 'steer' / 'pedals' for the car pads; x/y are the CENTRE as a fraction of the screen, 0..1).\n" +
      '  "see-through controls" → opacity: 0.6 (0.2..1). These are the DEFAULTS: every player can also open\n' +
      '  Settings → Edit controls in the game to drag, pinch-resize and fade each control and make the joystick fixed or\n' +
      '  floating; controls never cover each other or leave the screen. It is saved per game\n' +
      '  (gameId) on their device, and the player\'s own layout always wins. Do not build another layout editor.\n' +
      "- A CAR THE PLAYER DRIVES with driveVehicle(car, state, ctx.input.axis(), dt) is recognised by the\n" +
      "  shell: the camera chases it from BEHIND even if you forget ctx.follow (with camera: 'chase' and a\n" +
      "  single car, from the first frame; with rivals or a parked car, call ctx.follow(car)), and a phone\n" +
      '  gets Left/Right bottom-left and Brake/Gas bottom-right, wired to the\n' +
      '  same actions as the arrow keys. A player in a car it got into (ctx.vehicles) gets them too, with Use on\n' +
      '  them to get out; a game that reads Attack/Jump/Run itself keeps the joystick and those buttons instead.\n' +
      '  Never write your own steering pad or chase camera — a hand-written one is how LEFT ends up turning RIGHT.\n' +
      "- CAR CONTROLS FOLLOW THE USER'S WORDS → touchControls: { drive }. Default 'pads' (Left/Right + Brake/Gas).\n" +
      "  \"tilt\" / \"gyro\" / \"phone jhuka ke chalao\" → drive: 'tilt'; \"easy\" / \"simple\" / \"sirf steering\" / \"auto gas\"\n" +
      "  → drive: 'auto' (it drives forward by itself, the player steers and brakes); \"joystick se\" → drive: 'joystick'\n" +
      "  (ONLY when the user asks for a joystick); \"buttons se\" → 'pads'. A computer always drives with W/A/S/D and the\n" +
      '  arrows. Never hand-roll tilt or auto-gas.\n' +
      '- No WebGL on the device gives an honest message, never a blank screen.',
  };
}
