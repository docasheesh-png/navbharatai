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

const PAGES: Record<string, string> = {
  '/race': racer({ accelerates: true }),
  '/race-stalled': racer({ accelerates: false }),
  '/no-start': racer({ accelerates: true, title: 'how-only' }),
  '/two-screens': racer({ accelerates: true, title: 'two-screens' }),
  '/div-start': racer({ accelerates: true, title: 'div-start' }),
  // Q-865: two WORKING games the first look used to call stalled.
  '/race-countdown': racer({ accelerates: true, countdownOnGas: true }),
  '/race-slow': racer({ accelerates: true, topSpeed: 0.0012 }),
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
