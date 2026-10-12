/**
 * BUILD 46e2d74b (admin 2026-10-11) — "Create an racing game for Nokia c 2-01". The admin found within a
 * minute that the car showed its headlights and steered backwards. The platform's own playtest had never
 * played the game at all:
 *
 *   • L-09 — the title screen's only control was "Start Race"; the playtest pressed a control only when its
 *     WHOLE label matched an anchored, closed list, so nothing was pressed, no canvas appeared, and the run
 *     stopped with "no game surface (canvas) on the page" — recorded as an auto-resolved INFO line.
 *   • L-03 — the reviewer's "`updateGameState` never accelerates the car" (the third return of the
 *     2026-08-25 "speed nahi badhti" class) was never asked by anything that PLAYS the game.
 *
 * These tests run the REAL playtest module in a REAL Chromium against racing games built to be exactly
 * that: a title screen with a pulsing "Start Race", a "How to Play" decoy, and a car whose accelerator
 * either works or does nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import {
  gamePlaytestModule, gamePlaytestConfig, gamePlaytestScript, parsePlaytest, playtestVerdict, playtestNotRunVerdict,
  scorePlaytest, startLabelRank, isDrivingGame, replayFromCode, STALLED_VEHICLE_FIX, MAX_START_PRESSES, type PlaytestRun,
  firmFlow, CAMERA_FACES_VEHICLE_FIX, STEERING_MIRRORED_FIX,
} from '../src/server/AgentV3/gamePlaytest';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

/** A racing game behind a title screen. `accelerates: false` is the 46e2d74b bug: the gas is read and never applied. */
function racer(o: { accelerates: boolean; title?: 'start-race' | 'how-only' | 'two-screens' | 'div-start'; countdownOnGas?: boolean; topSpeed?: number }): string {
  // 'two-screens': "Play" opens a car picker whose "Race!" is what finally shows the track.
  const title = o.title === 'how-only'
    ? '<button id="how">How to Play</button><button id="set">Settings</button>'
    // 'div-start': the start is a <div> whose press handler React holds (no button anywhere), and the first
    // start-shaped control on the screen is a link that LEAVES the app.
    : o.title === 'div-start'
      ? '<a id="store" href="http://127.0.0.2:9/app">Play on Android</a><button id="how">How to Play</button><div id="start" class="pulse" style="padding:12px 24px">Start Race</div>'
    : o.title === 'two-screens'
      ? '<button id="how">How to Play</button><button id="play" onclick="this.parentElement.innerHTML=\'<h2>Pick a car</h2><button>Red</button><button id=start>Race!</button>\'; document.getElementById(\'start\').onclick = () => { document.getElementById(\'title\').remove(); start(); }; window.__plays = (window.__plays || 0) + 1;">Play</button>'
      : '<button id="how">How to Play</button><button id="start" class="pulse">Start Race</button>';
  // Q-865: the first press of the gas starts a 3 s 'Get ready' freeze; the car only moves after it.
  const countdown = o.countdownOnGas
    ? "if ((held.has('ArrowUp') || held.has('KeyW')) && readyUntil === 0) readyUntil = performance.now() + 3000; const ready = readyUntil === 0 || performance.now() < readyUntil;"
    : 'const ready = false;';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>.pulse{animation:p .5s infinite alternate}@keyframes p{from{transform:scale(1)}to{transform:scale(1.2)}}
button{font-size:22px;margin:8px;padding:12px 24px}</style></head>
<body style="margin:0;background:#111;color:#fff;font-family:sans-serif">
<div id="title" style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
<h1>Turbo Racer</h1>${title}</div>
<script>
document.getElementById('how').onclick = () => { document.body.insertAdjacentHTML('beforeend', '<p id="rules">Arrows to drive</p>'); };
const s = document.getElementById('start');
if (s) s.onclick = () => { document.getElementById('title').remove(); start(); };
// What React leaves on a <div onClick={…}>: the handler in the element's props, no onclick attribute.
if (s && s.tagName === 'DIV') s['__reactProps$nb'] = { onClick: s.onclick };
function start() {
  const c = document.createElement('canvas'); c.style.cssText = 'display:block;width:100vw;height:100vh;touch-action:none';
  document.body.appendChild(c); const g = c.getContext('2d');
  const fit = () => { c.width = innerWidth; c.height = innerHeight; }; fit(); addEventListener('resize', fit);
  const held = new Set(); addEventListener('keydown', (e) => held.add(e.code)); addEventListener('keyup', (e) => held.delete(e.code));
  let speed = 0, x = 0.5, offset = 0, readyUntil = 0;
  function frame() {
    ${countdown}
    if (!ready && (held.has('ArrowUp') || held.has('KeyW'))) { ${o.accelerates ? `speed = Math.min(speed + 0.004, ${o.topSpeed ?? 0.06});` : '/* the gas is read and never applied */'} }
    if (held.has('ArrowLeft') || held.has('KeyA')) x = Math.max(0.3, x - 0.01);
    if (held.has('ArrowRight') || held.has('KeyD')) x = Math.min(0.7, x + 0.01);
    offset = (offset + speed) % 0.25;
    g.fillStyle = '#2f6b2f'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#555'; g.fillRect(c.width * 0.25, 0, c.width * 0.5, c.height);
    // Lane marks and red/white kerbs, the way a real road shows that it is moving.
    for (let i = -1; i < 6; i++) {
      const y = (((i * 0.2 + offset * 0.8) % 1.2) + 1.2) % 1.2 * c.height - c.height * 0.1;
      g.fillStyle = '#fff'; g.fillRect(c.width * 0.47, y, c.width * 0.06, c.height * 0.1);
      g.fillStyle = i % 2 ? '#fff' : '#c22'; g.fillRect(c.width * 0.2, y, c.width * 0.05, c.height * 0.1); g.fillRect(c.width * 0.75, y, c.width * 0.05, c.height * 0.1);
    }
    g.fillStyle = '#d33'; g.fillRect(x * c.width - 30, c.height * 0.75, 60, 100);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
</script></body></html>`;
}

/**
 * Q-861: a chase-view racer drawn the way a hand-written three.js one looks from the driver's seat — hills on the
 * horizon at uneven bearings (what pans when the car turns) and ground bands at perspective depth (what streams
 * toward the camera as it drives). `facesCar`: the camera sits in front of the car looking back, so the ground
 * recedes UP the screen (the 46e2d74b headlights view). `mirrored`: LEFT turns the car right.
 */
function chase(o: { facesCar?: boolean; mirrored?: boolean; everyNth?: number } = {}): string {
  // `everyNth`: draws only every Nth animation frame and moves N steps per drawn frame — a slow software renderer.
  const n = o.everyNth ?? 1;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#000"><script>
const c = document.createElement('canvas'); c.style.cssText = 'display:block;width:100vw;height:100vh;touch-action:none';
document.body.appendChild(c); const g = c.getContext('2d');
const fit = () => { c.width = innerWidth; c.height = innerHeight; }; fit(); addEventListener('resize', fit);
const held = new Set(); addEventListener('keydown', (e) => held.add(e.code)); addEventListener('keyup', (e) => held.delete(e.code));
const hills = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 40; i++) hills.push({ at: rnd() * 6.283, w: 0.02 + rnd() * 0.08, h: 0.05 + rnd() * 0.2, shade: 60 + Math.floor(rnd() * 150) });
let speed = 0, dist = 0, heading = 0;
let tick = 0;
function frame() {
  if (++tick % ${n}) { requestAnimationFrame(frame); return; }
  for (let k = 0; k < ${n}; k++) {
    if (held.has('ArrowUp') || held.has('KeyW')) speed = Math.min(speed + 0.004, 0.05); else speed = Math.max(0, speed - 0.002);
    const turn = (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0) - (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0);
    heading += turn * 0.02 * ${o.mirrored ? -1 : 1};
    dist += speed;
  }
  const W = c.width, H = c.height, hz = H * 0.45;
  g.fillStyle = '#7ab'; g.fillRect(0, 0, W, hz);
  for (const h of hills) {
    const x = ((((h.at + heading) / 6.283) % 1) + 1) % 1 * W * 3 - W;
    g.fillStyle = 'rgb(' + h.shade + ',' + (h.shade + 30) + ',' + h.shade + ')';
    g.fillRect(x, hz - h.h * H, h.w * W, h.h * H);
  }
  for (let y = Math.ceil(hz); y < H; y += 2) {
    const z = (H * 0.5) / (y - hz + 1);
    const band = Math.floor((z ${o.facesCar ? '-' : '+'} dist) * 6);
    g.fillStyle = band % 2 ? '#3a7a3a' : '#2e5e2e'; g.fillRect(0, y, W, 2);
    g.fillStyle = band % 2 ? '#777' : '#555'; g.fillRect(W * 0.5 - W * 0.6 / (z + 0.5), y, W * 1.2 / (z + 0.5), 2);
  }
  g.fillStyle = '#d33'; g.fillRect(W * 0.5 - 40, H * 0.8, 80, 50);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
}

const PAGES: Record<string, string> = {
  '/race': racer({ accelerates: true }),
  '/race-stalled': racer({ accelerates: false }),
  '/no-start': racer({ accelerates: true, title: 'how-only' }),
  '/two-screens': racer({ accelerates: true, title: 'two-screens' }),
  '/div-start': racer({ accelerates: true, title: 'div-start' }),
  // Q-865: two WORKING games the first look used to call stalled.
  '/race-countdown': racer({ accelerates: true, countdownOnGas: true }),
  '/race-slow': racer({ accelerates: true, topSpeed: 0.0012 }),
  // Q-861: a chase view done right, one whose camera faces the car, one whose steering is mirrored.
  '/chase': chase(),
  '/chase-front': chase({ facesCar: true }),
  '/chase-mirrored': chase({ mirrored: true }),
  // The same three at ≈20 fps, the way the build sandbox's software renderer draws a 3D game.
  '/chase-20fps': chase({ everyNth: 3 }),
  '/chase-front-20fps': chase({ facesCar: true, everyNth: 3 }),
  '/chase-mirrored-20fps': chase({ mirrored: true, everyNth: 3 }),
};

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);
const DRIVING = { progress: true, restart: true, driving: true };

describe.skipIf(!haveBrowser)('a racing game behind a "Start Race" title screen is started and driven, in a real browser', () => {
  let server: http.Server;
  let base = '';
  const runs: Record<string, PlaytestRun> = {};
  beforeAll(async () => {
    server = http.createServer((q, r) => { const b = PAGES[(q.url ?? '/').split('?')[0]]; r.writeHead(b ? 200 : 404, { 'content-type': 'text/html' }); r.end(b ?? 'no'); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  async function play(path: string): Promise<PlaytestRun> {
    if (runs[path]) return runs[path];
    const dir = makeTempDir('nbai-racing-playtest-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, gamePlaytestModule(gamePlaytestConfig(base + path), `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 150_000 }, (e, o) => (e ? rej(e) : res(o))));
    runs[path] = parsePlaytest(stdout);
    return runs[path];
  }

  it('L-09: "Start Race" (pulsing, beside a "How to Play" decoy) is pressed, the canvas appears, the game is PLAYED', async () => {
    const run = await play('/race');
    expect(run.ok).toBe(true);
    expect(run.started).toBe('Start Race');
    const v = playtestVerdict(run, DRIVING);
    expect(v.code).not.toBe('GAME_PLAYTEST_NOT_RUN');
    expect(v.score?.stalledVehicle).toBeUndefined();
    expect(v.score!.respondedTo).toContain('up / W');
  }, 180_000);

  it('L-03: the car whose accelerator moves nothing is caught, named, and offered as a fix', async () => {
    const run = await play('/race-stalled');
    expect(run.ok).toBe(true);
    const v = playtestVerdict(run, DRIVING);
    expect(v.score!.stalledVehicle).toBe(true);
    expect(v.code).toBe('GAME_PLAYTEST_ISSUES');
    expect(v.message).toContain(STALLED_VEHICLE_FIX);
    expect(v.score!.weakest).toBe('responds');
    // The same measurement on a game that is NOT a driving game is not judged by this probe.
    expect(playtestVerdict(run, { progress: true, restart: true }).score!.stalledVehicle).toBeUndefined();
    expect(buildFindingSuggestions([{ code: v.code, severity: v.severity, autoResolved: v.autoResolved, message: v.message }]).map((s) => s.title)).toContain('Make the game playable');
  }, 180_000);

  it('🔒 Q-865: a "Get ready" countdown on the first press of the gas is not a stalled car', async () => {
    const run = await play('/race-countdown');
    expect(run.ok).toBe(true);
    expect(typeof run.gasLate).toBe('number');
    expect(playtestVerdict(run, DRIVING).score?.stalledVehicle).toBeUndefined();
  }, 180_000);

  it('🔒 Q-865: a slow car is not a stalled car — the longer look sees it move', async () => {
    const run = await play('/race-slow');
    expect(run.ok).toBe(true);
    expect(playtestVerdict(run, DRIVING).score?.stalledVehicle).toBeUndefined();
  }, 180_000);

  it('🔒 Q-861: a chase view done right — road streams DOWN, LEFT pans the horizon RIGHT — gets no camera or steering verdict', async () => {
    const run = await play('/chase');
    expect(run.ok).toBe(true);
    expect(firmFlow(run.gasFlow)).toBe(1);
    expect(firmFlow(run.steerFlow)).toBe(1);
    const v = playtestVerdict(run, DRIVING);
    expect(v.score?.cameraFacesVehicle).toBeUndefined();
    expect(v.score?.steeringMirrored).toBeUndefined();
  }, 180_000);

  it('🔒 Q-861: a camera in FRONT of the car (the headlights view) is caught by playing it, and named', async () => {
    const run = await play('/chase-front');
    expect(firmFlow(run.gasFlow)).toBe(-1);
    const v = playtestVerdict(run, DRIVING);
    expect(v.score!.cameraFacesVehicle).toBe(true);
    expect(v.code).toBe('GAME_PLAYTEST_ISSUES');
    expect(v.message).toContain(CAMERA_FACES_VEHICLE_FIX);
    // Not a driving game by its code ⇒ not judged.
    expect(playtestVerdict(run, { progress: true, restart: true }).score!.cameraFacesVehicle).toBeUndefined();
  }, 180_000);

  it('🔒 Q-861: steering that turns the car RIGHT on LEFT is caught by playing it, and named', async () => {
    const run = await play('/chase-mirrored');
    expect(firmFlow(run.gasFlow)).toBe(1);
    expect(firmFlow(run.steerFlow)).toBe(-1);
    const v = playtestVerdict(run, DRIVING);
    expect(v.score!.steeringMirrored).toBe(true);
    expect(v.message).toContain(STEERING_MIRRORED_FIX);
  }, 180_000);

  it('🔒 Q-861 at ≈20 fps (the sandbox\'s software renderer): the same three verdicts, read just as firmly', async () => {
    const right = await play('/chase-20fps');
    expect([firmFlow(right.gasFlow), firmFlow(right.steerFlow)]).toEqual([1, 1]);
    const v = playtestVerdict(right, DRIVING).score!;
    expect([v.cameraFacesVehicle, v.steeringMirrored]).toEqual([undefined, undefined]);
    expect(playtestVerdict(await play('/chase-front-20fps'), DRIVING).score!.cameraFacesVehicle).toBe(true);
    expect(playtestVerdict(await play('/chase-mirrored-20fps'), DRIVING).score!.steeringMirrored).toBe(true);
  }, 400_000);

  it('🔒 Q-861 precision: the top-down racers (a fast road, a slow one, a countdown) get no camera or steering verdict', async () => {
    for (const path of ['/race', '/race-slow', '/race-countdown']) {
      const s = playtestVerdict(await play(path), DRIVING).score!;
      expect([path, s.cameraFacesVehicle, s.steeringMirrored]).toEqual([path, undefined, undefined]);
    }
  }, 400_000);

  it('a title screen that leads to a second screen ("Play" → pick a car → "Race!") is followed to the track', async () => {
    const run = await play('/two-screens');
    expect(run.ok).toBe(true);
    expect(run.started).toBe('Race!');
  }, 180_000);

  it('a "Start Race" that is a <div onClick> (no button at all) is pressed, and a link that leaves the app is not', async () => {
    const run = await play('/div-start');
    expect(run.ok).toBe(true);
    expect(run.started).toBe('Start Race');
  }, 180_000);

  it('a title screen with no control that starts a game is NOT RUN — a warning that says the game was never played', async () => {
    const run = await play('/no-start');
    expect(run.ok).toBe(false);
    expect(run.error).toMatch(/no control that starts a game/);
    const v = playtestVerdict(run, DRIVING);
    expect(v).toMatchObject({ code: 'GAME_PLAYTEST_NOT_RUN', severity: 'warning', autoResolved: false });
    expect(v.message).toMatch(/^The game was never played/);
  }, 180_000);
});

