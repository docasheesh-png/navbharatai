// A COMPLETED WEAK BUILD WHOSE SURPLUS RECEIPTS DID NOT SETTLE IS STILL BILLED (failedbr #2487; owner decision 2026-11-22:
// "yahi to hamara revenue hai, yaha ₹0 charge galat hai" — chosen option "Tokens se andaaza × niyam").
//
// 🧬 TWO CLASSES:
//   1. ALL-OR-NOTHING ABSORB — one Surplus call without a valid receipt made `surplusBuildCharges` throw, and the whole
//      build's Surplus spend was absorbed at ₹0, settled calls included. Now each call stands on its own.
//   2. A FINISHED, WORKING BUILD WITH UNSETTLED RECEIPTS WAS FREE — only a user Stop had an estimate (BR2279). Now the
//      unsettled calls' recorded tokens are estimated at the cheapest published Surplus rate, with the ordinary markup.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { surplusBuildCharges } from '../src/server/AgentV3/surplusBuildBilling';
import { createProviderUsageLedger } from '../src/server/AgentV3/ProviderUsageLedger';
import { evaluateSurplusReceipt, type SurplusReceiptPolicyInput } from '../src/server/AI/SurplusRegistry/receiptPolicy';
import {
  decideSurplusStopTokenFloor, maybeApplySurplusUnsettledEstimate, SURPLUS_UNSETTLED_COST_ESTIMATED, SURPLUS_STOP_COST_ESTIMATED,
  SURPLUS_UNSETTLED_ESTIMATE_FLAG, surplusStopTokenFloorAdminMessage, cheapestPublishedSurplusRate,
} from '../src/server/AgentV3/surplusStopTokenFloor';
import { tieredMarkupUsd } from '../src/server/AgentV3/providerRates';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** The tokens recorded on failedbr #2487 (providerTokens.SURPLUS). */
const BR2487 = { inputTokens: 2_755_267, outputTokens: 10_648, cacheReadInputTokens: 2_155_568, cacheCreationInputTokens: 0 };

function receipt(callId: string): SurplusReceiptPolicyInput {
  const binding = { buildId: 'build', callId, accountId: 'account', modelId: 'synthetic', modelVersion: 'v1',
    providerId: 'seller', endpoint: 'https://api.surplusintelligence.ai/min90/v1', offerId: null, startedAt: 1000 };
  return { provider: 'surplus', product: 'app-builder', binding, disposition: 'accepted', now: 1200,
    receipt: { ...binding, kind: 'validated-surplus-response', identitySource: 'provider-response-id', receiptId: `receipt-${callId}`,
      requestId: `request-${callId}`, currency: 'USD', buyerCostMicro: '1000', costSource: 'usage.buyer_cost_micro',
      responseComplete: true, receivedAt: 1100, evidenceSha256: 'a'.repeat(64), additionalCharges: 'none',
      usage: { semantics: 'disjoint-token-counts-v1', mappingReviewId: 'usage-review',
        tokens: { input: '1000', output: '100', cacheRead: '0', cacheWrite: '0', reasoning: '0' } } },
    tariff: { kind: 'reviewed-official-provider-tariff', snapshotId: 'tariff', sourceUrl: 'https://official.example/pricing',
      artifactSha256: 'b'.repeat(64), reviewId: 'review', reviewedAt: 900, reviewExpiresAt: 2000,
      effectiveFrom: 800, effectiveUntil: null, observedAt: 850, surplusModelId: 'synthetic', surplusModelVersion: 'v1',
      officialModelId: 'official-synthetic', officialModelVersion: 'v1', modelMappingReviewId: 'model-review',
      usageMappingReviewId: 'usage-review', currency: 'USD', billingBasis: 'tokens-only',
      usdPerMillionTokens: { input: '10', output: '10', cacheRead: '0', cacheWrite: '0', reasoning: '0' } } };
}

beforeEach(() => { vi.unstubAllEnvs(); });

describe('1 · one unsettled receipt no longer zeroes the whole build', () => {
  it('settled calls are charged by their own receipts; the unsettled call is set aside with its tokens', () => {
    const ledger = createProviderUsageLedger();
    ledger.add('SURPLUS', { inputTokens: 1000, outputTokens: 100, surplusReceipt: evaluateSurplusReceipt(receipt('a')) }, 'synthetic');
    ledger.add('SURPLUS', { inputTokens: 1000, outputTokens: 100, surplusReceipt: evaluateSurplusReceipt(receipt('b')) }, 'synthetic');
    ledger.add('SURPLUS', { inputTokens: 900_000, outputTokens: 4000 }, 'synthetic');           // no receipt at all
    const all = surplusBuildCharges(ledger.entries(), new Set());
    const onlySettled = surplusBuildCharges(ledger.entries().slice(0, 2), new Set());
    expect(all.chargeUsd).toBe(onlySettled.chargeUsd);
    expect(Number(all.chargeUsd)).toBeGreaterThan(0);                                            // put the throw back ⇒ the whole build is ₹0
    expect(all.unsettled).toHaveLength(1);
    expect(all.unsettled[0].usage.inputTokens).toBe(900_000);
  });
  it('a receipt seen twice with different evidence: the repeat is unsettled, the first still counts', () => {
    const ledger = createProviderUsageLedger();
    const r = evaluateSurplusReceipt(receipt('a'));
    ledger.add('SURPLUS', { inputTokens: 1000, outputTokens: 100, surplusReceipt: r }, 'synthetic');
    ledger.add('SURPLUS', { inputTokens: 1000, outputTokens: 100, surplusReceipt: { ...r, userChargeUsd: '9' } as typeof r }, 'synthetic');
    const out = surplusBuildCharges(ledger.entries(), new Set());
    expect(out.unsettled).toHaveLength(1);
    expect(Number(out.chargeUsd)).toBeGreaterThan(0);
  });
  it('the route bills settled calls and hands only the UNSETTLED calls\' tokens to the estimate, at both billing points', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('const surplusUnsettledAbsorbed = surplus.unsettled.length > 0;');
    expect(route).toContain('surplusUnsettledUsage: surplusTokenUsageFromLedger(surplus.unsettled)');
    expect(route).toContain('usage: decided.surplusUnsettledUsage ?? surplusTokenUsageFromLedger([]),');   // deadline finalizer
    expect(route).toContain('usage: surplusUnsettledUsage ?? surplusTokenUsageFromLedger([]),');           // normal settle
    expect(route).toContain('decided.realCostUsd += watchdogSurplusStopFloor.costUsd;');
    expect(route).toContain('decidedRealCostUsd += surplusStopFloor.costUsd;');
    expect(route).not.toMatch(/surplusTokenUsageFromLedger\((?:billingCtx\.)?providerLedger\.entries\(\)\)/);   // never ALL Surplus tokens again
  });
});

