/**
 * 🔴 AUTOPSY 57875eb3 (2026-09-17) — a starved model was retired ONE KEY AT A TIME.
 *
 * The report, by its own timestamps: a Weak-tier car-racing game, 11 files generated in 45 seconds,
 * then a repair pass that never returned. `glm-4.7-flashx` was abandoned for crawling at 29 s;
 * `kimi-k2.7-code` starved its 8,000-token budget once and was retired; then `glm-5.3` starved the
 * same 8,000 tokens THIRTEEN TIMES, ~2 minutes apart, until the 29-minute wall clock stopped the
 * build. `CLAUDE_HAIKU` — the next rung of the ladder, a model that does not reason — was never
 * called. The report's own line said the starved rung was "retired for the rest of this build", and
 * that was true of ONE of the pool's fifty-one keys.
 *
 * The retirement key was `${name}::${model}`, and every key of a pool has a distinct name ('GLM',
 * 'GLM#2', …). This is autopsy 4efab9d7's per-key timeout streak, in its starvation sibling, which
 * that autopsy did not hunt. A starvation is a fact about the MODEL at this ask, never about the key
 * that carried it — so it is now keyed on the provider FAMILY + model, like the throughput bench.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeMultiProviderTurnRunner,
  sharedRateLimitCooldowns,
  type NamedRunner,
} from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { starvedBudgetError, STARVED_BUDGET_MESSAGE } from '../src/server/AgentV3/floorBudget';
import type { RunTurnParams, TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

beforeEach(() => sharedRateLimitCooldowns.reset());

const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'fix the build' }] };

const ok = (text: string): TurnResult => ({
  text, toolUses: [], stopReason: 'end_turn',
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  rawContent: [{ type: 'text', text }],
});
const okRunner = (text: string): TurnRunner => ({ runTurn: vi.fn().mockResolvedValue(ok(text)) });
/** The report's exact failure: the full 8,000-token ask, spent on reasoning, no text, no tool call. */
const starvingRunner = (): TurnRunner => ({ runTurn: vi.fn().mockRejectedValue(starvedBudgetError(8000, 8000)) });
const calls = (r: NamedRunner): number => (r.runner.runTurn as ReturnType<typeof vi.fn>).mock.calls.length;

/** A key pool exactly as the route builds one: first key bare, the rest `NAME#k` reporting as NAME. */
const pool = (family: string, model: string, n: number, make: () => TurnRunner): NamedRunner[] =>
  Array.from({ length: n }, (_, k) => (k === 0
    ? { name: family, runner: make(), modelId: model }
    : { name: `${family}#${k + 1}`, runner: make(), reportAs: family, modelId: model }));

describe('🔴 the report\'s ladder: a 51-key glm-5.3 pool that starves reaches HAIKU after ONE starvation', () => {
  it('one starved call retires the model for every key of the family — not one call per key', async () => {
    const glm53 = pool('GLM', 'glm-5.3', 51, starvingRunner);
    const haiku = okRunner('haiku fixed it');
    const runner = makeMultiProviderTurnRunner([
      { name: 'KIMI', runner: starvingRunner(), modelId: 'kimi-k2.7-code' },
      ...glm53,
      { name: 'CLAUDE_HAIKU', runner: haiku },
    ]);
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('haiku fixed it');
    // THE WHOLE POINT. Before: 13 keys × ~2 min each until the wall clock. Now: exactly one.
    expect(glm53.reduce((n, r) => n + calls(r), 0)).toBe(1);
    expect(haiku.runTurn).toHaveBeenCalledTimes(1);
  });

  it('the retirement holds for the rest of the run — the next turn goes straight past the pool', async () => {
    const glm53 = pool('GLM', 'glm-5.3', 5, starvingRunner);
    const haiku = okRunner('haiku');
    const runner = makeMultiProviderTurnRunner([...glm53, { name: 'CLAUDE_HAIKU', runner: haiku }]);
    await runner.runTurn(PARAMS);
    await runner.runTurn(PARAMS);
    await runner.runTurn(PARAMS);
    expect(glm53.map(calls)).toEqual([1, 0, 0, 0, 0]);
    expect(haiku.runTurn).toHaveBeenCalledTimes(3);
  });

  it('🔒 does not depend on WHICH key starved — a bare first key must not be the only thing making it work', async () => {
    // The route names the first key of a pool bare ('GLM') and the rest 'GLM#k'. A per-key
    // retirement written by the FIRST key coincides with the family key by accident of naming, so a
    // test in which key 1 starves proves nothing. Here key 1 times out (not a retirement), key 2
    // starves, and keys 3..N must still be skipped.
    const build = new Map<string, string>();
    const glm53 = pool('GLM', 'glm-5.3', 6, starvingRunner);
    glm53[0] = { ...glm53[0], runner: { runTurn: vi.fn().mockRejectedValue(new Error('OpenAI-compatible call (GLM/Kimi) timed out after 60000ms')) } };
    const haiku = okRunner('haiku');
    const runner = makeMultiProviderTurnRunner([...glm53, { name: 'CLAUDE_HAIKU', runner: haiku }], { deadRungs: build });
    expect((await runner.runTurn(PARAMS)).text).toBe('haiku');
    expect(glm53.map(calls)).toEqual([1, 1, 0, 0, 0, 0]);
    expect([...build.keys()]).toEqual(['GLM::glm-5.3']); // the family, not 'GLM#2'
  });

  it('holds across the fast lane\'s per-file runners too, through the build\'s shared dead-rung map', async () => {
    // `fastGenerateOnce` builds a NEW runner per file (see tests/fastLaneDeadRungMemory.test.ts); the
    // family key lives in the same caller-owned map, so file B never re-pays file A's starvation on
    // any key of the pool.
    const build = new Map<string, string>();
    const glm53 = pool('GLM', 'glm-5.3', 8, starvingRunner);
    const chain = () => [...glm53, { name: 'CLAUDE_HAIKU', runner: okRunner('h') }];
    await makeMultiProviderTurnRunner(chain(), { deadRungs: build }).runTurn(PARAMS);
    await makeMultiProviderTurnRunner(chain(), { deadRungs: build }).runTurn(PARAMS);
    expect(glm53.reduce((n, r) => n + calls(r), 0)).toBe(1);
    // The memory is keyed on the FAMILY, so the entry does not name any one key.
    expect([...build.keys()]).toEqual(['GLM::glm-5.3']);
  });
});

