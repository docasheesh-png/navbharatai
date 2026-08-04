import { describe, it, expect } from 'vitest';
import { generateTranslationIntegration, isTranslationProvider } from './TranslationGenerator';

describe('generateTranslationIntegration — Google', () => {
  const c = generateTranslationIntegration('google');

  it('emits a server-only translate() via the Cloud Translation API that falls back to the input on failure', () => {
    const server = c.files['server/lib/translate.ts'];
    expect(server).toContain('export async function translate(text: string, target: string, source?: string)');
    expect(server).toContain('translation.googleapis.com/language/translate/v2?key=');
    expect(server).toContain('translatedText ?? text'); // outage never breaks the app
    expect(server).toContain('GOOGLE_TRANSLATE_API_KEY');
    expect(c.files['src/lib/translate.ts']).toBeUndefined(); // key is server-side, no client file
  });

  it('needs no npm dependency (REST via fetch), declares the key + blank .env.example', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['GOOGLE_TRANSLATE_API_KEY']);
    expect(c.files['.env.example']).toBe('GOOGLE_TRANSLATE_API_KEY=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('generateTranslationIntegration — DeepL', () => {
  const c = generateTranslationIntegration('deepl');

  it('picks the free vs pro endpoint by the :fx key suffix and uses the DeepL-Auth-Key header', () => {
    const server = c.files['server/lib/translate.ts'];
    expect(server).toContain("KEY?.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'");
    expect(server).toContain("'Authorization': 'DeepL-Auth-Key ' + KEY");
    expect(server).toContain('target_lang: target.toUpperCase()');
    expect(server).toContain('translations?.[0]?.text ?? text');
    expect(c.envKeys).toEqual(['DEEPL_API_KEY']);
    expect(c.dependency).toBeUndefined();
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['google', 'deepl'] as const) {
      const env = generateTranslationIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isTranslationProvider accepts the two supported providers, rejects everything else', () => {
    expect(isTranslationProvider('google')).toBe(true);
    expect(isTranslationProvider('deepl')).toBe(true);
    expect(isTranslationProvider('bing')).toBe(false);
    expect(isTranslationProvider(undefined)).toBe(false);
  });
});
