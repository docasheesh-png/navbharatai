import { describe, it, expect } from 'vitest';
import { makeResilientTurnRunner, flattenTranscript, type RouterLike } from './agentv3Resilient';
import type { TurnRunner, TurnResult, RunTurnParams } from '../AgentV3';

const baseParams: RunTurnParams = {
  model: 'claude-sonnet-4-6',
  system: 'You are a test agent.',
  messages: [{ role: 'user', content: 'hello' }],
};

function okTurn(text: string): TurnResult {
  return {
    text,
    toolUses: [],
    stopReason: 'end_turn',
    usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    rawContent: [{ type: 'text', text }],
  };
}

describe('makeResilientTurnRunner', () => {
  it('returns the primary (Claude) result when Claude succeeds', async () => {
    const primary: TurnRunner = { runTurn: async () => okTurn('Hi from Claude') };
    const router: RouterLike = { route: async () => ({ response: { content: 'should not be used', provider: 'GROK' } }) };
    const runner = makeResilientTurnRunner(primary, () => router);

    const res = await runner.runTurn(baseParams);
    expect(res.text).toBe('Hi from Claude');
  });

  it('falls back to the multi-provider router and names the provider when Claude fails', async () => {
    const primary: TurnRunner = {
      runTurn: async () => { throw new Error('401 Missing or invalid Authorization header'); },
    };
    const router: RouterLike = { route: async () => ({ response: { content: 'Sab badhiya!', provider: 'GROK' } }) };
    const runner = makeResilientTurnRunner(primary, () => router);

    const res = await runner.runTurn(baseParams);
    // Diagnostic: the reply tells the user which provider answered.
    expect(res.text).toContain('Replied via GROK');
    expect(res.text).toContain('Sab badhiya!');
    // It's a text-only turn so the agent loop ends with a reply (never crashes).
    expect(res.toolUses).toHaveLength(0);
    expect(res.stopReason).toBe('end_turn');
  });

  it('surfaces both failures honestly when even the fallback router fails', async () => {
    const primary: TurnRunner = { runTurn: async () => { throw new Error('claude down'); } };
    const router: RouterLike = { route: async () => { throw new Error('router down'); } };
    const runner = makeResilientTurnRunner(primary, () => router);

    const res = await runner.runTurn(baseParams);
    expect(res.text).toContain('claude down');
    expect(res.text).toContain('router down');
    expect(res.toolUses).toHaveLength(0);
  });
});

describe('flattenTranscript', () => {
  it('flattens string and block content into a labelled prompt', () => {
    const out = flattenTranscript([
      { role: 'user', content: 'build me an app' },
      { role: 'assistant', content: [{ type: 'text', text: 'on it' }] },
      { role: 'user', content: [{ type: 'tool_result', content: 'exit 0' }] },
    ]);
    expect(out).toContain('User: build me an app');
    expect(out).toContain('Assistant: on it');
    expect(out).toContain('[tool result] exit 0');
  });
});
