import { describe, expect, it } from 'vitest';
import { freeChainMetricsFixture, freeChainViewFixture } from '../../tests/freeChatChainFixtures';
import { adminAuditRow, isAdminAuditEvent } from './adminAuditEvents';
import { readFreeChainBudgetAction, isFreeChainBudgetResponse, freeChainBudgetFingerprint, freeChainControls, freeChainControlFingerprint, freeChainPercent, freeChainUsd, freeChainTimestamp, isFreeChainAdminMetrics, isFreeChainAdminView, readFreeChainControlAction, validFreeChainReason } from './freeChatChainView';

const expectedControls = { enabled: true, rolloutPercent: 0, disabledProviders: [] };
const action = { enabled: false, reason: 'Investigating provider errors', expectedControls };
describe('credential-free chain response validation', () => {
  it('accepts an unavailable measurement without inventing a zero', () => {
    expect(isFreeChainAdminView(freeChainViewFixture())).toBe(true);
    expect(freeChainPercent(null)).toBe('Not measured'); expect(freeChainPercent(undefined)).toBe('Not measured');
    expect(freeChainUsd(null)).toBe('Unavailable'); expect(freeChainTimestamp(null)).toBe('Not available');
    expect(freeChainPercent(0)).toBe('0.0%'); expect(freeChainUsd(0)).toBe('$0.0000 USD'); expect(freeChainUsd(0.000001)).toBe('<$0.0001 USD');
  });
  it.each([null, {}, { error: 'no' }, { ...freeChainViewFixture(), providers: [] }, { ...freeChainViewFixture(), paid: {} }, { ...freeChainViewFixture(), allowListConfigured: undefined }, { ...freeChainViewFixture(), rolloutPercent: 101 }, { ...freeChainViewFixture(), order: undefined }, { ...freeChainViewFixture(), order: ['groq', 'groq'] }, { ...freeChainViewFixture(), order: ['unknown'] }])('rejects malformed snapshot %#', v => expect(isFreeChainAdminView(v)).toBe(false));
  it('rejects duplicate and unknown rungs instead of hiding a missing provider', () => {
    const view = freeChainViewFixture(); view.providers[4] = { ...view.providers[0] };
    expect(isFreeChainAdminView(view)).toBe(false);
    expect(isFreeChainAdminView({ ...view, providers: [{ id: 'not-a-provider' }] })).toBe(false);
  });
  it('rejects non-finite, negative, out-of-range and string measurements', () => {
    const valid = freeChainViewFixture();
    for (const value of [NaN, Infinity, -1, '0', undefined]) {
      expect(isFreeChainAdminView({ ...valid, paid: { ...valid.paid, reservedUsd: value } })).toBe(false);
    }
    valid.providers[0].usage = { requestsDay: 'not measured' as unknown as number };
    expect(isFreeChainAdminView(valid)).toBe(false);
  });
  it('validates circuit and reset data before rendering it', () => {
    const view = freeChainViewFixture();
    view.providers[0].circuit = { state: 'open', openedUntil: 1000 }; view.providers[0].nextResetAt = 1500;
    expect(isFreeChainAdminView(view)).toBe(true);
    view.providers[0].circuit.openedUntil = -1; expect(isFreeChainAdminView(view)).toBe(false);
  });
});

describe('control allowlist and optimistic concurrency', () => {
  it('accepts bounded changes and preserves the exact prior control snapshot', () => {
    expect(readFreeChainControlAction(action)).toEqual(action);
    expect(readFreeChainControlAction({ rolloutPercent: 5, reason: '  Limited rollout expansion  ', expectedControls })).toEqual({ rolloutPercent: 5, reason: 'Limited rollout expansion', expectedControls });
    expect(readFreeChainControlAction({ disabledProviders: ['groq'], reason: action.reason, expectedControls })).not.toBeNull();
  });
  it.each([{}, null, { reason: action.reason, expectedControls }, { ...action, expectedControls: undefined }, { ...action, expectedControls: { enabled: true } }, { ...action, expectedControls: { ...expectedControls, disabledProviders: ['groq', 'groq'] } }, { ...action, enabled: 'off' }, { ...action, rolloutPercent: -1 }, { ...action, rolloutPercent: 0.5 }, { ...action, rolloutPercent: 101 }, { ...action, rolloutPercent: NaN }, { ...action, rolloutPercent: '5' }, { ...action, disabledProviders: ['unknown'] }, { ...action, disabledProviders: ['gemini', 'gemini'] }, { ...action, capUsd: 100 }, { ...action, apiKey: 'must-never-pass' }, { ...action, actor: 'spoof' }, { ...action, reason: 'short' }, { ...action, reason: 'x'.repeat(501) }])('rejects malformed or unapproved control %#', v => expect(readFreeChainControlAction(v)).toBeNull());
  it('a control fingerprint is stable across provider ordering, not blind to a change', () => {
    const view = freeChainViewFixture(); view.providers[0].disabled = true; view.providers[2].disabled = true;
    const reversed = { ...view, providers: [...view.providers].reverse() };
    expect(freeChainControlFingerprint(view)).toBe(freeChainControlFingerprint(reversed));
    expect(freeChainControls(view).disabledProviders).toEqual(['glm47', 'groq']);
    expect(freeChainControlFingerprint({ ...view, runtimeEnabled: false })).not.toBe(freeChainControlFingerprint(view));
  });
  it('reason boundaries are the same in client and server', () => {
    expect(validFreeChainReason(' '.repeat(20))).toBe(false); expect(validFreeChainReason('x'.repeat(10))).toBe(true);
    expect(validFreeChainReason('x'.repeat(500))).toBe(true); expect(validFreeChainReason('x'.repeat(501))).toBe(false);
  });
  it('controls have a readable target in the existing admin audit log', () => {
    expect(isAdminAuditEvent('ADMIN_FREE_CHAT_CHAIN_CONTROL')).toBe(true);
    expect(isAdminAuditEvent('ADMIN_FREE_CHAT_CHAIN_CONTROL_FAILED')).toBe(true);
    expect(adminAuditRow({ event: 'ADMIN_FREE_CHAT_CHAIN_CONTROL', admin: 'owner', controlTarget: 'free-chat-chain', reason: action.reason, result: 'ok' })).toMatchObject({ actor: 'owner', target: 'free-chat-chain', reason: action.reason, result: 'ok' });
  });
});

