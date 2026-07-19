// U-4 (verified recipe modules) — text-translation generator (Google Translate + DeepL).
//
// Real, working machine translation generated into the app, Bring-Your-Own-keys (the user pastes their
// provider key into .env; NavBharatAI never stores it). Translation makes an app multilingual — especially
// valuable for India's many languages (English ⇄ Hindi/Tamil/Bengali/Marathi/…) and any global product. Each
// recipe is a SERVER helper (the key is a secret and must never reach the browser): translate(text, target,
// source?) → translated string. Both providers are plain REST APIs called with the built-in fetch, so NO npm
// dependency is needed. PURE builders; the generated code is correct and complete — no TODO stubs (the
// real-features rule). Unit-tested.

export type TranslationProvider = 'google' | 'deepl';

export interface TranslationConfig {
  provider: TranslationProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Both providers use the global fetch against a REST API — no npm dependency. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── Google Cloud Translation (v2) ────────────────────────────────────────────────────────────────────────
const GOOGLE_SERVER = `// Bring-Your-Own Google key — Google Cloud Console → enable "Cloud Translation API", create a SERVER key.
// Pasted into .env as GOOGLE_TRANSLATE_API_KEY. Language codes are ISO-639 (e.g. 'hi' Hindi, 'ta' Tamil).
const KEY = process.env.GOOGLE_TRANSLATE_API_KEY as string;

// Translate text into \`target\`. \`source\` is optional — Google auto-detects when omitted. Returns the
// original text unchanged if the API call fails, so a translation outage never breaks the app.
export async function translate(text: string, target: string, source?: string): Promise<string> {
  const body: Record<string, unknown> = { q: text, target, format: 'text' };
  if (source) body.source = source;
  try {
    const r = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return data?.data?.translations?.[0]?.translatedText ?? text;
  } catch {
    return text;
  }
}
`;

// ── DeepL ────────────────────────────────────────────────────────────────────────────────────────────────
const DEEPL_SERVER = `// Bring-Your-Own DeepL key — deepl.com → Account → API keys. Pasted into .env as DEEPL_API_KEY. A FREE key
// ends in ':fx' and uses the free endpoint (handled automatically below). Target languages are DeepL codes
// (e.g. 'EN', 'DE', 'HI', 'JA').
const KEY = process.env.DEEPL_API_KEY as string;
const ENDPOINT = KEY?.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';

// Translate text into \`target\`. \`source\` is optional — DeepL auto-detects when omitted. Returns the original
// text unchanged if the API call fails, so a translation outage never breaks the app.
export async function translate(text: string, target: string, source?: string): Promise<string> {
  const body: Record<string, unknown> = { text: [text], target_lang: target.toUpperCase() };
  if (source) body.source_lang = source.toUpperCase();
  try {
    const r = await fetch(ENDPOINT + '/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': 'DeepL-Auth-Key ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    return data?.translations?.[0]?.text ?? text;
  } catch {
    return text;
  }
}
`;

const GOOGLE_INSTRUCTIONS =
  'Google translation wired. Enable "Cloud Translation API" in Google Cloud Console, create a SERVER key, and ' +
  'paste it into .env as GOOGLE_TRANSLATE_API_KEY — NavBharatAI never stores it. Import translate(text, ' +
  "target, source?) in server code (e.g. translate(txt, 'hi') for Hindi). A failed call returns the original " +
  'text, so the app never breaks. The key stays server-side — translate from your backend, not the browser.';

const DEEPL_INSTRUCTIONS =
  'DeepL translation wired. Paste your DeepL API key into .env as DEEPL_API_KEY — NavBharatAI never stores it. ' +
  "A free key (ending ':fx') automatically uses the free endpoint. Import translate(text, target, source?) in " +
  "server code (e.g. translate(txt, 'HI')). A failed call returns the original text, so the app never breaks. " +
  'Call it from your backend so the key is not exposed in the browser.';

export function generateTranslationIntegration(provider: TranslationProvider): TranslationConfig {
  if (provider === 'google') {
    return {
      provider,
      files: {
        'server/lib/translate.ts': GOOGLE_SERVER,
        [ENV_EXAMPLE]: 'GOOGLE_TRANSLATE_API_KEY=\n',
      },
      envKeys: ['GOOGLE_TRANSLATE_API_KEY'],
      instructions: GOOGLE_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/translate.ts': DEEPL_SERVER,
      [ENV_EXAMPLE]: 'DEEPL_API_KEY=\n',
    },
    envKeys: ['DEEPL_API_KEY'],
    instructions: DEEPL_INSTRUCTIONS,
  };
}

export function isTranslationProvider(v: unknown): v is TranslationProvider {
  return v === 'google' || v === 'deepl';
}
