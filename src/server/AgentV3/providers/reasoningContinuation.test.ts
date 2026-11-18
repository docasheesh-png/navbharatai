import { describe, it, expect } from 'vitest';
import { answerCarriedInReasoning, reasoningContinuationMessages } from './reasoningContinuation';

describe('answerCarriedInReasoning', () => {
  it('lifts a two-file manifest out of a reasoning trace (#2430)', () => {
    const text = answerCarriedInReasoning('I should plan\nsrc/App.tsx :: the screen\nsrc/main.tsx :: the entry');
    expect(text).toBe('src/App.tsx :: the screen\nsrc/main.tsx :: the entry');
  });

  it('does not treat one mentioned path as the plan', () => {
    expect(answerCarriedInReasoning('maybe edit src/App.tsx :: later')).toBeNull();
  });

  it('lifts a file block and ignores the thinking around it', () => {
    const text = answerCarriedInReasoning('thinking\n<<<FILE src/App.tsx>>>\nexport const x = 1\n<<<ENDFILE>>>\nmore thinking');
    expect(text).toContain('<<<FILE src/App.tsx>>>');
    expect(text).toContain('export const x = 1');
  });

  it('the continuation keeps the original request and the reasoning tail', () => {
    const messages = reasoningContinuationMessages([{ role: 'user', content: 'plan the app' }], 'x'.repeat(7_000));
    expect(messages).toHaveLength(3);
    expect((messages[1] as { content: string }).content.length).toBe(6_000);
    expect((messages[2] as { content: string }).content).toMatch(/output only the answer/);
  });
});
