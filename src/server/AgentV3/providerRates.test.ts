import { describe, it, expect } from 'vitest';
import {
  realRateFor,
  usageCostUsd,
  realProviderCostUsd,
  tieredMarkupUsd,
  explainRealCostBuild,
  type ProviderCostEntry,
} from './providerRates';

describe('realRateFor — resolves the exact rate by model id, then provider label', () => {
  it('prices GLM by the exact rung: flash is free, 4.7 is cheap, 5.2 is flagship', () => {
    expect(realRateFor('GLM', 'glm-4.7-flash')).toEqual({ inputPerMTok: 0, outputPerMTok: 0 });
    expect(realRateFor('GLM', 'glm-4.7')).toEqual({ inputPerMTok: 0.6, outputPerMTok: 2.2, cacheReadPerMTok: 0.11 });
    expect(realRateFor('GLM', 'glm-5.2')).toEqual({ inputPerMTok: 1.4, outputPerMTok: 4.4, cacheReadPerMTok: 0.26 });
  });

  /**
   * ⚠️ REWRITTEN 2026-09-16 FROM MOONSHOT'S PUBLISHED TABLE. The old title — "k2.5 cheap" — also
   * covered k2.6, on the assumption that an older rung is a cheaper one. Moonshot prices **k2.6 exactly
   * like k2.7-code** ($0.95 / $4.00). k2.6 is the WEAK ladder's second rung and weak builds are paid for
   * by NavBharatAI, so the old lumping under-stated our own cost on every free build.
   */
  it('prices Kimi by rung: k2.6 and k2.7-code are the same price; k2.5 is the retired cheap line', () => {
    expect(realRateFor('KIMI', 'kimi-k2.6')).toEqual({ inputPerMTok: 0.95, outputPerMTok: 4.0, cacheReadPerMTok: 0.16 });
    expect(realRateFor('KIMI', 'kimi-k2.7-code')).toEqual({ inputPerMTok: 0.95, outputPerMTok: 4.0, cacheReadPerMTok: 0.19 });
    // k2.5 was DISCONTINUED on 2026-08-31 and is off every ladder; the row survives only so old
    // telemetry can still be priced, and its figures are historical rather than currently published.
    expect(realRateFor('KIMI', 'kimi-k2.5')).toEqual({ inputPerMTok: 0.6, outputPerMTok: 2.5, cacheReadPerMTok: 0.15 });
  });

  /**
   * 🔴 THE DEFECT THIS TEST WAS WRITTEN TO CATCH (found 2026-09-16, while wiring kimi-k2.7-code-highspeed
   * onto the Normal ladder). The model has NO row and NO matcher branch before this change, so
   * `realRateFor` fell through the 'k3' / 'k2.6' / 'k2.5' branches to the final `return card['kimi-k2.7']`
   * — silently billing HALF Moonshot's real price for a model priced at exactly 2x k2.7-code on every
   * column (identical coding quality, only faster tokens/sec). Verified by re-deleting the `highspeed`
   * branch and confirming this assertion fails before restoring it.
   */
  it('prices kimi-k2.7-code-highspeed at its OWN rate — 2x k2.7-code, never the plain k2.7-code rate', () => {
    const highspeed = realRateFor('KIMI', 'kimi-k2.7-code-highspeed');
    const regular = realRateFor('KIMI', 'kimi-k2.7-code');
    expect(highspeed).toEqual({ inputPerMTok: 1.9, outputPerMTok: 8.0, cacheReadPerMTok: 0.38 });
    expect(highspeed.inputPerMTok).toBe(regular.inputPerMTok * 2);
    expect(highspeed.outputPerMTok).toBe(regular.outputPerMTok * 2);
    expect(highspeed.cacheReadPerMTok).not.toEqual(regular.cacheReadPerMTok);
  });

  it('falls back to the provider label when the model id is unknown/absent', () => {
    expect(realRateFor('GLM')).toEqual({ inputPerMTok: 0.6, outputPerMTok: 2.2, cacheReadPerMTok: 0.11 });
    expect(realRateFor('KIMI')).toEqual({ inputPerMTok: 0.6, outputPerMTok: 2.5, cacheReadPerMTok: 0.15 });
    expect(realRateFor('CLAUDE_HAIKU')).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
    expect(realRateFor('CLAUDE')).toEqual({ inputPerMTok: 3, outputPerMTok: 15 }); // Sonnet
    expect(realRateFor('GROK')).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
  });

  it('unknown provider → conservative Sonnet rate (never under-bill)', () => {
    expect(realRateFor('other')).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
    expect(realRateFor('mystery-provider')).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
  });

  it('model id wins over provider label (a CLAUDE label carrying a haiku model prices as haiku)', () => {
    expect(realRateFor('CLAUDE', 'claude-haiku-4-5')).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
    expect(realRateFor('VERTEX', 'gemini-2.5-flash')).toEqual({ inputPerMTok: 0.3, outputPerMTok: 2.5 });
  });
});

