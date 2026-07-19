import { describe, it, expect } from 'vitest';
import { buildChatReply, teachAck, CHAT_WELCOME } from './offlineChat';
import { addMemory, parseTeaching, type UserMemory } from './offlineMemory';

describe('offlineChat — deterministic conversational replies (bot-like, never invents facts)', () => {
  it('replies to a math question with the real result', () => {
    const r = buildChatReply('what is 15% of 200');
    expect(r.answerKind).toBe('math');
    expect(r.text).toContain('30');
    expect(r.online).toBe(false);
  });

  it('replies with the date from an injected clock', () => {
    const r = buildChatReply('what is the date', new Date('2026-07-18T06:04:00'));
    expect(r.answerKind).toBe('datetime');
    expect(r.text).toContain('Saturday');
  });

  it('greets conversationally', () => {
    expect(buildChatReply('hi').text.length).toBeGreaterThan(0);
    expect(buildChatReply('hi').answerKind).toBe('greeting');
  });

  it('a greeting is TEXT ONLY — no feature/phone cards dumped under it (regression: "hi" wall of cards)', () => {
    for (const q of ['hi', 'namaste', 'thank you', 'who are you', '2+2', 'what is the date']) {
      const r = buildChatReply(q);
      expect(r.answerKind, `"${q}" is a deterministic answer`).toBeTruthy();
      expect(r.features, `"${q}" must not show feature cards`).toEqual([]);
      expect(r.deviceMatches, `"${q}" must not show phone cards`).toEqual([]);
    }
  });

  it('answers an app-navigation question with feature cards (no online needed)', () => {
    const r = buildChatReply('how do i deploy');
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.online).toBe(false);
  });

  it('answers a phone-settings problem with device help cards', () => {
    const r = buildChatReply('wifi not working');
    expect(r.deviceMatches.some((d) => d.id === 'wifi_not_connecting')).toBe(true);
    expect(r.online).toBe(false);
  });

  it('recalls what the user taught, verbatim', () => {
    let mem: UserMemory[] = [];
    mem = addMemory(mem, parseTeaching('when I ask my name answer Aashish')!, 'a', 1);
    const r = buildChatReply('my name', new Date(), mem);
    expect(r.answerKind).toBe('memory');
    expect(r.text).toBe('Aashish');
  });

  it('honestly points online for open-knowledge — never fabricates or shows a misleading card', () => {
    for (const q of ['who is the prime minister', 'qwlkjh zxcvb mnbvcx']) {
      const r = buildChatReply(q);
      expect(r.online, `"${q}"`).toBe(true);
      expect(r.features).toEqual([]);     // no misleading weak-match card
      expect(r.deviceMatches).toEqual([]);
      expect(r.text).toMatch(/internet|online/i);
    }
  });

  it('only shows a feature card when the match is keyword-strong (confident)', () => {
    // "how do i deploy" is a strong keyword match → confident feature answer.
    expect(buildChatReply('how do i deploy').features.length).toBeGreaterThan(0);
    // a bare weak graze does not surface a card.
    expect(buildChatReply('who is the prime minister').features).toEqual([]);
  });

  it('teachAck confirms both fact and Q→A teaching', () => {
    expect(teachAck({ kind: 'fact', text: 'buy milk' })).toMatch(/remember/i);
    expect(teachAck({ kind: 'qa', trigger: 'my name', text: 'Aashish' })).toContain('my name');
  });

  it('has a non-empty welcome line', () => {
    expect(CHAT_WELCOME.length).toBeGreaterThan(10);
  });
});
