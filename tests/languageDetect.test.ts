import { describe, it, expect } from 'vitest';
import { detectLanguage, languageDirective } from '../src/server/Guider/LanguageDetect';

describe('detectLanguage', () => {
  it('returns en for empty string', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('returns hi for Devanagari script', () => {
    expect(detectLanguage('नमस्ते')).toBe('hi');
  });

  it('returns bn for Bengali script', () => {
    expect(detectLanguage('হ্যালো')).toBe('bn');
  });

  it('returns ur for Arabic script', () => {
    expect(detectLanguage('مرحبا')).toBe('ur');
  });

  it('returns hinglish when 2+ marker words found', () => {
    // 'kya' and 'hai' are both HINGLISH_MARKERS
    expect(detectLanguage('kya hal hai')).toBe('hinglish');
  });

  it('returns en when only one marker word found', () => {
    // only 'kya' found — below 2 threshold
    expect(detectLanguage('kya is this')).toBe('en');
  });

  it('returns en for plain English text', () => {
    expect(detectLanguage('Hello world, how are you?')).toBe('en');
  });

  it('returns zh for CJK characters', () => {
    expect(detectLanguage('你好世界')).toBe('zh');
  });
});

describe('languageDirective', () => {
  it('returns Hindi directive for hi', () => {
    expect(languageDirective('hi')).toContain('Hindi');
  });

  it('returns Hinglish directive for hinglish', () => {
    expect(languageDirective('hinglish')).toContain('Hinglish');
  });

  it('returns English directive for unknown language', () => {
    expect(languageDirective('xx')).toContain('English');
  });

  it('returns Bengali directive for bn', () => {
    expect(languageDirective('bn')).toContain('Bengali');
  });

  it('returns Chinese directive for zh', () => {
    expect(languageDirective('zh')).toContain('Chinese');
  });
});
