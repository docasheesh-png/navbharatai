import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStickyState, escalateSticky, groupStart, isClaudeRung, nextDistinctModel, recordStickySuccess, stickyChainKey, stickyStartIndex } from './stickyRung';
import { makeMultiProviderTurnRunner, createBuildBenchRegistry, sharedRateLimitCooldowns, type NamedRunner } from '../providers/MultiProviderTurnRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';

const WEAK = [
  { name: 'GLM', modelId: 'glm-4.7-flashx' },
  { name: 'GLM#2', reportAs: 'GLM', modelId: 'glm-4.7-flashx' },
  { name: 'KIMI', modelId: 'kimi-k2.7-code' },
  { name: 'GLM', modelId: 'glm-5.3' },
  { name: 'CLAUDE_HAIKU', modelId: 'claude-haiku-4-5' },
];

describe('stickyRung — pure helpers', () => {
  it('groups a key pool as one model', () => {
    expect(groupStart(WEAK, 1)).toBe(0);
    expect(stickyChainKey(WEAK).split('>')).toHaveLength(4);
  });

  it('starts at 0 until something is recorded, then sticks to the answering model group (upward only)', () => {
    const st = createStickyState();
    expect(stickyStartIndex(st, WEAK)).toBe(0);
    recordStickySuccess(st, WEAK, 2, true);
    expect(stickyStartIndex(st, WEAK)).toBe(2);
    recordStickySuccess(st, WEAK, 0, true); // a lower rung answering never pulls the start down
    expect(stickyStartIndex(st, WEAK)).toBe(2);
  });

  it('remember:false records the last rung but never moves the start', () => {
    const st = createStickyState();
    recordStickySuccess(st, WEAK, 2, false);
    expect(stickyStartIndex(st, WEAK)).toBe(0);
  });

  it('escalates to the next DISTINCT model (skips other keys of the same pool)', () => {
    const st = createStickyState();
    recordStickySuccess(st, WEAK, 0, false);
    const out = escalateSticky(st);
    expect(out).toMatchObject({ escalated: true, fromModel: 'glm-4.7-flashx', toModel: 'kimi-k2.7-code' });
    expect(stickyStartIndex(st, WEAK)).toBe(2);
    expect(st.escalations).toBe(1);
  });

  it('noClaude: a weak build is NEVER escalated onto a Claude rung', () => {
    const st = createStickyState();
    recordStickySuccess(st, WEAK, 3, true); // on glm-5.3, only Haiku is above
    const out = escalateSticky(st, { noClaude: true });
    expect(out.escalated).toBe(false);
    expect(stickyStartIndex(st, WEAK)).toBe(3);
    expect(nextDistinctModel(WEAK, 3, (r) => !isClaudeRung(r))).toBe(-1);
  });

  it('refuses honestly when nothing has answered yet', () => {
    expect(escalateSticky(createStickyState()).escalated).toBe(false);
  });

  it('isClaudeRung recognises every Claude family name', () => {
    expect(isClaudeRung({ name: 'CLAUDE_HAIKU' })).toBe(true);
    expect(isClaudeRung({ name: 'X', modelId: 'claude-sonnet-4-6' })).toBe(true);
    expect(isClaudeRung({ name: 'KIMI', modelId: 'kimi-k2.7-code' })).toBe(false);
  });
});

function ok(text: string): TurnResult {
  return { text, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [{ type: 'text', text }] };
}
const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

describe('MultiProviderTurnRunner + sticky', () => {
  beforeEach(() => sharedRateLimitCooldowns.reset());

  function chain(): { chain: NamedRunner[]; a: TurnRunner; b: TurnRunner } {
    let aCalls = 0;
    const a: TurnRunner = { runTurn: vi.fn(async () => { aCalls += 1; if (aCalls === 1) throw new Error('500 internal server error'); return ok('a'); }) };
    const b: TurnRunner = { runTurn: vi.fn(async () => ok('b')) };
    return { chain: [{ name: 'GLM', runner: a, modelId: 'glm-4.7-flashx' }, { name: 'KIMI', runner: b, modelId: 'kimi-k2.7-code' }], a, b };
  }

  it('without sticky (default) every turn re-opens at rung 0', async () => {
    const { chain: c, a } = chain();
    const r = makeMultiProviderTurnRunner(c, { cooldowns: undefined });
    expect((await r.runTurn(PARAMS)).text).toBe('b');
    expect((await r.runTurn(PARAMS)).text).toBe('a');
    expect(a.runTurn).toHaveBeenCalledTimes(2);
  });

  it('with sticky.remember the build stays on the rung that answered', async () => {
    const { chain: c, a } = chain();
    const bench = createBuildBenchRegistry();
    const r = makeMultiProviderTurnRunner(c, { bench, sticky: { remember: true } });
    expect((await r.runTurn(PARAMS)).text).toBe('b');
    expect((await r.runTurn(PARAMS)).text).toBe('b');
    expect(a.runTurn).toHaveBeenCalledTimes(1);
  });

  it('an escalation on the shared bench moves the next turn up', async () => {
    const a: TurnRunner = { runTurn: vi.fn(async () => ok('a')) };
    const b: TurnRunner = { runTurn: vi.fn(async () => ok('b')) };
    const bench = createBuildBenchRegistry();
    const r = makeMultiProviderTurnRunner([{ name: 'GLM', runner: a, modelId: 'glm-4.7-flashx' }, { name: 'KIMI', runner: b, modelId: 'kimi-k2.7-code' }], { bench, sticky: { remember: false } });
    expect((await r.runTurn(PARAMS)).text).toBe('a');
    expect(escalateSticky(bench.sticky!, { noClaude: true }).escalated).toBe(true);
    expect((await r.runTurn(PARAMS)).text).toBe('b');
  });
});
