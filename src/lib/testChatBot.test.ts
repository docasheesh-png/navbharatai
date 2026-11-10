import { describe, expect, it } from 'vitest';
import { formatTestChatDiagnostic, isTestChatDiagnostic, isTestChatReply, isTestChatStatus, readTestChatAction, TEST_CHAT_MAX_CONTEXT_CHARS, TEST_CHAT_PROVIDER_IDS } from './testChatBot';

const action = { provider: 'qubax', requestId: '1d2efc71-6d00-4514-83c0-e31461ea9f35', messages: [{ role: 'user', content: 'What is 2 + 2?' }], confirmGatewayDisclosure: true };
const fullStatus = {
  providers: TEST_CHAT_PROVIDER_IDS.map(id => ({ id, label: id === 'qubax' ? 'Qubax' : id, configured: false, enabled: false, model: null })),
  approvalRequired: true, noFallback: true as const,
};
describe('isolated test chat contract', () => {
  it('accepts actual text and more than three conversational turns without sharing references', () => {
    const messages = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Synthetic turn ${i}` }));
    const read = readTestChatAction({ ...action, messages });
    expect(read?.messages).toEqual(messages); expect(read?.messages).not.toBe(messages);
  });
  it('accepts every server-owned provider id and still rejects client-chosen models', () => {
    for (const provider of TEST_CHAT_PROVIDER_IDS) {
      expect(readTestChatAction({ ...action, provider })).not.toBeNull();
    }
    expect(TEST_CHAT_PROVIDER_IDS).toContain('groq');
    expect(TEST_CHAT_PROVIDER_IDS).toContain('mitrify');
    expect(TEST_CHAT_PROVIDER_IDS).toContain('anthropic-claude');
    expect(TEST_CHAT_PROVIDER_IDS).toHaveLength(27);
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
    expect(isTestChatStatus(fullStatus)).toBe(true); expect(isTestChatStatus({ ...fullStatus, noFallback: false })).toBe(false);
    expect(isTestChatStatus({ ...fullStatus, providers: [fullStatus.providers[0], fullStatus.providers[0]] })).toBe(false);
    const reply = { requestId: action.requestId, provider: 'qubax', content: '4', model: 'reported', latencyMs: 120, noFallback: true };
    expect(isTestChatReply(reply)).toBe(true); expect(isTestChatReply({ ...reply, content: '' })).toBe(false);
    expect(isTestChatReply({ ...reply, provider: 'not-a-wired-provider' })).toBe(false);
    expect(isTestChatReply({ ...reply, usage: { inputTokens: -1, outputTokens: 2 } })).toBe(false);
    const diagnostic = { provider: 'qubax' as const, model: 'reported', latencyMs: 12, classification: 'auth' as const, httpStatus: 401,
      providerCode: 'invalid_api_key', providerType: 'authentication_error', providerRequestId: 'req_1',
      providerMessage: 'denied', rawErrorBody: '{"error":"denied"}' };
    expect(isTestChatDiagnostic(diagnostic)).toBe(true);
    expect(formatTestChatDiagnostic(diagnostic)).toContain('HTTP status: 401');
    expect(isTestChatDiagnostic({ ...diagnostic, classification: 'made-up' })).toBe(false);
  });
});
