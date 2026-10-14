/**
 * THE BILL OF REPORT 9c612cdb, TO THE CENT — and the two documents that described it wrongly (Q-996).
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
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { applyBuildDiscount } from '../src/server/lib/buildDiscount';
import { sandboxBillableUsd } from '../src/server/AgentV3/sandboxCost';

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

  /**
   * 🔴 THIS TEST COULD NOT FAIL, AND IT IS THE WORST KIND OF DEFECT (Q-1035).
   *
   * It used to read:
   *
   *     const twice = realProviderCostUsd([...ENTRIES, ENTRIES[1]]);
   *     expect(Math.abs(twice - REPORT.realCostUsd)).toBeGreaterThan(1e-6);
   *
   * `realProviderCostUsd` is a SUM over its argument. Handing a sum an extra entry changes the total —
   * that is a property of addition, not of this system, and it holds no matter how the ledger behaves.
   * The test was named for a claim about the LEDGER ("GLM is counted ONCE") while asserting something
   * arithmetic could never disprove. A test that cannot fail is worse than no test: it produces the
   * exact confidence a real double count would need in order to pass unnoticed.
   *
   * 🧬 AND THE SIMULATION WAS WRONG TOO, which is why it could never have caught the bug even in
   * principle. The ledger keys its slices by provider + model + phase, so recording the same GLM turn
   * twice yields ONE slice with DOUBLED tokens — never the two separate entries the old array
   * modelled. The shape it was testing for cannot occur.
   *
   * So the claim is now checked where it lives: the cost is reproduced THROUGH the ledger, and a
   * ledger that recorded one extra GLM turn is asserted to be both more expensive AND visibly so.
   *
   * ⚠️ WHAT IS DELIBERATELY NOT ASSERTED: how many GLM calls the real build logged. Q-1003 records GLM
   * crawling TWICE on this very report, so "GLM answered once" is not a verified fact and this test
   * will not pretend otherwise. `ENTRIES` are the report's merged SLICES; the call count below is a
   * property of this test's own construction, used only to prove a double record is detectable.
   */
  it('🔒 the cost is reproducible THROUGH the ledger, and a double record is visible and more expensive', () => {
    const once = createProviderUsageLedger();
    for (const e of ENTRIES) once.add(e.provider, e.usage, e.model);
    // The report's figure comes back out of the ledger's own entries, not a hand-written array.
    expect(realProviderCostUsd(once.entries())).toBeCloseTo(REPORT.realCostUsd, 6);

    // What a REAL double count looks like: the same GLM turn recorded a second time.
    const twice = createProviderUsageLedger();
    for (const e of ENTRIES) twice.add(e.provider, e.usage, e.model);
    twice.add(ENTRIES[1].provider, ENTRIES[1].usage, ENTRIES[1].model);

    const glm = twice.entries().filter((e) => e.provider === 'GLM');
    expect(glm).toHaveLength(1); // merged into one slice — NOT the two entries the old test simulated
    expect(glm[0].usage.inputTokens).toBe(ENTRIES[1].usage.inputTokens * 2);
    expect(glm[0].usage.outputTokens).toBe(ENTRIES[1].usage.outputTokens * 2);
    // The ledger SAYS it happened, so a double count cannot hide behind a plausible total.
    expect(twice.callsByProvider?.().GLM).toBe((once.callsByProvider?.().GLM ?? 0) + 1);
    // And it costs more, which is the consequence the user would have paid for.
    expect(realProviderCostUsd(twice.entries())).toBeGreaterThan(REPORT.realCostUsd);
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

  /**
   * Adversarial review of this fix: the first corrected text said the share is billed "when
   * AGENTV3_BILL_SANDBOX=on" — but the code ALSO requires E2B_USD_PER_HOUR to be set, and bills zero on the
   * flag alone. A money description naming one condition of two is the same class as the cache sentence.
   */
  it('and both describe the sandbox share with BOTH conditions the code checks', () => {
    const cost = { seconds: 600, usd: SANDBOX_USD, estimated: true as const };
    // The code's own rule, so the premise is measured, not assumed.
    expect(sandboxBillableUsd(cost, { AGENTV3_BILL_SANDBOX: 'on' } as NodeJS.ProcessEnv)).toBe(0);
    expect(sandboxBillableUsd(cost, { E2B_USD_PER_HOUR: '0.1' } as NodeJS.ProcessEnv)).toBe(0);
    expect(sandboxBillableUsd(cost, { AGENTV3_BILL_SANDBOX: 'on', E2B_USD_PER_HOUR: '0.1' } as NodeJS.ProcessEnv)).toBe(SANDBOX_USD);
    for (const file of FILES) {
      const text = readFileSync(join(__dirname, '..', file), 'utf8');
      const sentence = /sandbox(?:'s measured)? share is [^.]*?BEFORE the markup[^.]*\./i.exec(text)?.[0] ?? '';
      expect(sentence, `${file} has no sentence saying when the sandbox share is billed`).not.toBe('');
      expect(sentence, `${file}: "${sentence}" must name the flag`).toMatch(/AGENTV3_BILL_SANDBOX=on/);
      expect(sentence, `${file}: "${sentence}" must name the rate as the second condition`).toMatch(/BOTH[\s\S]*E2B_USD_PER_HOUR[\s\S]*set/);
    }
  });
});
