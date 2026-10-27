import { describe, expect, it } from 'vitest';
import { CHAT_REPLY_LANGUAGE_NAMES, chatReplyLanguageFromPicker, type ChatReplyLanguage } from '../src/lib/chatReplyLanguage';
import { chatAvailabilityMessage } from '../src/server/lib/chatAvailabilityMessage';

describe('safe availability notices follow the conversation reply language', () => {
  it('maps only supported legacy picker choices without mutating settings', () => {
    expect(chatReplyLanguageFromPicker('hindi')).toBe('hi');
    expect(chatReplyLanguageFromPicker('english')).toBe('en');
    expect(chatReplyLanguageFromPicker('hinglish')).toBe('hinglish');
    for (const value of ['auto', 'ta', '__proto__', null, {}]) expect(chatReplyLanguageFromPicker(value)).toBeUndefined();
  });
  it('uses an explicit Devanagari request even when the question is typed in Hinglish', () => {
    const text = chatAvailabilityMessage('capacity', { message: 'Hindi mein jawab do. Mujhe ek sawal ka jawab chahiye', replyLanguage: 'en' });
    expect(text).toBe(chatAvailabilityMessage('capacity', { replyLanguage: 'hi' }));
    expect(text).toMatch(/अधिक ट्रैफ़िक/);
  });
  it('keeps carried preference ahead of typed language and older history', () => {
    expect(chatAvailabilityMessage('temporary', { message: 'mujhe batao kya hua', history: [{ sender: 'user', text: 'Reply in English' }], replyLanguage: 'ta' }))
      .toBe(chatAvailabilityMessage('temporary', { replyLanguage: 'ta' }));
  });
  it('honors a current per-turn override without persisting an earlier one-turn override', () => {
    const history = [{ sender: 'user', text: 'Reply in Hindi' }, { sender: 'user', text: 'For this answer only, reply in English' }];
    expect(chatAvailabilityMessage('temporary', { message: 'For this answer only, reply in Tamil', history, replyLanguage: 'hi' }))
      .toBe(chatAvailabilityMessage('temporary', { replyLanguage: 'ta' }));
    expect(chatAvailabilityMessage('temporary', { message: 'What next?', history }))
      .toBe(chatAvailabilityMessage('temporary', { replyLanguage: 'hi' }));
  });
  it('does not treat quoted instructions or assistant text as a language selection', () => {
    expect(chatAvailabilityMessage('temporary', { message: 'Translate this: "Reply in Hindi"', history: [{ sender: 'ai', text: 'Reply in Tamil' }], replyLanguage: 'en' }))
      .toBe(chatAvailabilityMessage('temporary'));
  });
  it.each(Object.keys(CHAT_REPLY_LANGUAGE_NAMES) as ChatReplyLanguage[])('has separate bounded notices for selected %s without diagnostic interpolation', language => {
    const input = { replyLanguage: language, message: 'provider-synthetic API-key-synthetic budget-synthetic', error: 'secret-synthetic' };
    const capacity = chatAvailabilityMessage('capacity', input);
    const temporary = chatAvailabilityMessage('temporary', input);
    for (const notice of [capacity, temporary]) {
      expect(notice).toContain('NavBharatAI');
      expect(notice.length).toBeLessThan(350);
      expect(notice).not.toMatch(/provider-synthetic|API-key-synthetic|budget-synthetic|secret-synthetic/);
    }
    expect(temporary).not.toBe(capacity);
  });
  it('uses only neutral copy for unknown failures, and existing input-language fallback when no choice exists', () => {
    expect(chatAvailabilityMessage('temporary')).toBe('NavBharatAI is temporarily unable to respond. Please try again shortly.');
    expect(chatAvailabilityMessage('temporary')).not.toMatch(/traffic|load|busy|API|provider|budget|quota/i);
    expect(chatAvailabilityMessage('capacity', { message: 'mujhe batao kya hua' })).toContain('Zyada traffic');
    expect(chatAvailabilityMessage('temporary', { message: 'क्या हुआ' })).toMatch(/अभी जवाब/);
    expect(chatAvailabilityMessage('temporary', { message: {}, history: {}, replyLanguage: '__proto__' })).toBe(chatAvailabilityMessage('temporary'));
  });
});
