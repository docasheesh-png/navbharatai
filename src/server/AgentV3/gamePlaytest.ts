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

/** Is this project a game drawn on a canvas? Only those are played. PURE. */
export function isCanvasGameProject(files: Record<string, string>): boolean {
  for (const [path, content] of Object.entries(files || {})) {
    if (/(^|\/)node_modules\//.test(path) || !CODE_FILE.test(path) || typeof content !== 'string') continue;
    if (/(^|\/)src\/game\//.test(path)) return true;
    if (GAME_SIGNAL.test(content) && /requestAnimationFrame|GameLoop|setAnimationLoop/.test(content)) return true;
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

// Decode both screenshots IN THE BROWSER and compare them at 48×27. Returns the mean change (0–100) and
// the second image's spread of brightness (a single flat colour has none).
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
    return { change: (diff / (n * 3 * 255)) * 100, spread: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
  }, [a, b]);
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
    for (const el of document.querySelectorAll('button, [role=button], a, input[type=button], input[type=submit]')) {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (b.width <= 0 || b.height <= 0 || s.visibility === 'hidden' || s.display === 'none' || el.disabled) continue;
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

const browser = await chromium.launch();
const out = { ok: true };
try {
  // ── DESKTOP: keyboard + mouse ─────────────────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ ...cfg.pageOpts, viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(frameCounter);
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
  const a = await shot(page, box);
  await page.waitForTimeout(700);
  const b = await shot(page, box);
  const f1 = await page.evaluate(() => ({ ...window.__nb, t: performance.now() }));
  const idle = await compare(page, a, b);
  out.spread = Math.round(idle.spread * 10) / 10;
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
    const g0 = await shot(page, box);
    await page.waitForTimeout(550);
    const g1 = await shot(page, box);
    out.gas = Math.round((await compare(page, g0, g1)).change * 100) / 100;
    for (const k of ['ArrowUp', 'KeyW']) await page.keyboard.up(k).catch(() => {});
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

export interface PlaytestRun {
  ok: boolean;
  error?: string;
  diagnostic?: string | null;
  started?: string | null;
  spread?: number;
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
  const stalledVehicle = replay.driving === true && typeof run.gas === 'number'
    && idle < STILL_BELOW && run.gas < STILL_BELOW;
  // A driving game whose accelerator moves nothing cannot score as controllable, whatever else answered.
  const responds = Math.min(stalledVehicle ? 40 : 100,
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
  // A car that never moves is THE defect, whichever dimension lost more points on paper.
  if (stalledVehicle) weakest = 'responds';
  return { overall: Math.round(total / weight), dimensions, weakest, respondedTo, ...(stalledVehicle ? { stalledVehicle: true } : {}) };
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

/** The report line, with the scorecard. PURE. */
export function playtestVerdict(run: PlaytestRun, replay: GameCodeFacts): PlaytestVerdict {
  if (!run.ok) return playtestNotRunVerdict(run.error || run.diagnostic || '');
  const score = scorePlaytest(run, replay);
  const card = (Object.keys(DIMENSION_WEIGHTS) as Dimension[]).map((d) => `${LABEL[d]} ${score.dimensions[d]}`).join(' · ');
  const played = score.respondedTo.length ? `it responded to ${score.respondedTo.join(', ')}` : 'it did not respond to the arrows/WASD, Space or a drag';
  const fpsNote = typeof run.fps === 'number' ? `; ${run.fps} fps in the build sandbox's software renderer (a phone's GPU is faster)` : '';
  const errNote = run.errorCount ? `; ${run.errorCount} error(s) while playing: ${(run.errors ?? [])[0] ?? ''}` : '';
  const anyZero = (Object.keys(score.dimensions) as Dimension[]).some((d) => score.dimensions[d] === 0 && d !== 'replay');
  const ok = score.overall >= PLAYABLE_SCORE && !anyZero && !score.stalledVehicle;
  const head = `Game Quality Score ${score.overall}/100 (${card}) — played in a real browser: ${played}${fpsNote}${errNote}.`;
  if (ok) return { code: 'GAME_PLAYTEST_OK', severity: 'info', autoResolved: true, score, message: head };
  const fix = score.stalledVehicle ? STALLED_VEHICLE_FIX : DIMENSION_FIX[score.weakest];
  return { code: 'GAME_PLAYTEST_ISSUES', severity: 'warning', autoResolved: false, score, message: `${head} Weakest: ${LABEL[score.weakest]} — ${fix}` };
}

/** The card's three-way outcome from the code the playtest recorded. One place, so the card and the report agree. PURE. */
export function playtestOutcome(code: string | null | undefined): 'passed' | 'failed' | 'not-run' {
  const c = String(code ?? '').trim();
  if (c === 'GAME_PLAYTEST_OK') return 'passed';
  if (c === 'GAME_PLAYTEST_ISSUES') return 'failed';
  return 'not-run';
}
