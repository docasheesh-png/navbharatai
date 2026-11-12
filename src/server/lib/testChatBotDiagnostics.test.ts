import { describe, expect, it } from 'vitest';
import { formatTestChatDiagnostic } from '../../lib/testChatBot';
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
    expect(classifyTestChatFailure({ httpStatus: 504, code: 'MITRIFY_HTTP_504' })).toBe('timeout');
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

  it('redacts Google AIza keys, PEM blocks, AWS secrets and high-entropy tokens near key words', () => {
    const google = 'AIzaSyDabcdefghijklmnopqrstuvwx12345';
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAabcdefghijklmnopqrstuvwxyz0123456789+/==\n-----END RSA PRIVATE KEY-----';
    const awsId = 'AKIAIOSFODNN7EXAMPLE';
    const awsSecret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const token = 'k8QvN2mX9pL4sR7tY1wZ3aB5cD6eF0gH';
    const cleaned = redactTestChatDiagnosticText([
      `google key ${google}`,
      pem,
      `aws id ${awsId}`,
      `aws_secret_access_key=${awsSecret}`,
      `the secret is ${token}`,
      'please mention the password hint named twentyfouraaaaaa',
    ].join('\n'));
    expect(cleaned).not.toContain(google);
    expect(cleaned).not.toContain('MIIEowIBAAKCAQEAabcdefghijklmnopqrstuvwxyz0123456789');
    expect(cleaned).not.toContain(awsId);
    expect(cleaned).not.toContain(awsSecret);
    expect(cleaned).not.toContain(token);
    expect(cleaned).toContain('twentyfouraaaaaa');
    expect(cleaned).toContain('[redacted-secret]');
  });

  it('explains an HTTP 504 timeout in the copied admin diagnostic', () => {
    const text = formatTestChatDiagnostic({
      provider: 'mitrify', model: 'mitrify/auto-cheap', latencyMs: 55765, classification: 'timeout',
      httpStatus: 504, providerCode: 'MITRIFY_HTTP_504', providerType: null, providerRequestId: null,
      providerMessage: 'The provider gateway timed out (HTTP 504).', rawErrorBody: '<html>504 Gateway Time-out</html>',
    });
    expect(text).toContain('Meaning: the provider gateway timed out (HTTP 504)');
    expect(text).toContain('provider-side gateway time-out');
  });
});
