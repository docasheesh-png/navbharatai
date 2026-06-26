import { describe, it, expect, vi } from 'vitest';
import { makeMultiProviderTurnRunner, forceModelRunner, type NamedRunner } from './MultiProviderTurnRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../ClaudeClient';

const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

function ok(text: string): TurnResult {
  return { text, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [{ type: 'text', text }] };
}
function runnerOk(text: string): TurnRunner {
  return { runTurn: vi.fn().mockResolvedValue(ok(text)) };
}
function runnerFail(msg: string): TurnRunner {
  return { runTurn: vi.fn().mockRejectedValue(new Error(msg)) };
}

describe('makeMultiProviderTurnRunner', () => {
  it('uses the first (cheapest) provider when it succeeds and does not call the rest', async () => {
    const grok = runnerOk('from grok');
    const claude = runnerOk('from claude');
    const used: string[] = [];
    const chain: NamedRunner[] = [
      { name: 'GROK', runner: grok },
      { name: 'CLAUDE', runner: claude },
    ];
    const runner = makeMultiProviderTurnRunner(chain, { onProviderUsed: (u) => used.push(u) });
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('from grok');
    expect(used).toEqual(['GROK']);
    expect(claude.runTurn).not.toHaveBeenCalled();
  });

  it('falls through to the Claude backstop when cheaper providers throw', async () => {
    const vertex = runnerFail('vertex 500');
    const grok = runnerFail('grok 429');
    const claude = runnerOk('claude saved it');
    const fellBack: string[][] = [];
    const errors: string[] = [];
    const runner = makeMultiProviderTurnRunner(
      [
        { name: 'VERTEX', runner: vertex },
        { name: 'GROK', runner: grok },
        { name: 'CLAUDE', runner: claude },
      ],
      { onProviderUsed: (_u, fb) => fellBack.push(fb), onProviderError: (n) => errors.push(n) },
    );
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('claude saved it');
    expect(errors).toEqual(['VERTEX', 'GROK']);
    expect(fellBack).toEqual([['VERTEX', 'GROK']]);
  });

  it('throws an aggregated error only when EVERY provider (incl. backstop) fails', async () => {
    const runner = makeMultiProviderTurnRunner([
      { name: 'GROK', runner: runnerFail('grok down') },
      { name: 'CLAUDE', runner: runnerFail('claude down') },
    ]);
    await expect(runner.runTurn(PARAMS)).rejects.toThrow(/All v3.0 providers failed \(GROK → CLAUDE\).*claude down/);
  });

  it('works with a single backstop runner', async () => {
    const runner = makeMultiProviderTurnRunner([{ name: 'CLAUDE', runner: runnerOk('solo') }]);
    expect((await runner.runTurn(PARAMS)).text).toBe('solo');
  });

  it('throws if constructed with an empty chain', () => {
    expect(() => makeMultiProviderTurnRunner([])).toThrow(/at least one runner/);
  });
});

describe('forceModelRunner (P7 — fixed-model Haiku backstop)', () => {
  it('overrides params.model with the forced model, leaving other params intact', async () => {
    const captured: RunTurnParams[] = [];
    const inner: TurnRunner = { runTurn: vi.fn(async (p: RunTurnParams) => { captured.push(p); return ok('haiku reply'); }) };
    const forced = forceModelRunner(inner, 'claude-haiku-4-5');
    const res = await forced.runTurn(PARAMS); // PARAMS.model === 'm'
    expect(res.text).toBe('haiku reply');
    expect(captured[0].model).toBe('claude-haiku-4-5'); // forced, not 'm'
    expect(captured[0].messages).toBe(PARAMS.messages); // everything else passed through
  });

  it('serves as a working final backstop when the primary Claude model fails', async () => {
    // Vertex + Gemini + primary Claude all throw; the forced-Haiku backstop completes the turn.
    const haikuInner: TurnRunner = { runTurn: vi.fn(async (p: RunTurnParams) => ok(`done on ${p.model}`)) };
    const chain: NamedRunner[] = [
      { name: 'GEMINI', runner: runnerFail('gemini down') },
      { name: 'CLAUDE', runner: runnerFail('sonnet overloaded') },
      { name: 'CLAUDE_HAIKU', runner: forceModelRunner(haikuInner, 'claude-haiku-4-5') },
    ];
    const runner = makeMultiProviderTurnRunner(chain);
    const res = await runner.runTurn(PARAMS);
    expect(res.text).toBe('done on claude-haiku-4-5'); // backstop ran on the forced model
  });
});
