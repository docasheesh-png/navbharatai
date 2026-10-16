// AgentV3 — A HAND-WRITTEN CAR IS READ BY ITS SHAPE, WHILE THE FILE IS STILL OPEN (admin 2026-10-11, build
// 46e2d74b).
//
// Admin, verbatim: *"ek bahut dangerous issue … racing game me car ulti chal rahi hai"* — the player's car
// showed its HEADLIGHTS (the user must see the tail lights), and pressing LEFT turned it RIGHT, "and every
// game built now does this".
//
// 🔴 WHAT HAPPENED. Those two symptoms are ONE geometric fact: the camera sat on the side the car's nose
// points to. Seen face-on, the driver's left is the screen's right, so steering that is correct reads as
// mirrored. Measured twice in the investigation: a car modelled facing +Z (the convention every builder is
// told, MODEL_FORWARD) under the usual three.js chase camera at `car + (0, 3, 6)` shows its headlights
// (4.61 m against 8.30 m) and LEFT moves it screen-RIGHT; the same code with the car facing −Z shows the tail
// lights and steers correctly. The kit gets this right only through explicit calls (`driveVehicle`,
// `CameraRig.follow`, `ctx.follow`) — and build 46e2d74b never called the kit at all: it hand-wrote its game
// in src/lib/game/*, where no kit guard reaches. The same build's reviewer also found "`updateGameState`
// never accelerates the car" — the third return of the 2026-08-25 "speed nahi badhti" class, whose only
// deterministic guard (`createVehicleState` starts at speed 5) lives in the kit too.
//
// 🔑 THE CLASS: a spatial and a gameplay convention enforced only by OPT-IN library calls. The kit-side fix
// (making the right camera the default) belongs to the kit; THIS module is the residual net for the lane the
// kit never sees — a hand-written vehicle — keyed on CODE SHAPE, not on paths (46e2d74b's src/lib/game would
// beat any path rule) and not on words. Three shapes, each one a defect on its own:
//   • camera-ahead     — a camera placed at the car's position plus a Z offset of the SAME sign the car
//                        drives along Z (`camera.position.z = car.position.z + 6` with `car.position.z +=
//                        speed`): the camera is in front of the car, looking at its face;
//   • stalled          — a speed that starts at 0, moves the vehicle, is next to an accelerator, and is never
//                        raised anywhere the build has written;
//   • axis-throttle    — the kit's `input.axis()` y (−1 is UP) used as throttle without its minus sign, so
//                        the accelerator reverses.
//
// 🔒 PRECISION FIRST, because a false note costs a build a turn: every shape needs BOTH of its halves (the
// camera and the motion of the SAME object; the zero and the motion and the accelerator), the files under the
// kit's own library path are never read (`RECIPE_LIBRARY_PATH`), and a half the scan cannot read with
// certainty — a computed offset, a rotated vector, a camera that follows something else — is not a finding.
// Those are not left unread: the playtest PLAYS the game and reads the same two facts from its pixels — the road
// moving up the screen as it drives (a camera facing the car) and the view panning left on LEFT (mirrored
// steering) — whatever code produced them (gamePlaytest.ts `firmFlow`, Q-861), and for a three.js game from its scene
// itself (`sceneVerdict`, Q-869). The halves are indexed per file as the build writes them (`vehicleShapeHalves`), so a camera in scene.ts and
// the motion in physics.ts still meet. The note is said once per build, with the file still open. PURE.

import { RECIPE_LIBRARY_PATH } from './typeMembers';

