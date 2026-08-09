/**
 * ROADMAP item 6 — the PLATFORM speaks the user's language.
 *
 * These tests encode the two things that can actually go wrong: picking the WRONG language for a
 * prompt (worse than English, because the AI and the platform then disagree in one feed), and a
 * language whose catalogue silently loses a line.
 */

import { describe, it, expect } from 'vitest';
import {
  detectScript,
  resolveNarrationLanguage,
  isSupportedNarrationLanguage,
  SUPPORTED_NARRATION_LANGUAGES,
  SCRIPT_SHARE_THRESHOLD,
} from '../src/server/lib/narrationLanguage';
import { narrationText, _catalogues, type NarrationId } from '../src/server/AgentV3/narrationCatalogue';

describe('detectScript', () => {
  it('reads a Hindi prompt as Devanagari', () => {
    expect(detectScript('मुझे एक टू-डू ऐप बनाओ')).toBe('devanagari');
  });

  it('reads a plain English prompt as Latin', () => {
    expect(detectScript('Build me a todo app with login')).toBe('latin');
  });

  it('recognises the other Indian scripts by name, without claiming a language for them', () => {
    expect(detectScript('எனக்கு ஒரு பயன்பாடு உருவாக்கு')).toBe('tamil');
    expect(detectScript('আমার জন্য একটি অ্যাপ তৈরি করুন')).toBe('bengali');
    expect(detectScript('నాకు ఒక యాప్ తయారు చేయండి')).toBe('telugu');
  });

  it('has no letters to judge, so it says so instead of guessing', () => {
    expect(detectScript('')).toBe('unknown');
    expect(detectScript('   ')).toBe('unknown');
    expect(detectScript('🚀 🚀 123')).toBe('unknown');
    expect(detectScript(null)).toBe('unknown');
    expect(detectScript(undefined)).toBe('unknown');
  });

  it('does NOT flip an English prompt to Hindi over one quoted Hindi word', () => {
    // The real shape of the bug: an English brief that names a screen in Hindi.
    expect(detectScript('Build a dashboard app and label the home screen डैशबोर्ड please')).toBe('latin');
  });

  it('DOES take a genuinely Hindi prompt that carries English product names', () => {
    expect(detectScript('मुझे Firebase और Stripe के साथ एक ऐप बनाओ जिसमें लॉगिन हो')).toBe('devanagari');
  });

  it('ignores code, file paths and urls when judging — they are Latin by necessity', () => {
    const prompt = 'यह ठीक करो: `src/components/App.tsx` में https://example.com/api फेल हो रहा है';
    expect(detectScript(prompt)).toBe('devanagari');
  });

  it('applies the documented share threshold rather than "one character wins"', () => {
    // 1 Devanagari letter among 19 Latin letters is ~5% — under the threshold.
    expect(SCRIPT_SHARE_THRESHOLD).toBeGreaterThan(0.05);
    expect(detectScript('abcdefghijklmnopqrsक')).toBe('latin');
  });
});

describe('resolveNarrationLanguage', () => {
  it('gives Hindi to a Devanagari prompt', () => {
    expect(resolveNarrationLanguage('मेरे लिए एक ऐप बनाओ')).toBe('hi');
  });

  it('gives English to an English prompt', () => {
    expect(resolveNarrationLanguage('make me an app')).toBe('en');
  });

  it('gives English — NOT Hindi — to romanised Hinglish, matching what the model itself does', () => {
    // If the platform answered in Devanagari here, it would disagree with the AI in the same feed.
    expect(resolveNarrationLanguage('mujhe ek todo app banao')).toBe('en');
  });

  it('falls back to English for a script we recognise but cannot yet write', () => {
    expect(resolveNarrationLanguage('எனக்கு ஒரு பயன்பாடு உருவாக்கு')).toBe('en');
    expect(resolveNarrationLanguage('আমার জন্য একটি অ্যাপ তৈরি করুন')).toBe('en');
  });

  it('falls back to English when there is nothing to judge', () => {
    expect(resolveNarrationLanguage('')).toBe('en');
    expect(resolveNarrationLanguage(null)).toBe('en');
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
    const sample: Record<string, unknown> = {
      count: 2, enums: 'Role, Status', file: 'src/App.tsx', packages: 'zod, dayjs',
      changed: 'vite@5.4.0', added: 'react, react-dom', from: 'src/middleware.ts', to: 'middleware.ts',
    };
    for (const lang of SUPPORTED_NARRATION_LANGUAGES) {
      for (const id of ids) {
        const text = narrationText(lang, id, sample as never);
        expect(text.trim().length, `${lang}/${id}`).toBeGreaterThan(0);
      }
    }
  });

  it('actually differs from English in Hindi — a copy-pasted table is not a translation', () => {
    for (const id of ids) {
      const en = narrationText('en', id, { count: 2, enums: 'Role', file: 'a.ts', packages: 'zod', changed: 'v1', added: 'react', from: 'a', to: 'b' } as never);
      const hi = narrationText('hi', id, { count: 2, enums: 'Role', file: 'a.ts', packages: 'zod', changed: 'v1', added: 'react', from: 'a', to: 'b' } as never);
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
