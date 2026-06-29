import { describe, it, expect } from 'vitest';
import { redactPII, containsPII, redactSecrets } from '../src/server/AgentV3/SecretRedactor';

/**
 * P-AI.6 — PII redaction (India-focused).
 */
describe('redactPII', () => {
  it('masks email addresses', () => {
    expect(redactPII('contact me at john.doe@example.co.in please')).toContain('[REDACTED:email]');
    expect(redactPII('john.doe@example.co.in')).not.toContain('@example');
  });

  it('masks a PAN number', () => {
    expect(redactPII('PAN: ABCDE1234F')).toContain('[REDACTED:pan]');
  });

  it('masks an IFSC code', () => {
    expect(redactPII('IFSC HDFC0001234')).toContain('[REDACTED:ifsc]');
  });

  it('masks an Aadhaar number (spaced and unspaced)', () => {
    expect(redactPII('Aadhaar 2345 6789 0123')).toContain('[REDACTED:aadhaar]');
    expect(redactPII('234567890123')).toContain('[REDACTED:aadhaar]');
  });

  it('masks an Indian mobile number (with and without +91)', () => {
    expect(redactPII('call 9876543210')).toContain('[REDACTED:phone]');
    // A +91-prefixed number is 12 digits — it overlaps the Aadhaar shape; either label is fine,
    // what matters is the PII is masked (not left in clear text).
    expect(redactPII('reach +919876543210 today')).toMatch(/\[REDACTED:(phone|aadhaar)\]/);
  });

  it('leaves non-PII text unchanged', () => {
    const s = 'const total = 42; // just code, no personal data';
    expect(redactPII(s)).toBe(s);
    expect(containsPII(s)).toBe(false);
  });

  it('containsPII detects presence', () => {
    expect(containsPII('reach me: a@b.com')).toBe(true);
    expect(containsPII('nothing here')).toBe(false);
  });

  it('never throws on non-string', () => {
    expect(redactPII(undefined)).toBe('');
    expect(redactPII(123 as any)).toBe('123');
  });

  it('redactSecrets and redactPII are independent (secrets unchanged by PII pass)', () => {
    // A PAN-shaped token should be PII-masked but an API key is the secret path's job.
    const s = 'PAN ABCDE1234F and key sk-ant-abcdefghij1234567890XYZ';
    const pii = redactPII(s);
    expect(pii).toContain('[REDACTED:pan]');
    expect(pii).toContain('sk-ant-'); // redactPII does not touch secrets
    expect(redactSecrets(s)).toContain('[REDACTED:'); // secrets path still works
  });
});
