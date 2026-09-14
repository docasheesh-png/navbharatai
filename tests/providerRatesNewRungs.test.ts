import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { realRateFor, realRateCard } from '../src/server/AgentV3/providerRates';

const KEYS = ['RATE_GLM53_FLASH_IN', 'RATE_GLM53_FLASH_OUT', 'RATE_GLM53_FLASH_CACHE', 'RATE_GPT_IN', 'RATE_GPT_OUT', 'RATE_GPT_CACHE'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; } });

/**
 * Two rungs joined the ladders on 2026-09-14 with prices NOT known here. The rate card's own contract
 * is that an unknown model may only OVER-state cost, never under-state it — so each defaults to the
 * highest rate we can verify in its family, and the admin sets the real one by env.
 */
describe('glm-5.3-flash is priced as a 5.x model, not as the $0 4.7-flash', () => {
  it('🔴 does NOT inherit the glm-flash $0 line just because its name contains "flash"', () => {
    const r = realRateFor('GLM', 'glm-5.3-flash');
    expect(r.inputPerMTok).toBeGreaterThan(0);
    expect(r.outputPerMTok).toBeGreaterThan(0);
    expect(r).toEqual(realRateCard()['glm-5.3-flash']);
    // …while the genuine 4.7-flash still prices at its own $0 line.
    expect(realRateFor('GLM', 'glm-4.7-flash')).toEqual(realRateCard()['glm-flash']);
  });
  it('defaults to the glm-5 flagship line (the over-state-only direction) until the admin sets the real price', () => {
    expect(realRateFor('GLM', 'glm-5.3-flash')).toEqual({ ...realRateCard()['glm-5'] });
  });
  it('the env override is honoured', () => {
    process.env.RATE_GLM53_FLASH_IN = '0.2';
    process.env.RATE_GLM53_FLASH_OUT = '0.9';
    process.env.RATE_GLM53_FLASH_CACHE = '0.05';
    expect(realRateFor('GLM', 'glm-5.3-flash')).toEqual({ inputPerMTok: 0.2, outputPerMTok: 0.9, cacheReadPerMTok: 0.05 });
  });
});

describe('gpt-5.4 / OPENAI is priced at the conservative upper bound until the key and price exist', () => {
  it('a gpt model id and the OPENAI provider label both resolve to the gpt line', () => {
    expect(realRateFor('OPENAI', 'gpt-5.4')).toEqual(realRateCard().gpt);
    expect(realRateFor('OPENAI')).toEqual(realRateCard().gpt);
    expect(realRateFor('other', 'o4-mini')).toEqual(realRateCard().gpt);
  });
  it('defaults to the Sonnet rate — the card\'s own "never under-bill an unknown model" bound', () => {
    const { inputPerMTok, outputPerMTok } = realRateFor('OPENAI', 'gpt-5.4');
    expect({ inputPerMTok, outputPerMTok }).toEqual({ inputPerMTok: realRateCard().sonnet.inputPerMTok, outputPerMTok: realRateCard().sonnet.outputPerMTok });
  });
  it('the env override is honoured', () => {
    process.env.RATE_GPT_IN = '1.25';
    process.env.RATE_GPT_OUT = '10';
    const r = realRateFor('OPENAI', 'gpt-5.4');
    expect(r.inputPerMTok).toBe(1.25);
    expect(r.outputPerMTok).toBe(10);
  });
  it('does not swallow unrelated ids: kimi/glm/gemini still price on their own lines', () => {
    expect(realRateFor('KIMI', 'kimi-k2.6')).toEqual(realRateCard().kimi);
    expect(realRateFor('GEMINI', 'gemini-2.5-pro')).toEqual(realRateCard()['gemini-pro']);
  });
});
