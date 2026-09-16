import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { realRateFor, realRateCard } from '../src/server/AgentV3/providerRates';

const KEYS = ['RATE_GLM53_FLASH_IN', 'RATE_GLM53_FLASH_OUT', 'RATE_GLM53_FLASH_CACHE', 'RATE_GPT_IN', 'RATE_GPT_OUT', 'RATE_GPT_CACHE', 'RATE_GPT_NANO_IN', 'RATE_GPT_NANO_OUT'] as const;
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
  /**
   * ⚠️ THE CACHE FIGURE CHANGED ON 2026-09-16, AND THIS TEST IS WHY IT WAS NOTICED. It pinned
   * $0.0375 — a ≈25%-of-input CONVENTION this repo had assumed for Z.ai — and the admin's own copy of
   * docs.z.ai/pricing puts the published cache-hit rate at **$0.03**. The convention was over-stating
   * our cost on every cached GLM token, and a bill is the real cost × markup, so it was over-stating
   * the USER's bill too. The same correction moved glm-5.x ($0.35 → $0.26) and glm-4.x ($0.15 → $0.11).
   * Input and output were already right. A price is now a QUOTED number, never a derived one.
   */
  it('defaults to the published Z.ai price: $0.15 in / $0.50 out, cache-hit $0.03', () => {
    expect(realRateFor('GLM', 'glm-5.3-flash')).toEqual({ inputPerMTok: 0.15, outputPerMTok: 0.5, cacheReadPerMTok: 0.03 });
  });

  /** The other two rows the same correction touched, pinned so the convention cannot creep back. */
  it('the glm-5.x and glm-4.x cache-hit rates are the published ones too', () => {
    expect(realRateFor('GLM', 'glm-5.3').cacheReadPerMTok).toBe(0.26);
    expect(realRateFor('GLM', 'glm-4.7').cacheReadPerMTok).toBe(0.11);
  });
  it('the non-flash glm-5.3 prices on the glm-5 line ($1.40 / $4.40) — the same number the admin gave', () => {
    expect(realRateFor('GLM', 'glm-5.3')).toEqual(realRateCard()['glm-5']);
    expect(realRateCard()['glm-5'].inputPerMTok).toBe(1.4);
    expect(realRateCard()['glm-5'].outputPerMTok).toBe(4.4);
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
  it('a Nano id prices on its own $0.20 / $1.25 line, never at the full-GPT bound', () => {
    expect(realRateFor('OPENAI', 'gpt-5.4-nano')).toEqual({ inputPerMTok: 0.2, outputPerMTok: 1.25 });
    expect(realRateFor('OPENAI', 'gpt-5-nano')).toEqual({ inputPerMTok: 0.2, outputPerMTok: 1.25 });
    expect(realRateFor('OPENAI', 'gpt-5.4')).not.toEqual(realRateFor('OPENAI', 'gpt-5.4-nano'));
  });
  it('does not swallow unrelated ids: kimi/glm/gemini still price on their own lines', () => {
    // ⚠️ k2.6 moved to its OWN row on 2026-09-16 (Moonshot prices it at the k2.7-code rate), so the
    // point here is that it prices on ITS line — not that it shares the retired k2.5 one.
    expect(realRateFor('KIMI', 'kimi-k2.6')).toEqual(realRateCard()['kimi-k2.6']);
    expect(realRateFor('GEMINI', 'gemini-2.5-pro')).toEqual(realRateCard()['gemini-pro']);
  });
});
