import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { priceProviderUsage } from '../src/server/lib/platformBuildMetrics';
import { realRateFor, usageCostUsd, realProviderCostUsd } from '../src/server/AgentV3/providerRates';

/**
 * 🔴 THE ADMIN'S COST PANEL PRICED EVERY BUILD AT ITS FAMILY'S DEAREST RATE
 * (deep re-autopsy of build `9cca1fd5`, 2026-09-17).
 *
 * `platformBuildMetrics.ts` carries this promise in its own comment:
 *
 *     "Price it with the SAME live rate card the real-cost billing uses, so the admin's cost graph
 *      and the admin's bill can never tell two different stories about one build."
 *
 * They told different stories on every build. The graph was priced from `providerUsage` — a
 * per-PROVIDER token blob with no model in it — through `realRateFor(provider)` with the model
 * argument simply omitted. That function's provider-only fallback is deliberately the family's most
 * expensive rate, and says so in place: *"an unrecognized model can only ever over-state cost, never
 * under-state it."* Correct as a BILLING safeguard; wrong as a MEASUREMENT.
 *
 * ⚠️ The error ran the SAFE way — it over-stated our own cost, so no user was under-charged. It is
 * the same shape as the `E2B_USD_PER_HOUR` incident `CLAUDE.md` records: a wrong number on the admin's
 * own cost panel, margin-safe and still wrong.
 */

const GLM_FLASHX = realRateFor('GLM', 'glm-4.7-flashx');
const GLM_FAMILY = realRateFor('GLM');

describe('the rate card itself — the gap this was hiding', () => {
  it('🔴 the family fallback is many times the rung that actually runs on Weak and Normal', () => {
    expect(GLM_FLASHX.inputPerMTok).toBeLessThan(GLM_FAMILY.inputPerMTok);
    expect(GLM_FAMILY.inputPerMTok / GLM_FLASHX.inputPerMTok).toBeGreaterThan(5);
    expect(GLM_FAMILY.outputPerMTok / GLM_FLASHX.outputPerMTok).toBeGreaterThan(4);
  });
});

describe('priceProviderUsage — the model that ran is what gets priced', () => {
  const usage = { GLM: { inputTokens: 1_000_000, outputTokens: 1_000_000 } };

  it('🔴 with the ledger, a flashx build is priced as flashx', () => {
    const [row] = priceProviderUsage(usage, [
      { provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } },
    ]);
    expect(row.costUsd).toBeCloseTo(GLM_FLASHX.inputPerMTok + GLM_FLASHX.outputPerMTok, 6);
  });

  it('…and that is many times cheaper than what the panel used to record', () => {
    const fixed = priceProviderUsage(usage, [
      { provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } },
    ])[0].costUsd;
    const before = priceProviderUsage(usage)[0].costUsd;
    expect(before / fixed).toBeGreaterThan(4);
  });

  it('🔒 NO ledger ⇒ byte-identical to the old provider-only pricing', () => {
    const [row] = priceProviderUsage(usage);
    expect(row.costUsd).toBeCloseTo(usageCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, GLM_FAMILY), 9);
    expect(priceProviderUsage(usage, [])[0].costUsd).toBeCloseTo(row.costUsd, 9);
    expect(priceProviderUsage(usage, null)[0].costUsd).toBeCloseTo(row.costUsd, 9);
  });

  it('the TOKEN totals always come from the reconciled figure, never from the ledger', () => {
    const [row] = priceProviderUsage(usage, [
      { provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 10, outputTokens: 10 } },
    ]);
    expect(row.inputTokens).toBe(1_000_000);
    expect(row.outputTokens).toBe(1_000_000);
  });
});

describe("🔴 the cached share is priced at the cache rate — the BILL always did, the panel never could", () => {
  it('the rate card really does have a cheaper cache line for this rung', () => {
    expect(GLM_FLASHX.cacheReadPerMTok).toBeDefined();
    expect(GLM_FLASHX.cacheReadPerMTok!).toBeLessThan(GLM_FLASHX.inputPerMTok);
  });

  it('a fully-cached million input tokens costs the CACHE rate, not the input rate', () => {
    const [row] = priceProviderUsage(
      { GLM: { inputTokens: 1_000_000, outputTokens: 0 } },
      [{ provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 1_000_000 } }],
    );
    expect(row.costUsd).toBeCloseTo(GLM_FLASHX.cacheReadPerMTok!, 9);
    expect(row.costUsd).toBeLessThan(GLM_FLASHX.inputPerMTok);
  });

  it('…and it agrees with what the BILL computes for the same entry, to the cent', () => {
    const entry = { provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 900_000, outputTokens: 120_000, cacheReadInputTokens: 700_000 } };
    const panel = priceProviderUsage({ GLM: { inputTokens: 900_000, outputTokens: 120_000 } }, [entry])[0].costUsd;
    const bill = realProviderCostUsd([entry]);
    expect(panel).toBeCloseTo(bill, 9);
  });

  it('🔒 a cache figure larger than the entry\'s own input is clamped — a provider cannot cache-serve more than it received', () => {
    const [row] = priceProviderUsage(
      { GLM: { inputTokens: 1_000_000, outputTokens: 0 } },
      [{ provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadInputTokens: 9_000_000 } }],
    );
    expect(row.costUsd).toBeCloseTo(GLM_FLASHX.cacheReadPerMTok!, 9);
  });

  it('no cache field ⇒ the full input rate, exactly as before', () => {
    const [row] = priceProviderUsage(
      { GLM: { inputTokens: 1_000_000, outputTokens: 0 } },
      [{ provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 1_000_000, outputTokens: 0 } }],
    );
    expect(row.costUsd).toBeCloseTo(GLM_FLASHX.inputPerMTok, 9);
  });
});

