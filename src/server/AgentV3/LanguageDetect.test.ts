import { describe, it, expect } from 'vitest';
import { detectLanguageHint } from './LanguageDetect';

describe('detectLanguageHint', () => {
  it('detects a Hindi (Devanagari) prompt as Hindi', () => {
    const hint = detectLanguageHint('एक टू-डू ऐप बनाओ जिसमें लॉगिन हो');
    expect(hint).not.toBeNull();
    expect(hint?.name).toBe('Hindi');
    expect(hint?.code).toBe('hi');
  });

  it('detects a Tamil prompt as Tamil', () => {
    const hint = detectLanguageHint('உள்நுழைவுடன் ஒரு பணி பட்டியல் செயலியை உருவாக்கு');
    expect(hint?.name).toBe('Tamil');
    expect(hint?.code).toBe('ta');
  });

  it('detects a Bengali prompt as Bengali', () => {
    const hint = detectLanguageHint('লগইন সহ একটি টু-ডু অ্যাপ তৈরি করো');
    expect(hint?.name).toBe('Bengali');
    expect(hint?.code).toBe('bn');
  });

  it('returns null for an English prompt (Latin script is ambiguous)', () => {
    expect(detectLanguageHint('build a to-do app with login and a dashboard')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(detectLanguageHint('')).toBeNull();
  });

  it('returns null for a mostly-English prompt with one stray Devanagari word', () => {
    const hint = detectLanguageHint(
      'build a to-do app with login and a dashboard called काम, with charts and tables',
    );
    expect(hint).toBeNull();
  });

  it('detects an Arabic prompt as Arabic/Urdu', () => {
    const hint = detectLanguageHint('أنشئ تطبيق قائمة مهام مع تسجيل الدخول');
    expect(hint?.name).toBe('Arabic/Urdu');
    expect(hint?.code).toBe('ar');
  });

  it('detects a Japanese (kana) prompt as Japanese', () => {
    const hint = detectLanguageHint('ログインできるとどリストアプリをつくって');
    expect(hint?.name).toBe('Japanese');
    expect(hint?.code).toBe('ja');
  });
});
