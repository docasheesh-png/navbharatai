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
    // ENGLISH ONLY (admin 2026-09-14) — the Hindi label was removed.
    expect(editedLabel()).toBe('edited');
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
    const c = voiceConsent();
    expect(c.body).toContain(String(VOICE_PAISE_PER_SECOND));
    expect(c.title.length).toBeGreaterThan(5);
    expect(c.confirm.length).toBeGreaterThan(2);
    expect(c.cancel.length).toBeGreaterThan(2);
  });

  it('🔴 the price is GENERATED, never typed — a hardcoded rate becomes a lie the day it changes', () => {
    // This matters more now that the body is a single number shown in red: there is nothing else on
    // the card for a reader to cross-check it against.
    expect(voiceConsent(7).body).toContain('7');
    expect(voiceConsent(7).body).not.toContain(String(VOICE_PAISE_PER_SECOND));
  });

  it('🔴 the body is ONE SHORT LINE, because the long one was not being read', () => {
    /**
     * Admin 2026-09-12: "user bina padhe hi start kar deta hai". The card used to carry three
     * sentences of true, useful information that informed nobody. A wall of text nobody reads is
     * worse consent than one line everybody reads — so this pins the shortness itself, and a future
     * edit that quietly grows the card back has to delete this test to do it.
     */
    const body = voiceConsent().body;
    expect(body.length).toBeLessThanOrEqual(40);
    expect(body).not.toContain('.');   // not a sentence — a price
  });

  it('🔴 the card is ENGLISH — the admin caught it in Devanagari on his own phone (2026-09-14)', () => {
    // "ui me professional language (english only) honi chahiye … south india wale kaise padhenge
    // isko??" This SUPERSEDES the 2026-08-10 "user ki language me ek popup aaye": the card states a
    // PRICE, and a price a Tamil or Telugu speaker cannot read is not consent.
    const c = voiceConsent();
    expect(JSON.stringify(c)).not.toMatch(/[\u0900-\u097F]/);
    expect(c.body).toMatch(/paise per second/);
  });

  it('WHEN charging starts and stops is shown by the LIVE METER, not by the card', () => {
    /**
     * This test used to assert that the consent card explained it in words. That explanation was
     * REMOVED on 2026-09-12, deliberately — not lost. Showing somebody the meter while they talk is
     * worth far more than telling them, before they start, that a meter exists; and the card's three
     * sentences were the reason nobody read the price either.
     *
     * So the claim is re-pointed at where the information actually lands now. It is not weakened:
     * the meter must still show BOTH the time and the money.
     */
    expect(voiceRunningCostLabel(30)).toContain('₹');
    expect(voiceRunningCostLabel(30)).toMatch(/sec|min/);
    // ENGLISH ONLY (admin 2026-09-14) — the meter had a Hindi form too.
    expect(voiceRunningCostLabel(30)).not.toMatch(/[\u0900-\u097F]/);
    // And the title still tells the user, before anything starts, that this costs money.
    expect(voiceConsent().title.toLowerCase()).toContain('paid');
  });

  it('names no vendor — a consent popup is the most user-facing surface there is', () => {
    const c = voiceConsent();
    const all = `${c.title} ${c.body} ${c.confirm} ${c.cancel}`;
    expect(all).not.toMatch(/\b(sonic|nova|amazon|aws|bedrock|openai|gemini|claude|anthropic|elevenlabs)\b/i);
  });

  it('the live meter shows BOTH time and money — a number alone tells the user nothing', () => {
    expect(voiceRunningCostLabel(90)).toBe('1 min 30 sec · ₹1.80');
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