describe('the start control is found by its SHAPE (startLabelRank — the one definition the browser also applies)', () => {
  it('every label the old anchored list skipped is pressed now (the measured census)', () => {
    for (const label of ['Start Race', 'Play Game', 'Race!', 'Start Racing', 'Begin Race', 'Start Level 1', '▶ Play', 'PLAY NOW', 'Tap to Start', 'Let\'s Go!', 'खेलें', 'शुरू करें', 'Drive']) {
      expect(startLabelRank(label), label).toBeGreaterThan(0);
    }
  });

  it('a label that starts with the stem outranks one that only contains it; a label the caller saw start the game outranks both', () => {
    expect(startLabelRank('Start Race')).toBe(2);
    expect(startLabelRank('Quick Race')).toBe(1);
    expect(startLabelRank('Turbo!', ['turbo!'])).toBe(3);
    // …but a control that deletes, pays or shares is never pressed, whoever vouches for it.
    expect(startLabelRank('Buy coins', ['Buy coins'])).toBe(0);
  });

  it('precision: a control that does something else is never pressed as the start', () => {
    for (const label of ['How to Play', 'Settings', 'Google Play', 'Display', 'Playlist', 'Restart server', 'Share score', 'Buy coins',
      'Reset progress', 'Leaderboard', 'Sound: on', 'Back', '', 'Start a very long label that is certainly not a button at all here']) {
      expect(startLabelRank(label), JSON.stringify(label)).toBe(0);
    }
  });

  it('the runner is bounded, and the caller can hand it a label it already saw start the game', () => {
    expect(MAX_START_PRESSES).toBe(3);
    const s = gamePlaytestScript('http://localhost:5173/', { startLabels: ['Turbo!'] });
    expect(s).toContain('"known":["Turbo!"]');
  });
});

