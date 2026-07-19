import { describe, it, expect } from 'vitest';
import {
  loadBetaState, saveBetaState, shouldUseLlm, buildLlmMessages, LLM_SYSTEM_PROMPT, OFFLINE_BETA_KEY,
} from './offlineBeta';
import type { ChatReply } from './offlineChat';

function mkStore() {
  const bag: Record<string, string> = {};
  return { bag, getItem: (k: string) => bag[k] ?? null, setItem: (k: string, v: string) => { bag[k] = v; } };
}

const reply = (over: Partial<ChatReply>): ChatReply => ({ text: '', features: [], deviceMatches: [], online: false, ...over });

describe('offlineBeta — on-device LLM state + routing (default off, honest)', () => {
  it('defaults to disabled and round-trips state', () => {
    const s = mkStore();
    expect(loadBetaState(s).enabled).toBe(false);
    saveBetaState({ enabled: true, modelId: 'Qwen2.5-0.5B' }, s);
    expect(loadBetaState(s)).toEqual({ enabled: true, modelId: 'Qwen2.5-0.5B' });
  });

  it('load is corruption-safe (bad/again-shaped data → disabled)', () => {
    const s = mkStore();
    s.bag[OFFLINE_BETA_KEY] = 'not json';
    expect(loadBetaState(s).enabled).toBe(false);
    s.bag[OFFLINE_BETA_KEY] = JSON.stringify({ enabled: 'yes' });
    expect(loadBetaState(s).enabled).toBe(false);
  });

  it('routes to the LLM ONLY when beta is ready and the deterministic engine had no confident answer', () => {
    expect(shouldUseLlm(reply({ online: true }), true)).toBe(true);   // gap + ready → LLM
    expect(shouldUseLlm(reply({ online: true }), false)).toBe(false); // gap but beta off → no
    expect(shouldUseLlm(reply({ online: false }), true)).toBe(false); // deterministic answered → no LLM
    expect(shouldUseLlm(reply({ online: false, features: [{} as any] }), true)).toBe(false);
  });

  it('builds LLM messages: system first (with taught facts), recent turns, question last', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ role: (i % 2 ? 'bot' : 'user') as 'user' | 'bot', text: `t${i}` }));
    const msgs = buildLlmMessages('what should i cook', turns, ['wifi is NB@1234', 'my name → Aashish'], 6);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain(LLM_SYSTEM_PROMPT);
    expect(msgs[0].content).toContain('wifi is NB@1234');
    // last 6 turns + the new question
    expect(msgs.length).toBe(1 + 6 + 1);
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'what should i cook' });
    // a 'bot' turn maps to assistant
    expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('system prompt is white-labelled and honest (no vendor/model name, admits it can be wrong)', () => {
    expect(LLM_SYSTEM_PROMPT).toMatch(/navbharatai/i);
    expect(LLM_SYSTEM_PROMPT).not.toMatch(/\b(qwen|llama|gemma|openai|gpt|claude|gemini|mistral)\b/i);
    expect(LLM_SYSTEM_PROMPT).toMatch(/unsure|honest|small model/i);
  });
});
