// A GAME IS PLAYED BEFORE IT IS CALLED DONE (admin 2026-10-05 — the "Play → Test → Diagnose" half of the
// game-intelligence brief).
//
// Every browser check this platform had looked at a game the way it looks at a form, so the commonest
// broken game passed all of them: a canvas that paints a lovely scene and ignores every key. These tests
// run the REAL playtest module in a REAL Chromium against small canvas games built to be exactly that
// broken — and one that works — and check the scorecard names the right weakness.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import {
  gamePlaytestModule, gamePlaytestConfig, gamePlaytestScript, parsePlaytest, playtestVerdict, scorePlaytest,
  isCanvasGameProject, replayFromCode, gamePlaytestEnabled, PLAYTEST_RESULT_MARKER, type PlaytestRun,
} from '../src/server/AgentV3/gamePlaytest';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

/** A small canvas game. Each flag removes one thing a real game needs. */
function game(o: { keys?: boolean; pointer?: boolean; crashOnMove?: boolean; still?: boolean; blank?: boolean }): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#000"><canvas id="c" style="display:block;width:100vw;height:100vh;touch-action:none"></canvas><script>
const c = document.getElementById('c'); const g = c.getContext('2d');
const fit = () => { c.width = innerWidth; c.height = innerHeight; }; fit(); addEventListener('resize', fit);
let x = 0.5, y = 0.5, t = 0, vx = 0, vy = 0;
${o.keys ? `const held = new Set(); addEventListener('keydown', (e) => held.add(e.code)); addEventListener('keyup', (e) => held.delete(e.code));` : 'const held = new Set();'}
${o.pointer ? `let drag = null; c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointermove', (e) => { if (!drag) return; x += (e.clientX - drag.x) / innerWidth; y += (e.clientY - drag.y) / innerHeight; drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });` : ''}
function frame() {
  t += 1 / 60;
  vx = (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0) - (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0);
  vy = (held.has('ArrowDown') || held.has('KeyS') ? 1 : 0) - (held.has('ArrowUp') || held.has('KeyW') ? 1 : 0);
  if (held.has('Space')) y -= 0.02;
  ${o.crashOnMove ? `if (vx || vy) { throw new Error('player.velocity is undefined'); }` : ''}
  x = Math.min(0.95, Math.max(0.05, x + vx * 0.012)); y = Math.min(0.95, Math.max(0.05, y + vy * 0.012));
  ${o.blank ? `g.fillStyle = '#123'; g.fillRect(0, 0, c.width, c.height);` : `
  const sky = g.createLinearGradient(0, 0, 0, c.height); sky.addColorStop(0, '#5aa0e6'); sky.addColorStop(1, '#2f6b2f');
  g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; const cx = ${o.still ? '0.3' : '((t * 0.08) % 1.2) - 0.1'} * c.width; g.beginPath(); g.arc(cx, c.height * 0.2, 60, 0, 7); g.fill();
  g.fillStyle = '#d33'; g.fillRect(x * c.width - 60, y * c.height - 60, 120, 120);`}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
}

const PAGES: Record<string, string> = {
  '/good': game({ keys: true, pointer: true }),
  '/deaf': game({}),
  '/keyboard-only': game({ keys: true }),
  '/crash': game({ keys: true, pointer: true, crashOnMove: true }),
  '/blank': game({ keys: true, pointer: true, blank: true }),
  '/no-canvas': '<!doctype html><html><body><h1>Notes</h1><p>Not a game.</p></body></html>',
};

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);
const REPLAY_WIRED = { progress: true, restart: true };

describe.skipIf(!haveBrowser)('the playtest, in a real browser, against games built to be broken', () => {
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
    const dir = makeTempDir('nbai-playtest-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, gamePlaytestModule(gamePlaytestConfig(base + path), `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 120_000 }, (e, o) => (e ? rej(e) : res(o))));
    runs[path] = parsePlaytest(stdout);
    return runs[path];
  }

  it('a game that works scores as playable: it runs, moves, answers the keys, a drag and a thumb', async () => {
    const run = await play('/good');
    const v = playtestVerdict(run, REPLAY_WIRED);
    expect(run.ok).toBe(true);
    expect(v.code).toBe('GAME_PLAYTEST_OK');
    expect(v.score!.dimensions.responds).toBe(100);
    expect(v.score!.dimensions.mobile).toBe(100);
    expect(v.score!.dimensions.stable).toBe(100);
    expect(v.score!.overall).toBeGreaterThanOrEqual(85);
    expect(v.message).toMatch(/^Game Quality Score \d+\/100/);
  }, 150_000);

  it('THE GAP: a game that paints beautifully and ignores every control is caught, and Controls is the weakest', async () => {
    const v = playtestVerdict(await play('/deaf'), REPLAY_WIRED);
    expect(v.code).toBe('GAME_PLAYTEST_ISSUES');
    expect(v.score!.dimensions.runs).toBe(100);
    expect(v.score!.dimensions.responds).toBe(0);
    expect(v.score!.weakest).toBe('responds');
    expect(v.message).toMatch(/did not respond to the arrows\/WASD, Space or a drag/);
  }, 150_000);

  it('a keyboard-only game works on a desktop and is caught on a phone', async () => {
    const v = playtestVerdict(await play('/keyboard-only'), REPLAY_WIRED);
    expect(v.score!.dimensions.responds).toBeGreaterThanOrEqual(85);
    expect(v.score!.dimensions.mobile).toBe(0);
    expect(v.code).toBe('GAME_PLAYTEST_ISSUES');
    expect(v.score!.weakest).toBe('mobile');
  }, 150_000);

  it('a game that throws the moment the player moves is caught as unstable, with the error', async () => {
    const run = await play('/crash');
    const v = playtestVerdict(run, REPLAY_WIRED);
    expect(run.errorCount).toBeGreaterThan(0);
    expect(v.score!.dimensions.stable).toBeLessThan(100);
    expect(v.message).toMatch(/player\.velocity is undefined/);
    expect(v.code).toBe('GAME_PLAYTEST_ISSUES');
  }, 150_000);

  it('a blank, single-colour game screen is caught as not running', async () => {
    const v = playtestVerdict(await play('/blank'), REPLAY_WIRED);
    expect(v.score!.dimensions.runs).toBe(0);
    expect(v.code).toBe('GAME_PLAYTEST_ISSUES');
  }, 150_000);

  it('a page with no game surface is NOT RUN — never a pass', async () => {
    const run = await play('/no-canvas');
    expect(run.ok).toBe(false);
    expect(playtestVerdict(run, REPLAY_WIRED).code).toBe('GAME_PLAYTEST_NOT_RUN');
  }, 150_000);
});