describe('usageCostUsd — token cost at a rate', () => {
  it('multiplies input+output by their per-MTok rates', () => {
    // 1M input @ $0.60 + 0.5M output @ $2.20 = 0.60 + 1.10 = $1.70
    expect(usageCostUsd({ inputTokens: 1_000_000, outputTokens: 500_000 }, { inputPerMTok: 0.6, outputPerMTok: 2.2 }))
      .toBeCloseTo(1.7, 6);
  });
  it('clamps negative tokens to 0', () => {
    expect(usageCostUsd({ inputTokens: -100, outputTokens: -100 }, { inputPerMTok: 1, outputPerMTok: 1 })).toBe(0);
  });

  // ── Fix 66 billing slice — cache-read discount ──────────────────────────────────────────────
  it('prices the cache-hit share at cacheReadPerMTok and the rest at the full input rate', () => {
    // 1M input of which 800k cache-served: 0.2M@$0.60 + 0.8M@$0.15 = 0.12 + 0.12 = $0.24
    expect(usageCostUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 800_000 },
      { inputPerMTok: 0.6, outputPerMTok: 2.2, cacheReadPerMTok: 0.15 },
    )).toBeCloseTo(0.24, 6);
  });
  it('with NO cacheReadPerMTok on the rate, cacheRead changes nothing (margin-safe default)', () => {
    const withCache = usageCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 900_000 }, { inputPerMTok: 0.6, outputPerMTok: 2.2 });
    const without = usageCostUsd({ inputTokens: 1_000_000, outputTokens: 0 }, { inputPerMTok: 0.6, outputPerMTok: 2.2 });
    expect(withCache).toBeCloseTo(without, 9);
  });
  it('clamps cacheRead to the input total (a provider cannot cache-serve more than it received)', () => {
    // cacheRead 2M > input 1M → all 1M priced at the cache rate, never negative fresh-input tokens.
    expect(usageCostUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 2_000_000 },
      { inputPerMTok: 0.6, outputPerMTok: 2.2, cacheReadPerMTok: 0.15 },
    )).toBeCloseTo(0.15, 6);
  });
  it('a real GLM slice with a big cache-hit share costs a fraction of the undiscounted price', () => {
    // HabitTracker-scale: 2.4M GLM input. Undiscounted $1.44; with 80% cache-hit at the PUBLISHED
    // glm-4.x cache rate ($0.11): 0.48M@0.6 + 1.92M@0.11 = 0.288 + 0.2112 = $0.4992.
    // ⚠️ This number moved on 2026-09-16 because the rate did: the card had been using a
    // ≈25%-of-input CONVENTION ($0.15) instead of Z.ai's own published cache-hit price. Every figure
    // here is now quoted from docs.z.ai/pricing (recorded verbatim in providerRates.ts), and the
    // correction runs DOWNWARD — it had been over-stating our cost, and therefore the user's bill.
    const entries: ProviderCostEntry[] = [
      { provider: 'GLM', model: 'glm-4.7', usage: { inputTokens: 2_400_000, outputTokens: 0, cacheReadInputTokens: 1_920_000 } },
    ];
    expect(realProviderCostUsd(entries)).toBeCloseTo(0.4992, 4);
  });
});

