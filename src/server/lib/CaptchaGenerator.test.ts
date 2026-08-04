import { describe, it, expect } from 'vitest';
import { generateCaptchaIntegration } from './CaptchaGenerator';

describe('generateCaptchaIntegration', () => {
  const c = generateCaptchaIntegration();
  const server = c.files['server/lib/captcha.ts'];

  it('emits a server verifyCaptcha helper, dependency-free (fetch)', () => {
    expect(server).toContain('export async function verifyCaptcha(');
    expect(server).toContain('await fetch(endpoint');
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
    expect(c.files['src/lib/captcha.ts']).toBeUndefined(); // server-side (secret never in the browser)
  });

  it('supports the three major providers via one env var', () => {
    expect(server).toContain('challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(server).toContain('api.hcaptcha.com/siteverify');
    expect(server).toContain('www.google.com/recaptcha/api/siteverify');
    expect(server).toContain("process.env.CAPTCHA_PROVIDER");
  });

  it('verifies server-side against the token AND fails CLOSED on any error', () => {
    expect(server).toContain('data.success !== true');
    expect(server).toContain('return false; // fail CLOSED');
    // a missing secret/endpoint/token short-circuits to false
    expect(server).toContain('if (!endpoint || !SECRET || !token) return false');
  });

  it('enforces the reCAPTCHA v3 score threshold', () => {
    expect(server).toContain("process.env.CAPTCHA_MIN_SCORE");
    expect(server).toContain('data.score >=');
  });

  it('declares the env keys and ships a .env.example (secret blank), not a dependency', () => {
    expect(c.envKeys).toEqual(['CAPTCHA_PROVIDER', 'CAPTCHA_SECRET', 'CAPTCHA_MIN_SCORE']);
    expect(c.files['.env.example']).toContain('CAPTCHA_SECRET=');
    expect(c.files['.env.example']).not.toMatch(/CAPTCHA_SECRET=.+/); // never a real secret value
    expect(c.instructions.toLowerCase()).toContain('fails closed');
  });
});
