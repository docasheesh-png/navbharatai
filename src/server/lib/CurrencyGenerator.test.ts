import { describe, it, expect } from 'vitest';
import { generateCurrencyIntegration, isCurrencyProvider } from './CurrencyGenerator';

describe('generateCurrencyIntegration — ExchangeRate-API', () => {
  const c = generateCurrencyIntegration('exchangerate');

  it('emits a server-only getRate/convert via the v6 /pair endpoint', () => {
    const server = c.files['server/lib/currency.ts'];
    expect(server).toContain('export async function getRate(from: string, to: string)');
    expect(server).toContain('export async function convert(amount: number, from: string, to: string)');
    expect(server).toContain('v6.exchangerate-api.com/v6/');
    expect(server).toContain('/pair/');
    expect(server).toContain('conversion_rate');
    expect(server).toContain('EXCHANGERATE_API_KEY');
    expect(c.files['src/lib/currency.ts']).toBeUndefined(); // server-side, no client file
  });

  it('needs no npm dependency, declares the key + blank .env.example', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['EXCHANGERATE_API_KEY']);
    expect(c.files['.env.example']).toBe('EXCHANGERATE_API_KEY=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('generateCurrencyIntegration — Fixer', () => {
  const c = generateCurrencyIntegration('fixer');

  it('computes the EUR-based cross-rate so any pair works', () => {
    const server = c.files['server/lib/currency.ts'];
    expect(server).toContain('data.fixer.io/api/latest?access_key=');
    expect(server).toContain('return rt / rf;'); // (EUR→to)/(EUR→from) = from→to
    expect(server).toContain('&symbols=');
    expect(server).toContain('FIXER_API_KEY');
    expect(c.envKeys).toEqual(['FIXER_API_KEY']);
    expect(c.dependency).toBeUndefined();
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['exchangerate', 'fixer'] as const) {
      const env = generateCurrencyIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isCurrencyProvider accepts the two supported providers, rejects everything else', () => {
    expect(isCurrencyProvider('exchangerate')).toBe(true);
    expect(isCurrencyProvider('fixer')).toBe(true);
    expect(isCurrencyProvider('coinbase')).toBe(false);
    expect(isCurrencyProvider(undefined)).toBe(false);
  });
});
