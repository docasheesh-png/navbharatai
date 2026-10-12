/**
 * THE BILL OF REPORT 9c612cdb, TO THE CENT — and the two documents that described it wrongly (Q-956).
 *
 * The bill was right: real provider cost $0.274781 (Kimi's 896,000 cache-read tokens at Kimi's $0.19 cache
 * rate, the fast lane's GLM counted once) + sandbox $0.020972, × the Weak 4× markup = $1.183010 (₹114.71),
 * then the admin's 10% build discount = $1.064709 (₹103.24). What was WRONG was the description: the rate
 * card's header (providerRates.ts) and ROUTING_AND_BILLING.md both said cache hits were not tracked and were
 * priced at the full cache-MISS rate. That has been false since Fix 66 (#1434, 2026-07-16). At the miss rate
 * this build would have cost about ₹341 — so the stale sentence misstated our own bill by more than 3×.
 *
 * Asserted in USD only, with every price and markup env cleared, so the live USD→INR rate (Q-881's) and a
 * Cloud Run override cannot move the numbers. A drift in the formula fails on a real build's own tokens.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { realProviderCostUsd, realRateFor, tieredMarkupUsd, type ProviderCostEntry } from '../src/server/AgentV3/providerRates';
import { applyBuildDiscount } from '../src/server/lib/buildDiscount';

/** Env that would move a price or a markup; cleared for the test and put back afterwards. */
const MOVES_A_PRICE = /^(RATE_|AGENTV3_MARKUP_|E2B_|OPUS_|SONNET_|HAIKU_)/;
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of Object.keys(process.env)) {
    if (MOVES_A_PRICE.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v !== undefined) process.env[k] = v; }
});

/** The report's providerTokens, as the ledger attributed them (models from its LLM-call log). */
const ENTRIES: ProviderCostEntry[] = [
  { provider: 'KIMI', model: 'kimi-k2.7-code', usage: { inputTokens: 959_769, outputTokens: 10_706, cacheReadInputTokens: 896_000 } },
  { provider: 'GLM', model: 'glm-4.7-flashx', usage: { inputTokens: 8_508, outputTokens: 1_354, cacheReadInputTokens: 19 } },
];
const SANDBOX_USD = 0.020972;
const REPORT = { realCostUsd: 0.274781, billedUsd: 1.064709, discountPct: 10 };

describe('report 9c612cdb, recomputed with the code\'s own functions', () => {
  it('🔒 real provider cost = $0.274781 — cache reads at each provider\'s cache rate', () => {
    expect(realProviderCostUsd(ENTRIES)).toBeCloseTo(REPORT.realCostUsd, 6);
  });

  it('🔒 the bill = tieredMarkup(real + sandbox), then the 10% discount = $1.064709', () => {
    const real = realProviderCostUsd(ENTRIES);
    const list = tieredMarkupUsd(real + SANDBOX_USD);
    expect(list).toBeCloseTo(1.18301, 5);
    const paid = applyBuildDiscount({ billedUsd: list, floorUsd: real + SANDBOX_USD, pct: REPORT.discountPct });
    expect(Math.abs(paid.payUsd - REPORT.billedUsd)).toBeLessThan(1e-5);
  });

  it('the fast lane\'s GLM is counted ONCE (twice would not reproduce the report)', () => {
    const twice = realProviderCostUsd([...ENTRIES, ENTRIES[1]]);
    expect(Math.abs(twice - REPORT.realCostUsd)).toBeGreaterThan(1e-6);
  });

  it('pricing the cache hits at the miss rate would have tripled our own cost — the claim the docs made', () => {
    const atMissRate = realProviderCostUsd(ENTRIES.map((e) => ({ ...e, usage: { inputTokens: e.usage.inputTokens, outputTokens: e.usage.outputTokens } })));
    expect(atMissRate).toBeCloseTo(0.955742, 5);
    expect(atMissRate / REPORT.realCostUsd).toBeGreaterThan(3);
  });
});

describe('🔒 DOC TRUTH — nothing says cache hits are priced at the miss rate while a cache rate is in force', () => {
  const kimi = realRateFor('KIMI', 'kimi-k2.7-code');
  const STALE = [/priced at the full cache-?miss rate/i, /cache-hit input tokens are (not|NOT)( yet)? tracked separately/i, /not (yet )?tracked separately/i];
  const FILES = ['src/server/AgentV3/providerRates.ts', 'docs/claude/ROUTING_AND_BILLING.md'];

  it('the premise holds: a ladder model\'s cache-read rate is below its input rate', () => {
    expect(typeof kimi.cacheReadPerMTok).toBe('number');
    expect(kimi.cacheReadPerMTok as number).toBeLessThan(kimi.inputPerMTok);
  });

  for (const file of FILES) {
    it(`${file} does not claim the miss rate`, () => {
      const text = readFileSync(join(__dirname, '..', file), 'utf8');
      for (const re of STALE) {
        const m = re.exec(text);
        expect(m, `${file} still says "${m?.[0]}" — false since Fix 66 (cache reads are priced at the cache rate)`).toBeNull();
      }
    });
  }

  it('and the binding doc\'s formula names the sandbox share it bills', () => {
    const doc = readFileSync(join(__dirname, '..', 'docs/claude/ROUTING_AND_BILLING.md'), 'utf8');
    expect(doc.includes('`bill = tieredMarkup( REAL provider cost + sandbox share )`'), 'the formula omits the sandbox share (ENV_REGISTRY.md bills it before the markup)').toBe(true);
  });
});