const CODE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i;
const VEHICLE_WORD = /\b(?:car|cars|kart|vehicle|truck|bike|motorcycle|motorbike|racer|racecar|bus|tractor|rickshaw|scooter)\b/i;
const ACCELERATOR = /['"](?:ArrowUp|KeyW|w|W)['"]|\baccelerat\w*|\bthrottle\b|\bgas\b/;

/** An object expression as the scan compares it: `this.car.mesh` and `car.mesh` are the same thing. */
function normObj(expr: string): string {
  return expr.replace(/\s+/g, '').replace(/^this\./, '').replace(/\?\./g, '.');
}

/** The sign a term contributes after a `+` or `-`: a leading minus inside the term flips it. */
function termSign(op: string, term: string): 1 | -1 {
  const base = op === '-' ? -1 : 1;
  return (/^\s*-/.test(term) ? -base : base) as 1 | -1;
}

export interface CameraHalf { obj: string; sign: 1 | -1; line: string }
/** `byHeading`: the move follows the car's heading (Math.cos / Math.sin), so its world sign assumes heading 0. */
export interface MotionHalf { obj: string; sign: 1 | -1; line: string; byHeading: boolean }
export interface VehicleShapeHalves {
  cameras: CameraHalf[];
  motions: MotionHalf[];
  /** Names of speeds this file STARTS at zero, with the line. */
  zeroSpeeds: Array<{ name: string; line: string }>;
  /** Speeds this file moves a vehicle by. */
  movingSpeeds: string[];
  /** Speeds this file ever raises (any non-zero assignment counts — precision first). */
  raisedSpeeds: string[];
  accelerator: boolean;
  vehicle: boolean;
  /** `throttle = axis.y` from the kit's `input.axis()` without the minus. */
  axisThrottle: string | null;
  /** The file turns something half a circle (`rotation.y = Math.PI`) — a heading that does not start at 0. */
  flipsHeading: boolean;
  /**
   * FORWARD DIRECTION (2026-10-16): a camera placed at a LITERAL z (`camera.position.set(0, 3, 8)`,
   * `camera.position.z = 8`) — a fixed runner camera, which looks back toward z = 0.
   */
  fixedCameras?: Array<{ sign: 1 | -1; line: string }>;
  /** 2D scroll moves by a speed: `obstacle.x += speed`, `road.y -= speed`. */
  scrolls2d?: Array<{ obj: string; axis: 'x' | 'y'; sign: 1 | -1; line: string }>;
  /** The file reads as a side runner (jump / runner / endless) or a top-down racer (road / lane + a car). */
  sideRunner?: boolean;
  topDownRacer?: boolean;
}

const OBJ = '([A-Za-z_$][\\w$]*(?:\\??\\.[A-Za-z_$][\\w$]*)*)';
// `camera.position.z = car.position.z + 6`
const CAM_Z_ASSIGN = new RegExp(`\\b(\\w*cam\\w*)(?:\\.\\w+)*\\.position\\.z\\s*=\\s*${OBJ}\\.position\\.z\\s*([+-])\\s*([^;\\n,)]+)`, 'gi');
// `camera.position.set(car.position.x, car.position.y + 3, car.position.z + 6)` / `new THREE.Vector3(…)` on a camera line
const CAM_Z_ARG = new RegExp(`${OBJ}\\.position\\.z\\s*([+-])\\s*([^;\\n,)]+)\\)`, 'g');
// `camera.position.copy(car.position).add(new THREE.Vector3(0, 3, 6))`
const CAM_COPY_ADD = new RegExp(`\\b(\\w*cam\\w*)(?:\\.\\w+)*\\.position\\.copy\\(\\s*${OBJ}\\.position\\s*\\)\\s*\\.add\\(\\s*new\\s+(?:THREE\\.)?Vector3\\(\\s*[^,]+,\\s*[^,]+,\\s*(-?\\s*\\d+(?:\\.\\d+)?)\\s*\\)`, 'gi');
// `car.position.z += speed * dt`, `car.position.z -= Math.cos(h) * speed`
const MOVE_Z_COMPOUND = new RegExp(`${OBJ}\\.position\\.z\\s*([+-])=\\s*([^;\\n]+)`, 'g');
// `car.position.z = car.position.z + speed`
const MOVE_Z_ASSIGN = new RegExp(`${OBJ}\\.position\\.z\\s*=\\s*${OBJ}\\.position\\.z\\s*([+-])\\s*([^;\\n]+)`, 'g');
// `car.translateZ(speed)`
const MOVE_TRANSLATE = new RegExp(`${OBJ}\\.translateZ\\(\\s*(-?)\\s*([^)]+)\\)`, 'g');
const SPEED_NAME = /\b(\w*(?:speed|Speed)|velocity|vel)\b/;

/** The halves one file contributes. PURE. */
export function vehicleShapeHalves(path: string, content: string): VehicleShapeHalves {
  const empty: VehicleShapeHalves = { cameras: [], motions: [], zeroSpeeds: [], movingSpeeds: [], raisedSpeeds: [], accelerator: false, vehicle: false, axisThrottle: null, flipsHeading: false };
  const p = String(path ?? '').replace(/^\.?\/+/, '');
  const src = typeof content === 'string' ? content : '';
  if (!src || !CODE_FILE.test(p) || /(^|\/)node_modules\//.test(p) || RECIPE_LIBRARY_PATH.test(p)) return empty;
  const out = { ...empty, cameras: [] as CameraHalf[], motions: [] as MotionHalf[], zeroSpeeds: [] as Array<{ name: string; line: string }>, movingSpeeds: [] as string[], raisedSpeeds: [] as string[] };
  out.vehicle = VEHICLE_WORD.test(src);
  out.accelerator = ACCELERATOR.test(src);
  out.flipsHeading = /rotation\.y\s*=\s*-?\s*Math\.PI\b(?!\s*[/*])|rotateY\(\s*-?\s*Math\.PI\s*\)/.test(src);
  const lineAt = (i: number) => src.slice(src.lastIndexOf('\n', i) + 1, src.indexOf('\n', i) < 0 ? undefined : src.indexOf('\n', i)).trim().slice(0, 160);

  for (const m of src.matchAll(CAM_Z_ASSIGN)) {
    out.cameras.push({ obj: normObj(m[2]), sign: termSign(m[3], m[4]), line: lineAt(m.index ?? 0) });
  }
  for (const m of src.matchAll(CAM_COPY_ADD)) {
    const z = Number(String(m[3]).replace(/\s+/g, ''));
    if (z !== 0 && Number.isFinite(z)) out.cameras.push({ obj: normObj(m[2]), sign: z > 0 ? 1 : -1, line: lineAt(m.index ?? 0) });
  }
  // The CAMERA's own position set / lerped / copied to a point whose third coordinate is "object z ± d". Only
  // the call itself is read (up to its statement's end), so a `lookAt` target or a `cameraTarget` vector on
  // the same line — a point AHEAD of the car, which is right — is never mistaken for where the camera sits.
  for (const m of src.matchAll(/\b(\w*cam\w*)(?:\.\w+)*\.position\.(?:set|lerp|copy)\(/gi)) {
    if (/target|look|focus|aim/i.test(m[1])) continue;
    const from = m.index ?? 0;
    const end = src.slice(from).search(/;|\n\s*\n/);
    const call = src.slice(from, end < 0 ? undefined : from + end);
    for (const a of call.matchAll(CAM_Z_ARG)) out.cameras.push({ obj: normObj(a[1]), sign: termSign(a[2], a[3]), line: lineAt(from) });
  }

  const addMotion = (obj: string, sign: 1 | -1, rest: string, at: number) => {
    const s = SPEED_NAME.exec(rest);
    if (!s) return; // a move that is not by a speed is not a vehicle being driven
    out.motions.push({ obj: normObj(obj), sign, line: lineAt(at), byHeading: /Math\.(?:cos|sin)\(/.test(rest) });
    if (!out.movingSpeeds.includes(s[1])) out.movingSpeeds.push(s[1]);
  };
  for (const m of src.matchAll(MOVE_Z_COMPOUND)) {
    if (/cam/i.test(m[1])) continue;
    addMotion(m[1], termSign(m[2], m[3]), m[3], m.index ?? 0);
  }
  for (const m of src.matchAll(MOVE_Z_ASSIGN)) {
    if (/cam/i.test(m[1]) || normObj(m[1]) !== normObj(m[2])) continue;
    addMotion(m[1], termSign(m[3], m[4]), m[4], m.index ?? 0);
  }
  for (const m of src.matchAll(MOVE_TRANSLATE)) {
    if (/cam/i.test(m[1])) continue;
    addMotion(m[1], m[2] === '-' ? -1 : 1, m[3], m.index ?? 0);
  }
  // A move along X by a speed (a heading-driven car) still says "this speed moves the vehicle".
  for (const m of src.matchAll(/\.position\.x\s*[+-]=\s*([^;\n]+)/g)) {
    const s = SPEED_NAME.exec(m[1]);
    if (s && !out.movingSpeeds.includes(s[1])) out.movingSpeeds.push(s[1]);
  }

  // A speed that STARTS at zero: `speed: 0`, `let speed = 0`, `this.speed = 0`, `useState(0)` for a speed.
  for (const m of src.matchAll(/\b(\w*(?:speed|Speed)|velocity)\s*[:=]\s*0(?:\.0+)?\s*[,;}\n)]/g)) {
    out.zeroSpeeds.push({ name: m[1], line: lineAt(m.index ?? 0) });
  }
  for (const m of src.matchAll(/\[\s*(\w*(?:speed|Speed))\s*,\s*set\w*\s*\]\s*=\s*useState(?:<[^>]*>)?\(\s*0(?:\.0+)?\s*\)/g)) {
    out.zeroSpeeds.push({ name: m[1], line: lineAt(m.index ?? 0) });
  }
  // Anything that could raise it — any assignment that is not a plain zero, any setter, any ++.
  // (The lookaheads sit BEFORE the optional spaces, so the spaces cannot backtrack around them; a type
  // annotation — `speed: number` — is not a value.)
  for (const m of src.matchAll(/\b(\w*(?:speed|Speed)|velocity)\s*(?:\+=|\*=|-=|\+\+|=(?![=>])(?!\s*0(?:\.0+)?\s*[,;}\n)])|:(?!\s*(?:0(?:\.0+)?\s*[,}\n]|(?:number|string|boolean|any|unknown)\b))\s*[^\s,}])/g)) {
    if (!out.raisedSpeeds.includes(m[1])) out.raisedSpeeds.push(m[1]);
  }
  for (const m of src.matchAll(/\bset(\w*Speed)\s*\(/g)) {
    const name = m[1][0].toLowerCase() + m[1].slice(1);
    if (!out.raisedSpeeds.includes(name)) out.raisedSpeeds.push(name);
  }

  // `const a = input.axis(); throttle = a.y` — the kit's axis has UP as −1.
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*[\w.]+\.axis\(\)/g)) {
    const v = m[1];
    const t = new RegExp(`\\b(?:throttle|accel\\w*|gas)\\s*=\\s*${v}\\.y\\b|\\b\\w*[sS]peed\\s*\\+=\\s*${v}\\.y\\b`).exec(src);
    if (t) { out.axisThrottle = lineAt(t.index); break; }
  }
  // FORWARD DIRECTION: a fixed camera at a literal z.
  out.fixedCameras = [];
  for (const m of src.matchAll(/\b(\w*cam\w*)(?:\.\w+)*\.position\.set\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*(-?\s*\d+(?:\.\d+)?)\s*\)/gi)) {
    if (/target|look|focus|aim/i.test(m[1])) continue;
    const z = Number(m[2].replace(/\s+/g, ''));
    if (z !== 0 && Number.isFinite(z)) out.fixedCameras.push({ sign: z > 0 ? 1 : -1, line: lineAt(m.index ?? 0) });
  }
  for (const m of src.matchAll(/\b(\w*cam\w*)(?:\.\w+)*\.position\.z\s*=\s*(-?\s*\d+(?:\.\d+)?)\s*[;\n]/gi)) {
    const z = Number(m[2].replace(/\s+/g, ''));
    if (z !== 0 && Number.isFinite(z)) out.fixedCameras.push({ sign: z > 0 ? 1 : -1, line: lineAt(m.index ?? 0) });
  }
  // 2D scroll by a speed (canvas runners and top-down racers write plain x / y, not position.x).
  out.scrolls2d = [];
  for (const m of src.matchAll(new RegExp(`${OBJ}\\.(x|y)\\s*([+-])=\\s*([^;\\n]+)`, 'g'))) {
    if (/position$|cam/i.test(m[1]) || !SPEED_NAME.test(m[4])) continue;
    out.scrolls2d.push({ obj: normObj(m[1]), axis: m[2] as 'x' | 'y', sign: termSign(m[3], m[4]), line: lineAt(m.index ?? 0) });
  }
  out.sideRunner = /\b(?:runner|endless|jump(?:ing)?|dino|platform(?:er)?)\b/i.test(src) && !/\b(?:road|lane|traffic)\b/i.test(src);
  out.topDownRacer = /\b(?:road|lane|traffic|highway)\b/i.test(src) && VEHICLE_WORD.test(src);
  return out;
}

/** Names that are the PLAYER, and names that are the WORLD scrolling past it. */
const PLAYER_OBJ = /(?:^|\.)(?:player|runner|hero|avatar|character|car|bike|kart|vehicle|ship|plane)\w*$/i;
const WORLD_OBJ = /(?:^|\.)(?:obstacles?|obs|o|e|enem(?:y|ies)\w*|coins?|items?|trees?|rocks?|barriers?|blocks?|tiles?|segments?|ground\w*|road\w*|lanes?|world|track\w*|traffic|props?|pickups?|cones?)$/i;

export type VehicleShapeKind = 'camera-ahead' | 'stalled' | 'axis-throttle' | 'world-backwards' | 'runner-toward-camera' | 'scroll-backwards';
export interface VehicleShapeFinding { kind: VehicleShapeKind; path: string; line: string }

/**
 * The defects the build's written files show together. `index` maps each written path to its halves (the
 * dispatcher keeps it, replacing a path's entry on every write of it). PURE.
 */
export function vehicleShapeFindings(index: ReadonlyMap<string, VehicleShapeHalves>): VehicleShapeFinding[] {
  const all = [...index.entries()];
  const out: VehicleShapeFinding[] = [];
  const motions = all.flatMap(([path, h]) => h.motions.map((m) => ({ ...m, path })));
  // A heading-driven move's sign is read at heading 0; a game that turns its car half a circle first
  // (`rotation.y = Math.PI`) drives the other way, and the scan cannot know which — so it says nothing.
  const headingFlipped = all.some(([, h]) => h.flipsHeading);
  for (const [path, h] of all) {
    for (const cam of h.cameras) {
      const drives = motions.filter((m) => m.obj === cam.obj);
      // EVERY move of that object toward the camera's side — a reverse gear on another line keeps it silent.
      if (drives.length > 0 && drives.every((m) => m.sign === cam.sign && !(m.byHeading && headingFlipped))) {
        out.push({ kind: 'camera-ahead', path, line: cam.line });
        break;
      }
    }
    if (out.some((f) => f.kind === 'camera-ahead')) break;
  }
  const vehicle = all.some(([, h]) => h.vehicle);
  const accelerator = all.some(([, h]) => h.accelerator);
  const moving = new Set(all.flatMap(([, h]) => h.movingSpeeds));
  const raised = new Set(all.flatMap(([, h]) => h.raisedSpeeds));
  if (vehicle && accelerator) {
    for (const [path, h] of all) {
      const z = h.zeroSpeeds.find((s) => moving.has(s.name) && !raised.has(s.name));
      if (z) { out.push({ kind: 'stalled', path, line: z.line }); break; }
    }
  }
  for (const [path, h] of all) {
    if (h.axisThrottle) { out.push({ kind: 'axis-throttle', path, line: h.axisThrottle }); break; }
  }
  // FORWARD DIRECTION (2026-10-16). Only with ONE fixed-camera side in the build (two disagreeing literal
  // cameras — a menu camera and a game camera — are not readable with certainty).
  const fixedSigns = new Set(all.flatMap(([, h]) => (h.fixedCameras ?? []).map((c) => c.sign)));
  if (fixedSigns.size === 1) {
    const camSign = [...fixedSigns][0];
    const followed = new Set(all.flatMap(([, h]) => h.cameras.map((c) => c.obj)));
    // The world moving AWAY from a fixed camera: the player seems to run backwards.
    const away = motions.find((m) => WORLD_OBJ.test(m.obj) && m.sign === -camSign && !m.byHeading);
    if (away) out.push({ kind: 'world-backwards', path: away.path, line: away.line });
    // The player moving TOWARD a fixed camera that does not follow it: it runs out of the screen.
    const toward = motions.find((m) => PLAYER_OBJ.test(m.obj) && m.sign === camSign && !followed.has(m.obj)
      && !(m.byHeading && headingFlipped));
    if (toward) out.push({ kind: 'runner-toward-camera', path: toward.path, line: toward.line });
  }
  // 2D: a side runner's world scrolls LEFT (x decreases); a top-down racer's road scrolls DOWN (y increases).
  for (const [path, h] of all) {
    const bad = (h.scrolls2d ?? []).find((sc) => WORLD_OBJ.test(sc.obj) && (
      (h.sideRunner && sc.axis === 'x' && sc.sign === 1)
      || (h.topDownRacer && sc.axis === 'y' && sc.sign === -1)));
    if (bad) { out.push({ kind: 'scroll-backwards', path, line: bad.line }); break; }
  }
  return out;
}

const WHAT: Readonly<Record<VehicleShapeKind, string>> = {
  'camera-ahead': 'the camera sits on the side the car DRIVES TOWARD (its Z offset has the same sign as the car\'s motion along Z), so the player sees the car\'s HEADLIGHTS, and LEFT reads as RIGHT on screen. The camera belongs BEHIND the car: camera = car.position − forward × distance + up × height, where forward is the way the car moves',
  stalled: 'the speed starts at 0 and nothing the build has written ever raises it, so holding the accelerator never moves the car. A vehicle starts moving (speed above zero) and the accelerator raises its speed every frame it is held',
  'world-backwards': 'the camera is fixed at one side of the track and this moves the WORLD (obstacles, road, coins) AWAY from it, so the player appears to run BACKWARDS. Forward is INTO the screen: obstacles spawn far ahead (three.js: negative z, e.g. −80) and move TOWARD the camera (o.position.z += speed * dt), recycled once they pass it',
  'runner-toward-camera': 'the camera is fixed and this moves the PLAYER TOWARD it, so the runner comes OUT of the screen at the user and shows its face. Forward is INTO the screen (three.js: −Z, player.position.z -= speed * dt, model rotation.y = Math.PI), with the camera behind and above following at player.z + distance — or keep the player still and scroll the world toward the camera',
  'scroll-backwards': 'this scrolls the world the wrong way. A side runner runs RIGHT, so the ground and obstacles move LEFT (x -= speed); a top-down racer drives UP, so the road and traffic move DOWN (y += speed)',
  'axis-throttle': 'the kit\'s input.axis() reports UP as y = −1, and this uses axis.y as the throttle without its minus sign, so the accelerator REVERSES the car. Throttle is −axis.y',
};

/**
 * The note the builder reads with the file still open — once per build (the dispatcher holds the flag).
 * Points at the kit that does all of this correctly by construction. PURE.
 */
export function handWrittenVehicleNote(findings: readonly VehicleShapeFinding[]): string {
  if (!findings || findings.length === 0) return '';
  const lines = findings.slice(0, 3).map((f) => `- ${f.path}: \`${f.line}\` — ${WHAT[f.kind]}.`);
  return '\n\n🏎️ HAND-WRITTEN VEHICLE / RUNNER — this will look or move backwards (admin 2026-10-11, build 46e2d74b: '
    + '"car ulti chal rahi hai"; 2026-10-16: the runner comes out of the screen):\n'
    + `${lines.join('\n')}\n`
    + 'The game kit does all of this correctly: run_recipe({ name: "generate_game_3d" }) gives driveVehicle(car, drive, '
    + 'input.axis(), dt) — it starts moving, the accelerator raises its speed, LEFT turns left — and rig.follow(car, dt) '
    + '(ctx.follow(car) in the game shell), which keeps the camera BEHIND the car. Use them, or fix the lines above now, '
    + 'while the file is open.';
}
