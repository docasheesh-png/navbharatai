import { describe, it, expect } from 'vitest';
import { detectNoticeLang, updateNoticeText, updateNoticeFor } from '../src/lib/updateNoticeI18n';

/**
 * App-update chat notice i18n (admin 2026-07-20: "language wahi ho jo user likh raha ho"). Locks the
 * language detection + localized text so the update prompt always speaks the user's language.
 */

describe('detectNoticeLang', () => {
  it('detects Hindi from Devanagari script', () => {
    expect(detectNoticeLang('मुझे एक ऐप बनाना है')).toBe('hi');
    expect(detectNoticeLang('नमस्ते, कैसे हो?')).toBe('hi');
  });
  it('detects Hinglish from romanized-Hindi marker words', () => {
    expect(detectNoticeLang('mujhe ek app banana hai')).toBe('hinglish');
    expect(detectNoticeLang('yeh kaise karu bhai')).toBe('hinglish');
    expect(detectNoticeLang('theek hai, update karo')).toBe('hinglish');
  });
  it('defaults to English for plain English and empty input', () => {
    expect(detectNoticeLang('build me a todo app with categories')).toBe('en');
    expect(detectNoticeLang('')).toBe('en');
    expect(detectNoticeLang(undefined)).toBe('en');
    expect(detectNoticeLang(null)).toBe('en');
  });
  it('does not misfire Hinglish on an English sentence that merely contains "update"', () => {
    // "update" is an English word too — it must NOT alone trigger Hinglish.
    expect(detectNoticeLang('please update the button color')).toBe('en');
  });
});

describe('updateNoticeText / updateNoticeFor', () => {
  it('returns NavBharatAI-branded, non-empty text with a button for every language', () => {
    for (const lang of ['en', 'hi', 'hinglish'] as const) {
      const t = updateNoticeText(lang);
      expect(t.body).toMatch(/NavBharatAI/);
      expect(t.body.length).toBeGreaterThan(0);
      expect(t.button.length).toBeGreaterThan(0);
    }
  });
  it('the Hindi variant is actually in Devanagari and Hinglish in roman', () => {
    expect(updateNoticeText('hi').button).toMatch(/[ऀ-ॿ]/);
    expect(updateNoticeText('hinglish').button).toMatch(/^[\x00-\x7F]+$/);
  });
  it('updateNoticeFor detects + resolves in one step', () => {
    expect(updateNoticeFor('mujhe update chahiye')).toEqual(updateNoticeText('hinglish'));
    expect(updateNoticeFor('अपडेट')).toEqual(updateNoticeText('hi'));
    expect(updateNoticeFor('hello there')).toEqual(updateNoticeText('en'));
  });
});
