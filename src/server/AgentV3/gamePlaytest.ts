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
import { CONSOLE_NOISE } from './clickExplorer';
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

/** REPLAY, read from the code: a progress/best-score layer, and a way to play again. PURE. */
export function replayFromCode(files: Record<string, string>): { progress: boolean; restart: boolean } {
  let progress = false;
  let restart = false;
  for (const [path, content] of Object.entries(files || {})) {
    if (/(^|\/)node_modules\//.test(path) || !CODE_FILE.test(path) || typeof content !== 'string') continue;
    // The meta layer's own file only DEFINES these; using them is what counts.
    if (/(^|\/)src\/game\/core\/meta\.ts$/.test(path)) continue;
    if (/\bstartMeta\s*\(/.test(content) || /localStorage\.setItem\([^)]*(best|high|score|level|progress)/i.test(content)) progress = true;
    if (/\b(play again|restart|try again|retry|replay)\b/i.test(content) || /\.restart\s*\(/.test(content)) restart = true;
  }
  return { progress, restart };
}

/** The in-sandbox shell command. PURE. */
export function gamePlaytestScript(previewUrl: string, opts: { storageState?: string | null } = {}): string {
  const cfg = gamePlaytestConfig(previewUrl, opts.storageState ?? null);
  return `cat > /tmp/nbai-playtest.mjs <<'NBAI_EOF'
${gamePlaytestModule(cfg)}
NBAI_EOF
${browserScriptRunLine({ toolsDir: TOOLS_DIR, scriptPath: '/tmp/nbai-playtest.mjs', marker: PLAYTEST_RESULT_MARKER })}`;
}

export function gamePlaytestConfig(previewUrl: string, storageState: string | null = null): Record<string, unknown> {
  return {
    base: String(previewUrl ?? '').trim(),
    marker: PLAYTEST_RESULT_MARKER,
    loadMs: LOAD_MS,
    noise: CONSOLE_NOISE.source,
    noiseFlags: CONSOLE_NOISE.flags,
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
const START = /^\\s*(start|play|play now|begin|start game|let'?s go|go|tap to (start|play)|press start|new game|khelo|shuru|शुरू|खेलें)\\s*!?\\s*$/i;

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

async function pressStart(page) {
  const names = await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    for (const el of document.querySelectorAll('button, [role=button], a')) {
      const b = el.getBoundingClientRect();
      const t = (el.getAttribute('aria-label') || el.innerText || '').trim();
      if (b.width > 0 && b.height > 0 && re.test(t)) { el.setAttribute('data-nb-start', '1'); return t; }
    }
    return null;
  }, START.source);
  if (names) { await page.click('[data-nb-start="1"]', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }
  return names;
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
  if (!box) { say({ ok: false, error: 'no game surface (canvas) on the page' }); throw null; }
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
  await step('up / W', () => hold(page, ['ArrowUp', 'KeyW'], 700));
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
  await pressStart(mp);
  let mbox = await surface(mp);
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
}

/** Turn the measurements into the Game Quality Score. Every number comes from a measurement. PURE. */
export function scorePlaytest(run: PlaytestRun, replay: { progress: boolean; restart: boolean }): PlaytestScore {
  const idle = run.idle ?? 0;
  const threshold = Math.max(STILL_BELOW * 4, idle * 1.5 + 0.3);
  const respondedTo = (run.moves ?? []).filter((m) => m.change > threshold).map((m) => m.label);
  const runs = (run.spread ?? 0) >= 3 ? 100 : (run.spread ?? 0) >= 1 ? 50 : 0;
  const responds = respondedTo.length >= 3 ? 100 : respondedTo.length === 2 ? 85 : respondedTo.length === 1 ? 65 : 0;
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
  return { overall: Math.round(total / weight), dimensions, weakest, respondedTo };
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

/** The report line, with the scorecard. PURE. */
export function playtestVerdict(run: PlaytestRun, replay: { progress: boolean; restart: boolean }): PlaytestVerdict {
  if (!run.ok) {
    const why = run.error || run.diagnostic || 'the playtest browser produced no result';
    return { code: 'GAME_PLAYTEST_NOT_RUN', severity: 'info', autoResolved: true, score: null, message: `The game was not played: ${why}.` };
  }
  const score = scorePlaytest(run, replay);
  const card = (Object.keys(DIMENSION_WEIGHTS) as Dimension[]).map((d) => `${LABEL[d]} ${score.dimensions[d]}`).join(' · ');
  const played = score.respondedTo.length ? `it responded to ${score.respondedTo.join(', ')}` : 'it did not respond to the arrows/WASD, Space or a drag';
  const fpsNote = typeof run.fps === 'number' ? `; ${run.fps} fps in the build sandbox's software renderer (a phone's GPU is faster)` : '';
  const errNote = run.errorCount ? `; ${run.errorCount} error(s) while playing: ${(run.errors ?? [])[0] ?? ''}` : '';
  const anyZero = (Object.keys(score.dimensions) as Dimension[]).some((d) => score.dimensions[d] === 0 && d !== 'replay');
  const ok = score.overall >= PLAYABLE_SCORE && !anyZero;
  const head = `Game Quality Score ${score.overall}/100 (${card}) — played in a real browser: ${played}${fpsNote}${errNote}.`;
  if (ok) return { code: 'GAME_PLAYTEST_OK', severity: 'info', autoResolved: true, score, message: head };
  return { code: 'GAME_PLAYTEST_ISSUES', severity: 'warning', autoResolved: false, score, message: `${head} Weakest: ${LABEL[score.weakest]} — ${DIMENSION_FIX[score.weakest]}` };
}

/** The card's three-way outcome from the code the playtest recorded. One place, so the card and the report agree. PURE. */
export function playtestOutcome(code: string | null | undefined): 'passed' | 'failed' | 'not-run' {
  const c = String(code ?? '').trim();
  if (c === 'GAME_PLAYTEST_OK') return 'passed';
  if (c === 'GAME_PLAYTEST_ISSUES') return 'failed';
  return 'not-run';
}
