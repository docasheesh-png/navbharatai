import { describe, it, expect, afterEach } from 'vitest';
import { clearReasoningStore, modelAcceptsReasoningPassback, reasoningStoreSize } from './reasoningPassback';
import { parseOpenAiCompletion, transcriptToOpenAI } from '../providers/OpenAiToolAdapter';

const completion = {
  choices: [{
    message: { role: 'assistant', content: null, reasoning_content: 'plan: write App first', tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'write_file', arguments: '{"path":"a.ts","content":"x"}' } }] },
    finish_reason: 'tool_calls',
  }],
};

describe('reasoning passback (AGENTV3_REASONING_PASSBACK)', () => {
  afterEach(() => { delete process.env.AGENTV3_REASONING_PASSBACK; clearReasoningStore(); });

  it('OFF (default): nothing is stored and nothing is attached', () => {
    const turn = parseOpenAiCompletion(completion);
    expect(reasoningStoreSize()).toBe(0);
    const msgs = transcriptToOpenAI([{ role: 'assistant', content: turn.rawContent }], undefined, { reasoningPassback: true });
    expect(msgs[0].reasoning_content).toBeUndefined();
  });

  it('ON: the reasoning comes back on the assistant message that made the tool call', () => {
    process.env.AGENTV3_REASONING_PASSBACK = 'on';
    const turn = parseOpenAiCompletion(completion);
    // The transcript itself stays Anthropic-valid: no reasoning block in rawContent.
    expect(JSON.stringify(turn.rawContent)).not.toContain('plan: write App first');
    const msgs = transcriptToOpenAI([{ role: 'assistant', content: turn.rawContent }], undefined, { reasoningPassback: true });
    expect(msgs[0].reasoning_content).toBe('plan: write App first');
    // …but only when the caller says the target model reads it.
    expect(transcriptToOpenAI([{ role: 'assistant', content: turn.rawContent }])[0].reasoning_content).toBeUndefined();
  });

  it('only Kimi / GLM models get the field', () => {
    expect(modelAcceptsReasoningPassback('kimi-k2.7-code')).toBe(true);
    expect(modelAcceptsReasoningPassback('glm-5.3')).toBe(true);
    expect(modelAcceptsReasoningPassback('grok-4')).toBe(false);
    expect(modelAcceptsReasoningPassback('claude-haiku-4-5')).toBe(false);
  });
});
