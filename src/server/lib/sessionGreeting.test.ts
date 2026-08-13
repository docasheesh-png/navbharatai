import { describe, it, expect } from 'vitest';
import { isFirstChatTurn, sessionGreetingRule } from './sessionGreeting';

describe('isFirstChatTurn — a session is greeted only on its first message', () => {
  it('the first message (no history) is the first turn', () => {
    expect(isFirstChatTurn(undefined)).toBe(true);
    expect(isFirstChatTurn(null)).toBe(true);
    expect(isFirstChatTurn([])).toBe(true);
    expect(isFirstChatTurn('not-an-array')).toBe(true); // malformed → treat as first, safe
  });

  it('any prior conversation means it is NOT the first turn', () => {
    expect(isFirstChatTurn([{ role: 'user', content: 'hi' }])).toBe(false);
    expect(isFirstChatTurn([{}, {}, {}])).toBe(false);
  });
});

describe('sessionGreetingRule — the firm once-per-session rule', () => {
  it('on the FIRST turn, a single greeting is allowed', () => {
    const rule = sessionGreetingRule(true);
    expect(rule).toContain('FIRST message of the session');
    expect(rule).toContain('a single warm greeting is allowed');
  });

  it('on a LATER turn, greeting again is explicitly forbidden — the "namaste every message" bug', () => {
    const rule = sessionGreetingRule(false);
    expect(rule).toContain('ALREADY greeted');
    expect(rule).toContain('Do NOT greet again');
    expect(rule).toContain('Namaste');
    expect(rule).toContain('राम-राम');
  });

  it('the two turns give different rules (the gate actually switches)', () => {
    expect(sessionGreetingRule(true)).not.toEqual(sessionGreetingRule(false));
  });
});

describe('it is wired into the free-chat prompt', () => {
  const chat = require('fs').readFileSync(require('path').join(__dirname, '../routes/chat.ts'), 'utf8') as string;

  it('the greeting-style hint is gated on the first turn (no re-greeting every reply)', () => {
    expect(chat).toContain('profile?.preferredGreeting && isFirstTurn');
  });

  it('the prompt embeds the once-per-session rule and computes the first turn from history', () => {
    expect(chat).toContain('sessionGreetingRule(isFirstTurn)');
    expect(chat).toContain('buildFreeSystemPrompt(userProfile || undefined, isFirstChatTurn(history))');
  });
});
