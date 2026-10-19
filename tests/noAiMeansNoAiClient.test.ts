// r6–r10 autopsy (2026-10-18): "AI ALREADY WIRED via src/lib/ai.ts" was added on the bare word "AI" even when the
// user said no API / offline. A negated AI request must not get the AI client.
import { describe, it, expect } from 'vitest';
import { laneAiClient, NO_AI_RE } from '../src/server/AgentV3/SimpleBuilder';

const on = { APP_AI_GATEWAY: 'on' } as unknown as NodeJS.ProcessEnv;

describe('no AI means no AI client', () => {
  it('negated prompts get no client', () => {
    for (const p of [
      'simple notes app, no AI, no API, works offline',
      'expense tracker without AI',
      'quiz app — bina API ke, AI nahi chahiye',
      'an offline flashcards app (AI not needed)',
      "habit tracker, don't use any API",
    ]) expect(laneAiClient(p, 'vite-react', on), p).toBeNull();
  });
  it('real AI requests still get it', () => {
    for (const p of ['a personal finance app that automatically categorises expenses using AI', 'AI chatbot for my shop']) {
      expect(laneAiClient(p, 'vite-react', on)?.path, p).toBe('src/lib/ai.ts');
    }
  });
  it('does not misfire on ordinary words', () => {
    for (const p of ['know your API rate limits app', 'notes app with AI summaries']) expect(NO_AI_RE.test(p), p).toBe(false);
  });
  it('kill switch restores the old behaviour', () => {
    expect(laneAiClient('notes app, no AI', 'vite-react', { ...on, AGENTV3_LANE_AI_NEGATION: 'off' } as never)?.path).toBe('src/lib/ai.ts');
  });
});
