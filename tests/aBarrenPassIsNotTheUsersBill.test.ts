/**
 * A PASS THAT DELIVERED NOTHING IS OUR COST, NEVER THE USER'S BILL (admin 2026-09-18, build b6f88a72).
 *
 * The turn-level half shipped first (`unbilledTurns.ts`) and could not reach this case, which is
 * where the money actually was: that build's post-build reviewer made **40 calls, spent 523,374 input
 * tokens = 34.4% of the build (≈₹12), returned `responseChars: 0` on every one** — and then timed out
 * with no verdict at all. Its turns were NOT starved; they completed and made tool calls, reading
 * `src/App.tsx` six times. Each TURN produced something. The PASS produced nothing.
 *
 * That was inexpressible, because `ProviderUsageLedger` recorded which VENDOR was paid and never what
 * FOR. These cases pin the dimension that fixes it, and — more importantly — every place the rule must
 * NOT reach: a review that was salvaged, one that landed late, and the unattributed remainder.
 *
 * Reversion-proven: the zone, the verdict and the settle were each removed in turn and the matching
 * cases observed to fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PHASE_POST_BUILD_REVIEW,
  NO_BARREN_PHASES,
  runInBillingPhase,
  currentBillingPhase,
} from '../src/server/AgentV3/billingPhase';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { billableEntries, splitUnbilledCost, type UnbilledAwareEntry } from '../src/server/AgentV3/unbilledTurns';
import { realProviderCostUsd } from '../src/server/AgentV3/providerRates';
import { ledgerCostUsd } from '../src/server/AgentV3/buildCostCeiling';
import { decideBuildBilledUsd, type BillingLedgerView } from '../src/server/routes/agentv3';
import { tieredMarkupUsd } from '../src/server/AgentV3/providerRates';

const KIMI = 'kimi-k2.7-code'; // $0.95 in / $4.00 out — a real row on the rate card
const BARREN: ReadonlySet<string> = new Set([PHASE_POST_BUILD_REVIEW]);

describe('the zone — a label that travels by itself', () => {
  it('is null outside any phase, which is where most turns are made', async () => {
    expect(currentBillingPhase()).toBeNull();
  });

  it('reaches every awaited descendant, so a sub-agent needs no line of its own', async () => {
    const seen: Array<string | null> = [];
    await runInBillingPhase(PHASE_POST_BUILD_REVIEW, async () => {
      seen.push(currentBillingPhase());
      await Promise.resolve();
      await (async () => { seen.push(currentBillingPhase()); })();
    });
    expect(seen).toEqual([PHASE_POST_BUILD_REVIEW, PHASE_POST_BUILD_REVIEW]);
    expect(currentBillingPhase()).toBeNull(); // …and it does not leak out
  });

  it('🔑 SURVIVES THE CALLER WALKING AWAY — the case this exists for', async () => {
    // `raceTimeout` gives up on the reviewer; the reviewer keeps running and keeps spending. Those
    // late turns are the money, and they are still inside the zone.
    const late: Array<string | null> = [];
    let settle: () => void = () => {};
    const slow = new Promise<void>((r) => { settle = r; });
    const abandoned = runInBillingPhase(PHASE_POST_BUILD_REVIEW, async () => {
      await slow;
      late.push(currentBillingPhase());
    });
    // The caller has moved on…
    expect(currentBillingPhase()).toBeNull();
    settle();
    await abandoned;
    expect(late).toEqual([PHASE_POST_BUILD_REVIEW]);
  });

  it('nesting takes the innermost phase, and a blank name opens no zone', async () => {
    await runInBillingPhase('outer', async () => {
      await runInBillingPhase('inner', async () => { expect(currentBillingPhase()).toBe('inner'); });
      expect(currentBillingPhase()).toBe('outer');
      // An empty key would silently merge with the un-phased turns it exists to be distinguished from.
      await runInBillingPhase('   ', async () => { expect(currentBillingPhase()).toBe('outer'); });
    });
  });

  it('a thrown pass still leaves the zone cleanly', async () => {
    await expect(runInBillingPhase(PHASE_POST_BUILD_REVIEW, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(currentBillingPhase()).toBeNull();
  });
});

describe('the ledger carries the phase, and splits rather than relabels', () => {
  it('keeps the same model in two slices when two phases spent it', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('KIMI', { inputTokens: 100, outputTokens: 50 }, KIMI);
    ledger.add('KIMI', { inputTokens: 900, outputTokens: 0 }, KIMI, { phase: PHASE_POST_BUILD_REVIEW });
    const entries = ledger.entries();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => !e.phase)!.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(entries.find((e) => e.phase === PHASE_POST_BUILD_REVIEW)!.usage).toEqual({ inputTokens: 900, outputTokens: 0 });
    // 🔒 More rows must change no total — every consumer of entries() sums.
    expect(ledger.total()).toEqual({ inputTokens: 1000, outputTokens: 50 });
    expect(realProviderCostUsd(entries)).toBeCloseTo(realProviderCostUsd([
      { provider: 'KIMI', model: KIMI, usage: { inputTokens: 1000, outputTokens: 50 } },
    ]), 12);
  });

  it('no phase ⇒ no field at all, so an un-zoned build is byte-for-byte today', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('GLM', { inputTokens: 10, outputTokens: 2 }, 'glm-5.3');
    expect(ledger.entries()[0]).not.toHaveProperty('phase');
  });

  it('a blank phase is treated as none, never as a slice of its own', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('GLM', { inputTokens: 10, outputTokens: 2 }, 'glm-5.3', { phase: '  ' });
    ledger.add('GLM', { inputTokens: 5, outputTokens: 1 }, 'glm-5.3');
    expect(ledger.entries()).toHaveLength(1);
  });
});

describe('a barren phase leaves the bill and stays in our cost', () => {
  const entries = (): UnbilledAwareEntry[] => [
    { provider: 'KIMI', model: KIMI, usage: { inputTokens: 100_000, outputTokens: 5_000 } },
    { provider: 'KIMI', model: KIMI, phase: PHASE_POST_BUILD_REVIEW, usage: { inputTokens: 523_374, outputTokens: 0 } },
  ];

  it('THE REPORTED CASE: the reviewer’s 523,374 tokens stop being the user’s bill', () => {
    const split = splitUnbilledCost(entries(), { inputTokens: 0, outputTokens: 0 }, BARREN);
    const productive = (100_000 / 1e6) * 0.95 + (5_000 / 1e6) * 4.0;
    const reviewer = (523_374 / 1e6) * 0.95;
    expect(split.billableCostUsd).toBeCloseTo(productive, 9);
    expect(split.absorbedCostUsd).toBeCloseTo(reviewer, 9);
    // …and we still record every rupee we really spent.
    expect(split.realCostUsd).toBeCloseTo(productive + reviewer, 9);
  });

  it('🔒 with NO verdict it is billed exactly as before — an empty set is today’s billing', () => {
    const split = splitUnbilledCost(entries(), { inputTokens: 0, outputTokens: 0 }, NO_BARREN_PHASES);
    expect(split.billableCostUsd).toBeCloseTo(split.realCostUsd, 12);
    expect(split.absorbedCostUsd).toBe(0);
    // …and the default argument is that same empty set.
    expect(splitUnbilledCost(entries()).absorbedCostUsd).toBe(0);
  });

  it('🔒 a barren phase and a starved turn OVERLAP without subtracting twice', () => {
    // The union rule. A starved turn inside a barren pass is in BOTH sets; adding them would hand
    // back money we never spent.
    const overlapping: UnbilledAwareEntry[] = [{
      provider: 'KIMI', model: KIMI, phase: PHASE_POST_BUILD_REVIEW,
      usage: { inputTokens: 1000, outputTokens: 0 },
      unbilled: { inputTokens: 1000, outputTokens: 0 },
    }];
    const split = splitUnbilledCost(overlapping, { inputTokens: 0, outputTokens: 0 }, BARREN);
    expect(split.absorbedCostUsd).toBeCloseTo(split.realCostUsd, 12); // the whole slice, ONCE
    expect(split.billableCostUsd).toBe(0);
    expect(split.absorbedCostUsd).toBeLessThanOrEqual(split.realCostUsd);
  });

  it('the cost ceiling and OUR cost still see every barren-phase token', () => {
    // A ceiling blind to a pass's spend is a ceiling a runaway pass walks straight past.
    const ledger = createProviderUsageLedger();
    ledger.add('KIMI', { inputTokens: 1_000_000, outputTokens: 0 }, KIMI, { phase: PHASE_POST_BUILD_REVIEW });
    expect(ledgerCostUsd(ledger.entries())).toBeCloseTo(0.95, 6);
    expect(splitUnbilledCost(ledger.entries(), { inputTokens: 0, outputTokens: 0 }, BARREN).billableCostUsd).toBe(0);
  });

  it('a DIFFERENT phase’s spend is untouched — the verdict is per phase, not global', () => {
    const mixed: UnbilledAwareEntry[] = [
      { provider: 'KIMI', model: KIMI, phase: 'some-other-pass', usage: { inputTokens: 1000, outputTokens: 0 } },
      { provider: 'KIMI', model: KIMI, phase: PHASE_POST_BUILD_REVIEW, usage: { inputTokens: 1000, outputTokens: 0 } },
    ];
    const split = splitUnbilledCost(mixed, { inputTokens: 0, outputTokens: 0 }, BARREN);
    expect(split.billableCostUsd).toBeCloseTo((1000 / 1e6) * 0.95, 9);
  });

  it('🔒 the unattributed remainder can never be reached by a verdict', () => {
    // We have no per-turn record of the aux calls at all, so we cannot claim any of them produced
    // nothing — and they carry no phase for a verdict to match.
    const split = splitUnbilledCost(
      [{ provider: 'KIMI', model: KIMI, phase: PHASE_POST_BUILD_REVIEW, usage: { inputTokens: 10, outputTokens: 0 } }],
      { inputTokens: 50_000, outputTokens: 5_000 },
      BARREN,
    );
    expect(split.billableCostUsd).toBeGreaterThan(0);
  });

  it('billableEntries never mutates its input — our cost still needs the full figures', () => {
    const list = entries();
    billableEntries(list, BARREN);
    expect(list[1].usage).toEqual({ inputTokens: 523_374, outputTokens: 0 });
  });
});

describe('the settle bills from the verdict, on BOTH exits', () => {
  function ledgerView(entries: UnbilledAwareEntry[]): BillingLedgerView {
    const byProvider: Record<string, { inputTokens: number; outputTokens: number }> = {};
    let ti = 0, to = 0;
    for (const e of entries) {
      byProvider[e.provider] ??= { inputTokens: 0, outputTokens: 0 };
      byProvider[e.provider].inputTokens += e.usage.inputTokens;
      byProvider[e.provider].outputTokens += e.usage.outputTokens;
      ti += e.usage.inputTokens; to += e.usage.outputTokens;
    }
    return { entries: () => entries, byProvider: () => byProvider, total: () => ({ inputTokens: ti, outputTokens: to }) };
  }

  const list: UnbilledAwareEntry[] = [
    { provider: 'KIMI', model: KIMI, usage: { inputTokens: 100_000, outputTokens: 5_000 } },
    { provider: 'KIMI', model: KIMI, phase: PHASE_POST_BUILD_REVIEW, usage: { inputTokens: 523_374, outputTokens: 0 } },
  ];
  const sink = { inputTokens: 623_374, outputTokens: 5_000 };

  it('the markup is applied to the productive half only, and the rest is named', () => {
    const r = decideBuildBilledUsd(ledgerView(list), sink, 'off', null, null, 0, BARREN);
    const productive = (100_000 / 1e6) * 0.95 + (5_000 / 1e6) * 4.0;
    const reviewer = (523_374 / 1e6) * 0.95;
    expect(r.effectiveBilledUsd).toBeCloseTo(tieredMarkupUsd(productive), 9);
    expect(r.realCostUsd).toBeCloseTo(productive + reviewer, 9);
    expect(r.absorbedUnbilledUsd).toBeCloseTo(reviewer, 9);
  });

  it('🔒 omitting the verdict bills exactly as before — every existing caller is unchanged', () => {
    const r = decideBuildBilledUsd(ledgerView(list), sink, 'off', null, null);
    expect(r.absorbedUnbilledUsd).toBe(0);
    expect(r.effectiveBilledUsd).toBeCloseTo(tieredMarkupUsd(r.realCostUsd), 9);
  });

  it('the OPUS tier is untouched, as CLAUDE.md records it admin-confirmed', () => {
    const opus = decideBuildBilledUsd(ledgerView(list), sink, 'medium', null, null, 0, BARREN);
    const plain = decideBuildBilledUsd(ledgerView(list), sink, 'medium', null, null);
    expect(opus.effectiveBilledUsd).toBe(plain.effectiveBilledUsd);
  });
});

describe('REVERSION GUARDS — the wiring lives in a 20k-line route no unit test can drive', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the reviewer runs inside its billing phase', () => {
    expect(route).toContain('runInBillingPhase(PHASE_POST_BUILD_REVIEW');
  });

  it('every turn is tagged from the ZONE, not from a caller that might forget', () => {
    expect(route).toContain('const phase = currentBillingPhase() ?? undefined;');
    expect(route).toMatch(/providerLedger\.add\([\s\S]{0,260}\.\.\.\(phase \? \{ phase \} : \{\}\)/);
  });

  it('🔴 the verdict is recorded ONLY where the review delivered nothing', () => {
    const at = route.indexOf('barrenPhases.add(PHASE_POST_BUILD_REVIEW)');
    expect(at, 'the verdict is not recorded at all').toBeGreaterThan(-1);
    // It must sit with REVIEW_INCOMPLETE — never with the salvage or the late-collection branches,
    // both of which DELIVERED something and must stay billable.
    const after = route.slice(at, at + 400);
    expect(after).toContain('REVIEW_INCOMPLETE');
    expect(route.match(/barrenPhases\.add\(/g) ?? []).toHaveLength(1);
    // And the two branches it must NOT be in:
    const partial = route.indexOf('REVIEW_PARTIAL');
    const late = route.indexOf('REVIEW_LATE');
    for (const other of [partial, late]) {
      expect(other).toBeGreaterThan(-1);
      expect(Math.abs(other - at), 'the verdict sits in a branch that DID deliver').toBeGreaterThan(200);
    }
  });

  it('BOTH settle paths pass the same verdict — Fix 67 is what their drifting cost', () => {
    // A `[^)]*` window cannot be used here: the argument list itself contains calls like
    // `buildUsage.total()`, so the first `)` is not the call's own.
    expect(route.match(/decideBuildBilledUsd\([\s\S]{0,220}?barrenPhases\)/g) ?? []).toHaveLength(2);
  });

  it('the verdict set is declared ABOVE the deadline finalizer that closes over it', () => {
    // Correct by placement rather than by timing: a `const` referenced from a function defined
    // earlier is only safe while nobody calls that function synchronously first.
    expect(route.indexOf('const barrenPhases = new Set<string>()')).toBeLessThan(route.indexOf('const finalizeOnDeadline'));
  });
});
