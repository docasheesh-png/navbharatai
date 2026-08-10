import { describe, it, expect } from 'vitest';
import {
  deleteMessage, editMessage, canEditMessage, repliesTo, editedLabel,
  withinEditWindow, EDIT_WINDOW_MS, type ChatMsgLike,
} from '../src/lib/chatMessageActions';
import {
  VOICE_PAISE_PER_SECOND, voiceCostInr, voiceRupeesPerMinute, voiceConsent,
  voiceRunningCostLabel, formatVoiceDuration, voiceChatEnabled,
} from '../src/lib/voiceChatBilling';

/**
 * ADMIN 2026-08-10: "sabhi AI's ke input ka acche cheezein utha kar best input box banao, aur wahi
 * sabhi jagah laga do" — delete a sent message everywhere, plus WhatsApp-style edit; and voice chat
 * as a paid feature on every AI, with the price shown in the user's own language first.
 *
 * These are the DECISIONS, isolated from any screen: what delete and edit actually mean in a chat
 * with an AI, and what the user is charged and told. The rules must be identical on all four AIs, so
 * they live in one place and are proven here rather than re-implemented per surface.
 */

const msgs = (): ChatMsgLike[] => ([
  { id: 'u1', sender: 'user', text: 'build me a todo app' },
  { id: 'a1', sender: 'ai', text: 'here is your todo app' },
  { id: 'a2', sender: 'ai', text: 'and I added dark mode' },
  { id: 'u2', sender: 'user', text: 'now add login' },
  { id: 'a3', sender: 'ai', text: 'login added' },
]);

describe('DELETE — the answers to a deleted question go with it', () => {
  /**
   * A chat with an AI is not WhatsApp: every reply is an answer TO something. Leaving the replies
   * behind produces a transcript where the assistant answers a question nobody asked — worse than the
   * message the user wanted gone.
   */
  it('removes the message AND its replies, up to the next user message', () => {
    expect(deleteMessage(msgs(), 'u1').map((m) => m.id)).toEqual(['u2', 'a3']);
  });

  it('leaves the rest of the conversation completely alone', () => {
    expect(deleteMessage(msgs(), 'u2').map((m) => m.id)).toEqual(['u1', 'a1', 'a2']);
  });

  it('will not delete the ASSISTANT\'s words — that is not the user\'s text to remove', () => {
    expect(deleteMessage(msgs(), 'a1').map((m) => m.id)).toEqual(msgs().map((m) => m.id));
    expect(canEditMessage(msgs(), 'a1')).toBe(false);
    expect(canEditMessage(msgs(), 'u1')).toBe(true);
    expect(canEditMessage(msgs(), 'nope')).toBe(false);
  });

  it('an unknown id changes nothing, and junk never throws', () => {
    expect(deleteMessage(msgs(), 'ghost')).toHaveLength(5);
    expect(deleteMessage([], 'x')).toEqual([]);
    expect(deleteMessage(undefined as any, 'x')).toEqual([]);
  });

  it('repliesTo stops at the next user message, never runs to the end', () => {
    expect(repliesTo(msgs(), 0)).toBe(3); // a1, a2 belong to u1
    expect(repliesTo(msgs(), 3)).toBe(5); // a3 belongs to u2
  });
});

describe('EDIT — rewind to that point, because the user wants a different ANSWER', () => {
  it('the new text stands and everything after it is dropped, ready to be re-asked', () => {
    const r = editMessage(msgs(), 'u1', 'build me a notes app');
    expect(r.messages.map((m) => m.id)).toEqual(['u1']);
    expect(r.messages[0].text).toBe('build me a notes app');
    expect(r.resend).toBe('build me a notes app');
  });

  it('the edit is MARKED — the history never pretends the original was never sent', () => {
    expect(editMessage(msgs(), 'u1', 'something else').messages[0].edited).toBe(true);
    expect(editedLabel('en')).toBe('edited');
    expect(editedLabel('hi')).toBe('बदला गया');
  });

  it('changing NOTHING is a no-op — opening the editor must not cost the conversation', () => {
    const r = editMessage(msgs(), 'u1', '  build me a todo app  ');
    expect(r.messages).toHaveLength(5);
    expect(r.resend).toBe('');
    expect(r.messages[0].edited).toBeUndefined();
  });

  it('emptying a message is a DELETE — that is what emptying means everywhere else', () => {
    const r = editMessage(msgs(), 'u1', '   ');
    expect(r.messages.map((m) => m.id)).toEqual(['u2', 'a3']);
    expect(r.resend).toBe('');
  });

  it('an assistant message cannot be edited', () => {
    expect(editMessage(msgs(), 'a1', 'rewrite what I was told').resend).toBe('');
    expect(editMessage(msgs(), 'a1', 'rewrite').messages).toHaveLength(5);
  });

  it('the window is generous but not unlimited — a build already changed real files', () => {
    const now = 1_000_000;
    expect(withinEditWindow(now - 60_000, now)).toBe(true);
    expect(withinEditWindow(now - EDIT_WINDOW_MS - 1, now)).toBe(false);
    expect(withinEditWindow(now + 5_000, now)).toBe(false); // a future timestamp is not "recent"
    expect(withinEditWindow(NaN, now)).toBe(false);
  });
});

