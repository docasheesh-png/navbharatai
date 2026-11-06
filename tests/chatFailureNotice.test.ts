import { describe, it, expect } from 'vitest';
import { chatFailureNotice, CHAT_FAILURE_TEXT } from '../src/lib/chatFailureNotice';

describe('chat failure notice gives a specific, trust-building reason', () => {
  it('daily limit uses the server text, else asks to login', () => {
    expect(chatFailureNotice({ code: 'FREE_ANSWER_DAILY_LIMIT', serverText: 'Aaj ka limit khatam' }).text).toBe('Aaj ka limit khatam');
    expect(chatFailureNotice({ code: 'FREE_ANSWER_DAILY_LIMIT' }).text).toMatch(/login/i);
  });
  it('wallet empty → insufficient balance', () => {
    expect(chatFailureNotice({ status: 402 }).reason).toBe('INSUFFICIENT_BALANCE');
    expect(chatFailureNotice({ status: 402, code: 'WALLET_INSUFFICIENT', serverText: 'Recharge karein' }).text).toBe('Recharge karein');
  });
  it('429 → slow down, 401 → login again, offline → check internet', () => {
    expect(chatFailureNotice({ status: 429 }).reason).toBe('RATE_LIMIT');
    expect(chatFailureNotice({ status: 401 }).text).toMatch(/login/i);
    expect(chatFailureNotice({ offline: true, networkError: true }).reason).toBe('OFFLINE');
  });
  it('provider/5xx/unknown → high server load, never raw text from an untrusted code', () => {
    expect(chatFailureNotice({ status: 503 }).text).toBe(CHAT_FAILURE_TEXT.HIGH_LOAD);
    expect(chatFailureNotice({ code: 'PROVIDER_X', serverText: 'openrouter 500 key=abc' }).text).toBe(CHAT_FAILURE_TEXT.HIGH_LOAD);
    expect(chatFailureNotice({ networkError: true }).reason).toBe('HIGH_LOAD');
  });
});
