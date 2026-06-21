import { describe, it, expect } from 'vitest';
import { detectLanguage, languageDirective } from '../src/server/Guider/LanguageDetect';

describe('detectLanguage', () => {
  it('returns "en" for plain English text', () => {
    expect(detectLanguage('Build a todo app with authentication')).toBe('en');
  });

  it('returns "hi" for Devanagari script text', () => {
    expect(detectLanguage('मुझे एक todo app बनानी है')).toBe('hi');
  });

  it('returns "hinglish" when at least 2 Hinglish markers are present', () => {
    // 'kya' and 'karo' are both markers
    expect(detectLanguage('kya yeh karo please')).toBe('hinglish');
  });

  it('returns "en" for an empty string', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('returns "en" for a whitespace-only string', () => {
    expect(detectLanguage('   ')).toBe('en');
  });

  it('detects Bengali script', () => {
    expect(detectLanguage('আমার একটা অ্যাপ দরকার')).toBe('bn');
  });

  it('does not classify single Hinglish word as hinglish (needs ≥ 2 hits)', () => {
    // only one marker → falls back to 'en'
    expect(detectLanguage('karo please the build')).toBe('en');
  });
});

describe('languageDirective', () => {
  it('gives a Hindi instruction for "hi"', () => {
    expect(languageDirective('hi')).toContain('Hindi');
  });

  it('gives a Hinglish instruction for "hinglish"', () => {
    expect(languageDirective('hinglish')).toContain('Hinglish');
  });

  it('gives an English instruction for unknown language codes', () => {
    expect(languageDirective('xx')).toContain('English');
  });

  it('gives a Bengali instruction for "bn"', () => {
    expect(languageDirective('bn')).toContain('Bengali');
  });
});
