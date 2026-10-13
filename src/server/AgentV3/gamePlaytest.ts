// A GAME IS PLAYED BEFORE IT IS CALLED DONE — the playtest and the Game Quality Score.
//
// Admin 2026-10-05: "navbharatai jab game banaye to user ko navbharatai ki latt lag jaye", with the brief's
// last section: the builder must not only GENERATE a game but PLAY it, TEST it, find what is weak and say
// so — "technically game chal raha hai, lekin game accha nahi hai" is a defect too.
//
// THE GAP. Every browser check this platform owns looks at a game the way it looks at a form: did it
// paint, did a button throw, does it fit a phone. None of them ever PLAYED one. So the commonest broken
// game passed all of them: a canvas that renders a beautiful scene and ignores every key, a game whose
// joystick moves nothing on a phone, a loop that throws on the first frame of movement. The app "works";
// nobody can play it.
//
// WHAT THIS DOES. One browser, no model call. It opens the running game, starts it (presses a visible
// Start/Play, then taps the game surface — that tap is also the user gesture audio and vibration need),
// and measures, from PIXELS, what a player meets in their first ten seconds:
//   • RUNS     — the game surface is on screen and is not a single flat colour;
//   • ALIVE    — the picture changes by itself (a world that moves);
//   • RESPONDS — the picture changes MORE when the controls are used (arrows/WASD, Space, a drag) than
//                when they are not. This is the question nothing asked before;
//   • MOBILE   — on a phone-sized touch screen, a joystick drag and a tap change the picture, or the game
//                shows on-screen controls;
//   • STABLE   — no uncaught error while it is played;
//   • SMOOTH   — the frame rate it reached. Measured in the build sandbox's SOFTWARE renderer, which is far
//                slower than a phone's GPU: only a game that crawls even there is flagged, and the message
//                says where it was measured;
//   • REPLAY   — read from the code: a best score / progress layer and a restart (meta.ts).
// The pixels are compared at 48×27 inside the page (the screenshot is decoded by the browser itself), so
// nothing here depends on an image library.
//
// THE SCORE. Each dimension is 0–100 from a measurement, never an opinion, and the overall score is their
// weighted mean. The weakest dimension is named with what to do about it, and becomes a one-tap fix offer
// (buildFindingSuggestions.ts). Nothing is changed behind the user's back.
//
// EVIDENCE, NEVER A GATE, and three outcomes, never two: a runner that could not reach the game, or a page
// with no game surface, is GAME_PLAYTEST_NOT_RUN — never a pass. Kill switch AGENTV3_GAME_PLAYTEST=off.
//
// PURE. The runner is a STRING built here and executed by the caller in the sandbox.

import { browserScriptRunLine, parseScriptDiagnostic, playwrightImport } from './sandboxBrowserScript';
import { newPageOptionsExpr } from './signInExplore';
import { CONSOLE_NOISE, NEVER_PRESS } from './clickExplorer';
import { GAME_SIGNAL } from './touchPlayableGame';

export const PLAYTEST_RESULT_MARKER = 'NBAI_PLAYTEST:';
export const PLAYTEST_BUDGET_MS = 60_000;
const LOAD_MS = 15_000;
const TOOLS_DIR = '/home/user/.e-tools';

export function gamePlaytestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_PLAYTEST ?? '').trim().toLowerCase() !== 'off';
}

const CODE_FILE = /\.(tsx?|jsx?|mjs|html?|vue|svelte)$/i;

/**
 * Is this project a game drawn on a canvas? Only those are played. PURE.
 *
 * 🔴 THE TWO HALVES ARE ASKED SEPARATELY (verification of build 46e2d74b's fixes, 2026-10-11). This used to read
 * `GAME_SIGNAL && /requestAnimationFrame|…/` on one file — and `GAME_SIGNAL` itself contains
 * `requestAnimationFrame`, so the "and" was empty: ONE animation frame anywhere made any app a canvas game.
 * While the answer only decided whether to run a playtest, that cost a wasted run. The same day made two more
 * readers depend on it — a playtest that could not look became a WARNING ("The game was never played"), and
 * `journeyDerivation` began reading a game's checkboxes and selects as SETTINGS — and, measured, a habit
 * tracker whose only data is its checkboxes, with an animated progress bar, was told "this is a game" and its
 * save-and-reload proof was skipped. So a game needs a SURFACE it is drawn on (a 2D/WebGL context, three.js,
 * Phaser, a <canvas>: `GAME_SIGNAL` with the frame left out) AND a LOOP that redraws it. The two may sit in
 * different files, as a hand-written game's scene.ts and loop.ts do (46e2d74b's own layout).
 */
