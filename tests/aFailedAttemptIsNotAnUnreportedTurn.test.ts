// 🔴 Q-2920 / Q-2931 (failedbr #2449/#2450/#2475; admin decision 2026-11-19, option a). Surplus's failure path reported a
// failed, retried attempt as a zero-token turn, so the report said "a provider returned no token usage — cost is an
// under-estimate" while the ANSWERED turn had reported 1253/4 (#2449) and 21,684/474 (#2475). A failed attempt is now
// judged by its receipt: a provider-reported cost ⇒ nothing to say; none ⇒ FAILED_ATTEMPT_COST_UNKNOWN, never zero.
// The user's bill is untouched (reporting only). Reversion: drop `failedAttempt: true` from buildSession's onFailure, or
// the verdict gate in the route, and this fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { failedAttemptCostVerdict } from '../src/server/AI/SurplusRegistry/failedAttemptCost';
import type { SurplusReceiptDecision } from '../src/server/AI/SurplusRegistry/receiptPolicy';
import { USER_HIDDEN_BILLING_METHOD_CODES } from '../src/server/AgentV3/BuildDiagnostics';

const receipt = (over: Partial<SurplusReceiptDecision>) => ({ expenseEvidence: 'unknown', actualCostUsd: null, ...over }) as SurplusReceiptDecision;
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('a failed attempt is judged by its receipt', () => {
  it('not a failed attempt ⇒ null (the old USAGE_NOT_REPORTED judgement applies)', () => {
    expect(failedAttemptCostVerdict({ })).toBeNull();
    expect(failedAttemptCostVerdict(undefined)).toBeNull();
  });
  it('provider-reported actual cost ⇒ known (nothing to warn about)', () => {
    expect(failedAttemptCostVerdict({ failedAttempt: true, surplusReceipt: receipt({ expenseEvidence: 'provider-reported-actual', actualCostUsd: '0.0004' }) })).toBe('known');
  });
  it('no receipt, or an unknown cost ⇒ unknown (never zero)', () => {
    expect(failedAttemptCostVerdict({ failedAttempt: true })).toBe('unknown');
    expect(failedAttemptCostVerdict({ failedAttempt: true, surplusReceipt: receipt({}) })).toBe('unknown');
    expect(failedAttemptCostVerdict({ failedAttempt: true, surplusReceipt: receipt({ expenseEvidence: 'provider-reported-actual', actualCostUsd: null }) })).toBe('unknown');
  });
});

describe('the wiring', () => {
  it("Surplus's failure path marks its result as a failed attempt", () => {
    expect(read('src/server/AI/SurplusRegistry/buildSession.ts')).toMatch(/measured: false, failedAttempt: true \}/);
  });
  it('the route never files a failed attempt as USAGE_NOT_REPORTED', () => {
    expect(read('src/server/routes/agentv3.ts')).toContain('if (failedAttemptVerdict === null && usage.measured === false && !usageUnreportedFired)');
  });
  it('the new code is a billing-method code users never see (white-label)', () => {
    expect(USER_HIDDEN_BILLING_METHOD_CODES.has('FAILED_ATTEMPT_COST_UNKNOWN')).toBe(true);
  });
});