describe('🔒 what the family key must NOT do', () => {
  it('a starved glm-5.3 never retires a healthy glm-4.7-flashx rung of the SAME family', async () => {
    // The MODEL half of the key is load-bearing: the weak ladder carries two GLM models, and
    // retiring the family would take the cheap opener down with the strong rung.
    const flashx = pool('GLM', 'glm-4.7-flashx', 3, () => okRunner('flashx'));
    const glm53 = pool('GLM', 'glm-5.3', 3, starvingRunner);
    const runner = makeMultiProviderTurnRunner([...glm53, ...flashx, { name: 'CLAUDE_HAIKU', runner: okRunner('h') }]);
    expect((await runner.runTurn(PARAMS)).text).toBe('flashx');
    expect((await runner.runTurn(PARAMS)).text).toBe('flashx');
    expect(glm53.reduce((n, r) => n + calls(r), 0)).toBe(1);
  });

  it('a starvation on one FAMILY never retires the same model id at another vendor', async () => {
    // Two families happen to carry the same model id (a proxy, a resold model). The key names the
    // family, so vendor B still gets its own attempt.
    const a = pool('GLM', 'shared-model', 2, starvingRunner);
    const b = pool('PROXY', 'shared-model', 2, () => okRunner('proxy answered'));
    const runner = makeMultiProviderTurnRunner([...a, ...b, { name: 'CLAUDE_HAIKU', runner: okRunner('h') }]);
    expect((await runner.runTurn(PARAMS)).text).toBe('proxy answered');
    expect(b[0].runner.runTurn).toHaveBeenCalledTimes(1);
  });

  it('a non-pool rung keeps exactly the key it had — its family IS its name', async () => {
    const dead = starvingRunner();
    const build = new Map<string, string>();
    const runner = makeMultiProviderTurnRunner([
      { name: 'KIMI', runner: dead, modelId: 'kimi-k2.7-code' },
      { name: 'CLAUDE_HAIKU', runner: okRunner('h') },
    ], { deadRungs: build });
    await runner.runTurn(PARAMS);
    expect([...build.keys()]).toEqual(['KIMI::kimi-k2.7-code']);
  });

  it('an ACCOUNT-level fatal is unchanged: still per key, still the whole bench name', async () => {
    const build = new Map<string, string>();
    const runner = makeMultiProviderTurnRunner([
      { name: 'GLM', runner: { runTurn: vi.fn().mockRejectedValue(new Error('Your credit balance is too low')) }, modelId: 'glm-5.3' },
      { name: 'CLAUDE_HAIKU', runner: okRunner('h') },
    ], { deadRungs: build });
    await runner.runTurn(PARAMS);
    expect([...build.keys()]).toEqual(['GLM']);
  });

  it('a model-not-found is unchanged: keyed on the key that saw it, not the family', async () => {
    // Deliberately narrower than the starvation key: a pool may span accounts whose model access
    // differs, and re-proving a 404 costs one round-trip, not two minutes of reasoning. Recorded here
    // so the scope of this change is legible, not because the choice is beyond revisiting.
    const build = new Map<string, string>();
    const runner = makeMultiProviderTurnRunner([
      { name: 'KIMI#2', runner: { runTurn: vi.fn().mockRejectedValue(new Error('404 Not found the model kimi-k2.5 or Permission denied')) }, reportAs: 'KIMI', modelId: 'kimi-k2.5' },
      { name: 'CLAUDE_HAIKU', runner: okRunner('h') },
    ], { deadRungs: build });
    await runner.runTurn(PARAMS);
    expect([...build.keys()]).toEqual(['KIMI#2::kimi-k2.5']);
  });

  it('a SUCCESS is never retired, and a timeout is still a timeout, not a starvation', async () => {
    const build = new Map<string, string>();
    const glm = pool('GLM', 'glm-5.3', 2, () => ({ runTurn: vi.fn().mockRejectedValue(new Error('OpenAI-compatible call (GLM/Kimi) timed out after 60000ms')) }));
    const runner = makeMultiProviderTurnRunner([...glm, { name: 'CLAUDE_HAIKU', runner: okRunner('h') }], { deadRungs: build });
    await runner.runTurn(PARAMS);
    expect(build.size).toBe(0); // a timeout lives in the family timeout streak, not the dead-rung map
  });

  it('the report\'s own marker is what the key reacts to — the wording is the contract', () => {
    expect(starvedBudgetError(8000, 8000).message).toContain(STARVED_BUDGET_MESSAGE);
  });
});
