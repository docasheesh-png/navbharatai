// failedbr #1153 (2026-11-20): GLM's closing think-tag reached the user — "Ab type errors fix kar raha hoon.</think>".
import { describe, expect, it } from 'vitest';
import { parseOpenAiCompletion, withoutThinkTags } from '../src/server/AgentV3/providers/OpenAiToolAdapter';

describe('a think-tag never reaches the user (failedbr #1153)', () => {
  it('a stray closing tag is removed and the words kept', () => {
    expect(withoutThinkTags('Ab type errors fix kar raha hoon.</think>')).toBe('Ab type errors fix kar raha hoon.');
  });
  it('a whole think block is reasoning and goes', () => {
    expect(withoutThinkTags('<think>plan the files first</think>Writing App.tsx now.')).toBe('Writing App.tsx now.');
  });
  it('the parser applies it to every answer', () => {
    const r = parseOpenAiCompletion({ choices: [{ message: { role: 'assistant', content: 'Fixing the types.</think>' }, finish_reason: 'stop' }] } as never);
    expect(JSON.stringify(r)).not.toContain('think>');
    expect(JSON.stringify(r)).toContain('Fixing the types.');
  });
  it('text without the tag is untouched', () => {
    expect(withoutThinkTags('I will think about <b>it</b>')).toBe('I will think about <b>it</b>');
  });
});