describe('the score is made of measurements', () => {
  const base: PlaytestRun = { ok: true, spread: 30, idle: 0.5, fps: 60, longFrames: 0, moves: [{ label: 'up / W', change: 5 }, { label: 'left / A', change: 4 }, { label: 'Space', change: 3 }], touchControls: 4, touchIdle: 0.4, touch: 3, errorCount: 0 };

  it('replay is read from the code: progress and a restart', () => {
    expect(scorePlaytest(base, { progress: false, restart: false }).dimensions.replay).toBe(0);
    expect(scorePlaytest(base, REPLAY_WIRED).dimensions.replay).toBe(100);
    const files = {
      'src/game/core/meta.ts': 'export function startMeta() {} // play again',
      'src/App.tsx': "import { startMeta } from './game/core/meta'; startMeta({ gameId: 'x' }); <button onClick={() => game.restart()}>Play again</button>",
    };
    expect(replayFromCode(files)).toEqual({ progress: true, restart: true });
    // The meta layer's own file defines startMeta and mentions "play again": defining is not using.
    expect(replayFromCode({ 'src/game/core/meta.ts': files['src/game/core/meta.ts'] })).toEqual({ progress: false, restart: false });
  });

  it('a constantly animated world does not count as "responding": input must change MORE than idle does', () => {
    const busy = { ...base, idle: 6, moves: [{ label: 'up / W', change: 6.5 }, { label: 'Space', change: 5.8 }] };
    expect(scorePlaytest(busy, REPLAY_WIRED).dimensions.responds).toBe(0);
  });

  it('frame rate is graded gently — measured in a software renderer, said so in the message', () => {
    expect(scorePlaytest({ ...base, fps: 20 }, REPLAY_WIRED).dimensions.smooth).toBe(60);
    expect(playtestVerdict({ ...base, fps: 20 }, REPLAY_WIRED).message).toMatch(/20 fps in the build sandbox's software renderer/);
  });

  it('the weakest dimension is the one costing the most points', () => {
    const s = scorePlaytest({ ...base, errorCount: 5 }, { progress: false, restart: true });
    expect(s.weakest).toBe('stable'); // 80 × 15 lost beats 60 × 10 lost
  });

  it('a run that produced nothing is not run, whatever else is known', () => {
    expect(playtestVerdict(parsePlaytest('crashed\n'), REPLAY_WIRED).code).toBe('GAME_PLAYTEST_NOT_RUN');
    expect(parsePlaytest(`noise\n${PLAYTEST_RESULT_MARKER}{"ok":true,"spread":9}\n`).spread).toBe(9);
  });
});

describe('it plays games only, and a finding is offered as a fix', () => {
  it('only a canvas game is played', () => {
    expect(isCanvasGameProject({ 'src/game/Game.ts': 'x' })).toBe(true);
    expect(isCanvasGameProject({ 'src/Pong.tsx': "const g = c.getContext('2d'); requestAnimationFrame(loop);" })).toBe(true);
    expect(isCanvasGameProject({ 'src/App.tsx': 'export default function App() { return <h1>Notes</h1>; }' })).toBe(false);
    expect(isCanvasGameProject({ 'node_modules/three/build/three.module.js': 'requestAnimationFrame <canvas' })).toBe(false);
  });

  it('the shell command writes the module and runs it with the shared run line; the kill switch works', () => {
    const s = gamePlaytestScript('http://localhost:5173/');
    expect(s).toContain("cat > /tmp/nbai-playtest.mjs <<'NBAI_EOF'");
    expect(s).toContain('"base":"http://localhost:5173/"');
    expect(gamePlaytestEnabled({ AGENTV3_GAME_PLAYTEST: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(gamePlaytestEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('GAME_PLAYTEST_ISSUES becomes a one-tap fix; OK and NOT RUN never do', () => {
    const offered = buildFindingSuggestions([{ code: 'GAME_PLAYTEST_ISSUES', severity: 'warning', autoResolved: false, message: 'Game Quality Score 40/100 … Weakest: Controls — The controls do not move anything — wire the arrow keys/WASD, Space and a drag to the player.' }]);
    expect(offered.map((s) => s.title)).toContain('Make the game playable');
    expect(offered[0].prompt).toMatch(/controls do not move anything/);
    expect(buildFindingSuggestions([{ code: 'GAME_PLAYTEST_OK', severity: 'info' }, { code: 'GAME_PLAYTEST_NOT_RUN', severity: 'info' }])).toEqual([]);
  });
});