describe('🔒 the unattributed remainder keeps the conservative rate — exact where we know, safe where we do not', () => {
  it('half attributed to a cheap rung, half unattributed, is priced as exactly that mix', () => {
    const [row] = priceProviderUsage(
      { GLM: { inputTokens: 1_000_000, outputTokens: 0 } },
      [{ provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 400_000, outputTokens: 0 } }],
    );
    const expected = (400_000 / 1e6) * GLM_FLASHX.inputPerMTok + (600_000 / 1e6) * GLM_FAMILY.inputPerMTok;
    expect(row.costUsd).toBeCloseTo(expected, 9);
    // …and it sits strictly between the two extremes, which is the whole point.
    expect(row.costUsd).toBeGreaterThan(GLM_FLASHX.inputPerMTok * 1);
    expect(row.costUsd).toBeLessThan(GLM_FAMILY.inputPerMTok * 1);
  });

  it('a provider the ledger never mentions is unchanged', () => {
    const [row] = priceProviderUsage(
      { KIMI: { inputTokens: 1_000_000, outputTokens: 0 } },
      [{ provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 1_000_000, outputTokens: 0 } }],
    );
    expect(row.provider).toBe('KIMI');
    expect(row.costUsd).toBeCloseTo(realRateFor('KIMI').inputPerMTok, 9);
  });

  it('several rungs of the SAME provider are each priced at their own rate', () => {
    const [row] = priceProviderUsage(
      { GLM: { inputTokens: 2_000_000, outputTokens: 0 } },
      [
        { provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
        { provider: 'GLM', model: 'glm-5.3', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
      ],
    );
    const expected = realRateFor('GLM', 'glm-4.7-flashx').inputPerMTok + realRateFor('GLM', 'glm-5.3').inputPerMTok;
    expect(row.costUsd).toBeCloseTo(expected, 9);
  });

  it('🔒 a ledger claiming MORE than the reconciled total is clamped, never trusted upward', () => {
    const [row] = priceProviderUsage(
      { GLM: { inputTokens: 1_000_000, outputTokens: 0 } },
      [{ provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 4_000_000, outputTokens: 0 } }],
    );
    // Priced at the ledger's own average for the share kept — never four times the real tokens.
    expect(row.costUsd).toBeCloseTo(GLM_FLASHX.inputPerMTok, 6);
    expect(row.inputTokens).toBe(1_000_000);
  });
});

describe('never throws, and never invents a row', () => {
  it('junk in, empty or clamped out', () => {
    expect(priceProviderUsage(null)).toEqual([]);
    expect(priceProviderUsage(undefined, undefined)).toEqual([]);
    expect(priceProviderUsage({})).toEqual([]);
    expect(priceProviderUsage({ GLM: { inputTokens: 0, outputTokens: 0 } })).toEqual([]);
  });

  it('a malformed ledger entry is skipped, not allowed to poison the total', () => {
    const [row] = priceProviderUsage(
      { GLM: { inputTokens: 1_000_000, outputTokens: 0 } },
      [
        { provider: '', model: 'glm-4.7-flashx', usage: { inputTokens: 999, outputTokens: 0 } },
        { provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
      ] as never,
    );
    expect(row.costUsd).toBeCloseTo(GLM_FLASHX.inputPerMTok, 9);
  });

  it('negative and non-numeric token counts clamp rather than subtract', () => {
    const [row] = priceProviderUsage(
      { GLM: { inputTokens: 1_000_000, outputTokens: 0 } },
      [{ provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: -5, outputTokens: NaN } }] as never,
    );
    // Nothing attributable ⇒ the whole thing is the conservative remainder.
    expect(row.costUsd).toBeCloseTo(GLM_FAMILY.inputPerMTok, 9);
  });
});

/**
 * 🔒 REVERSION GUARD — the wiring. The helper is useless unless BOTH settle paths hand it the ledger,
 * and this repo has already shipped exactly that drift once: Fix 67 found the watchdog finalizer
 * billing by the old formula while the normal settle used the new one.
 */
describe('the wiring — both settle paths, proven by reversion', () => {
  const ROUTE = readFileSync(fileURLToPath(new URL('../src/server/routes/agentv3.ts', import.meta.url)), 'utf8');

  it('the normal settle and the watchdog finalizer BOTH pass the model-attributed entries', () => {
    const passes = ROUTE.match(/providerEntries:\s*\w+(\.\w+)*\.entries\(\)/g) ?? [];
    expect(passes).toHaveLength(2);
  });

  it('and each one sits beside the providerUsage it corrects', () => {
    for (const m of ROUTE.matchAll(/providerEntries:/g)) {
      const before = ROUTE.slice(Math.max(0, m.index - 600), m.index);
      expect(before).toContain('providerUsage:');
    }
  });

  it('the metrics recorder no longer prices by provider alone', () => {
    const mod = readFileSync(fileURLToPath(new URL('../src/server/lib/platformBuildMetrics.ts', import.meta.url)), 'utf8');
    expect(mod).toContain('priceProviderUsage(rec.providerUsage, rec.providerEntries)');
    // The old one-line pricing must be gone from the recorder, or a future edit could resurrect it.
    expect(mod).not.toContain('usageCostUsd({ inputTokens, outputTokens }, realRateFor(provider))');
  });
});
