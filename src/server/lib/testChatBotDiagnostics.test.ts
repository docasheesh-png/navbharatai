import { describe, expect, it } from 'vitest';
import { buildTestChatDiagnostic, classifyTestChatFailure, redactTestChatDiagnosticText } from './testChatBotDiagnostics';

describe('admin test chat diagnostic redaction', () => {
  it('redacts API keys, bearer tokens, env names and caller-supplied secrets', () => {
    const raw = [
      'Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz',
      'FREE_CHAIN_GROQ_API_KEY is missing',
      'QUBAX_API_KEY=super-secret-value-12345678',
      'api_key=another-secret-value',
      'provider said invalid key super-secret-value-12345678',
    ].join('\n');
    const cleaned = redactTestChatDiagnosticText(raw, ['super-secret-value-12345678']);
    expect(cleaned).not.toContain('sk-live-abcdefghijklmnopqrstuvwxyz');
    expect(cleaned).not.toContain('FREE_CHAIN_GROQ_API_KEY');
    expect(cleaned).not.toContain('QUBAX_API_KEY');
    expect(cleaned).not.toContain('super-secret-value-12345678');
    expect(cleaned).toContain('[redacted-env]');
    expect(cleaned).toContain('[redacted-secret]');
  });
  it('classifies common provider failures honestly', () => {
    expect(classifyTestChatFailure({ httpStatus: 401 })).toBe('auth');
    expect(classifyTestChatFailure({ httpStatus: 429 })).toBe('rate-limit');
    expect(classifyTestChatFailure({ httpStatus: 402 })).toBe('quota');
    expect(classifyTestChatFailure({ code: 'TIMEOUT' })).toBe('timeout');
    expect(classifyTestChatFailure({ empty: true })).toBe('empty');
    expect(classifyTestChatFailure({ aborted: true })).toBe('cancelled');
    expect(classifyTestChatFailure({ code: 'NETWORK' })).toBe('network');
    expect(classifyTestChatFailure({ httpStatus: 500 })).toBe('http');
  });
  it('builds a bounded diagnostic without leaking secrets', () => {
    const diagnostic = buildTestChatDiagnostic({
      provider: 'groq', model: 'openai/gpt-oss-120b', latencyMs: 42, httpStatus: 401,
      providerCode: 'invalid_api_key', providerMessage: 'bad key sk-ant-abcdefghijklmnopqrstuvwxyz',
      rawErrorBody: '{"error":{"message":"bad key sk-ant-abcdefghijklmnopqrstuvwxyz","type":"authentication_error"}}',
      extraSecrets: ['sk-ant-abcdefghijklmnopqrstuvwxyz'],
    });
    expect(diagnostic.classification).toBe('auth');
    expect(JSON.stringify(diagnostic)).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz');
    expect(diagnostic.httpStatus).toBe(401);
    expect(diagnostic.providerCode).toBe('invalid_api_key');
  });
});
