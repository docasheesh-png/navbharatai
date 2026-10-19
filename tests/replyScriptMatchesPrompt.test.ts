// Session 67d5ba74: a Bengali-script prompt was answered in romanized Bengali.
import { describe, it, expect } from 'vitest';
import { languageInstruction } from '../src/server/AgentV3/IndicLanguage';
import { detectLanguageHint } from '../src/server/AgentV3/LanguageDetect';

describe('reply script matches the prompt script', () => {
  it('a native-script prompt is told to reply in native script, not Roman letters', () => {
    const h = detectLanguageHint('আমার জন্য একটা ফাইটিং গেম বানাও');
    expect(h?.code).toBe('bn');
    const s = languageInstruction({ code: 'bn', name: 'Bengali', evidence: 'script' });
    expect(s).toMatch(/native script/);
    expect(s).toMatch(/never transliterated into Roman\/Latin/);
  });
  it('a romanized prompt still gets a Roman-letter reply (unchanged)', () => {
    expect(languageInstruction({ code: 'bn', name: 'Bengali', evidence: 'romanized' })).toMatch(/in Roman letters the way they wrote/);
  });
});
