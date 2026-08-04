import { describe, it, expect } from 'vitest';
import { generateOtpIntegration, isOtpProvider } from './OtpGenerator';

describe('generateOtpIntegration — MSG91 (India-first)', () => {
  const c = generateOtpIntegration('msg91');

  it('emits a server route that sends AND verifies the OTP server-side (never trust the client)', () => {
    const server = c.files['server/routes/otp.ts'];
    expect(server).toContain("otpRouter.post('/send'");
    expect(server).toContain("otpRouter.post('/verify'");
    expect(server).toContain('control.msg91.com/api/v5/otp'); // real send endpoint
    expect(server).toContain('/api/v5/otp/verify'); // real verify endpoint
    expect(server).toContain('MSG91_AUTH_KEY');
    expect(server).toContain('MSG91_TEMPLATE_ID');
    // verification is server-side; success is the provider's, not the client's
    expect(server).toContain("data?.type === 'success'");
  });

  it('emits a client helper that calls the app server (not the provider directly)', () => {
    const client = c.files['src/lib/otp.ts'];
    expect(client).toContain('export async function sendOtp(mobile: string)');
    expect(client).toContain('export async function verifyOtp(mobile: string, otp: string)');
    expect(client).toContain("/api/otp/send");
    expect(client).toContain("/api/otp/verify");
    // the client never sees provider keys — it only talks to our own server
    expect(client).not.toContain('MSG91_AUTH_KEY');
  });

  it('declares env keys + honest instructions + blank .env.example values, and needs NO npm dependency', () => {
    expect(c.envKeys).toEqual(['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID']);
    expect(c.dependency).toBeUndefined(); // MSG91 v5 uses global fetch
    expect(c.files['.env.example']).toContain('MSG91_AUTH_KEY=\n');
    expect(c.files['.env.example']).toContain('MSG91_TEMPLATE_ID=\n');
    expect(c.instructions).toContain('never stores');
  });

  it('.env.example carries NO real secret values (blank RHS only)', () => {
    for (const line of c.files['.env.example'].split('\n').filter(Boolean)) {
      expect(line).toMatch(/=$/); // key= with nothing after
    }
  });
});

describe('generateOtpIntegration — Twilio (global, Verify API)', () => {
  const c = generateOtpIntegration('twilio');

  it('emits a Verify-API send + check route and a client helper', () => {
    const server = c.files['server/routes/otp.ts'];
    expect(server).toContain("import twilio from 'twilio'");
    expect(server).toContain('verifications.create({ to, channel');
    expect(server).toContain('verificationChecks.create({ to, code })');
    expect(server).toContain("check.status === 'approved'"); // only an approved check passes
    expect(server).toContain('TWILIO_VERIFY_SERVICE_SID');
    const client = c.files['src/lib/otp.ts'];
    expect(client).toContain('export async function sendOtp(to: string)');
    expect(client).toContain('export async function verifyOtp(to: string, code: string)');
  });

  it('declares Twilio env keys + the twilio dependency + blank .env.example values', () => {
    expect(c.envKeys).toEqual(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID']);
    expect(c.dependency).toEqual({ name: 'twilio', version: '^5' });
    expect(c.files['.env.example']).toContain('TWILIO_ACCOUNT_SID=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('isOtpProvider — guard', () => {
  it('accepts the two supported providers, rejects everything else', () => {
    expect(isOtpProvider('msg91')).toBe(true);
    expect(isOtpProvider('twilio')).toBe(true);
    expect(isOtpProvider('nexmo')).toBe(false);
    expect(isOtpProvider(undefined)).toBe(false);
    expect(isOtpProvider(42)).toBe(false);
  });
});