export function isCanvasGameProject(files: Record<string, string>): boolean {
  let surface = false;
  let loop = false;
  for (const [path, content] of Object.entries(files || {})) {
    if (/(^|\/)node_modules\//.test(path) || !CODE_FILE.test(path) || typeof content !== 'string') continue;
    // 🔴 THE KIT'S OWN ENGINE FILES ARE NOT A SURFACE (build 46e2d74b's fixes, 2026-10-11). Since the platform
    // lays the game kit down for every new game (gameKitSeed.ts), `src/game/` is on disk for a sudoku drawn
    // in the DOM too — and this used to answer "canvas game" for any file under it, so a DOM game was sent
    // to the canvas playtest and, finding no canvas, reported as a game that was "never played". The loop,
    // input, sound and music layers (`src/game/core`, `src/game/fx`, `src/audio`) never draw anything; the
    // surface has to come from the game's own code or from the kit's 3D layer / shell, which do.
    // The kit's 3D layer and shell DO draw (a WebGL canvas), so a project carrying them is a canvas game.
    if (/(^|\/)src\/game\/(?:three\/|ui\/|Game\.ts$|GameCanvas\.tsx$)/.test(path)) return true;
    const kitEngineOnly = /(^|\/)src\/(?:game\/(?:core|fx)|audio)\//.test(path);
    if (!surface && !kitEngineOnly && GAME_SIGNAL.test(content.replace(/requestAnimationFrame/g, ''))) surface = true;
    if (!loop && /requestAnimationFrame|GameLoop|setAnimationLoop/.test(content)) loop = true;
    if (surface && loop) return true;
  }
  return false;
}

/**
 * REPLAY, read from the code: a progress/best-score layer, and a way to play again — and, since build
 * 46e2d74b, whether it is a DRIVING game (`isDrivingGame`), which the score's accelerator probe needs. The
 * one object the route already hands the verdict, so the new fact reaches it without a second read. PURE.
 */
export function replayFromCode(files: Record<string, string>): GameCodeFacts {
  let progress = false;
  let restart = false;
  for (const [path, content] of Object.entries(files || {})) {
    if (/(^|\/)node_modules\//.test(path) || !CODE_FILE.test(path) || typeof content !== 'string') continue;
    // The meta layer's own file only DEFINES these; using them is what counts.
    if (/(^|\/)src\/game\/core\/meta\.ts$/.test(path)) continue;
    if (/\bstartMeta\s*\(/.test(content) || /localStorage\.setItem\([^)]*(best|high|score|level|progress)/i.test(content)) progress = true;
    if (/\b(play again|restart|try again|retry|replay)\b/i.test(content) || /\.restart\s*\(/.test(content)) restart = true;
  }
  return isDrivingGame(files) ? { progress, restart, driving: true } : { progress, restart };
}

/**
 * 🏁 THE BUTTON THAT STARTS THE GAME IS FOUND BY ITS SHAPE (admin 2026-10-11, build 46e2d74b).
 *
 * 🔴 WHAT HAPPENED. The racing game opened on a title screen whose only control was "Start Race"; the
 * canvas existed only after it was pressed. The playtest pressed a control only when its WHOLE label
 * matched an anchored, closed list — start, play, play now, begin, start game, let's go, go … — and
 * "Start Race" is not on it. Nothing was pressed, no canvas appeared, and the run stopped with "no game
 * surface (canvas) on the page". The game was never played, and the report recorded that as an
 * auto-resolved info line. Measured on the old list, all of these were skipped too: "Play Game",
 * "Race!", "Start Racing", "Begin Race", "Start Level 1", "▶ Play". The earlier racing build 0bb437b4
 * used the same "Start Race" label.
 *
 * 🔑 THE CLASS: a closed vocabulary standing in for "the control that starts the game" — the same class
 * as the review parser's exact tags (same build, `readLeadingTags`). So the label is matched by SHAPE:
 * a short visible control (≤ 40 characters, ≤ 6 words) with a start STEM as a whole word anywhere in it,
 * and nothing in it that says it does something else (help, settings, a shop, a share, a delete — the
 * explorer's own `NEVER_PRESS` list plus the menu words below). A label that STARTS with the stem ranks
 * above one that merely contains it, and a label the caller already saw start this game (`startLabels`,
 * e.g. the click explorer's record) ranks above both. At most three distinct candidates are pressed, one
 * at a time and never one twice, until a game surface appears — bounded, so a title screen with ten
 * buttons is never a tour.
 */
export const START_STEM = "(?:start|play|race|begin|go|drive|ride|fly|launch|resume|let'?s\\s+go|tap\\s+to\\s+(?:start|play)|press\\s+start|new\\s+game|khelo|shuru|शुरू|खेलें|खेलो|चलो)";
/** A start stem as a whole word, anywhere in the label (`u`: the Hindi words have no ASCII word boundary). */
export const START_LABEL = new RegExp(`(?:^|[^\\p{L}\\p{N}])${START_STEM}(?![\\p{L}\\p{N}])|[▶►⏵]`, 'iu');
/** The same stem at the very start of the label — ranked first. */
export const START_LABEL_LEADING = new RegExp(`^\\s*(?:[▶►⏵]\\s*)?${START_STEM}(?![\\p{L}\\p{N}])|^\\s*[▶►⏵]`, 'iu');
/** Controls on a title screen that do something other than start the game. */
export const NOT_A_START = /\b(?:how|help|rules|tutorial|instructions?|settings?|options|about|credits|store|shop|leader ?board|high ?scores?|scores?|controls|privacy|terms|sign|log ?in|back|menu|mute|unmute|sound|music|volume|quit|exit|google play|app store)\b/i;
/** At most this many start candidates are pressed, one at a time, before the game is called unreachable. */
export const MAX_START_PRESSES = 3;

/**
 * Would the playtest press this label to start the game? 0 = no; 1 = contains a start stem; 2 = starts
 * with one; 3 = the caller already saw this label start the game. The in-browser runner applies the same
 * three regexes (handed over as sources), so this is the one definition. PURE.
 */
export function startLabelRank(label: unknown, known: readonly string[] = []): number {
  const t = String(label ?? '').trim().replace(/\s+/g, ' ');
  if (!t || t.length > 40 || t.split(' ').length > 6) return 0;
  // A control that deletes, pays, shares or logs out is never pressed, whoever vouches for it.
  if (NEVER_PRESS.test(t)) return 0;
  if (known.some((k) => String(k ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === t.toLowerCase())) return 3;
  if (NOT_A_START.test(t)) return 0;
  if (START_LABEL_LEADING.test(t)) return 2;
  return START_LABEL.test(t) ? 1 : 0;
}

/**
 * The start labels the CLICK EXPLORER has already seen work, handed to the playtest (admin 2026-10-11, build
 * 46e2d74b — item L-18). The explorer pressed "Start Race" and the game came up; the playtest then opened its
 * own browser and had to find Start again by its own matcher. Only a first-screen press (no `via`) that
 * responded cleanly and changed the page, and whose label is start-SHAPED by the playtest's own rule, is
 * passed — so "Settings" or "Back" can never be vouched into a start press. PURE.
 */
export function startLabelsFromExplore(presses: ReadonlyArray<{ label?: unknown; verdict?: unknown; changed?: unknown; kind?: unknown; via?: unknown }> | null | undefined): string[] {
  const out: string[] = [];
  for (const p of presses ?? []) {
    if (!p || p.verdict !== 'ok' || p.changed !== true || p.via) continue;
    if (p.kind !== undefined && p.kind !== 'press') continue;
    const label = String(p.label ?? '').trim().replace(/\s+/g, ' ');
    if (!label || startLabelRank(label) === 0) continue;
    if (!out.some((l) => l.toLowerCase() === label.toLowerCase())) out.push(label);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * 🏎️ IS THIS A DRIVING GAME? Read from the code, so the playtest knows to ask whether holding the
 * accelerator actually moves the vehicle (see `stalledVehicle`). The kit's own vehicle API counts, and so
 * does hand-written code that names a vehicle, keeps a speed, and reads an accelerator key or a throttle.
 * All three together — a puzzle that mentions a car and a speed setting is not a driving game. PURE.
 */
const VEHICLE_WORD = /\b(?:car|cars|kart|go-?kart|vehicle|truck|bike|motorcycle|motorbike|racer|racecar|race ?car|bus|tractor|rickshaw|scooter)\b/i;
const SPEED_STATE = /\b(?:speed|velocity)\b/;
const ACCELERATOR = /['"](?:ArrowUp|KeyW|w)['"]|\baccelerat\w*|\bthrottle\b|\bgas\b/i;
export function isDrivingGame(files: Record<string, string>): boolean {
  for (const [path, content] of Object.entries(files || {})) {
    if (/(^|\/)node_modules\//.test(path) || !CODE_FILE.test(path) || typeof content !== 'string') continue;
    if (/\bdriveVehicle\s*\(|\bcreateVehicleState\s*\(/.test(content)) return true;
    if (VEHICLE_WORD.test(content) && SPEED_STATE.test(content) && ACCELERATOR.test(content)) return true;
  }
  return false;
}

/** What the game's CODE says the score needs: the replay layer, and whether a vehicle is driven. */
export interface GameCodeFacts {
  progress: boolean;
  restart: boolean;
  /** Present (true) only for a driving game — see `isDrivingGame`. */
  driving?: boolean;
}

/** The in-sandbox shell command. PURE. */
export function gamePlaytestScript(previewUrl: string, opts: { storageState?: string | null; startLabels?: readonly string[] } = {}): string {
  const cfg = gamePlaytestConfig(previewUrl, opts.storageState ?? null, opts.startLabels ?? []);
  return `cat > /tmp/nbai-playtest.mjs <<'NBAI_EOF'
${gamePlaytestModule(cfg)}
NBAI_EOF
${browserScriptRunLine({ toolsDir: TOOLS_DIR, scriptPath: '/tmp/nbai-playtest.mjs', marker: PLAYTEST_RESULT_MARKER })}`;
}

export function gamePlaytestConfig(previewUrl: string, storageState: string | null = null, startLabels: readonly string[] = []): Record<string, unknown> {
  return {
    base: String(previewUrl ?? '').trim(),
    marker: PLAYTEST_RESULT_MARKER,
    loadMs: LOAD_MS,
    // The "same picture" floor, so the script can tell when the accelerator probe saw nothing move (Q-865).
    stillBelow: STILL_BELOW,
    // How many one-second looks the second accelerator hold may take (Q-869: a 9 s countdown is a working game).
    lateLooks: LATE_LOOKS,
    noise: CONSOLE_NOISE.source,
    noiseFlags: CONSOLE_NOISE.flags,
    // The start-control shape (see `startLabelRank`) — the same regexes, handed to the browser as sources.
    start: { any: START_LABEL.source, lead: START_LABEL_LEADING.source, flags: START_LABEL.flags,
      never: NEVER_PRESS.source, neverFlags: NEVER_PRESS.flags, notStart: NOT_A_START.source, notStartFlags: NOT_A_START.flags,
      known: startLabels.map((l) => String(l ?? '').trim()).filter((l) => l && l.length <= 40).slice(0, 5),
      max: MAX_START_PRESSES },
    // NOT reduced motion: a game is supposed to move, and a game that honours the preference would read
    // as frozen. The saved session still applies, so a game behind a login is played signed in.
    pageOpts: { ...JSON.parse(newPageOptionsExpr(storageState)), reducedMotion: 'no-preference' },
  };
}

/** The ES module the runner executes — split out so a test can run it as-is in a real browser. */
export function gamePlaytestModule(cfg: Record<string, unknown>, importLine: string = playwrightImport(TOOLS_DIR)): string {
  return `${importLine}
const cfg = ${JSON.stringify(cfg)};
const say = (o) => console.log(cfg.marker + JSON.stringify(o));
const noise = new RegExp(cfg.noise, cfg.noiseFlags);

// Frames are counted by DISTINCT timestamps, so a game with three requestAnimationFrame loops is not
// counted three times; a gap over 100ms is a long frame (a visible hitch).
const frameCounter = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__nb = { frames: 0, long: 0, last: 0 };
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = window.__nb;
    if (t !== s.last) { if (s.last && t - s.last > 100) s.long++; s.frames++; s.last = t; }
    return cb(t);
  });
};

// READ THE SCENE ITSELF, NOT ONLY ITS PIXELS (Q-869). three.js announces every WebGLRenderer to
// window.__THREE_DEVTOOLS__ at the end of its constructor; wrapping that renderer's render() hands us the scene and the
// camera it draws with. Positions are STATE — a loaded machine that draws few frames moves them less, never the wrong
// way — so where a three.js game is found, the camera and steering verdicts read them first and pixels second.
const sceneHook = () => {
  const hub = new EventTarget();
  const seen = { scene: null, camera: null };
  hub.addEventListener('observe', (e) => {
    const o = e && e.detail;
    if (!o || o.isScene || typeof o.render !== 'function') return;
    const render = o.render;
    o.render = function (scene, camera) {
      if (scene && scene.isScene && camera && camera.isCamera) { seen.scene = scene; seen.camera = camera; }
      return render.apply(this, arguments);
    };
  });
  try { Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: hub, configurable: true, writable: true }); } catch (e) { /* the page owns it */ }
  // Every object's horizontal world position, whether it holds a mesh, and whether it rides on the camera.
  window.__nbSnap = () => {
    const sc = seen.scene, cam = seen.camera;
    if (!sc || !cam || !cam.matrixWorld) return null;
    const objs = [];
    const walk = (o, depth, underCam) => {
      if (objs.length > 3000) return false;
      const isCam = o === cam;
      let mesh = !!(o.isMesh || o.isInstancedMesh || o.isSkinnedMesh);
      for (const k of (o.children || [])) { if (walk(k, depth + 1, underCam || isCam)) mesh = true; }
      if (o !== sc && !isCam && o.matrixWorld) { const m = o.matrixWorld.elements; objs.push([o.uuid, m[12], m[14], depth, mesh ? 1 : 0, (underCam || isCam) ? 1 : 0]); }
      return mesh;
    };
    walk(sc, 0, false);
    const c = cam.matrixWorld.elements;
    return { t: performance.now(), cam: [c[12], c[14]], camDir: [-c[8], -c[10]], objs };
  };
};

async function snapScene(page) {
  return page.evaluate(() => (window.__nbSnap ? window.__nbSnap() : null)).catch(() => null);
}

// Per object, how far it moved between two snapshots, and how fast.
function sceneMoves(a, b) {
  if (!a || !b) return null;
  const before = new Map(a.objs.map((o) => [o[0], o]));
  const dt = Math.max(1, b.t - a.t) / 1000;
  const out = new Map();
  for (const o of b.objs) {
    const p = before.get(o[0]);
    if (p) out.set(o[0], { dx: o[1] - p[1], dz: o[2] - p[2], speed: Math.hypot(o[1] - p[1], o[2] - p[2]) / dt, depth: o[3], mesh: o[4], cam: o[5], x: o[1], z: o[2] });
  }
  return out;
}

// The vehicle: the mesh-holding object the accelerator sped up the most over its idle speed (so a traffic car that
// moves anyway does not win), the outermost of the ones that moved together. null when nothing clearly did.
function pickVehicle(idle, gas) {
  if (!gas) return null;
  let best = 0;
  const score = new Map();
  for (const [id, m] of gas) {
    if (!m.mesh || m.cam) continue;
    const s = m.speed - ((idle && idle.get(id)) ? idle.get(id).speed : 0);
    score.set(id, s);
    if (s > best) best = s;
  }
  if (best < 0.5) return null;
  let pick = null;
  for (const [id, s] of score) {
    if (s < best * 0.9) continue;
    const m = gas.get(id);
    if (!pick || m.depth < gas.get(pick).depth) pick = id;
  }
  return pick;
}

async function surface(page) {
  return page.evaluate(() => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const b = c.getBoundingClientRect();
      const s = getComputedStyle(c);
      if (s.display === 'none' || s.visibility === 'hidden' || b.width < 120 || b.height < 80) continue;
      const area = Math.min(b.width, innerWidth) * Math.min(b.height, innerHeight);
      if (!best || area > best.area) best = { x: Math.max(0, b.left), y: Math.max(0, b.top), w: Math.min(b.width, innerWidth - Math.max(0, b.left)), h: Math.min(b.height, innerHeight - Math.max(0, b.top)), area };
    }
    return best;
  });
}

async function shot(page, box) {
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  return buf.toString('base64');
}

// Decode both screenshots IN THE BROWSER and compare them at 48×27. Returns the mean change (0–100), the second
// image's spread of brightness (a single flat colour has none) and its mean brightness (0–255) — recorded so a
// picture too dark to play can be measured, not argued about (Q-980, found beside Q-913).
async function compare(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const px = async (b64) => {
      const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = 48; c.height = 27;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, 48, 27);
      return g.getImageData(0, 0, 48, 27).data;
    };
    const [p, q] = await Promise.all([px(a), px(b)]);
    let diff = 0, sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < p.length; i += 4) {
      diff += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
      const l = 0.299 * q[i] + 0.587 * q[i + 1] + 0.114 * q[i + 2];
      sum += l; sum2 += l * l; n++;
    }
    const mean = sum / n;
    return { change: (diff / (n * 3 * 255)) * 100, spread: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), brightness: mean };
  }, [a, b]);
}

// WHICH WAY THE WORLD MOVES (Q-861) — read from CONSECUTIVE frames, inside the page, right after the game drew.
// Two screenshots are too far apart: a road's lane marks repeat, and a car that travels more than half a mark
// between them reads as moving BACKWARDS (aliasing). So the frames are taken in the page's own animation frames —
// our callback runs after the game's in the same frame, while even a WebGL canvas still holds what it just drew —
// and each consecutive pair is matched at 160×90 for the shift (sub-pixel) that best maps one onto the next. 'y'
// reads the lower part (the road under a forward camera), 'x' the horizon band (where a turn pans the world). A
// pair that is faster than the search (an edge of it) or barely changed says nothing; the total, and how many
// pairs agreed on the sign, go to the score, which judges only when they are firm. It stops at 14 DRAWN frames, not at
// a fixed time: a page a loaded machine draws slowly is given up to \`ms\` to draw them (Q-869).
async function sampleFlow(page, axis, ms) {
  return page.evaluate(async ([axis, ms]) => {
    let c = null, area = 0;
    for (const el of document.querySelectorAll('canvas')) {
      const b = el.getBoundingClientRect();
      if (b.width >= 120 && b.height >= 80 && b.width * b.height > area) { area = b.width * b.height; c = el; }
    }
    if (!c) return null;
    // The road's lane marks repeat, so its search stays narrow; the horizon's hills and buildings do not, and a turn on
    // a slow software renderer (≈20 fps) pans it several pixels a frame, so its search is wider.
    const W = 160, H = 90, R = axis === 'y' ? 4 : 8;
    const off = document.createElement('canvas'); off.width = W; off.height = H;
    const g = off.getContext('2d', { willReadFrequently: true });
    const frames = [];
    const end = performance.now() + ms;
    let last = -1;
    while (performance.now() < end && frames.length < 14) {
      await new Promise((r) => requestAnimationFrame(r));
      try { g.clearRect(0, 0, W, H); g.drawImage(c, 0, 0, W, H); } catch (e) { return null; }
      const d = g.getImageData(0, 0, W, H).data;
      const l = new Float32Array(W * H);
      let sig = 0;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) { l[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sig += l[j] * ((j % 13) + 1); }
      if (sig === last) continue; // the game did not draw a new frame
      last = sig;
      frames.push(l);
    }
    // Perspective makes the near road move faster than the far road, so 'y' is read in three strips and each votes
    // on its own; a turn pans the whole horizon band alike, so 'x' is one strip.
    const strips = axis === 'y'
      ? [[0.55, 0.68], [0.68, 0.81], [0.81, 1]].map(([a, b]) => [Math.floor(H * a), Math.min(H - R, Math.floor(H * b))])
      : [[Math.floor(H * 0.1), Math.floor(H * 0.6)]];
    const cost = (p, q, d, y0, y1) => {
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        const yy = axis === 'y' ? y + d : y;
        if (yy < 0 || yy >= H) continue;
        for (let x = R; x < W - R; x++) { sum += Math.abs(p[y * W + x] - q[yy * W + (axis === 'y' ? x : x + d)]); n++; }
      }
      return n ? sum / n : 0;
    };
    // One vote per frame PAIR (its readable strips summed), never per strip. A strip that hit the edge of the search
    // moved faster than this can read — and a repeating texture read past half its period ALIASES, which is exactly
    // how a correct road can read as backwards — so it is left out and counted (\`edge\`); the slower, farther strips
    // of the same pair still vote. When most strip reads are too fast, the score voids the whole read.
    let total = 0, pos = 0, neg = 0, pairs = 0, edge = 0, read = 0;
    for (let i = 1; i < frames.length; i++) {
      let sum = 0, voted = false, readable = false, up = false, down = false;
      for (const [y0, y1] of strips) {
        const cs = [];
        for (let d = -R; d <= R; d++) cs.push(cost(frames[i - 1], frames[i], d, y0, y1));
        const still = cs[R];
        if (still < 0.5) continue;
        let b = 0;
        for (let k = 1; k < cs.length; k++) if (cs[k] < cs[b]) b = k;
        if (b === 0 || b === cs.length - 1) { edge++; continue; }
        read++;
        readable = true;
        if ((still - cs[b]) / still < 0.1) continue;
        const den = cs[b - 1] - 2 * cs[b] + cs[b + 1];
        const shift = (b - R) + (den > 0 ? (cs[b - 1] - cs[b + 1]) / (2 * den) : 0);
        sum += shift;
        voted = true;
        if (shift > 0.25) down = true; else if (shift < -0.25) up = true;
      }
      if (!readable) continue;
      pairs++;
      // Real motion moves every strip the same way (perspective changes how far, never which way); strips of one pair
      // that disagree mean one of them aliased, so that pair abstains rather than vote.
      if (!voted || (up && down)) continue;
      total += sum;
      if (sum > 0.25) pos++; else if (sum < -0.25) neg++;
    }
    return { total: Math.round(total * 10) / 10, pos, neg, pairs, edge, read };
  }, [axis, ms]);
}

// The controls that look like they start the game, best first — the in-browser half of startLabelRank
// (gamePlaytest.ts): the same regexes, the same ranks. Each is marked data-nb-start="<n>" so it can be
// pressed by Playwright, which waits for it the way a finger would.
async function startCandidates(page) {
  return page.evaluate((st) => {
    const any = new RegExp(st.any, st.flags), lead = new RegExp(st.lead, st.flags);
    const never = new RegExp(st.never, st.neverFlags), notStart = new RegExp(st.notStart, st.notStartFlags);
    const known = new Set((st.known || []).map((k) => String(k).toLowerCase()));
    const found = [];
    let order = 0;
    for (const el of document.querySelectorAll('[data-nb-start]')) el.removeAttribute('data-nb-start');
    // A START CONTROL WITHOUT A CONTROL'S TAG (the click explorer's lesson, autopsy f496c75b, missed here until the
    // verification of build 46e2d74b's fix): a hand-written game's "Start Race" is as often a <div onClick> as a
    // <button>. An element counts when it carries an inline onclick or React holds a press handler in its props —
    // never the page's own roots, never inside or around a real control, and only the innermost of nested ones.
    const CONTROL = 'button, [role=button], a, input[type=button], input[type=submit]';
    const reactPress = (el) => {
      for (const k of Object.keys(el)) {
        if (k.indexOf('__reactProps$') !== 0) continue;
        const p = el[k];
        return !!(p && (p.onClick || p.onPointerDown || p.onPointerUp || p.onMouseDown || p.onMouseUp || p.onTouchStart || p.onTouchEnd));
      }
      return false;
    };
    const roots = new Set([document.documentElement, document.body, document.querySelector('#root, #app, #__next')]);
    const extra = [];
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    for (let n = 0; n < all.length && n < 4000; n++) {
      const el = all[n];
      if (roots.has(el) || el.closest(CONTROL) || el.querySelector(CONTROL)) continue;
      if (el.hasAttribute('onclick') || reactPress(el)) extra.push(el);
    }
    const nodes = Array.from(document.querySelectorAll(CONTROL)).concat(extra.filter((el) => !extra.some((o) => o !== el && el.contains(o))));
    for (const el of nodes) {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (b.width <= 0 || b.height <= 0 || s.visibility === 'hidden' || s.display === 'none' || el.disabled) continue;
      // A link that leaves the app ("Play on Android", a store page, a new tab) is never the start — the same
      // rule the click explorer applies before it presses a link.
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        if (el.target === '_blank' || /^(mailto|tel|sms|javascript):/i.test(href)) continue;
        try { if (href && new URL(href, location.href).origin !== location.origin) continue; } catch { continue; }
      }
      const t = String(el.getAttribute('aria-label') || el.innerText || el.value || '').trim().replace(/\\s+/g, ' ');
      if (!t || t.length > 40 || t.split(' ').length > 6) continue;
      const rank = never.test(t) ? 0 : known.has(t.toLowerCase()) ? 3 : notStart.test(t) ? 0 : lead.test(t) ? 2 : any.test(t) ? 1 : 0;
      if (rank > 0) found.push({ rank, order: order++, t, el });
    }
    found.sort((a, b) => b.rank - a.rank || a.order - b.order);
    return found.slice(0, st.max).map((c, n) => { c.el.setAttribute('data-nb-start', String(n)); return c.t; });
  }, cfg.start);
}

// A start button that pulses for ever never "stops moving", and Playwright will not click a moving
// element (autopsy 0bb437b4 — the explorer met the same "Start Race"). The same element is then clicked
// by dispatch, exactly as the click explorer does; any other refusal is left as a refusal.
async function pressMarked(page, n) {
  const sel = '[data-nb-start="' + n + '"]';
  try { await page.click(sel, { timeout: 3000 }); }
  catch (e) { if (/not stable/i.test(String(e && e.message || e))) await page.dispatchEvent(sel, 'click').catch(() => {}); }
  await page.waitForTimeout(500);
}

async function pressStart(page) {
  const labels = await startCandidates(page);
  if (!labels.length) return null;
  await pressMarked(page, 0);
  return labels[0];
}

// THE LADDER, used only when no game surface is on screen: give the first press a moment more, then press
// the best start candidate NOT yet pressed, one at a time, until a canvas appears — at most cfg.start.max
// distinct controls in all, counting the one already pressed. The candidates are read again before each
// press, so a title screen that leads to a second screen ("Select car" → "Race!") is followed, and a
// control is never pressed twice. Returns the label that revealed the surface, or null.
async function startUntilSurface(page, already) {
  const tried = new Set(already ? [already] : []);
  while (tried.size < cfg.start.max) {
    await page.waitForTimeout(400);
    if (await surface(page)) return null;
    const labels = await startCandidates(page);
    const n = labels.findIndex((t) => !tried.has(t));
    if (n < 0) return null;
    tried.add(labels[n]);
    await pressMarked(page, n);
    if (await surface(page)) return labels[n];
  }
  return null;
}

const errors = [];
function watch(page) {
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push(m.text().slice(0, 160)); });
}

async function hold(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k).catch(() => {});
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k).catch(() => {});
}

// A FRAME-DRIVEN SIMULATION IS SAMPLED IN FRAMES, NOT MILLISECONDS (Q-1038 — Q-869's class again).
//
// Q-869 removed this dependence from the PIXEL verdicts: a page a loaded machine stops drawing shows the
// same picture whatever the car does, so those looks record how many frames were drawn. The STEERING
// probe below kept measuring in wall-clock: it held a key for a fixed interval and read the turn from the
// vehicle's velocity before and after. The fixture turns 0.03 rad PER FRAME, so a page starved of frames
// moves it too little to clear the 0.2 speed floor, the turn is never computed, and the verdict is a
// silent null. No false claim — and a flake that gated two PRs, because a null is indistinguishable from
// "this game does not steer".
async function drawn(page) {
  return await page.evaluate(() => (window.__nb && window.__nb.frames) || 0).catch(() => 0);
}

/**
 * Wait for BOTH: at least minMs of wall clock AND n DRAWN frames — giving up at capMs.
 *
 * 🔴 THE FRAME COUNT IS A FLOOR ADDED TO THE TIME, NOT A REPLACEMENT FOR IT, and getting that wrong
 * broke a passing test. The first version waited for frames ALONE, which on a fast machine is SHORTER
 * than the interval it replaced: twelve frames is about 200 ms at 60 fps, against the 550 ms the
 * accelerator window used to run for. The picture then changed less between the two shots, out.gas fell
 * under the still threshold, the gas optical-flow sample was never taken at all, and Q-861's steering
 * test went from a firm reading to no reading. A fix that shortens the measurement it was protecting is
 * not a fix.
 *
 * So the slow machine gets its frames and the fast machine keeps its milliseconds. The cap bounds both,
 * because a page whose raf loop has died would otherwise hold the probe for the whole playtest budget.
 * Returns what really happened, so the caller can report the starvation instead of nothing at all.
 */
async function waitFrames(page, n, capMs, minMs) {
  const t0 = Date.now();
  const f0 = await drawn(page);
  let got = 0;
  for (;;) {
    const waited = Date.now() - t0;
    if (waited >= capMs) break;
    if (got >= n && waited >= minMs) break;
    await page.waitForTimeout(16);
    got = (await drawn(page)) - f0;
  }
  return { frames: got, ms: Date.now() - t0, starved: got < n };
}

const browser = await chromium.launch();
const out = { ok: true };
try {
  // ── DESKTOP: keyboard + mouse ─────────────────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ ...cfg.pageOpts, viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(frameCounter);
  await ctx.addInitScript(sceneHook);
  const page = await ctx.newPage();
  watch(page);
  await page.goto(cfg.base, { waitUntil: 'load', timeout: cfg.loadMs });
  await page.waitForTimeout(1500);
  out.started = await pressStart(page);
  let box = await surface(page);
  if (!box) {
    const revealed = await startUntilSurface(page, out.started);
    if (revealed) out.started = revealed;
    box = await surface(page);
  }
  if (!box) { say({ ok: false, error: out.started ? 'no game surface (canvas) appeared after pressing "' + out.started + '"' : 'no game surface (canvas) on the page, and no control that starts a game' }); throw null; }
  // The tap that starts many games, focuses the canvas for the keyboard, and counts as the user gesture.
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await page.waitForTimeout(400);
  if (!out.started) out.started = await pressStart(page);
  box = (await surface(page)) || box;

  const f0 = await page.evaluate(() => ({ ...window.__nb, t: performance.now() }));
  const sceneIdle0 = await snapScene(page);
  const a = await shot(page, box);
  await page.waitForTimeout(700);
  const b = await shot(page, box);
  const idleMoves = sceneMoves(sceneIdle0, await snapScene(page));
  const f1 = await page.evaluate(() => ({ ...window.__nb, t: performance.now() }));
  const idle = await compare(page, a, b);
  out.spread = Math.round(idle.spread * 10) / 10;
  out.brightness = Math.round(idle.brightness);
  out.idle = Math.round(idle.change * 100) / 100;
  out.fps = Math.round(((f1.frames - f0.frames) * 1000) / Math.max(1, f1.t - f0.t));
  out.longFrames = f1.long - f0.long;

  const moves = [];
  let prev = b;
  const step = async (label, act) => {
    await act();
    const next = await shot(page, box);
    moves.push({ label, change: Math.round((await compare(page, prev, next)).change * 100) / 100 });
    prev = next;
  };
  // THE ACCELERATOR PROBE (admin 2026-10-11, build 46e2d74b: the reviewer's "updateGameState never
  // accelerates the car"). Up/W is held for 0.9 s, and the picture is compared between 0.35 s and 0.9 s
  // INTO the hold: a vehicle that is moving keeps changing the picture; one whose speed never rises does
  // not. Read by the score only for a driving game (see stalledVehicle).
  await step('up / W', async () => {
    for (const k of ['ArrowUp', 'KeyW']) await page.keyboard.down(k).catch(() => {});
    await page.waitForTimeout(350);
    const sg0 = await snapScene(page);
    const g0 = await shot(page, box);
    // 🔴 THE INTERVAL EVERY SCENE VERDICT DEPENDS ON (Q-1038). This was waitForTimeout(550). Both
    // sceneVerdict fields sit behind its moved >= 0.2 guard, so a page starved here nulls the camera
    // AND the steering reading — which is why frame-gating the steering leg alone did not stop the flake.
    // It also makes the gas reading more trustworthy, never less: a stalled car's picture does not
    // change however long you look at it, while a moving one gets the frames it needs to prove it.
    const legGas = await waitFrames(page, ${PROBE_MIN_FRAMES}, ${PROBE_CAP_MS}, 550);
    const g1 = await shot(page, box);
    const sg1 = await snapScene(page);
    const gasMoves = sceneMoves(sg0, sg1);
    const car = pickVehicle(idleMoves, gasMoves);
    if (car && sg0 && sg1) {
      // Q-869: where the camera is, relative to where the vehicle is going — read from the scene, not from pixels.
      const m = gasMoves.get(car);
      const moved = Math.hypot(m.dx, m.dz);
      const camMoved = Math.hypot(sg1.cam[0] - sg0.cam[0], sg1.cam[1] - sg0.cam[1]);
      const rx = sg1.cam[0] - m.x, rz = sg1.cam[1] - m.z, rl = Math.hypot(rx, rz) || 1;
      const ahead = (rx * m.dx + rz * m.dz) / (rl * (moved || 1));
      const dl = Math.hypot(sg1.camDir[0], sg1.camDir[1]) || 1;
      const looks = (sg1.camDir[0] * -rx + sg1.camDir[1] * -rz) / (dl * rl);
      out.scene = {
        moved: Math.round(moved * 100) / 100, follows: camMoved >= moved * 0.5,
        ahead: Math.round(ahead * 100) / 100, looks: Math.round(looks * 100) / 100,
        // The frames this read actually got. Recorded here because this is the window the whole scene
        // read depends on; the steering probe narrows it to the weakest leg below.
        probeFrames: legGas.frames, probeMs: legGas.ms,
      };
    }
    out.gas = Math.round((await compare(page, g0, g1)).change * 100) / 100;
    // Q-861: which way the road moves while the vehicle drives — down the screen under a camera that looks the way
    // it drives, UP under one that sits in front of it looking back (the headlights view).
    if (out.gas >= cfg.stillBelow) out.gasFlow = await sampleFlow(page, 'y', 3000).catch(() => null);
    for (const k of ['ArrowUp', 'KeyW']) await page.keyboard.up(k).catch(() => {});
    // A SECOND, LONGER LOOK BEFORE "THE CAR NEVER MOVES" (Q-865, Q-869). Working games read as stalled on the first
    // hold: one still showing "Get ready…" (a countdown freezes the car on purpose — measured: a 9 s one), a slow car
    // under a fixed top-down camera, and a page a loaded machine had stopped drawing. So when the first hold saw nothing
    // move, wait past a short countdown and hold again, looking once a second for up to cfg.lateLooks seconds and
    // stopping the moment anything moves. It records how long it looked and how many frames the page DREW meanwhile:
    // a still picture is evidence of a stalled car only if the game was drawing (see stalledVehicle).
    if (out.gas < cfg.stillBelow) {
      await page.waitForTimeout(2500);
      for (const k of ['ArrowUp', 'KeyW']) await page.keyboard.down(k).catch(() => {});
      await page.waitForTimeout(200);
      const n0 = await page.evaluate(() => (window.__nb && window.__nb.frames) || 0).catch(() => 0);
      const t0 = Date.now();
      const h0 = await shot(page, box);
      let most = 0;
      for (let k = 0; k < cfg.lateLooks && most < cfg.stillBelow; k++) {
        await page.waitForTimeout(1000);
        most = Math.max(most, (await compare(page, h0, await shot(page, box))).change);
      }
      out.gasLate = Math.round(most * 100) / 100;
      out.gasLateMs = Date.now() - t0;
      out.gasLateFrames = (await page.evaluate(() => (window.__nb && window.__nb.frames) || 0).catch(() => 0)) - n0;
      for (const k of ['ArrowUp', 'KeyW']) await page.keyboard.up(k).catch(() => {});
    }
  });
  await step('left / A', () => hold(page, ['ArrowLeft', 'KeyA'], 500));
  await step('right / D', () => hold(page, ['ArrowRight', 'KeyD'], 500));
  await step('Space', () => hold(page, ['Space'], 120).then(() => page.waitForTimeout(400)));
  await step('mouse drag', async () => {
    await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.w * 0.75, box.y + box.h * 0.4, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  });
  out.moves = moves;
  // THE STEERING PROBE (Q-861). Accelerator and LEFT together — most cars only turn while they move — and which
  // way the horizon pans: a vehicle that turns to the driver's left pans the world to the RIGHT under any camera
  // that follows it. Only read when the vehicle was seen to move.
  if (out.gas >= cfg.stillBelow) {
    // The accelerator alone first (the direction the vehicle is going), then LEFT with it (the direction it turned to).
    for (const k of ['ArrowUp', 'KeyW']) await page.keyboard.down(k).catch(() => {});
    await page.waitForTimeout(300);
    const e0 = await snapScene(page);
    // THE FRAGILE LEG (Q-1038). This was waitForTimeout(400) — about 24 frames on an idle machine and
    // about two on a loaded one, and two frames of travel do not clear the 0.2 speed floor that
    // sceneVerdict needs before it will read a turn at all.
    const legStraight = await waitFrames(page, ${PROBE_MIN_FRAMES}, ${PROBE_CAP_MS}, 400);
    const e1 = await snapScene(page);
    for (const k of ['ArrowLeft', 'KeyA']) await page.keyboard.down(k).catch(() => {});
    await page.waitForTimeout(300);
    const s0 = await snapScene(page);
    // The turning leg's length is sampleFlow's own 3 s, which is generous in frames even when loaded —
    // but it is counted too, so the probe reports the frames it really saw rather than assuming them.
    const turnFrom = await drawn(page);
    out.steerFlow = await sampleFlow(page, 'x', 3000).catch(() => null);
    const legTurn = { frames: (await drawn(page)) - turnFrom };
    const s1 = await snapScene(page);
    for (const k of ['ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA']) await page.keyboard.up(k).catch(() => {});
    const before = sceneMoves(e0, e1), after = sceneMoves(s0, s1);
    const car = pickVehicle(idleMoves, before);
    if (out.scene) {
      // Recorded WHETHER OR NOT a turn is computed below — that is the whole point: a null turn beside
      // "3 frames in 2500 ms" is a starved page, and a null turn beside 180 frames is a game that does
      // not steer. Without this they read identically.
      //
      // The WEAKEST leg decides, because any one starved interval is enough to null a reading: the
      // accelerator window above set this, and the two steering legs can only lower it.
      out.scene.probeFrames = Math.min(out.scene.probeFrames ?? Infinity, legStraight.frames, legTurn.frames);
      out.scene.probeMs = Math.max(out.scene.probeMs ?? 0, legStraight.ms);
    }
    if (out.scene && car && after && after.get(car)) {
      const v0 = before.get(car), v1 = after.get(car);
      if (Math.hypot(v0.dx, v0.dz) >= 0.2 && Math.hypot(v1.dx, v1.dz) >= 0.2) {
        // + is toward the driver's left: facing +Z, the driver's left is +X (three.js is right-handed, Y up).
        const left = v1.dx * v0.dz - v1.dz * v0.dx, along = v1.dx * v0.dx + v1.dz * v0.dz;
        out.scene.turn = Math.round(Math.atan2(left, along) * 180 / Math.PI * 10) / 10;
      }
    }
  }
  await ctx.close();

  // ── PHONE: touch only ─────────────────────────────────────────────────────────────────────────────
  const m = await browser.newContext({ ...cfg.pageOpts, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  watch(mp);
  await mp.goto(cfg.base, { waitUntil: 'load', timeout: cfg.loadMs });
  await mp.waitForTimeout(1500);
  const phoneStarted = await pressStart(mp);
  let mbox = await surface(mp);
  if (!mbox) { await startUntilSurface(mp, phoneStarted); mbox = await surface(mp); }
  if (mbox) {
    await mp.touchscreen.tap(mbox.x + mbox.w / 2, mbox.y + mbox.h / 2).catch(() => {});
    await mp.waitForTimeout(400);
    await pressStart(mp);
    mbox = (await surface(mp)) || mbox;
    out.touchControls = await mp.evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll('button, [role=button], [class*=joystick], [class*=stick], [class*=dpad], [class*=nbg-tc]')) {
        const b = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (s.display !== 'none' && s.visibility !== 'hidden' && b.width >= 40 && b.height >= 40 && b.top > innerHeight * 0.45) n++;
      }
      return n;
    });
    const t0 = await shot(mp, mbox);
    await mp.waitForTimeout(600);
    const t1 = await shot(mp, mbox);
    const tIdle = (await compare(mp, t0, t1)).change;
    // A thumb on a joystick: press low on the left, push up, hold. Raw touch events, so multi-touch
    // games and pointer-event games both see it.
    const cdp = await m.newCDPSession(mp);
    const sx = mbox.x + mbox.w * 0.2, sy = mbox.y + mbox.h * 0.8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - i * 7 }] }); await mp.waitForTimeout(25); }
    await mp.waitForTimeout(600);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await mp.touchscreen.tap(mbox.x + mbox.w * 0.85, mbox.y + mbox.h * 0.8).catch(() => {});
    await mp.waitForTimeout(300);
    const t2 = await shot(mp, mbox);
    out.touchIdle = Math.round(tIdle * 100) / 100;
    out.touch = Math.round((await compare(mp, t1, t2)).change * 100) / 100;
  } else {
    out.touchSurface = false;
  }
  await m.close();
  out.errors = errors.slice(0, 5);
  out.errorCount = errors.length;
  say(out);
} catch (e) {
  if (e !== null) say({ ok: false, error: String(e && e.message || e).slice(0, 200) });
} finally {
  await browser.close();
}
`;
}

/** One flow read (Q-861): the summed sub-pixel shift over consecutive frames at 160×90, how the frame pairs voted,
 *  and how many strip reads moved too fast to read (`edge`) against how many could be read (`read`). */
export interface FlowRead { total: number; pos: number; neg: number; pairs: number; edge?: number; read?: number }

/**
 * A three.js game read from its scene (Q-869). `moved`: how far the vehicle went under the accelerator (world units);
 * `follows`: the camera moved with it; `ahead`: cosine between camera-minus-vehicle and the vehicle's motion (+1 = the
 * camera is straight ahead of where it is going); `looks`: cosine between the camera's view and the way to the vehicle;
 * `turn`: degrees the vehicle's direction turned with LEFT held, + toward the driver's left.
 */
/**
 * How many frames the steering probe must see DRAWN before its reading is evidence of anything (Q-1038).
 *
 * The fixture turns 0.03 rad — about 1.7° — per frame, and `sceneVerdict` will not read a turn below 5°,
 * so three frames of turning is the arithmetic floor. Twelve is that floor with room: it is a fifth of a
 * second on an idle machine and still reachable on a loaded one, and it clears the 0.2 speed floor by a
 * margin rather than by luck. The sibling constant for the PIXEL looks is `LATE_MIN_FRAMES` (Q-869).
 */
export const PROBE_MIN_FRAMES = 12;

/**
 * How long the probe will wait for those frames before giving up and SAYING SO.
 *
 * Twelve frames is 200 ms at 60 fps and 2.4 s at 5 fps, so this covers a badly loaded machine. The cap
 * exists because a page whose raf loop has died would otherwise hold the probe for the whole playtest
 * budget — a hang is a worse outcome than an honest "starved".
 */
export const PROBE_CAP_MS = 2500;

export interface SceneRead {
  moved: number;
  follows: boolean;
  ahead: number;
  looks: number;
  turn?: number;
  /** Frames the page DREW during the steering probe's shortest leg (Q-1038). Absent on an older run. */
  probeFrames?: number;
  /** Wall-clock the probe spent collecting them, so "starved" can be stated with both numbers. */
  probeMs?: number;
}

/**
 * Was the steering probe starved of frames, so that a null turn says nothing about the game? PURE.
 *
 * 🔴 WHY THIS IS NOT "just a flaky test". A null turn had two indistinguishable causes: this game does
 * not steer, and this machine did not draw. The first is a finding; the second is noise. Reporting them
 * identically is what let a real finding and a CPU spike look the same, and it gated two PRs
 * (report 9c612cdb's, then #3703) before anybody traced it.
 *
 * `undefined` probeFrames means the run predates this measurement — that is NOT starvation, and
 * claiming it would turn every old run into a false alarm.
 */
export function probeStarved(r: SceneRead | null | undefined, min = PROBE_MIN_FRAMES): boolean {
  return !!r && typeof r.probeFrames === 'number' && r.probeFrames < min;
}

/**
 * The line to print instead of a silent null, or null when the probe was not starved. PURE.
 *
 * Both numbers are in it on purpose: "3 frames in 2500 ms" is a starved page, and the same null beside
 * 180 frames is a game that really does not steer. One of those is worth an autopsy.
 */
export function probeStarvedNote(r: SceneRead | null | undefined, min = PROBE_MIN_FRAMES): string | null {
  if (!probeStarved(r, min)) return null;
  return `page starved: ${r!.probeFrames} frames in ${r!.probeMs ?? 0} ms — the steering could not be read`;
}

export interface PlaytestRun {
  ok: boolean;
  error?: string;
  diagnostic?: string | null;
  started?: string | null;
  spread?: number;
  /** Mean brightness of the idle picture, 0–255 (Q-980, found beside Q-913). Recorded, not yet scored: BlockWorld
   *  (50378049) shipped a screen too dark to play, and `spread` alone passes a dark world with a little variation
   *  (Q-913 itself — the playtest never running — is fixed by playtestSkipReason). A threshold needs real numbers from
   *  a dark game AND a legitimately dark one (a space shooter), so it is measured and printed first. */
  brightness?: number;
  idle?: number;
  fps?: number;
  longFrames?: number;
  moves?: Array<{ label: string; change: number }>;
  touchControls?: number;
  touchIdle?: number;
  touch?: number;
  touchSurface?: boolean;
  /** Picture change WHILE up/W stayed held (0.35 s → 0.9 s into the hold) — the accelerator probe. */
  gas?: number;
  /** The second, longer accelerator look — taken only when the first saw nothing move (Q-865): the most it changed. */
  gasLate?: number;
  /** How long that look lasted, and how many frames the page drew during it (Q-869). */
  gasLateMs?: number;
  gasLateFrames?: number;
  /** Which way the lower picture (the road) moved, frame to frame, while the accelerator was held — + is down (Q-861). */
  gasFlow?: FlowRead | null;
  /** Which way the horizon band moved while accelerator + LEFT were held — + is right (Q-861). */
  steerFlow?: FlowRead | null;
  /** Read from a three.js game's own scene (Q-869): see SceneRead. */
  scene?: SceneRead;
  errors?: string[];
  errorCount?: number;
}

/** Read the runner's stdout. A run with no result line is `ok: false`, never a pass. PURE. */
export function parsePlaytest(stdout: string | null | undefined): PlaytestRun {
  const text = String(stdout ?? '');
  for (const line of text.split('\n').reverse()) {
    const at = line.indexOf(PLAYTEST_RESULT_MARKER);
    if (at < 0) continue;
    try { return JSON.parse(line.slice(at + PLAYTEST_RESULT_MARKER.length)) as PlaytestRun; } catch { break; }
  }
  return { ok: false, diagnostic: parseScriptDiagnostic(text) };
}

export type Dimension = 'runs' | 'responds' | 'mobile' | 'stable' | 'smooth' | 'alive' | 'replay';

/** How much each dimension weighs in the overall score. A game nobody can control is not a game. */
export const DIMENSION_WEIGHTS: Readonly<Record<Dimension, number>> = {
  runs: 20, responds: 25, mobile: 15, stable: 15, replay: 10, smooth: 10, alive: 5,
};

/** Below this mean change (0–100 at 48×27) two frames are "the same picture". */
export const STILL_BELOW = 0.15;

/** The second accelerator look: up to this many one-second looks (Q-869). */
export const LATE_LOOKS = 8;
/** A "never moves" verdict needs the whole look (≥ 7 s) and at least this many frames drawn during it — a page a
 *  loaded machine had stopped drawing shows the same picture whatever the car does (Q-869). */
export const LATE_MIN_MS = 7000;
export const LATE_MIN_FRAMES = 40;

/** What a player is told to fix, per weakest dimension — a sentence the build card can show. */
export const DIMENSION_FIX: Readonly<Record<Dimension, string>> = {
  runs: 'The game screen is blank or a single colour — draw the world and the player on it.',
  responds: 'The controls do not move anything — wire the arrow keys/WASD, Space and a drag to the player.',
  mobile: 'On a phone nothing can be controlled — add an on-screen joystick and action buttons (touch only).',
  stable: 'The game throws errors while it is played — fix them so a round can finish.',
  smooth: 'The game crawls even before any action — reduce draw calls (merge, instance, lite detail) and allocations per frame.',
  alive: 'Nothing moves until a key is pressed — add idle motion (the world, an enemy, a hint) so it reads as a game.',
  replay: 'Nothing brings the player back — keep a best score and progress (startMeta) and a one-tap Play again.',
};

export interface PlaytestScore {
  overall: number;
  dimensions: Record<Dimension, number>;
  weakest: Dimension;
  respondedTo: string[];
  /** A driving game whose picture stayed still at idle AND while the accelerator was held — see below. */
  stalledVehicle?: boolean;
  /** A driving game whose road moved UP the screen as it drove — the camera faces the vehicle (Q-861). */
  cameraFacesVehicle?: boolean;
  /** A driving game seen from a forward camera whose view panned LEFT when LEFT was held (Q-861). */
  steeringMirrored?: boolean;
}

/**
 * 🏎️ THE CAR THAT NEVER MOVES (admin 2026-10-11, build 46e2d74b). The reviewer wrote "`updateGameState`
 * never accelerates the car" — the third return of the 2026-08-25 "speed nahi badhti" class, which had
 * only a prompt rule and a guard inside the kit (`createVehicleState` starts at speed 5) that a
 * hand-written game never calls. Nothing that PLAYS the game asked the question, so it shipped.
 *
 * Asked here, from pixels, and only where the answer cannot be mistaken: a DRIVING game (read from its
 * code, `isDrivingGame`) whose picture is the SAME picture at idle and the same picture while up/W is held
 * for most of a second (both below STILL_BELOW). A moving vehicle changes the picture under any camera —
 * the road streams past a chase camera, the car crosses a fixed one. A world that moves at idle (an
 * auto-running game, an animated sky) is never judged by this: the probe cannot tell a car that is
 * already moving from one the accelerator should have moved, so it says nothing.
 *
 * ⚠️ THE ONE RESIDUAL, said rather than hidden: a world with nothing in it that can be seen to move — a
 * flat, untextured road and an empty sky under a camera that follows the car — looks the same moving or
 * stopped. Such a game would be offered this fix wrongly; it is also a game a player cannot see moving,
 * which is a defect of its own. PURE.
 */
export const STALLED_VEHICLE_FIX = 'Holding the accelerator (Up / W) moved nothing — the vehicle never speeds up. Start it moving (speed above zero) and raise its speed every frame the accelerator is held, then drive it along its own heading.';

/**
 * 🎥 THE CAMERA THAT FACES THE CAR, AND THE STEERING THAT IS MIRRORED — read by PLAYING (Q-861, found by 46e2d74b).
 * The write-time shape note (`chaseCameraShape`) reads a hand-written camera only when its offset is a literal +Z;
 * one built with `applyQuaternion` or a lerp is invisible to it. Playing it is not: under a camera that looks the
 * way the vehicle drives, the road moves DOWN the screen as it drives, and holding LEFT pans the world RIGHT. A
 * camera in front of the vehicle looking back at it (the headlights view, where LEFT looks like RIGHT) moves the
 * road UP; mirrored steering pans the world LEFT.
 *
 * ⚠️ PRECISION FIRST — a false verdict offers a wrong fix on a working game. Judged only for a DRIVING game, only
 * from consecutive frames (`sampleFlow` — never two screenshots far apart, where repeating lane marks alias), and
 * only when FIRM: at least FLOW_MIN_PX in total, three out of four voting frame pairs agreeing, and no more than half
 * of the strip reads faster than the search can read (those may alias — measured: a correct top-down road at full
 * speed read −5.5 px on the two pairs that did not hit the edge; a near strip alone too fast, as on a dropped frame
 * under load, leaves the farther strips voting — a quarter-of-pairs rule voided a correct chase view that way). A top-down or side
 * view whose camera does not follow the vehicle moves nothing in those bands and gets no verdict; steering is
 * judged only once the camera was proven to look forward. PURE.
 */
export const FLOW_MIN_PX = 3;
export const CAMERA_FACES_VEHICLE_FIX = 'Driving forward moves the road UP the screen — the camera sits in front of the vehicle looking back at it, so the player sees its headlights and LEFT looks like RIGHT. Put the camera BEHIND the vehicle (offset along its backward direction, looking along its heading); in the kit, ctx.follow(car) does this.';
export const STEERING_MIRRORED_FIX = 'Holding LEFT turned the view to the RIGHT — the steering is mirrored. LEFT must turn the vehicle to the driver\'s left and RIGHT to the right; in the kit, driveVehicle already does this.';

/**
 * What a three.js game's own scene says (Q-869): `faces` — the camera sits ahead of the vehicle's motion looking back
 * at it (true), or behind it (false); `mirrored` — LEFT turned it to the driver's right (true) or left (false). null
 * when the scene cannot say: no three.js scene, no vehicle the accelerator clearly moved, or a camera that does not
 * follow it (a fixed camera, or a game that moves the world instead of the car — pixels judge those). PURE.
 */
export function sceneVerdict(r: SceneRead | null | undefined): { faces: boolean | null; mirrored: boolean | null } {
  const none = { faces: null, mirrored: null };
  if (!r || !r.follows || !(r.moved >= 0.2)) return none;
  const faces = r.ahead > 0.3 && r.looks > 0.5 ? true : r.ahead < -0.3 ? false : null;
  const mirrored = typeof r.turn === 'number' && Number.isFinite(r.turn) && Math.abs(r.turn) >= 5 ? r.turn < 0 : null;
  return { faces, mirrored };
}

/** Is this flow read firm enough to judge, and which way did it go? 0 when it is not. PURE. */
export function firmFlow(f: FlowRead | null | undefined): -1 | 0 | 1 {
  if (!f || typeof f.total !== 'number' || !Number.isFinite(f.total) || Math.abs(f.total) < FLOW_MIN_PX) return 0;
  const agree = f.total > 0 ? f.pos : f.neg;
  const voted = (f.pos ?? 0) + (f.neg ?? 0);
  if (agree < 3 || agree < Math.ceil(voted * 0.75)) return 0;
  // Most strip reads faster than the search: what was read may be aliased. No verdict. (A near strip alone being too
  // fast is normal on a slow frame rate — the farther strips of the same pairs still read true.)
  const edge = f.edge ?? 0;
  if (edge > 0 && edge * 2 > edge + (f.read ?? f.pairs ?? 0)) return 0;
  return f.total > 0 ? 1 : -1;
}

/** Turn the measurements into the Game Quality Score. Every number comes from a measurement. PURE. */
export function scorePlaytest(run: PlaytestRun, replay: GameCodeFacts): PlaytestScore {
  const idle = run.idle ?? 0;
  const threshold = Math.max(STILL_BELOW * 4, idle * 1.5 + 0.3);
  const respondedTo = (run.moves ?? []).filter((m) => m.change > threshold).map((m) => m.label);
  const runs = (run.spread ?? 0) >= 3 ? 100 : (run.spread ?? 0) >= 1 ? 50 : 0;
  // "Still" here is the floor this file already uses for "the same picture" (STILL_BELOW), on BOTH reads:
  // the strictest reading there is, because the cost of a false "your car never moves" is a wrong fix
  // offered on a working game. A road with lane marks, kerbs or scenery changes far more than this the
  // moment it moves (measured: a thin-striped test road gave 0.22 moving and 0 stalled).
  // Q-865: and the second, longer look — after any countdown, start of the hold against its end — saw nothing
  // move either. Without that look there is no verdict: a countdown or a slow car under a fixed camera is a
  // working game, and a false "your car never moves" offers a wrong fix.
  // Q-869: and that look lasted its full length with the page DRAWING — measured: a 9 s 'Get ready' countdown was called
  // stalled by a 2 s look, and a page a loaded machine stops drawing is the same picture whatever the car does.
  const stalledVehicle = replay.driving === true && typeof run.gas === 'number'
    && idle < STILL_BELOW && run.gas < STILL_BELOW
    && typeof run.gasLate === 'number' && run.gasLate < STILL_BELOW
    && (run.gasLateMs ?? 0) >= LATE_MIN_MS && (run.gasLateFrames ?? 0) >= LATE_MIN_FRAMES;
  // The scene first, where there is one (Q-869: positions do not depend on how many frames a loaded machine drew);
  // pixels only where the scene could not say — and never against a scene that said the opposite.
  const scene = replay.driving === true && !stalledVehicle ? sceneVerdict(run.scene) : { faces: null, mirrored: null };
  const road = replay.driving === true && !stalledVehicle ? firmFlow(run.gasFlow) : 0;
  const cameraFacesVehicle = scene.faces ?? road === -1;
  const forwardCamera = scene.faces === false || (scene.faces === null && road === 1);
  const steeringMirrored = scene.mirrored ?? (forwardCamera && firmFlow(run.steerFlow) === -1);
  const backwards = cameraFacesVehicle || steeringMirrored;
  // A driving game whose accelerator moves nothing cannot score as controllable, whatever else answered — nor one
  // whose controls read backwards to the player.
  const responds = Math.min(stalledVehicle || backwards ? 40 : 100,
    respondedTo.length >= 3 ? 100 : respondedTo.length === 2 ? 85 : respondedTo.length === 1 ? 65 : 0);
  const touchThreshold = Math.max(STILL_BELOW * 4, (run.touchIdle ?? 0) * 1.5 + 0.3);
  const touchMoved = (run.touch ?? 0) > touchThreshold;
  const mobile = run.touchSurface === false ? 0 : touchMoved ? 100 : (run.touchControls ?? 0) >= 2 ? 60 : 0;
  const errs = run.errorCount ?? 0;
  const stable = errs === 0 ? 100 : errs <= 2 ? 60 : 20;
  const fps = run.fps ?? 0;
  const smooth = fps >= 45 ? 100 : fps >= 25 ? 85 : fps >= 12 ? 60 : fps >= 5 ? 35 : 10;
  const alive = idle >= STILL_BELOW ? 100 : 60;
  const rep = (replay.progress ? 60 : 0) + (replay.restart ? 40 : 0);
  const dimensions: Record<Dimension, number> = { runs, responds, mobile, stable, smooth, alive, replay: rep };
  let total = 0, weight = 0;
  for (const d of Object.keys(DIMENSION_WEIGHTS) as Dimension[]) { total += dimensions[d] * DIMENSION_WEIGHTS[d]; weight += DIMENSION_WEIGHTS[d]; }
  // The weakest dimension is the one costing the most points, so a tie goes to what matters more.
  let weakest: Dimension = 'responds';
  let worst = -1;
  for (const d of Object.keys(DIMENSION_WEIGHTS) as Dimension[]) {
    const lost = (100 - dimensions[d]) * DIMENSION_WEIGHTS[d];
    if (lost > worst) { worst = lost; weakest = d; }
  }
  // A car that never moves, or one whose controls read backwards, is THE defect, whichever dimension lost more points on paper.
  if (stalledVehicle || backwards) weakest = 'responds';
  return {
    overall: Math.round(total / weight), dimensions, weakest, respondedTo,
    ...(stalledVehicle ? { stalledVehicle: true } : {}),
    ...(cameraFacesVehicle ? { cameraFacesVehicle: true } : {}),
    ...(steeringMirrored ? { steeringMirrored: true } : {}),
  };
}

/** At or above this, with nothing at zero, a game is reported as playable. */
export const PLAYABLE_SCORE = 75;

export interface PlaytestVerdict {
  code: 'GAME_PLAYTEST_OK' | 'GAME_PLAYTEST_ISSUES' | 'GAME_PLAYTEST_NOT_RUN';
  severity: 'info' | 'warning';
  message: string;
  autoResolved: boolean;
  score: PlaytestScore | null;
}

const LABEL: Readonly<Record<Dimension, string>> = {
  runs: 'Runs', responds: 'Controls', mobile: 'Phone', stable: 'Stable', smooth: 'Smooth', alive: 'Alive', replay: 'Replay',
};

/**
 * A GAME THAT WAS NEVER PLAYED IS SAID SO, AS A WARNING (admin 2026-10-11, build 46e2d74b).
 *
 * 🔴 This line used to be recorded `info` and auto-resolved — the way a pass is recorded. In 46e2d74b the
 * playtest never pressed "Start Race", never found a canvas, and the report filed that beside the passes;
 * nothing anywhere said the racing game had never been played, while the admin found within a minute that
 * its car showed its headlights and steered backwards. A check that could not look is not a check that
 * passed: it stays an open WARNING that names what was not done. It is still OUR instrument, not a defect
 * of the user's app (BuildDiagnostics keeps the code process-only, so it costs the app no health points and
 * no money) — the change is that it can no longer read as fine. One sentence for every way it is reached
 * (the runner's own answer, and the route's timeout or crash), so the two can never drift apart. PURE.
 */
export function playtestNotRunVerdict(why: string): PlaytestVerdict {
  const reason = String(why ?? '').trim().replace(/\.+$/, '') || 'the playtest browser produced no result';
  return {
    code: 'GAME_PLAYTEST_NOT_RUN', severity: 'warning', autoResolved: false, score: null,
    message: `The game was never played — ${reason}. Nothing here shows that it is playable: its controls, its speed and its camera were not checked in a browser.`,
  };
}

/**
 * 🔴 THE THIRD WAY THIS CHECK IS REACHED, WHICH HAD NO SENTENCE (Q-913, autopsy `50378049`, 2026-10-12).
 *
 * `playtestNotRunVerdict` above promises *"one sentence for every way it is reached (the runner's own
 * answer, and the route's timeout or crash), so the two can never drift apart."* There is a THIRD way:
 * **the route never calls it at all.** Its gate is one long `if (…)` with no `else`, so when a condition
 * is false the playtest is silently skipped and the report says nothing.
 *
 * That is the reported build. BlockWorld is a canvas game whose screen stayed DARK; the engine's own
 * measurement for exactly that — `scorePlaytest`'s `runs`, read from the brightness spread of a 48×27
 * sample, which scores 0 for *"blank or a single colour"* — never ran, because the preview address had
 * been discarded (Q-900). **Nothing anywhere said the game had not been played**, so the only account of
 * the dark screen left in the report was the MODEL's own prose — *"normal for a sandbox game, players
 * can move and dig to daylight"* — an explanation standing where a measurement belonged.
 *
 * 🔒 "COULD NOT LOOK" AND "NOT APPLICABLE" ARE DIFFERENT, and conflating them would make this a nag.
 * A project with no canvas game, an import turn, a stopped build, a failed build or the kill switch are
 * NOT APPLICABLE — this returns null and the report stays silent, correctly. A canvas game the route
 * could not play — no preview address, a module turn judged as awaiting its shell, no time left, no
 * command channel — is COULD NOT LOOK, and gets the warning that already exists.
 *
 * PURE.
 */
export function playtestSkipReason(ctx: {
  enabled: boolean;
  buildOk: boolean;
  isCanvasGame: boolean;
  isImportTurn: boolean;
  aborted: boolean;
  hasRunCommand: boolean;
  hasPreviewUrl: boolean;
  awaitsShell: boolean;
  timeLeft: boolean;
}): string | null {
  // Not applicable — silence is the honest answer, and a warning here would be a nag.
  if (!ctx.enabled || !ctx.isCanvasGame || !ctx.buildOk || ctx.isImportTurn || ctx.aborted) return null;
  // Could not look — each one names what was missing, never "something went wrong".
  if (!ctx.hasPreviewUrl) return 'no live preview address was available to open the game at';
  if (ctx.awaitsShell) return 'this turn built one project module and the app is assembled by a later one';
  if (!ctx.hasRunCommand) return 'this sandbox has no way to run a browser';
  if (!ctx.timeLeft) return 'the build had no time left to play it in';
  return null;
}

/** The report line, with the scorecard. PURE. */
export function playtestVerdict(run: PlaytestRun, replay: GameCodeFacts): PlaytestVerdict {
  if (!run.ok) return playtestNotRunVerdict(run.error || run.diagnostic || '');
  const score = scorePlaytest(run, replay);
  const card = (Object.keys(DIMENSION_WEIGHTS) as Dimension[]).map((d) => `${LABEL[d]} ${score.dimensions[d]}`).join(' · ');
  const played = score.respondedTo.length ? `it responded to ${score.respondedTo.join(', ')}` : 'it did not respond to the arrows/WASD, Space or a drag';
  const fpsNote = typeof run.fps === 'number' ? `; ${run.fps} fps in the build sandbox's software renderer (a phone's GPU is faster)` : '';
  const pictureNote = typeof run.brightness === 'number' ? `; picture brightness ${run.brightness}/255, contrast ${run.spread ?? 0}` : '';
  const errNote = run.errorCount ? `; ${run.errorCount} error(s) while playing: ${(run.errors ?? [])[0] ?? ''}` : '';
  const anyZero = (Object.keys(score.dimensions) as Dimension[]).some((d) => score.dimensions[d] === 0 && d !== 'replay');
  const ok = score.overall >= PLAYABLE_SCORE && !anyZero && !score.stalledVehicle && !score.cameraFacesVehicle && !score.steeringMirrored;
  /**
   * 🔴 A PROBE THAT COULD NOT LOOK DOES NOT READ AS A PASS (Q-1038) — `playtestNotRunVerdict`'s own
   * principle, one level down. When the page was starved of frames the steering verdict is null, and a
   * null used to be indistinguishable in the report from "this game steers correctly". It is appended to
   * the head rather than changing the score: the probe not running is OUR instrument's problem, not the
   * app's, exactly as the not-run warning says — it costs the app no points and no money, and it can no
   * longer read as fine.
   */
  const starved = probeStarvedNote(run.scene);
  const starvedNote = starved ? ` Steering was not read — ${starved}.` : '';
  const head = `Game Quality Score ${score.overall}/100 (${card}) — played in a real browser: ${played}${fpsNote}${pictureNote}${errNote}.${starvedNote}`;
  if (ok) return { code: 'GAME_PLAYTEST_OK', severity: 'info', autoResolved: true, score, message: head };
  const fix = score.stalledVehicle ? STALLED_VEHICLE_FIX
    : score.cameraFacesVehicle ? CAMERA_FACES_VEHICLE_FIX
      : score.steeringMirrored ? STEERING_MIRRORED_FIX
        : DIMENSION_FIX[score.weakest];
  return { code: 'GAME_PLAYTEST_ISSUES', severity: 'warning', autoResolved: false, score, message: `${head} Weakest: ${LABEL[score.weakest]} — ${fix}` };
}

/** The card's three-way outcome from the code the playtest recorded. One place, so the card and the report agree. PURE. */
export function playtestOutcome(code: string | null | undefined): 'passed' | 'failed' | 'not-run' {
  const c = String(code ?? '').trim();
  if (c === 'GAME_PLAYTEST_OK') return 'passed';
  if (c === 'GAME_PLAYTEST_ISSUES') return 'failed';
  return 'not-run';
}
