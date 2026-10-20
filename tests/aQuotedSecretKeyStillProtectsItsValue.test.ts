import { describe, expect, it } from 'vitest';
import { redactSecrets as plain, redactDeep } from '../src/server/AgentV3/SecretRedactor';
import { redactSecrets as source } from '../src/server/AgentV3/SourceSecretRedactor';

describe('a serialized secret field is not exempt because its key is quoted', () => {
  it.each([
    '{"password":"syntheticCredential"}',
    "{'api_key': 'syntheticCredential'}",
    '{"client-secret" : "synthetic Credential with spaces"}',
    '{"access_token":"short"}',
    '{"PASSWORD":"synthetic\\\\\\"Credential"}',
    '{"password":"first\\\\nsecond"}',
    '{"password":\n"syntheticCredential"}',
    '{"password"\n:\n"syntheticCredential"}',
    '{"pass\\u0077ord":"syntheticCredential"}',
    'payload = {"password": "syntheticCredential", "visible": "safe"};',
  ])('masks a quoted secret value in plain and source-aware text: %s', text => {
    for (const redact of [plain, source]) {
      const out = redact(text);
      expect(out).toContain('[REDACTED:secret]');
      expect(out).not.toContain('synthetic');
      expect(out).not.toContain('short');
      expect(out).not.toContain('first');
      expect(redact(out)).toBe(out);
    }
  });
  it('reaches a serialized JSON value nested inside report text', () => {
    expect(redactDeep({ message: '{"password":"syntheticCredential"}' }))
      .toEqual({ message: '{"password":"[REDACTED:secret]"}' });
  });
  it('preserves an exact prior classification but not additional unmasked material', () => {
    const classified = '{"private_key":"[REDACTED:private-key]"}';
    expect(plain(classified)).toBe(classified);
    expect(plain('{"private_key":"[REDACTED:private-key]\\\\n"}'))
      .toBe('{"private_key":"[REDACTED:private-key]\\\\n"}');
    expect(plain('{"private_key":"[REDACTED:private-key] syntheticCredential"}'))
      .toBe('{"private_key":"[REDACTED:secret]"}');
    expect(plain('{"password":"[REDACTED:syntheticCredential]"}'))
      .toBe('{"password":"[REDACTED:secret]"}');
  });
  it.each([
    'interface Login { "password": string; }',
    "interface Login { 'password'?: string; }",
    'class Login { #password: string = "syntheticCredential"; }',
    'class Login { ["password"]: string = "syntheticCredential"; }',
    'class Login { "password": string = "syntheticCredential"; }',
  ])('retains proven quoted/private annotations but never their initializers: %s', text => {
    const out = source(text);
    expect(out).toContain(': string');
    expect(out).not.toContain('syntheticCredential');
    expect(source(out)).toBe(out);
  });
  it('does not rewrite unrelated quoted fields or primitive property types', () => {
    const text = '{"message":"ordinary text","count":3}';
    expect(plain(text)).toBe(text);
    expect(source(text)).toBe(text);
    expect(plain('"password": string;')).toBe('"password": string;');
  });
  it.each(['tokenCount', 'token_count', 'input_tokens', 'outputTokens', 'cache_read_input_tokens'])(
    'retains numeric telemetry for %s, but does not exempt a credential-shaped value', key => {
      const json = JSON.stringify({ [key]: '1234567' });
      expect(plain(json)).toBe(json);
      expect(source(json)).toBe(json);
      expect(plain(JSON.stringify({ [key]: 'syntheticCredential' }))).not.toContain('syntheticCredential');
      const declaration = `export const ${key}: number = 1234567;`;
      expect(source(declaration)).toBe(declaration);
    },
  );
  it('never treats an ordinary numeric token/password value as harmless telemetry', () => {
    expect(plain('{"token":"1234567","password":"1234567"}'))
      .toBe('{"token":"[REDACTED:secret]","password":"[REDACTED:secret]"}');
  });
});
