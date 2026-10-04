// Q-150 (autopsy 77bd487b): `COMPLIANCE_LOG_LEAK_FOUND` flagged 7 console logs across 6 files as "printing a
// credential/token" — every one logged an ERROR object under a label that happened to say OTP or secret.
// The word in a label counts only when a value other than an error is logged beside it.
import { describe, it, expect } from 'vitest';
import { lineLogsCredential, scanCompliance } from '../src/server/AgentV3/ComplianceAnalysis';
import { redactCredentialLogLine } from '../src/server/AgentV3/credentialLogRedaction';

// The report's own lines (PROGRESS.md, autopsy 77bd487b).
const REPORT = [
  "console.error('[OTP SEND ERROR]', err);",
  "console.error('[ROTATE] secret re-encrypt failed:', err);",
  "console.error('[OTP PROTECTION SECURITY ERROR]', err);",
];

describe('a label is not a leak', () => {
  it.each(REPORT)('the report: %s', (l) => expect(lineLogsCredential(l)).toBe(false));
  it.each([
    "console.log('Password reset email sent');",
    "console.error('OTP verification failed:', error.message);",
    "console.warn(`secret rotation failed: ${err?.message}`);",
    "console.error('[API key check] failed', e.response?.status);",
    "console.log('saved'); // never log the password",
  ])('quiet: %s', (l) => expect(lineLogsCredential(l)).toBe(false));
});

describe('🔒 a credential that is logged is still found', () => {
  it.each([
    "console.log(password);",
    "console.log('user password is', password);",
    "console.log('otp is', code);",
    "console.log('secret', s);",
    'console.log(`token ${accessToken}`);',
    "console.debug('cvv', form.cvv);",
    "console.log('api_key', JSON.stringify(cfg));",
  ])('flagged: %s', (l) => expect(lineLogsCredential(l)).toBe(true));

  it('the scanner and the redaction heal read the same definition', () => {
    expect(scanCompliance('src/otp.ts', REPORT[0]!)).toEqual([]);
    expect(redactCredentialLogLine(REPORT[0]!)).toBeNull();
    expect(scanCompliance('src/auth.ts', "console.log('user password is', password);")).toHaveLength(1);
  });
});