describe('tieredMarkupUsd — admin curve (×4 under $1, ×3 on the excess)', () => {
  it('small builds (≤ $1 real cost) are marked up ×4', () => {
    expect(tieredMarkupUsd(0.05)).toBeCloseTo(0.2, 6);
    expect(tieredMarkupUsd(0.4)).toBeCloseTo(1.6, 6);
    expect(tieredMarkupUsd(1)).toBeCloseTo(4, 6);
  });
  it('large builds: first $1 ×4, the excess ×3', () => {
    expect(tieredMarkupUsd(1.5)).toBeCloseTo(4 + 0.5 * 3, 6); // 5.5
    expect(tieredMarkupUsd(3)).toBeCloseTo(4 + 2 * 3, 6); // 10
    expect(tieredMarkupUsd(8)).toBeCloseTo(4 + 7 * 3, 6); // 25
  });
  it('is continuous at the $1 threshold and monotonic', () => {
    expect(tieredMarkupUsd(1)).toBeCloseTo(tieredMarkupUsd(1.0001), 2);
    expect(tieredMarkupUsd(2)).toBeGreaterThan(tieredMarkupUsd(1));
  });
  it('negative/zero real cost → 0', () => {
    expect(tieredMarkupUsd(0)).toBe(0);
    expect(tieredMarkupUsd(-5)).toBe(0);
  });
});

describe('realProviderCostUsd — sums per-slice real cost + conservative remainder', () => {
  it('prices each slice at its own rate and the remainder at Sonnet rates', () => {
    const entries: ProviderCostEntry[] = [
      { provider: 'GLM', model: 'glm-4.7', usage: { inputTokens: 1_000_000, outputTokens: 0 } }, // $0.60
      { provider: 'KIMI', model: 'kimi-k2.5', usage: { inputTokens: 1_000_000, outputTokens: 0 } }, // $0.60
    ];
    const remainder = { inputTokens: 1_000_000, outputTokens: 0 }; // $3.00 at Sonnet
    expect(realProviderCostUsd(entries, remainder)).toBeCloseTo(0.6 + 0.6 + 3.0, 6);
  });

  it("mirrors the admin's real build: GLM 455k + KIMI 1.5M ≈ well under $1 → ×4 markup", () => {
    // The real LedgerLite build (admin dashboards): GLM in 443,642/out 12,142, KIMI in 1,487,427/out 12,552.
    const entries: ProviderCostEntry[] = [
      { provider: 'GLM', model: 'glm-4.7', usage: { inputTokens: 443_642, outputTokens: 12_142 } },
      { provider: 'KIMI', model: 'kimi-k2.5', usage: { inputTokens: 1_487_427, outputTokens: 12_552 } },
    ];
    const real = realProviderCostUsd(entries);
    // GLM: 0.443642*0.6 + 0.012142*2.2 = 0.2929 ; KIMI: 1.487427*0.6 + 0.012552*2.5 = 0.9239 → ~1.217
    expect(real).toBeGreaterThan(1.1);
    expect(real).toBeLessThan(1.35);
    // Billed ≈ 4 + (1.217-1)*3 ≈ 4.65 (vs the old ₹811/$8.48 Sonnet-based overcharge).
    const billed = tieredMarkupUsd(real);
    expect(billed).toBeGreaterThan(4.5);
    expect(billed).toBeLessThan(5.1);
  });
});