describe('VOICE — the money, and what the user reads before spending any of it', () => {
  it('the confirmed rate is 2 paise/sec, and ₹/min is DERIVED from it (they cannot drift)', () => {
    expect(VOICE_PAISE_PER_SECOND).toBe(2);
    expect(voiceRupeesPerMinute()).toBeCloseTo(1.2, 5);
  });

  it('the charge is exact and never rounded UP', () => {
    expect(voiceCostInr(1)).toBeCloseTo(0.02, 5);
    expect(voiceCostInr(60)).toBeCloseTo(1.2, 5);
    expect(voiceCostInr(95)).toBeCloseTo(1.9, 5);
    // Whole seconds only — you cannot use half a second of a call.
    expect(voiceCostInr(1.9)).toBeCloseTo(0.02, 5);
  });

  it('a call that never started costs NOTHING — no minimum fee', () => {
    expect(voiceCostInr(0)).toBe(0);
    expect(voiceCostInr(-5)).toBe(0);
    expect(voiceCostInr(NaN)).toBe(0);
  });

  it('the popup says the same rate the wallet will actually charge', () => {
    for (const lang of ['en', 'hi'] as const) {
      const c = voiceConsent(lang);
      expect(c.body).toContain(String(VOICE_PAISE_PER_SECOND));
      expect(c.body).toContain('1.2');       // the per-minute figure people think in
      expect(c.title.length).toBeGreaterThan(5);
      expect(c.confirm.length).toBeGreaterThan(2);
      expect(c.cancel.length).toBeGreaterThan(2);
    }
  });

  it('Hindi is WRITTEN, not transliterated English (the admin asked for exactly that)', () => {
    const hi = voiceConsent('hi');
    expect(hi.title).toMatch(/[ऀ-ॿ]/);
    expect(hi.body).toMatch(/[ऀ-ॿ]/);
    expect(hi.confirm).toMatch(/[ऀ-ॿ]/);
    // …and it is not the English string with Devanagari letters bolted on.
    expect(hi.body).not.toContain('paise per second');
  });

  it('the consent explains WHEN charging starts and stops, and that it is one balance', () => {
    expect(voiceConsent('en').body).toMatch(/only while the call is connected/i);
    expect(voiceConsent('en').body).toMatch(/same balance/i);
    expect(voiceConsent('hi').body).toMatch(/कॉल जुड़ती है/);
    expect(voiceConsent('hi').body).toMatch(/बैलेंस/);
  });

  it('names no vendor — a consent popup is the most user-facing surface there is', () => {
    for (const lang of ['en', 'hi'] as const) {
      const c = voiceConsent(lang);
      const all = `${c.title} ${c.body} ${c.confirm} ${c.cancel}`;
      expect(all).not.toMatch(/\b(sonic|nova|amazon|aws|bedrock|openai|gemini|claude|anthropic|elevenlabs)\b/i);
    }
  });

  it('the live meter shows BOTH time and money — a number alone tells the user nothing', () => {
    expect(voiceRunningCostLabel(90)).toBe('1 min 30 sec · ₹1.80');
    expect(voiceRunningCostLabel(90, 'hi')).toBe('1 मिनट 30 सेकंड · ₹1.80');
    expect(formatVoiceDuration(45)).toBe('45 sec');
    expect(formatVoiceDuration(120)).toBe('2 min');
    expect(formatVoiceDuration(0)).toBe('0 sec');
  });

  it('has a kill switch, project convention', () => {
    expect(voiceChatEnabled({})).toBe(true);
    expect(voiceChatEnabled({ VITE_VOICE_CHAT: 'off' })).toBe(false);
    expect(voiceChatEnabled({ VOICE_CHAT: ' OFF ' })).toBe(false);
  });
});