describe('separate on-demand history schema', () => {
  it('accepts an observed empty sample with unknown rates, not an unobserved status placeholder', () => {
    expect(isFreeChainAdminMetrics(freeChainMetricsFixture())).toBe(true);
    expect(isFreeChainAdminMetrics(freeChainViewFixture())).toBe(false);
    expect(freeChainViewFixture()).not.toHaveProperty('metrics');
  });
  it.each([null, {}, { observedAt: undefined }, { observedAt: -1 }, { observedAt: Infinity }, { observedAt: 8.65e15 }, { scanLimit: 4097 }, { sampleCount: 4097 }, { sampleCount: 0.5 }, { complete: true }, { fallbackRate: 1.01 }, { cacheHitRate: -1 }, { p95Ms: NaN }, { shareByProvider: { secrets: 1 } }])('rejects missing timestamps, false census claims and unbounded metrics %#', over => {
    expect(isFreeChainAdminMetrics(over === null ? null : Object.keys(over).length ? { ...freeChainMetricsFixture(), ...over } : {})).toBe(false);
  });
});


describe('durable paid budget action and response schema', () => {
  const budget = { capUsd: 0, expectedRevision: 7, reason: 'Emergency paid fallback stop' };
  it.each([0, 0.01, 0.29, 2.5, 10])('accepts deliberate bounded USD edits %s', capUsd => {
    expect(readFreeChainBudgetAction({ ...budget, capUsd })).toEqual({ ...budget, capUsd });
  });
  it.each([null, {}, { capUsd: 10.01 }, { capUsd: -1 }, { capUsd: Infinity }, { capUsd: NaN }, { capUsd: '2' }, { capUsd: 0.001 }, { expectedRevision: undefined }, { expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { actorUid: 'spoof' }, { enabled: true }, { reason: 'short' }, { reason: 'x'.repeat(501) }])('rejects malformed budget edit %#', over => {
    expect(readFreeChainBudgetAction(over === null ? null : Object.keys(over).length ? { ...budget, ...over } : {})).toBeNull();
  });
  it('validates the confirmed policy revision and amount instead of trusting ok alone', () => {
    expect(isFreeChainBudgetResponse({ ok: true, capUsd: 0, policyRevision: 8 })).toBe(true);
    for (const body of [{ ok: true }, { ok: true, capUsd: 11, policyRevision: 8 }, { ok: true, capUsd: 0, policyRevision: 0 }]) expect(isFreeChainBudgetResponse(body)).toBe(false);
  });
  it('validates shared and configured caps and revisions, keeping unknowns nullable', () => {
    const view = freeChainViewFixture();
    expect(isFreeChainAdminView({ ...view, paid: { ...view.paid, policyState: 'uninitialized', capUsd: null, configuredCapUsd: null, policyRevision: null } })).toBe(true);
    for (const bad of [{ capUsd: 11 }, { configuredCapUsd: 11 }, { policyRevision: -1 }, { policyRevision: 1.1 }, { policyRevision: undefined }, { policyState: undefined }, { policyState: 'uninitialized' }]) expect(isFreeChainAdminView({ ...view, paid: { ...view.paid, ...bad } })).toBe(false);
    expect(freeChainBudgetFingerprint(view)).not.toBe(freeChainBudgetFingerprint({ ...view, paid: { ...view.paid, policyRevision: 2 } }));
    expect(freeChainBudgetFingerprint(view)).not.toBe(freeChainBudgetFingerprint({ ...view, paid: { ...view.paid, configuredCapUsd: 0 } }));
  });
  it('budget audits remain visible with their specific control target', () => {
    for (const event of ['ADMIN_FREE_CHAT_CHAIN_BUDGET', 'ADMIN_FREE_CHAT_CHAIN_BUDGET_FAILED']) {
      expect(isAdminAuditEvent(event)).toBe(true);
      expect(adminAuditRow({ event, admin: 'owner', controlTarget: 'free-chat-chain-paid-budget', reason: budget.reason, result: 'ok' })).toMatchObject({ actor: 'owner', target: 'free-chat-chain-paid-budget', reason: budget.reason });
    }
  });
});
