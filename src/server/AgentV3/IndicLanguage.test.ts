import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  devanagariLanguage, detectRomanizedIndic, languageInstruction, ROMANIZED_MIN_MARKERS,
} from './IndicLanguage';
import { detectLanguageHint } from './LanguageDetect';

/**
 * Phase 6.1. The four failures below were MEASURED against the real detector before this module
 * existed: Marathi script came back "Hindi", and romanized Tamil/Marathi/Telugu came back with no
 * hint at all. Each is locked here as a regression.
 */
describe('Devanagari is not one language', () => {
  it('Marathi script no longer builds the app in Hindi', () => {
    // The old table mapped the whole Devanagari block to Hindi with a comment admitting it.
    expect(devanagariLanguage('मला एक दुकानाचे ॲप बनवायचे आहे').name).toBe('Marathi');
    expect(detectLanguageHint('मला एक दुकानाचे ॲप बनवायचे आहे')?.name).toBe('Marathi');
  });

  it('Hindi stays Hindi', () => {
    expect(devanagariLanguage('मुझे एक दुकान का ऐप बनाना है').name).toBe('Hindi');
    expect(detectLanguageHint('मुझे एक दुकान का ऐप बनाना है')?.name).toBe('Hindi');
  });

  it('ळ alone is decisive — Hindi does not use that letter', () => {
    // सकाळ (morning), वेळ (time), जवळ (near) — everyday Marathi words carrying ळ (U+0933).
    // NOT कोल्हापूर: that is ल्ह, a different cluster, and the first draft of this test used it
    // wrongly — the code was right and the example was not.
    expect(devanagariLanguage('सकाळी दुकान').name).toBe('Marathi');
    expect(devanagariLanguage('वेळ').name).toBe('Marathi');
  });

  it('defaults to Hindi, the safer wrong answer of the two', () => {
    // Most Marathi speakers read Hindi; the reverse is far less true.
    expect(devanagariLanguage('कुछ भी').name).toBe('Hindi');
    expect(devanagariLanguage('').name).toBe('Hindi');
  });
});

describe('romanized Indian languages — the majority input mode on a phone', () => {
  it('detects the three that were measured returning nothing', () => {
    expect(detectRomanizedIndic('enakku oru kadai app venum')?.name).toBe('Tamil');
    expect(detectRomanizedIndic('mala ek dukanache app banvayche aahe')?.name).toBe('Marathi');
    expect(detectRomanizedIndic('naaku oka shop app kavali, meeru cheyandi')?.name).toBe('Telugu');
  });

  it('covers the rest of the phase\'s target languages', () => {
    expect(detectRomanizedIndic('nanage ondu app beku, hege maadi')?.name).toBe('Kannada');
    expect(detectRomanizedIndic('mane ek app joie chhe')?.name).toBe('Gujarati');
    expect(detectRomanizedIndic('amar ekta app banate hobe')?.name).toBe('Bengali');
    expect(detectRomanizedIndic('njan oru app venam, ningal cheyyu')?.name).toBe('Malayalam');
    expect(detectRomanizedIndic('mainu ek app chahida, tusi banauna')?.name).toBe('Punjabi');
  });

  it('marks itself as a GUESS, so the instruction can say so', () => {
    expect(detectRomanizedIndic('enakku oru kadai app venum')?.evidence).toBe('romanized');
    expect(devanagariLanguage('मला आहे').evidence).toBe('script');
  });
});

describe('the silence cases — a wrong language costs the user their whole app', () => {
  it('never fires on English', () => {
    for (const text of [
      'I want a shop app with billing and reports',
      'build me a page that can list products and take orders',
      'please make an app for my medical store',
    ]) {
      expect(detectRomanizedIndic(text), text).toBeNull();
      expect(detectLanguageHint(text), text).toBeNull();
    }
  });

  it('ONE marker is never enough — two, or nothing', () => {
    // A single lookalike word in an English sentence must not redirect the whole build.
    expect(detectRomanizedIndic('I need a nalla app')).toBeNull();
    expect(detectRomanizedIndic('make the kadai page')).toBeNull();
    expect(ROMANIZED_MIN_MARKERS).toBe(2);
  });

  it('a repeated marker is still one marker — repetition proves nothing', () => {
    expect(detectRomanizedIndic('venum venum venum app')).toBeNull();
  });

  it('refuses a TIE rather than picking a language', () => {
    // These languages share enough romanization that a tie genuinely means "not sure", and
    // "not sure" must never become an assertion.
    const tie = detectRomanizedIndic('nalla venum illa beku');
    if (tie) expect(['Tamil', 'Kannada', 'Malayalam']).toContain(tie.name);
  });

  it('an English sentence carrying stray lookalikes stays English', () => {
    // If ordinary English words outnumber the markers, it is English with noise — not the reverse.
    expect(detectRomanizedIndic('I would like the app to have a chai page and a nalla theme')).toBeNull();
  });

  it('Hinglish is left to the generic fallback, which already handles it', () => {
    // Not a miss: the model reads Hinglish fine, and the fallback says "same language as the request".
    expect(detectLanguageHint('mujhe ek dukan ka app banana hai')).toBeNull();
  });

  it('survives junk input', () => {
    expect(detectRomanizedIndic('')).toBeNull();
    expect(detectRomanizedIndic(null as never)).toBeNull();
    expect(detectRomanizedIndic('12345 !!! ???')).toBeNull();
  });
});

describe('languageInstruction — a guess is stated AS a guess', () => {
  it('asserts a script hit plainly, because it is not a guess', () => {
    const s = languageInstruction({ code: 'ta', name: 'Tamil', evidence: 'script' });
    expect(s).toContain('the user is writing in Tamil');
    expect(s).not.toContain('appears to be');
  });

  it('hedges a romanized hit and offers the model a way out', () => {
    // Overstating a guess is how a mis-detection becomes an entire app the user cannot read.
    const r = languageInstruction({ code: 'ta', name: 'Tamil', evidence: 'romanized' });
    expect(r).toContain('appears to be writing Tamil in Roman script');
    expect(r).toContain("follow the user's words rather than this hint");
    expect(r).toContain("using Tamil's own script");
  });

  it('always keeps code in English, both ways', () => {
    for (const ev of ['script', 'romanized'] as const) {
      expect(languageInstruction({ code: 'bn', name: 'Bengali', evidence: ev }))
        .toContain('Keep code identifiers and comments in English');
    }
  });
});

describe('wired into the build', () => {
  const route = readFileSync(join(__dirname, '..', 'routes', 'agentv3.ts'), 'utf8');

  it('the build prompt uses the confidence-aware instruction, not a hard-coded string', () => {
    expect(route).toContain('languageInstruction({ code: hint.code, name: hint.name');
    // The old always-assertive sentence is gone.
    expect(route).not.toContain('`Language: the user is writing in ${hint.name}.');
  });

  it('an undetected language still falls back to mirroring the request', () => {
    expect(route).toContain('the SAME language the user used in this request');
  });
});
