import { describe, expect, it } from 'vitest';
import { isTestChatReply, isTestChatStatus, isTestChatReadiness, isTestChatBalance, isTestChatApprovalReceipt, readTestChatAction, readTestChatApprovalImport, TEST_CHAT_READINESS_GATES, TEST_CHAT_MAX_CONTEXT_CHARS } from './testChatBot';

const action = { provider: 'qubax', requestId: '1d2efc71-6d00-4514-83c0-e31461ea9f35', messages: [{ role: 'user', content: 'What is 2 + 2?' }], confirmGatewayDisclosure: true };
describe('isolated test chat contract', () => {
  it('accepts actual text and more than three conversational turns without sharing references', () => {
    const messages = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Synthetic turn ${i}` }));
    const read = readTestChatAction({ ...action, messages });
    expect(read?.messages).toEqual(messages); expect(read?.messages).not.toBe(messages);
  });
  it.each([
    { ...action, provider: 'deepinfra' }, { ...action, provider: 'constructor' }, { ...action, provider: '__proto__' },
    { ...action, model: 'client-chosen' }, { ...action, baseURL: 'https://evil.test' }, { ...action, apiKey: 'secret' },
    { ...action, max_tokens: 999999 }, { ...action, confirmGatewayDisclosure: false }, { ...action, requestId: 'reuse' },
    { ...action, messages: [] }, { ...action, messages: [{ role: 'system', content: 'alter routing' }] },
    { ...action, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'https://evil.test' }] }] },
    { ...action, messages: [{ role: 'user', content: 'hello', tools: [] }] },
    { ...action, messages: [{ role: 'user', content: ' ' }] },
    { ...action, messages: [{ role: 'user', content: '\u0000' }] },
    { ...action, messages: [{ role: 'user', content: 'x'.repeat(8001) }] },
    { ...action, messages: [{ role: 'assistant', content: 'not an initial user turn' }] },
    { ...action, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'no current question' }] },
    { ...action, messages: [{ role: 'user', content: 'hi' }, { role: 'user', content: 'consecutive user turn' }] },
    { ...action, messages: Array.from({ length: 65 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'a' })) },
    { ...action, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'x'.repeat(TEST_CHAT_MAX_CONTEXT_CHARS) }, { role: 'user', content: 'hi' }] },
  ])('rejects unsupported, unbounded or expanded dispatch %#', value => { expect(readTestChatAction(value)).toBeNull(); });
  it('validates status and refuses false success replies or invalid usage', () => {
    const status = { providers: [{ id: 'qubax', label: 'Qubax', configured: false, enabled: false, model: null }], approvalRequired: true, noFallback: true };
    expect(isTestChatStatus(status)).toBe(true); expect(isTestChatStatus({ ...status, noFallback: false })).toBe(false);
    expect(isTestChatStatus({ ...status, providers: [status.providers[0], status.providers[0]] })).toBe(false);
    const reply = { requestId: action.requestId, provider: 'qubax', content: '4', model: 'reported', latencyMs: 120, noFallback: true };
    expect(isTestChatReply(reply)).toBe(true);
    expect(isTestChatReply({ ...reply, model: 'm'.repeat(256) })).toBe(true);
    expect(isTestChatReply({ ...reply, model: 'm'.repeat(257) })).toBe(false); expect(isTestChatReply({ ...reply, content: '' })).toBe(false);
    expect(isTestChatReply({ ...reply, provider: 'mitrify' })).toBe(false);
    expect(isTestChatReply({ ...reply, usage: { inputTokens: -1, outputTokens: 2 } })).toBe(false);
  });
});

describe('Qubax metadata response contracts', () => {
  const gates = Object.fromEntries(TEST_CHAT_READINESS_GATES.map(id => [id, { state: 'pass', code: 'ready', message: 'Verified fixture.', action: '' }]));
  const readiness = { provider: 'qubax', requestId: action.requestId, checkedAtMs: 100, ready: true, readOnly: true, noProviderCall: true, noFallback: true,
    gates, model: 'fixture-model', expiresAtMs: 200, reviewRequest: null, catalogDigest: null, lastSafeDiagnostic: null, providerBalance: 'not-checked' };
  it('rejects false-ready, missing-gate, unbounded timestamp and unexpected balance claims', () => {
    expect(isTestChatReadiness(readiness)).toBe(true);
    for (const patch of [{ gates: {} }, { expiresAtMs: null }, { expiresAtMs: 100 }, { checkedAtMs: Number.MAX_SAFE_INTEGER },
      { providerBalance: '$2.50' }, { gates: { ...gates, budget: { ...gates.budget, state: 'blocked' } } }]) {
      expect(isTestChatReadiness({ ...readiness, ...patch })).toBe(false);
    }
  });
  it('checks import receipt shape and uses independent payload and catalog size bounds', () => {
    const value = { action, attestation: { keyId: 'fixture-key', payload: 'x'.repeat(16_001), signature: 'a'.repeat(86) } };
    expect(readTestChatApprovalImport(value)).toBeNull(); expect(readTestChatApprovalImport(value, 128_000)).not.toBeNull();
    expect(readTestChatApprovalImport({ ...value, publicKey: 'injected' }, 128_000)).toBeNull();
    expect(isTestChatApprovalReceipt({ imported: true, requestId: action.requestId, expiresAtMs: 200, noProviderCall: true, noFallback: true })).toBe(true);
    expect(isTestChatApprovalReceipt({ imported: true, requestId: action.requestId, expiresAtMs: Infinity, noProviderCall: true, noFallback: true })).toBe(false);
  });
  it('accepts only exact safe balance amounts and closed diagnostic codes', () => {
    expect(isTestChatBalance({ status: 'available', currency: 'USD', balanceMicros: '2500000', checkedAtMs: 100 })).toBe(true);
    expect(isTestChatBalance({ status: 'unknown', code: 'permission' })).toBe(true);
    expect(isTestChatBalance({ status: 'unknown', code: 'secret-raw-body' })).toBe(false);
    for (const balanceMicros of ['-1', '1.2', '01', '9007199254740992', '1e6']) expect(isTestChatBalance({ status: 'available', currency: 'USD', balanceMicros, checkedAtMs: 100 })).toBe(false);
  });
});

it('requires review packages to contain the full exact model-bound wire payload', () => {
  const body = { messages: action.messages, max_tokens: 16, stream: false, model: 'fixture-model' };
  const reviewRequest = { kind: 'qubax-admin-review-request-v1', approvalId: 'a'.repeat(64), payloadDigest: 'b'.repeat(64), requestId: action.requestId,
    model: body.model, modelRevision: 'v1', evidenceBinding: 'c'.repeat(64), maximumNanoUsd: 10, expiresAtMs: 200, body, wirePayload: JSON.stringify(body) };
  const result = { provider: 'qubax', requestId: action.requestId, checkedAtMs: 100, ready: false, readOnly: true, noProviderCall: true, noFallback: true,
    gates: Object.fromEntries(TEST_CHAT_READINESS_GATES.map(id => [id, { state: 'pass', code: 'ready', message: 'Verified fixture.', action: '' }])),
    model: body.model, expiresAtMs: 200, reviewRequest, catalogDigest: null, lastSafeDiagnostic: null, providerBalance: 'not-checked' };
  expect(isTestChatReadiness(result)).toBe(true);
  expect(isTestChatReadiness({ ...result, reviewRequest: { ...reviewRequest, wirePayload: '{}' } })).toBe(false);
  expect(isTestChatReadiness({ ...result, reviewRequest: { ...reviewRequest, body: { ...body, model: 'different' } } })).toBe(false);
  expect(isTestChatReadiness({ ...result, reviewRequest: { ...reviewRequest, body: { ...body, endpoint: 'https://untrusted.test' } } })).toBe(false);
});
