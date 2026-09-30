// Autopsy 12c642ed (2026-09-30). The fast lane's plan step had 90 s. The first rung waited the whole
// 60 s silence window for a first byte that never came; the next rung got 30 s — too little to plan an
// app — and the lane produced nothing. A deadline-bound call with a next rung now waits at most a third
// of its time for the first answer.
import { describe, it, expect, afterEach } from 'vitest';
import { firstAnswerBoundMs, FIRST_ANSWER_FLOOR_MS } from '../src/server/AgentV3/turnDeadline';
import { OpenAiToolRunner, type OpenAiChatClient } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('the rule', () => {
  it('🔴 the report: a 90 s step waits 30 s for the first rung, not 60', () => {
    expect(firstAnswerBoundMs(60_000, 90_000, 'deadline', true)).toBe(30_000);
  });
  it('never below the floor', () => {
    expect(firstAnswerBoundMs(60_000, 20_000, 'deadline', true)).toBe(FIRST_ANSWER_FLOOR_MS);
  });
  it('a long step keeps the ordinary silence window', () => {
    expect(firstAnswerBoundMs(60_000, 1_500_000, 'deadline', true)).toBe(60_000);
  });
  it('the last rung is never cut short — a slow answer beats none', () => {
    expect(firstAnswerBoundMs(60_000, 90_000, 'deadline', false)).toBe(60_000);
  });
  it('a call bounded by the provider\'s own ceiling is unchanged', () => {
    expect(firstAnswerBoundMs(60_000, 90_000, 'configured', true)).toBe(60_000);
  });
});

describe('the runner applies it', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  const hung = (): OpenAiChatClient => ({ chat: { completions: { create: () => new Promise(() => {}) } } } as unknown as OpenAiChatClient);
  const params = (over: Record<string, unknown>) => ({ model: 'glm-4.7-flashx', system: 's', messages: [{ role: 'user' as const, content: 'plan' }], tools: [], ...over });

  it('a silent rung with a next rung is given up on at a third of the step', async () => {
    process.env.AGENTV3_STREAM_BUILD_CALLS = 'on';
    process.env.AGENTV3_STREAM_IDLE_MS = '60000';
    const t0 = Date.now();
    // 45 s of step → 15 s first-answer wait (the floor). The call must end by then, not at 45 s.
    await expect(new OpenAiToolRunner(hung(), { model: 'glm-4.7-flashx' }).runTurn(params({ deadlineAt: t0 + 45_000, hasNextRung: true }) as never))
      .rejects.toThrow(/timed out after 15000ms/);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 30_000);
});

describe('the ladder says whether a next rung exists', () => {
  it('passes hasNextRung to every rung', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/providers/MultiProviderTurnRunner.ts'), 'utf8');
    expect(src).toContain('...params, canAbandonSlowStream, hasNextRung: i + 1 < chain.length,');
  });
});
