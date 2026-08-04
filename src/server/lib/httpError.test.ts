import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { errToString, toSafeClientMessage, sendSafeError, isProduction } from './httpError';

// Locks the safe-error backstop that every route uses to answer the client. Its whole job is to keep two
// things from ever reaching a user: (1) secrets (tokens, credentials, token-embedded URLs) and (2) any
// third-party vendor/model name (white-label law). The module's header claims "unit-tested" — this makes
// that true so the backstop can never silently regress.

describe('errToString', () => {
  it('extracts a string from any thrown shape without throwing', () => {
    expect(errToString(null)).toBe('');
    expect(errToString(undefined)).toBe('');
    expect(errToString('boom')).toBe('boom');
    expect(errToString(new Error('kaboom'))).toBe('kaboom');
    expect(errToString({ message: 'obj msg' })).toBe('obj msg');
    expect(errToString(42)).toBe('42');
  });
});

describe('toSafeClientMessage — no secret ever reaches the client', () => {
  it('strips URLs, token-embedded clone URLs, and credentials', () => {
    const out = toSafeClientMessage("fatal: 'https://x-access-token:ghp_SECRET123456@github.com/a/b.git' failed");
    expect(out).not.toContain('ghp_SECRET123456');
    expect(out).not.toMatch(/https?:\/\//);
  });

  it('redacts bearer/api-key style secrets', () => {
    const out = toSafeClientMessage('auth failed: api_key=sk_live_ABCDEF123456 rejected');
    expect(out).not.toContain('sk_live_ABCDEF123456');
    expect(out).toMatch(/\[redacted\]/);
  });
});

describe('toSafeClientMessage — no vendor/model name ever reaches the client (white-label)', () => {
  const banned = /\b(z\.?ai|glm|kimi|moonshot|anthropic|claude|sonnet|opus|haiku|gemini|vertex|grok|xai|deepseek|openai|bedrock|E2B)\b/i;
  const raws = [
    'Provider GLM failed: 429 from Z.ai',
    'claude-opus-4-8 rate limited, switching to Sonnet',
    'Kimi (Moonshot) timed out; gemini-2.5-pro fallback',
    'xAI Grok error; Anthropic backstop; OpenAI gpt quota',
    'E2B sandbox 403; DeepSeek unavailable; Bedrock throttled',
  ];
  it('replaces every vendor/model token with the NavBharatAI brand', () => {
    for (const raw of raws) {
      const out = toSafeClientMessage(raw);
      expect(out, `leaked from: ${raw}`).not.toMatch(banned);
      expect(out).toContain('NavBharatAI');
    }
  });

  it('returns the fallback for empty input and caps length', () => {
    expect(toSafeClientMessage('')).toBe('Something went wrong. Please try again.');
    expect(toSafeClientMessage(null, 'custom fallback')).toBe('custom fallback');
    expect(toSafeClientMessage('x'.repeat(500)).length).toBeLessThanOrEqual(200);
  });

  it('passes an ordinary curated message through unchanged', () => {
    expect(toSafeClientMessage('Your session expired — please sign in again.')).toBe(
      'Your session expired — please sign in again.',
    );
  });
});

describe('sendSafeError', () => {
  const ORIG_ENV = process.env.NODE_ENV;
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { logSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); process.env.NODE_ENV = ORIG_ENV; });

  function mockRes() {
    return {
      statusCode: 0,
      body: undefined as unknown,
      status(c: number) { this.statusCode = c; return this; },
      json(b: unknown) { this.body = b; return this; },
    };
  }

  it('sends the safe public message and logs the real detail server-side', () => {
    const res = mockRes();
    sendSafeError(res as never, 500, 'Could not complete the build.', new Error('GLM 500 at https://api.z.ai'));
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: string }).error).toBe('Could not complete the build.');
    expect(logSpy).toHaveBeenCalledOnce(); // real detail goes to the server log, not the client
  });

  it('in production the response carries NO raw detail', () => {
    process.env.NODE_ENV = 'production';
    const res = mockRes();
    sendSafeError(res as never, 502, 'Upstream error.', new Error('claude-opus-4-8 refused'));
    expect((res.body as { detail?: string }).detail).toBeUndefined();
    expect((res.body as { error: string }).error).not.toMatch(/claude|opus/i);
  });

  it('in development the echoed detail is still vendor/secret-redacted', () => {
    process.env.NODE_ENV = 'development';
    const res = mockRes();
    sendSafeError(res as never, 500, 'Build error.', new Error('Kimi failed with token=sk_ABCDEF123456'));
    const detail = (res.body as { detail?: string }).detail ?? '';
    expect(detail).not.toContain('sk_ABCDEF123456');
    expect(detail).not.toMatch(/\bKimi\b/i);
  });
});

describe('isProduction', () => {
  const ORIG = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = ORIG; });
  it('reflects NODE_ENV', () => {
    process.env.NODE_ENV = 'production';
    expect(isProduction()).toBe(true);
    process.env.NODE_ENV = 'development';
    expect(isProduction()).toBe(false);
  });
});
