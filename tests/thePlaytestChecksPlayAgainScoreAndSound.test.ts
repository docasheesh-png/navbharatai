// THE PLAYTEST CHECKS PLAY AGAIN, THE SCORE AND THE SOUND (admin 2026-11-19 game-gap audit, P0 #3: "playtest never
// checks game over, restart, score or audio"). These run the REAL playtest module in a REAL Chromium against small games
// that expose the kit's window.__nbKit hook: one whose Play again works and which plays a sound, one with no play-again
// control at all, and one whose button does nothing. The verdict must say which is which, and the defects must name it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { gamePlaytestModule, gamePlaytestConfig, parsePlaytest, playtestVerdict, playtestDefects, replayFromCode, type PlaytestRun } from '../src/server/AgentV3/gamePlaytest';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

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


/** The kit's hook, as Game.ts writes it, plus an end screen the probe must find (or not). */
function kitGame(end: 'works' | 'none' | 'dead', sound: boolean): string {
  const page = game({ keys: true, pointer: true });
  const hook = `<script>
let status = 'playing', score = 0;
addEventListener('keydown', (e) => { if (e.code === 'Space') score += 10; });
${sound ? `addEventListener('keydown', (e) => { if (e.code !== 'Space') return; const a = new AudioContext(); const o = a.createOscillator(); o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.05); });` : ''}
const over = document.createElement('div'); over.style.cssText = 'position:fixed;inset:0;display:none;place-items:center;background:rgba(0,0,0,.6)';
document.body.appendChild(over);
window.__nbKit = { status: () => status, score: () => score, endRound: () => {
  status = 'gameover'; over.style.display = 'grid';
  ${end === 'none' ? `over.innerHTML = '<h2 style="color:#fff">Game over</h2>';` : `over.innerHTML = '<button id="again" style="padding:16px 32px;font-size:20px">Play again</button>';`}
  ${end === 'works' ? `document.getElementById('again').onclick = () => { status = 'playing'; over.style.display = 'none'; };` : ''}
} };
</script>`;
  return page.replace('</body>', hook + '</body>');
}

const PAGES: Record<string, string> = {
  '/works': kitGame('works', true),
  '/no-button': kitGame('none', false),
  '/dead-button': kitGame('dead', true),
  '/plain': game({ keys: true, pointer: true }),
};

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe('the kit exposes the hook the probe reads', () => {
  it('Game.ts writes window.__nbKit with status, score and endRound, and removes it on dispose', () => {
    const game = generateGameShell().files['src/game/Game.ts'];
    expect(game).toMatch(/__nbKit = hook/);
    expect(game).toMatch(/endRound: \(\) => \{ if \(state\.status === 'playing' \|\| state\.status === 'paused'\) setStatus\('gameover'\); \}/);
    expect(game).toMatch(/if \(w\.__nbKit === hook\) delete w\.__nbKit/);
  });
  it('code facts: a game that plays sound is known, a silent one is not', () => {
    expect(replayFromCode({ 'src/game/shooter/main.ts': "audio.play('shoot');" }).sound).toBe(true);
    expect(replayFromCode({ 'src/game/shooter/main.ts': 'const x = 1;', 'src/game/fx/audio.ts': 'audio.play(x)' }).sound).toBeUndefined();
  });
  it('defects: RESTART_BROKEN for no control or a dead one; SILENT only for a game whose code plays sound and played none', () => {
    const base: PlaytestRun = { ok: true };
    expect(playtestDefects({ ...base, restartCheck: { ended: 'gameover', pressed: null, after: 'gameover' } }, null).map((d) => d.code)).toEqual(['GAME_DEFECT_RESTART_BROKEN']);
    expect(playtestDefects({ ...base, restartCheck: { ended: 'gameover', pressed: 'Play again', after: 'gameover' } }, null)[0].evidence).toMatch(/stayed "gameover"/);
    expect(playtestDefects({ ...base, restartCheck: { ended: 'gameover', pressed: 'Play again', after: 'playing' } }, null)).toEqual([]);
    expect(playtestDefects({ ...base, sounds: 0 }, null, [], { progress: true, restart: true, sound: true }).map((d) => d.code)).toEqual(['GAME_DEFECT_SILENT']);
    expect(playtestDefects({ ...base, sounds: 0 }, null, [], { progress: true, restart: true })).toEqual([]);
    expect(playtestDefects({ ...base, sounds: null }, null, [], { progress: true, restart: true, sound: true })).toEqual([]);
  });
});

describe.skipIf(!haveBrowser)('🔴 in a real browser: play again is pressed, the score and the sounds are counted', () => {
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
    const dir = makeTempDir('nbai-playtest-again-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, gamePlaytestModule(gamePlaytestConfig(base + path), `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 150_000 }, (e, o) => (e ? rej(e) : res(o))));
    runs[path] = parsePlaytest(stdout);
    return runs[path];
  }

  it('a working Play again is found, pressed and proven; the score rose and sounds were played', async () => {
    const run = await play('/works');
    expect(run.ok).toBe(true);
    expect(run.restartCheck).toEqual({ ended: 'gameover', pressed: 'Play again', after: 'playing' });
    expect(run.kitScoreEnd!).toBeGreaterThan(run.kitScoreStart!);
    expect(run.sounds!).toBeGreaterThan(0);
    const v = playtestVerdict(run, { progress: true, restart: true, sound: true });
    expect(v.message).toContain('Play again works ("Play again")');
    expect(v.message).toMatch(/Score \d+ → \d+ while played/);
    expect(playtestDefects(run, v.score, [], { progress: true, restart: true, sound: true })).toEqual([]);
  }, 200_000);
  it('no play-again control after the round ended is RESTART_BROKEN', async () => {
    const run = await play('/no-button');
    expect(run.restartCheck).toMatchObject({ ended: 'gameover', pressed: null });
    expect(playtestDefects(run, null).map((d) => d.code)).toContain('GAME_DEFECT_RESTART_BROKEN');
    expect(playtestVerdict(run, { progress: true, restart: true }).message).toContain('Play again did NOT start a new round');
  }, 200_000);
  it('a play-again button that does nothing is RESTART_BROKEN, with the label it pressed', async () => {
    const run = await play('/dead-button');
    expect(run.restartCheck).toMatchObject({ ended: 'gameover', pressed: 'Play again', after: 'gameover' });
    expect(playtestDefects(run, null)[0]).toMatchObject({ code: 'GAME_DEFECT_RESTART_BROKEN' });
  }, 200_000);
  it('a game without the kit hook is not probed (no restartCheck), and its sounds are still counted', async () => {
    const run = await play('/plain');
    expect(run.restartCheck).toBeUndefined();
    expect(run.sounds).toBe(0);
  }, 200_000);
});