describe('2 · a completed Weak build with unsettled receipts is billed an estimate', () => {
  const facts = {
    powerLevel: 'weak', surplusUnsettledAbsorbed: true, abortCause: 'none', builderWroteCount: 9,
    previewProven: true, freeListed: false, usage: BR2487,
  };
  it('the #2487 build: cost from recorded tokens at the cheapest published rate, with the ordinary markup, labelled', () => {
    const d = maybeApplySurplusUnsettledEstimate(facts, {})!;
    expect(d).not.toBeNull();
    expect(d.kind).toBe('completed-estimate');
    expect(d.code).toBe(SURPLUS_UNSETTLED_COST_ESTIMATED);
    expect(d.costUsd).toBeCloseTo(cheapestPublishedSurplusRate(BR2487)!.usd, 6);
    expect(d.costUsd).toBeGreaterThan(0.05);                                                       // the build was not free
    expect(d.usd).toBeCloseTo(Math.min(tieredMarkupUsd(d.costUsd), d.ceilingUsd), 6);
    expect(d.usd).toBeGreaterThanOrEqual(d.costUsd);
    expect(d.usd).toBeLessThanOrEqual(d.ceilingUsd);
    expect(surplusStopTokenFloorAdminMessage(d)).toMatch(/receipts did not settle[\s\S]*input=2755267[\s\S]*Labelled estimated/);
  });
  it('only when every gate holds', () => {
    const none = (over: Partial<typeof facts> & { alreadyZeroedReason?: string }) => maybeApplySurplusUnsettledEstimate({ ...facts, ...over }, {});
    expect(none({ powerLevel: 'normal' })).toBeNull();
    expect(none({ surplusUnsettledAbsorbed: false })).toBeNull();                                // every receipt settled: billed by receipts
    expect(none({ abortCause: 'user-stop' })).toBeNull();                                          // the stop floor owns a stop
    expect(none({ previewProven: false })).toBeNull();                                             // the markup is earned by a preview
    expect(none({ builderWroteCount: 0 })).toBeNull();
    expect(none({ freeListed: true })).toBeNull();
    expect(none({ alreadyZeroedReason: 'preview did not render' })).toBeNull();
    expect(none({ usage: { inputTokens: 0, outputTokens: 0 } })).toBeNull();
    expect(maybeApplySurplusUnsettledEstimate(facts, { [SURPLUS_UNSETTLED_ESTIMATE_FLAG]: 'off' })).toBeNull();
  });
  it('the one decision for both billing points: a stop gets the at-cost floor, a completed build the estimate — never both', () => {
    const settle = (abortCause: string, previewProven: boolean) => decideSurplusStopTokenFloor({
      powerLevel: 'weak', surplusUnsettledAbsorbed: true, abortCause,
      writtenFiles: new Map([['src/game/features/traffic.ts', 'export {}']]), previewProven, freeListed: false, usage: BR2487,
      expectsArtifacts: true, previewVerifiedFailed: false, emptyBuildOk: true,
    }, {});
    const stop = settle('user-stop', false)!;
    expect(stop.code).toBe(SURPLUS_STOP_COST_ESTIMATED);
    expect(stop.usd).toBe(stop.costUsd);                                                           // BR2279 unchanged: at cost
    const done = settle('none', true)!;
    expect(done.code).toBe(SURPLUS_UNSETTLED_COST_ESTIMATED);
    expect(settle('none', false)).toBeNull();                                                      // finished but no preview ran
  });
});

describe('3 · documented as the owner decided it', () => {
  it('ROUTING_AND_BILLING and ENV_REGISTRY carry the decision and the kill switch', () => {
    expect(read('docs/claude/ROUTING_AND_BILLING.md')).toMatch(/2026-11-22[\s\S]*SURPLUS_UNSETTLED_COST_ESTIMATED/);
    expect(read('docs/claude/ENV_REGISTRY.md')).toContain(SURPLUS_UNSETTLED_ESTIMATE_FLAG);
  });
});
