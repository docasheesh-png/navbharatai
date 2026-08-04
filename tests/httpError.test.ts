import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { toSafeClientMessage, errToString, isProduction, sendSafeError } from '../src/server/lib/httpError';

describe('httpError — safe error responses (SEC 2026-07-19)', () => {
  describe('errToString', () => {
    it('handles null/undefined/string/Error/object', () => {
      expect(errToString(null)).toBe('');
      expect(errToString(undefined)).toBe('');
      expect(errToString('boom')).toBe('boom');
      expect(errToString(new Error('kaboom'))).toBe('kaboom');
      expect(errToString({ message: 'msg' })).toBe('msg');
    });
  });

  describe('toSafeClientMessage — redaction invariants', () => {
    it('strips URLs (incl. token-embedded clone URLs)', () => {
      const out = toSafeClientMessage('failed to clone https://x-access-token:abcdef123456@github.com/o/r.git');
      expect(out).not.toContain('github.com');
      expect(out).not.toContain('abcdef123456');
      expect(out).toContain('[link]');
    });

    it('redacts bearer tokens / api keys / secrets', () => {
      const out = toSafeClientMessage('auth error: bearer sk_live_9f8a7b6c5d4e');
      expect(out).not.toContain('sk_live_9f8a7b6c5d4e');
      expect(out.toLowerCase()).toContain('[redacted]');
    });

    it('NEVER leaks a third-party vendor/model name (white-label law)', () => {
      const vendors = [
        'GLM provider failed', 'kimi-k2.7 timed out', 'Anthropic 529 overloaded',
        'claude-opus-4-8 error', 'Sonnet is repairing', 'gemini-2.0 quota',
        'Vertex AI denied', 'grok-4 rate limit', 'xAI down', 'Moonshot 429',
        'Z.ai blocked', 'E2B team is blocked', 'DeepSeek error', 'OpenAI 500', 'Bedrock region',
      ];
      const forbidden = /\b(glm|kimi|moonshot|anthropic|claude|sonnet|opus|haiku|gemini|vertex|grok|xai|z\.?ai|deepseek|openai|bedrock|e2b)\b/i;
      for (const v of vendors) {
        const out = toSafeClientMessage(v);
        expect(forbidden.test(out), `leaked vendor in: "${out}"`).toBe(false);
        expect(out).toContain('NavBharatAI');
      }
    });

    it('caps the length at 200 chars', () => {
      const out = toSafeClientMessage('x'.repeat(1000));
      expect(out.length).toBeLessThanOrEqual(200);
    });

    it('returns the fallback for empty input', () => {
      expect(toSafeClientMessage('', 'fallback here')).toBe('fallback here');
      expect(toSafeClientMessage(null, 'fallback here')).toBe('fallback here');
    });

    it('leaves a clean curated message intact', () => {
      const msg = 'Preview upstream unreachable. Please try again.';
      expect(toSafeClientMessage(msg, msg)).toBe(msg);
    });
  });

  describe('isProduction', () => {
    const prev = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = prev; });
    it('true only when NODE_ENV=production', () => {
      process.env.NODE_ENV = 'production';
      expect(isProduction()).toBe(true);
      process.env.NODE_ENV = 'development';
      expect(isProduction()).toBe(false);
    });
  });

  describe('sendSafeError', () => {
    let res: any;
    let logSpy: any;
    const prevEnv = process.env.NODE_ENV;
    beforeEach(() => {
      res = {
        _status: 0, _json: null,
        status(s: number) { this._status = s; return this; },
        json(b: any) { this._json = b; return this; },
      };
      logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { logSpy.mockRestore(); process.env.NODE_ENV = prevEnv; });

    it('returns only the public message and NO raw detail in production', () => {
      process.env.NODE_ENV = 'production';
      sendSafeError(res, 502, 'Preview upstream unreachable', new Error('ECONNREFUSED 10.0.0.5:443'));
      expect(res._status).toBe(502);
      expect(res._json.error).toBe('Preview upstream unreachable');
      expect(res._json.detail).toBeUndefined();
      expect(JSON.stringify(res._json)).not.toContain('10.0.0.5');
    });

    it('always logs the real detail server-side', () => {
      process.env.NODE_ENV = 'production';
      sendSafeError(res, 500, 'Sync save failed', new Error('firestore write conflict at doc/x'));
      const logged = logSpy.mock.calls.map((c: any[]) => c.join(' ')).join('\n');
      expect(logged).toContain('firestore write conflict');
    });

    it('echoes a REDACTED detail in development', () => {
      process.env.NODE_ENV = 'development';
      sendSafeError(res, 500, 'Deployment failed', new Error('GLM provider 429 at https://z.ai/api'));
      expect(res._json.detail).toBeDefined();
      expect(res._json.detail).not.toContain('GLM');
      expect(res._json.detail).not.toContain('z.ai');
      expect(res._json.detail).not.toContain('https://');
    });

    it('redacts a vendor name even if it slips into the public message', () => {
      process.env.NODE_ENV = 'production';
      sendSafeError(res, 500, 'Claude failed to respond', undefined);
      expect(res._json.error).not.toContain('Claude');
      expect(res._json.error).toContain('NavBharatAI');
    });
  });
});
