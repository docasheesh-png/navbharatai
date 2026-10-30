/**
 * Game Engine Ultra Phase 4 (2026-10-30): the game benchmark corpus is made of REAL prompts already in this repo,
 * every one a game, and the bench reads its game readings from the build's own diagnostics — never invents them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateBenchFixture, selectBenchPrompts } from '../src/server/AgentV3/reliability/benchHarness';
import { benchFixtureFile, gameSignalsFromEvents, gameFailClass, summarizeGameBench } from '../src/server/AgentV3/reliability/gameBench';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';

const raw = JSON.parse(readFileSync('scripts/fixtures/game-bench-prompts.json', 'utf8'));
const fx = validateBenchFixture(raw);

describe('the corpus', () => {
  it('has exactly 44 prompts, 14 in the smoke set', () => {
    expect(fx.prompts).toHaveLength(44);
    expect(selectBenchPrompts(fx, 'smoke')).toHaveLength(14);
  });
  it('every prompt is still in the repo file it was taken from', () => {
    for (const p of raw.prompts as Array<{ prompt: string; source: string }>) {
      expect(existsSync(p.source), p.source).toBe(true);
      expect(readFileSync(p.source, 'utf8').includes(p.prompt), `${p.source}: ${p.prompt}`).toBe(true);
    }
  });
  it('every prompt is a game to the platform\'s own classifier or the contract', () => {
    const notGame = fx.prompts.filter((p) => analyzeRequirementGaps(p.prompt).domain !== 'game' && buildGameContract(p.prompt).genre === 'unknown');
    // 🔎 FINDING (Phase 4, 2026-10-30): the Hindi word "khel" (game) is recognised by neither
    // RequirementGapAnalyzer nor the Phase 1 contract, so this real prompt is not classified as a game.
    // Kept in the corpus ON PURPOSE — the bench should measure it. Remove from this list when fixed.
    expect(notGame.map((p) => p.prompt)).toEqual(['ek car wala khel banao']);
  });
  it('covers 2D, 3D, DOM (quiz/board/card/puzzle) games and Hinglish', () => {
    const genres = new Set(fx.prompts.map((p) => buildGameContract(p.prompt).genre));
    for (const g of ['racing', 'quiz', 'board', 'puzzle', 'shooter', 'platformer']) expect(genres.has(g as never), g).toBe(true);
    expect(fx.prompts.some((p) => buildGameContract(p.prompt).dimension === '3d')).toBe(true);
    expect(fx.prompts.some((p) => p.lang === 'hinglish')).toBe(true);
  });
});

describe('fixture selection', () => {
  it('defaults to the reliability corpus; game is opt-in; anything else is refused', () => {
    expect(benchFixtureFile(undefined)).toBe('fixtures/reliability-bench-prompts.json');
    expect(benchFixtureFile('game')).toBe('fixtures/game-bench-prompts.json');
    expect(() => benchFixtureFile('../etc/passwd')).toThrow();
  });
});

describe('readings come only from the build\'s own diagnostics', () => {
  const result = (issues: Array<{ code: string; message?: string }>) => [{ type: 'result', ok: true, diagnostics: { issues } }];
  it('reads playtest, GQS, defects, scope, repair, gate', () => {
    const g = gameSignalsFromEvents(result([
      { code: 'GAME_KIT_SEEDED' },
      { code: 'GAME_PLAYTEST_ISSUES', message: 'Game Quality Score 42/100 (C) — played in a real browser' },
      { code: 'GAME_DEFECTS', message: 'Game defects measured: GAME_DEFECT_INPUT_IGNORED — x; GAME_DEFECT_NO_TOUCH — y.' },
      { code: 'GAME_SCOPE_GAP' }, { code: 'GAME_REPAIR_UNREPAIRED' }, { code: 'GAME_COMPLETE_GATE_BLOCKED' },
    ]));
    expect(g).toEqual({ kitSeeded: true, playtest: 'failed', gqs: 42, defects: ['GAME_DEFECT_INPUT_IGNORED', 'GAME_DEFECT_NO_TOUCH'], scope: 'gap', repair: 'unrepaired', gateBlocked: true });
  });
  it('nothing recorded → nothing claimed', () => {
    expect(gameSignalsFromEvents([])).toEqual({ kitSeeded: null, playtest: null, gqs: null, defects: [], scope: null, repair: null, gateBlocked: false });
  });
  it('fail classes, worst first', () => {
    const ok = { success: true, metrics: { ok: true, filesCreated: 5, errored: false } };
    const g = gameSignalsFromEvents(result([{ code: 'GAME_PLAYTEST_OK' }]));
    expect(gameFailClass({ ...ok, failure: 'HTTP 500' }, g)).toBe('transport');
    expect(gameFailClass({ success: false, metrics: { ok: false, filesCreated: 3, errored: false } }, g)).toBe('build-failed');
    expect(gameFailClass(ok, { ...g, defects: ['GAME_DEFECT_BLANK'] })).toBe('not-playable');
    expect(gameFailClass(ok, { ...g, scope: 'gap' })).toBe('scope-gap');
    expect(gameFailClass(ok, null)).toBe('not-played');
    expect(gameFailClass(ok, g)).toBe('ok');
  });
  it('the summary counts only reported time and cost, with n', () => {
    const s = summarizeGameBench([
      { seconds: 10, realCostUsd: null, cls: 'ok', game: null },
      { seconds: null, realCostUsd: 0.5, cls: 'not-played', game: null },
    ]);
    expect(s.seconds).toEqual({ n: 1, total: 10 });
    expect(s.realCostUsd).toEqual({ n: 1, total: 0.5 });
    expect(s.gqs).toEqual({ n: 0, mean: null });
  });
});

describe('the runner', () => {
  it('a dry run lists the game corpus and starts no build', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/agentv3-reliability-bench.ts'], {
      env: { ...process.env, BENCH_FIXTURE: 'game', BENCH_POWER_LEVEL: 'weak', BENCH_SET: 'full', BENCH_CONFIRM: '', BENCH_BASE_URL: 'http://localhost:1' },
      encoding: 'utf8', timeout: 60_000,
    });
    expect(out).toContain('Game bench');
    expect(out).toContain('44 prompts');
    expect(out).toContain('DRY RUN (no build started)');
  }, 70_000);
});
