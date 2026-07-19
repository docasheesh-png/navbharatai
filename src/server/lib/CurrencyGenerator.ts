// U-4 (verified recipe modules) — currency exchange-rate generator (ExchangeRate-API + Fixer).
//
// Real, working currency conversion generated into the app, Bring-Your-Own-keys (the user pastes their
// provider key into .env; NavBharatAI never stores it). Currency conversion is behind multi-currency pricing,
// international checkout, invoicing and finance dashboards. Each recipe is a SERVER helper (the key is a
// secret and must never reach the browser): getRate(from, to) → number and convert(amount, from, to) →
// number. Both providers are plain REST APIs called with the built-in fetch, so NO npm dependency is needed.
// PURE builders; the generated code is correct and complete — no TODO stubs (the real-features rule).
// Unit-tested.

export type CurrencyProvider = 'exchangerate' | 'fixer';

export interface CurrencyConfig {
  provider: CurrencyProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Both providers use the global fetch against a REST API — no npm dependency. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── ExchangeRate-API (v6, direct pair endpoint — any base) ───────────────────────────────────────────────
const EXCHANGERATE_SERVER = `// Bring-Your-Own ExchangeRate-API key — app.exchangerate-api.com. Pasted into .env as EXCHANGERATE_API_KEY.
// The v6 /pair endpoint converts between ANY two ISO-4217 currencies directly. Server secret.
const KEY = process.env.EXCHANGERATE_API_KEY as string;

// Latest exchange rate FROM → TO (e.g. getRate('USD', 'INR')). Throws if the API rejects the request.
export async function getRate(from: string, to: string): Promise<number> {
  const r = await fetch('https://v6.exchangerate-api.com/v6/' + KEY + '/pair/' + from + '/' + to);
  const data = await r.json();
  if (data?.result !== 'success' || typeof data?.conversion_rate !== 'number') {
    throw new Error('Exchange rate lookup failed: ' + (data?.['error-type'] ?? 'unknown'));
  }
  return data.conversion_rate;
}

// Convert an amount FROM → TO at the latest rate.
export async function convert(amount: number, from: string, to: string): Promise<number> {
  return amount * (await getRate(from, to));
}
`;

// ── Fixer (EUR-base on the free tier → we compute the cross-rate) ─────────────────────────────────────────
const FIXER_SERVER = `// Bring-Your-Own Fixer key — fixer.io. Pasted into .env as FIXER_API_KEY. The free tier quotes everything
// against EUR, so getRate() fetches both currencies vs EUR and computes the cross-rate (to / from) — this
// works for ANY pair regardless of the base. Server secret.
const KEY = process.env.FIXER_API_KEY as string;

// Latest exchange rate FROM → TO (e.g. getRate('USD', 'INR')), via the EUR-based cross-rate.
export async function getRate(from: string, to: string): Promise<number> {
  const r = await fetch('http://data.fixer.io/api/latest?access_key=' + KEY + '&symbols=' + from + ',' + to);
  const data = await r.json();
  const rf = data?.rates?.[from];
  const rt = data?.rates?.[to];
  if (!data?.success || typeof rf !== 'number' || typeof rt !== 'number') {
    throw new Error('Exchange rate lookup failed: ' + (data?.error?.info ?? 'unknown'));
  }
  return rt / rf; // (EUR→to) / (EUR→from) = from→to
}

// Convert an amount FROM → TO at the latest rate.
export async function convert(amount: number, from: string, to: string): Promise<number> {
  return amount * (await getRate(from, to));
}
`;

const EXCHANGERATE_INSTRUCTIONS =
  'ExchangeRate-API currency conversion wired. Paste your key into .env as EXCHANGERATE_API_KEY — NavBharatAI ' +
  "never stores it. Import getRate(from, to) / convert(amount, from, to) (e.g. convert(100, 'USD', 'INR')). " +
  'The v6 /pair endpoint handles any currency pair directly. The key stays server-side — convert on your ' +
  'backend, never the browser.';

const FIXER_INSTRUCTIONS =
  'Fixer currency conversion wired. Paste your key into .env as FIXER_API_KEY — NavBharatAI never stores it. ' +
  "Import getRate(from, to) / convert(amount, from, to). Fixer's free tier quotes against EUR, so the recipe " +
  'computes the cross-rate automatically (works for any pair). The key stays server-side — convert on your ' +
  'backend, never the browser.';

export function generateCurrencyIntegration(provider: CurrencyProvider): CurrencyConfig {
  if (provider === 'exchangerate') {
    return {
      provider,
      files: {
        'server/lib/currency.ts': EXCHANGERATE_SERVER,
        [ENV_EXAMPLE]: 'EXCHANGERATE_API_KEY=\n',
      },
      envKeys: ['EXCHANGERATE_API_KEY'],
      instructions: EXCHANGERATE_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/currency.ts': FIXER_SERVER,
      [ENV_EXAMPLE]: 'FIXER_API_KEY=\n',
    },
    envKeys: ['FIXER_API_KEY'],
    instructions: FIXER_INSTRUCTIONS,
  };
}

export function isCurrencyProvider(v: unknown): v is CurrencyProvider {
  return v === 'exchangerate' || v === 'fixer';
}
