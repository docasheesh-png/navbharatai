/**
 * ROADMAP item 6 — the PLATFORM speaks the user's language.
 *
 * These tests encode the two things that can actually go wrong: picking a language that DISAGREES
 * with the AI's own replies (worse than English, because the two halves of one feed then contradict
 * each other), and a language whose catalogue silently loses a line.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveNarrationLanguage,
  isSupportedNarrationLanguage,
  SUPPORTED_NARRATION_LANGUAGES,
  NARRATION_SCRIPT_SHARE,
} from '../src/server/lib/narrationLanguage';
import { detectLanguageHint } from '../src/server/AgentV3/LanguageDetect';
import { narrationText, _catalogues, type NarrationId } from '../src/server/AgentV3/narrationCatalogue';

describe('there is ONE language detector, not two', () => {
  // The whole point of this module: the build's language is already decided by LanguageDetect (it
  // drives the app's generated text and the weak-tier notice). A private script counter here would be
  // a second source of truth with its own threshold, and the day they disagreed the AI would speak
  // Hindi while the platform answered in English — the exact defect being fixed.
  const src = readFileSync(join(__dirname, '../src/server/lib/narrationLanguage.ts'), 'utf8');

  it('delegates to the shared detector', () => {
    expect(src).toContain("import { detectLanguageHint } from '../AgentV3/LanguageDetect'");
    expect(src).toContain('detectLanguageHint(');
  });

  it('owns no script table, code-point range or threshold of its own', () => {
    expect(src).not.toMatch(/0x0[89A-Fa-f]/);           // no unicode ranges
    expect(src).not.toMatch(/THRESHOLD\s*=/);            // no second dominance threshold
    expect(src).not.toMatch(/\/\[.*-.*\]\/[gu]/);        // no script regexes
  });

  it('agrees with the shared detector on every script it can write', () => {
    for (const prompt of ['मुझे एक ऐप बनाओ', 'मुझे Firebase के साथ ऐप बनाओ']) {
      expect(detectLanguageHint(prompt)?.code).toBe('hi');
      expect(resolveNarrationLanguage(prompt)).toBe('hi');
    }
  });
});

describe('resolveNarrationLanguage', () => {
  it('gives Hindi to a prompt genuinely written in Devanagari', () => {
    expect(resolveNarrationLanguage('मेरे लिए एक ऐप बनाओ')).toBe('hi');
  });

  it('gives English to an English prompt', () => {
    expect(resolveNarrationLanguage('make me an app with login and a dashboard')).toBe('en');
  });

  it('gives ENGLISH to romanised Hinglish — matching how the AI itself replies', () => {
    // LANGUAGE_RULE mirrors the user's WORDS, so a Latin-script prompt gets a Latin-script reply.
    // Devanagari status lines beside those replies would be the very mismatch this module removes.
    expect(resolveNarrationLanguage('mujhe ek todo app banao jisme login ho aur data save ho jaye')).toBe('en');
    // …including when the shared detector DOES recognise the romanised language: that hint decides
    // the APP's text, not the language the model is replying in.
    const romanised = 'enakku oru kadai app venum';
    if (detectLanguageHint(romanised)?.evidence === 'romanized') {
      expect(resolveNarrationLanguage(romanised)).toBe('en');
    }
  });

  it('falls back to English for a script we recognise but cannot yet write', () => {
    expect(resolveNarrationLanguage('எனக்கு ஒரு பயன்பாடு உருவாக்கு')).toBe('en');
    expect(resolveNarrationLanguage('আমার জন্য একটি অ্যাপ তৈরি করুন')).toBe('en');
    expect(resolveNarrationLanguage('నాకు ఒక యాప్ తయారు చేయండి')).toBe('en');
  });

  it('does NOT flip a mostly-English prompt to Hindi over a quoted Hindi label', () => {
    // The SHARED detector deliberately DOES take this for the app's generated text (its bar is
    // lower, and a prompt naming a Hindi label plausibly wants a Hindi app). The model, however,
    // replies to this in English — so the platform must stay English or the feed contradicts itself.
    const prompt = 'Build a dashboard app and label the home screen डैशबोर्ड please';
    expect(detectLanguageHint(prompt)?.code).toBe('hi');   // the app-text hint says Hindi…
    expect(resolveNarrationLanguage(prompt)).toBe('en');   // …the platform's own voice does not
  });

  it('needs a MAJORITY of the letters, measured on the shared detector\'s own count', () => {
    const hindi = 'मुझे एक ऐप बनाओ जिसमें लॉगिन हो';
    expect(detectLanguageHint(hindi)?.scriptShare).toBeGreaterThanOrEqual(NARRATION_SCRIPT_SHARE);
    expect(resolveNarrationLanguage(hindi)).toBe('hi');
  });

  it('answers a MARATHI prompt in English rather than in Hindi it did not ask for', () => {
    // Marathi shares the Devanagari block but is a different language, and the shared detector
    // already tells them apart — so serving Hindi here would be a confident wrong answer.
    const marathi = 'मला एक ॲप बनवायचे आहे ज्यामध्ये लॉगिन आहे आणि माहिती साठवली जाते';
    if (detectLanguageHint(marathi)?.code === 'mr') {
      expect(resolveNarrationLanguage(marathi)).toBe('en');
    }
  });

  it('falls back to English when there is nothing to judge', () => {
    expect(resolveNarrationLanguage('')).toBe('en');
    expect(resolveNarrationLanguage('   ')).toBe('en');
    expect(resolveNarrationLanguage('🚀 123')).toBe('en');
    expect(resolveNarrationLanguage(null)).toBe('en');
    expect(resolveNarrationLanguage(undefined)).toBe('en');
  });
});

describe('isSupportedNarrationLanguage', () => {
  it('accepts only the languages with a complete catalogue', () => {
    expect(isSupportedNarrationLanguage('en')).toBe(true);
    expect(isSupportedNarrationLanguage('hi')).toBe(true);
    expect(isSupportedNarrationLanguage('ta')).toBe(false);
    expect(isSupportedNarrationLanguage(null)).toBe(false);
    expect(isSupportedNarrationLanguage(7)).toBe(false);
  });
});

describe('the catalogue is COMPLETE for every supported language', () => {
  const ids = Object.keys(_catalogues.en) as NarrationId[];
  const sample = {
    count: 2, enums: 'Role, Status', file: 'src/App.tsx', packages: 'zod, dayjs',
    changed: 'vite@5.4.0', added: 'react, react-dom', from: 'src/middleware.ts', to: 'middleware.ts',
  };

  it('lists every supported language', () => {
    expect(Object.keys(_catalogues).sort()).toEqual([...SUPPORTED_NARRATION_LANGUAGES].sort());
  });

  it('answers every id in every language — no silent English hole', () => {
    for (const lang of SUPPORTED_NARRATION_LANGUAGES) {
      for (const id of ids) {
        expect(typeof _catalogues[lang][id], `${lang}/${id}`).toBe('function');
      }
    }
  });

  it('renders a non-empty line for every id in every language', () => {
    for (const lang of SUPPORTED_NARRATION_LANGUAGES) {
      for (const id of ids) {
        expect(narrationText(lang, id, sample as never).trim().length, `${lang}/${id}`).toBeGreaterThan(0);
      }
    }
  });

  it('actually differs from English in Hindi — a copy-pasted table is not a translation', () => {
    for (const id of ids) {
      const en = narrationText('en', id, sample as never);
      const hi = narrationText('hi', id, sample as never);
      expect(hi, `hi/${id} was left in English`).not.toBe(en);
      expect(/[ऀ-ॿ]/.test(hi), `hi/${id} has no Devanagari`).toBe(true);
    }
  });
});

describe('narrationText', () => {
  it('interpolates the real values, in both languages', () => {
    expect(narrationText('en', 'secrets.loaded', { count: 3 })).toContain('3');
    expect(narrationText('hi', 'secrets.loaded', { count: 3 })).toContain('3');
  });

  it('keeps English singular/plural correct', () => {
    expect(narrationText('en', 'secrets.loaded', { count: 1 })).toContain('saved key (');
    expect(narrationText('en', 'secrets.loaded', { count: 2 })).toContain('saved keys (');
  });

  it('never translates identifiers, paths or package names', () => {
    expect(narrationText('hi', 'fix.duplicateImport', { file: 'src/components/App.tsx' })).toContain('src/components/App.tsx');
    expect(narrationText('hi', 'fix.missingDeps', { count: 1, packages: 'zod' })).toContain('zod');
    expect(narrationText('hi', 'fix.missingDeps', { count: 1, packages: 'zod' })).toContain('package.json');
  });

  it('degrades to English for a language it does not have, instead of throwing', () => {
    expect(narrationText('ta' as never, 'db.ready', {})).toBe(narrationText('en', 'db.ready', {}));
  });

  it('never leaks a provider or model name into a user-facing line (white-label law)', () => {
    const forbidden = /\b(GLM|Z\.ai|Kimi|Moonshot|Claude|Anthropic|Sonnet|Opus|Haiku|Gemini|Vertex|Grok|xAI|Bedrock|OpenAI|DeepSeek)\b/i;
    const ids = Object.keys(_catalogues.en) as NarrationId[];
    for (const lang of SUPPORTED_NARRATION_LANGUAGES) {
      for (const id of ids) {
        const text = narrationText(lang, id, { count: 1, enums: 'E', file: 'a.ts', packages: 'p', changed: 'c', added: 'a', from: 'x', to: 'y' } as never);
        expect(forbidden.test(text), `${lang}/${id}: ${text}`).toBe(false);
      }
    }
  });
});
