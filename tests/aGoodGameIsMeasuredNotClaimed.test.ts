/**
 * 🌟 A GOOD GAME IS MEASURED, NOT CLAIMED (S4, admin 2026-11-24: "aapke suggestion ke anusar"). "Playable" (75) was the only
 * bar, and a game was never judged on how it FEELS, whether it PROGRESSES, or how it LOOKS. Three new dimensions are measured
 * in the real browser — feel (key → first motion), progression (a round played to see the score or level move), visual
 * (colours and edges at 96×54) — and "good" (GOOD_SCORE 88) is said only when every condition is measured and met. A run
 * measured only on the old seven dimensions scores exactly what it scored before.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import {
  DIMENSION_WEIGHTS, GOOD_SCORE, PLAYTEST_BUDGET_MS, PROGRESS_PLAY_MS, gamePlaytestConfig, gamePlaytestModule, isGoodGame, parsePlaytest,
  playtestVerdict, scorePlaytest, type PlaytestRun,
} from '../src/server/AgentV3/gamePlaytest';
import { PLAYTEST_RESERVE_MS } from '../src/server/AgentV3/buildPhases/buildHeadroom';

const replay = { progress: true, restart: true };
/** An old run: everything the seven dimensions read, nothing the new three need. */
const OLD: PlaytestRun = {
  ok: true, spread: 30, brightness: 120, idle: 0.6, fps: 50, errorCount: 0,
  moves: [{ label: 'right', change: 4 }, { label: 'up', change: 4 }, { label: 'space', change: 4 }],
  touch: 3, touchIdle: 0.2, touchControls: 2, touchSurface: true,
};
const OLD_WEIGHTS = { runs: 20, responds: 25, mobile: 15, stable: 15, replay: 10, smooth: 10, alive: 5 };

describe('the score', () => {
  it('🔒 an old run scores exactly what the old weights gave it (the old seven are kept in proportion)', () => {
    const s = scorePlaytest(OLD, replay);
    const old = Object.entries(OLD_WEIGHTS).reduce((t, [d, w]) => t + (s.dimensions as any)[d] * w, 0) / 100;
    expect(s.overall).toBe(Math.round(old));
    expect(s.notMeasured).toEqual(['feel', 'progression', 'visual']);
    expect(Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    for (const [d, w] of Object.entries(OLD_WEIGHTS)) expect((DIMENSION_WEIGHTS as any)[d]).toBeCloseTo(w * 0.8, 6);
    // and its message does not name the new dimensions it never measured
    expect(playtestVerdict(OLD, replay).message).not.toMatch(/Feel|Progress|Looks/);
  });
  it('🔴 feel, progression and visual are scored when measured', () => {
    const s = scorePlaytest({ ...OLD, feelMs: 80, progression: { start: { score: 0, level: 1 }, end: { score: 30, level: 1 }, ms: 4000, advanced: true }, looks: { colors: 60, edges: 0.09 } }, replay);
    expect(s.dimensions.feel).toBe(100);
    expect(s.dimensions.progression).toBe(100);
    expect(s.dimensions.visual).toBe(100);
    expect(s.notMeasured).toBeUndefined();
    expect(scorePlaytest({ ...OLD, feelMs: 250 }, replay).dimensions.feel).toBe(50);
    expect(scorePlaytest({ ...OLD, feelMs: 500 }, replay).dimensions.feel).toBe(0);
    expect(scorePlaytest({ ...OLD, feelMs: -1 }, replay).notMeasured).toContain('feel'); // never "slow" on a probe that saw nothing
    expect(scorePlaytest({ ...OLD, looks: { colors: 3, edges: 0 } }, replay).dimensions.visual).toBeLessThan(10);
  });
});

describe('"good" is said only when it is measured', () => {
  const GOODRUN: PlaytestRun = { ...OLD, feelMs: 60, progression: { start: { score: 0, level: 1 }, end: { score: 30, level: 1 }, ms: 3000, advanced: true }, looks: { colors: 80, edges: 0.1 } };
  it('🔴 every condition met → "A good game"; a playable game that is not good is never called good', () => {
    const v = playtestVerdict(GOODRUN, replay);
    expect(v.code).toBe('GAME_PLAYTEST_OK');
    expect(v.score!.overall).toBeGreaterThanOrEqual(GOOD_SCORE);
    expect(v.message.startsWith('A good game — ')).toBe(true);
    expect(playtestVerdict(OLD, replay).message.startsWith('A good game')).toBe(false);                    // progression never measured
    expect(playtestVerdict({ ...GOODRUN, progression: { ...GOODRUN.progression!, advanced: false } }, replay).message.startsWith('A good game')).toBe(false);
    expect(isGoodGame(playtestVerdict(GOODRUN, replay).score!, [{ verdict: 'not-held' }])).toBe(false);   // a named rule broke
  });
  it('a measured zero on a new dimension never makes a game unplayable (they decide "good", not "playable")', () => {
    expect(playtestVerdict({ ...GOODRUN, progression: { ...GOODRUN.progression!, advanced: false } }, replay).code).toBe('GAME_PLAYTEST_OK');
  });
  it('the playtest has the time to play a round: 90 s, 45 s of it for progression, 125 s held back', () => {
    expect(PLAYTEST_BUDGET_MS).toBe(90_000);
    expect(PROGRESS_PLAY_MS).toBe(45_000);
    expect(PLAYTEST_RESERVE_MS).toBe(125_000);
    expect(gamePlaytestConfig('http://x').progressMs).toBe(45_000);
  });
});

/** A colourful canvas game whose score rises on Space, exposing the kit's hook. */
const PAGE = `<!doctype html><html><body style="margin:0"><canvas id="c" style="display:block;width:100vw;height:100vh"></canvas><script>
const c = document.getElementById('c'); const g = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
let score = 0, status = 'playing', x = 100;
addEventListener('keydown', (e) => { if (e.code === 'Space') score += 5; if (e.code === 'ArrowRight') x += 20; });
window.__nbKit = { status: () => status, score: () => score, endRound: () => { status = 'gameover'; } };
function frame(t) {
  for (let i = 0; i < 12; i++) { g.fillStyle = 'hsl(' + (i * 30) + ',70%,50%)'; g.fillRect((i * c.width) / 12, 0, c.width / 12, c.height); }
  g.fillStyle = '#fff'; g.fillRect(x % c.width, 200 + Math.sin(t / 300) * 50, 80, 80);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const BROWSERS = '/opt/pw-browsers';
const haveBrowser = existsSync(PW) && existsSync(BROWSERS);

describe.skipIf(!haveBrowser)('🔴 in a real browser: the round is played and its progress and looks are measured', () => {
  let server: http.Server; let base = '';
  beforeAll(async () => {
    server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));
  it('progression advanced (the score rose while it was played) and the picture is colourful', async () => {
    const dir = makeTempDir('nbai-playtest-good-');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, gamePlaytestModule(gamePlaytestConfig(base + '/'), `import playwright from '${PW}';\nconst { chromium } = playwright;`));
    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((res, rej) => execFile(process.execPath, [file], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS }, timeout: 150_000 }, (e, o) => (e ? rej(e) : res(o))));
    const run = parsePlaytest(stdout);
    expect(run.ok).toBe(true);
    expect(run.progression?.advanced).toBe(true);
    expect(run.looks!.colors).toBeGreaterThanOrEqual(12);
    expect(run.feelMs ?? null).toBeNull(); // a 2D canvas has no scene to time
    expect(scorePlaytest(run, replay).dimensions.progression).toBe(100);
  }, 200_000);
});
