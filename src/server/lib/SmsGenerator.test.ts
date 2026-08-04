import { describe, it, expect } from 'vitest';
import { generateSmsIntegration, isSmsProvider } from './SmsGenerator';

describe('generateSmsIntegration — Twilio', () => {
  const c = generateSmsIntegration('twilio');

  it('emits a server-only sendSms helper via the Twilio Messages API', () => {
    const server = c.files['server/lib/sms.ts'];
    expect(server).toContain("import twilio from 'twilio'");
    expect(server).toContain('export async function sendSms(to: string, body: string)');
    expect(server).toContain('client.messages.create({ to, from: process.env.TWILIO_FROM_NUMBER');
    expect(server).toContain('TWILIO_ACCOUNT_SID');
    // no client file — SMS is always server-side so credentials never reach the browser
    expect(c.files['src/lib/sms.ts']).toBeUndefined();
  });

  it('declares env keys + twilio dependency + honest instructions + blank .env.example', () => {
    expect(c.envKeys).toEqual(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']);
    expect(c.dependency).toEqual({ name: 'twilio', version: '^5' });
    expect(c.files['.env.example']).toContain('TWILIO_ACCOUNT_SID=\n');
    expect(c.instructions).toContain('never stores');
    expect(c.instructions).toContain('generate_otp'); // points OTP users to the right recipe
  });
});

describe('generateSmsIntegration — Vonage', () => {
  const c = generateSmsIntegration('vonage');

  it('emits a server sendSms helper via the Vonage SMS API', () => {
    const server = c.files['server/lib/sms.ts'];
    expect(server).toContain("import { Vonage } from '@vonage/server-sdk'");
    expect(server).toContain('vonage.sms.send({ to, from: process.env.VONAGE_FROM');
    expect(server).toContain('export async function sendSms(to: string, body: string)');
    expect(c.envKeys).toEqual(['VONAGE_API_KEY', 'VONAGE_API_SECRET', 'VONAGE_FROM']);
    expect(c.dependency).toEqual({ name: '@vonage/server-sdk', version: '^3' });
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['twilio', 'vonage'] as const) {
      const env = generateSmsIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isSmsProvider accepts the two supported providers, rejects everything else', () => {
    expect(isSmsProvider('twilio')).toBe(true);
    expect(isSmsProvider('vonage')).toBe(true);
    expect(isSmsProvider('msg91')).toBe(false); // msg91 is the OTP recipe, not transactional SMS here
    expect(isSmsProvider(undefined)).toBe(false);
  });
});