describe('the accelerator probe is precise (scorePlaytest)', () => {
  const base: PlaytestRun = { ok: true, spread: 30, idle: 0.05, fps: 60, longFrames: 0, moves: [{ label: 'up / W', change: 0.1 }, { label: 'left / A', change: 2 }, { label: 'right / D', change: 2 }, { label: 'mouse drag', change: 2 }], touchControls: 4, touchIdle: 0.1, touch: 3, errorCount: 0 };

  it('a driving game, still at idle and still under the accelerator, is a stalled vehicle — even when steering answered', () => {
    const s = scorePlaytest({ ...base, gas: 0.08, gasLate: 0.05 }, DRIVING);
    expect(s.stalledVehicle).toBe(true);
    expect(s.dimensions.responds).toBeLessThanOrEqual(40);
    // Without the probe this game scored as playable: left, right and a drag all answered.
    expect(scorePlaytest({ ...base, gas: 0.08 }, { progress: true, restart: true }).overall).toBeGreaterThanOrEqual(75);
  });

  it('never judged when the world already moves at idle, when the accelerator moved the picture, or when the probe did not run', () => {
    expect(scorePlaytest({ ...base, idle: 3, gas: 3.2 }, DRIVING).stalledVehicle).toBeUndefined();
    expect(scorePlaytest({ ...base, gas: 4 }, DRIVING).stalledVehicle).toBeUndefined();
    expect(scorePlaytest({ ...base }, DRIVING).stalledVehicle).toBeUndefined();
  });

  it('🔒 Q-865: no stall verdict without the second, longer look — or when that look saw the car move', () => {
    expect(scorePlaytest({ ...base, gas: 0.08 }, DRIVING).stalledVehicle).toBeUndefined();
    expect(scorePlaytest({ ...base, gas: 0.08, gasLate: 0.9 }, DRIVING).stalledVehicle).toBeUndefined();
  });

  it('🔒 Q-861: a firm read judges — the road moving UP is a camera facing the car; a forward camera panning LEFT on LEFT is mirrored steering', () => {
    const up = { total: -12, pos: 0, neg: 9, pairs: 10, edge: 0 };
    const down = { total: 12, pos: 9, neg: 0, pairs: 10, edge: 0 };
    const panLeft = { total: -10, pos: 0, neg: 8, pairs: 9, edge: 0 };
    const front = scorePlaytest({ ...base, gas: 3, gasFlow: up }, DRIVING);
    expect([front.cameraFacesVehicle, front.weakest, front.dimensions.responds <= 40]).toEqual([true, 'responds', true]);
    const mirrored = scorePlaytest({ ...base, gas: 3, gasFlow: down, steerFlow: panLeft }, DRIVING);
    expect([mirrored.steeringMirrored, mirrored.cameraFacesVehicle]).toEqual([true, undefined]);
    expect(playtestVerdict({ ...base, gas: 3, gasFlow: down, steerFlow: panLeft }, DRIVING).message).toContain(STEERING_MIRRORED_FIX);
    // Steering is only judged once the camera was proven to look forward.
    expect(scorePlaytest({ ...base, gas: 3, steerFlow: panLeft }, DRIVING).steeringMirrored).toBeUndefined();
    // Not a driving game by its code: never judged.
    expect(scorePlaytest({ ...base, gas: 3, gasFlow: up }, { progress: true, restart: true }).cameraFacesVehicle).toBeUndefined();
  });

  it('🔒 Q-861 precision: a read that is small, split, or too fast to trust gives NO verdict', () => {
    expect(firmFlow({ total: -2.5, pos: 0, neg: 6, pairs: 8, edge: 0 })).toBe(0); // under FLOW_MIN_PX
    expect(firmFlow({ total: -9, pos: 0, neg: 2, pairs: 3, edge: 0 })).toBe(0); // fewer than three pairs agree
    expect(firmFlow({ total: -9, pos: 2, neg: 4, pairs: 6, edge: 0 })).toBe(0); // under three in four
    // The measured alias: a correct top-down road at full speed read −5.5 px on the pairs that did not hit the edge.
    expect(firmFlow({ total: -5.5, pos: 0, neg: 3, pairs: 4, edge: 9 })).toBe(0);
    expect(firmFlow(null)).toBe(0);
    expect(firmFlow({ total: -9, pos: 0, neg: 6, pairs: 8, edge: 1 })).toBe(-1);
    // Per strip: most reads too fast voids it; a near strip alone too fast on a dropped frame does not (the full-suite
    // run under load voided a correct chase view under the old quarter-of-pairs rule).
    expect(firmFlow({ total: -5.5, pos: 0, neg: 3, pairs: 3, edge: 35, read: 4 })).toBe(0);
    expect(firmFlow({ total: 18.7, pos: 10, neg: 0, pairs: 13, edge: 9, read: 30 })).toBe(1);
  });

  it('a driving game is read from its code: the kit\'s vehicle API, or a vehicle + a speed + an accelerator', () => {
    expect(isDrivingGame({ 'src/game/play/race.ts': 'drive = driveVehicle(car, drive, input.axis(), dt);' })).toBe(true);
    expect(isDrivingGame({ 'src/lib/game/runtime.ts': "const car = { speed: 0 }; if (keys['ArrowUp']) car.speed += ACCELERATION;" })).toBe(true);
    expect(isDrivingGame({ 'src/Puzzle.tsx': 'const car = "red"; const speed = settings.speed;' })).toBe(false);
    expect(isDrivingGame({ 'src/Snake.tsx': "let speed = 5; if (e.key === 'ArrowUp') dir = UP;" })).toBe(false);
    expect(replayFromCode({ 'src/lib/game/runtime.ts': "const car = { speed: 0 }; window.addEventListener('keydown', (e) => { if (e.code === 'KeyW') accelerating = true; });" }).driving).toBe(true);
  });
});

describe('a game that was never played is said so (playtestNotRunVerdict)', () => {
  it('a warning, open, naming what was not checked — never an auto-resolved info line', () => {
    const v = playtestNotRunVerdict('no game surface (canvas) on the page.');
    expect(v).toMatchObject({ code: 'GAME_PLAYTEST_NOT_RUN', severity: 'warning', autoResolved: false, score: null });
    expect(v.message).toBe('The game was never played — no game surface (canvas) on the page. Nothing here shows that it is playable: its controls, its speed and its camera were not checked in a browser.');
    expect(playtestVerdict(parsePlaytest('crashed\n'), DRIVING).severity).toBe('warning');
  });

  it('it is our instrument, not a fix to sell: never offered as a suggestion', () => {
    expect(buildFindingSuggestions([{ code: 'GAME_PLAYTEST_NOT_RUN', severity: 'warning', autoResolved: false, message: 'The game was never played — x.' }])).toEqual([]);
  });
});