describe('explainRealCostBuild — honest breakdown whose billedUsd equals the charge', () => {
  it('billedUsd == tieredMarkupUsd(realCost) and INR == billedUsd × rate', () => {
    const entries: ProviderCostEntry[] = [
      { provider: 'GLM', model: 'glm-4.7', usage: { inputTokens: 500_000, outputTokens: 10_000 } },
    ];
    const b = explainRealCostBuild(entries, { inputTokens: 0, outputTokens: 0 }, 87);
    expect(b.billedUsd).toBeCloseTo(tieredMarkupUsd(b.realCostUsd), 8);
    expect(b.billedInr).toBeCloseTo(b.billedUsd * 87, 6);
    expect(b.perProvider.find((p) => p.provider === 'GLM')?.costUsd).toBeGreaterThan(0);
  });
});

// NEWER-MODEL SAFETY (admin 2026-07-28, when kimi-k3 was prepended to the paid ladder).
// The old branches sent any unrecognized id in a family to the CHEAPEST rung, so a new flagship
// would be paid at flagship price and billed at the k2.5 / glm-4.x price — a silent loss on every
// build, and a direct contradiction of this module's own "never under-bill an unknown model" rule.
describe('realRateFor — an unknown/newer model can never bill at the cheap rate', () => {
  const cheapKimi = realRateFor('KIMI', 'kimi-k2.5');
  const cheapGlm = realRateFor('GLM', 'glm-4.7');

  it('kimi-k3 is NOT billed at the k2.5/k2.6 rate', () => {
    const k3 = realRateFor('KIMI', 'kimi-k3');
    expect(k3.inputPerMTok).toBeGreaterThan(cheapKimi.inputPerMTok);
    expect(k3.outputPerMTok).toBeGreaterThan(cheapKimi.outputPerMTok);
  });

  it('a future unknown Kimi id falls to the most expensive KNOWN rate, not the cheapest', () => {
    const future = realRateFor('KIMI', 'kimi-k4-turbo');
    expect(future.inputPerMTok).toBeGreaterThanOrEqual(realRateFor('KIMI', 'kimi-k2.7-code').inputPerMTok);
    expect(future.inputPerMTok).toBeGreaterThan(cheapKimi.inputPerMTok);
  });

  it('the retired k2.5 line still prices what old telemetry recorded', () => {
    expect(realRateFor('KIMI', 'kimi-k2.5')).toEqual(cheapKimi);
    // ⚠️ k2.6 NO LONGER belongs here (2026-09-16): Moonshot publishes it at the k2.7-code price, so it
    // must be strictly dearer than the retired cheap line and identical to k2.7 on input and output.
    const k26 = realRateFor('KIMI', 'kimi-k2.6');
    const k27 = realRateFor('KIMI', 'kimi-k2.7-code');
    expect(k26.inputPerMTok).toBeGreaterThan(cheapKimi.inputPerMTok);
    expect(k26.inputPerMTok).toBe(k27.inputPerMTok);
    expect(k26.outputPerMTok).toBe(k27.outputPerMTok);
    // Their cache-hit rates genuinely differ ($0.16 vs $0.19) — one row could not express both.
    expect(k26.cacheReadPerMTok).toBe(0.16);
    expect(k27.cacheReadPerMTok).toBe(0.19);
  });

  it('k2.7 keeps its own rate', () => {
    const k27 = realRateFor('KIMI', 'kimi-k2.7-code');
    expect(k27.inputPerMTok).toBeGreaterThan(cheapKimi.inputPerMTok);
  });

  it('the same guard applies to GLM — a future glm-6 cannot bill at the 4.x rate', () => {
    const future = realRateFor('GLM', 'glm-6');
    expect(future.inputPerMTok).toBeGreaterThan(cheapGlm.inputPerMTok);
    expect(realRateFor('GLM', 'glm-4.7')).toEqual(cheapGlm);       // known cheap unchanged
    expect(realRateFor('GLM', 'glm-4.7-flash').inputPerMTok).toBe(0); // flash still free
  });
});
