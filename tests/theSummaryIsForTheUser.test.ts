import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 🔴 Autopsy 4d538ca3: the user's final summary ended "No further tools needed." — the model answering
 * our own rule ("Do not call any tool in that final turn") in the one message the user reads. The reply
 * streams to the chat as it is written, so the only place this can be prevented is the instruction.
 */
describe('the final summary is written to the user', () => {
  const prompt = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
  it('the end-of-turn rule says who reads the summary, and forbids talk about tools', () => {
    expect(prompt).toContain('That summary is read by the USER');
    expect(prompt).toContain('never');
    expect(prompt).toMatch(/about tools, turns or this instruction/);
  });
});
