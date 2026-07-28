import { describe, it, expect } from 'vitest';
import { anonymousAiRefusal } from '../src/server/lib/costlyAiAccess';

// Every spend control NavBharatAI has hangs off the wallet, and the wallet needs an ACCOUNT. Two AI
// endpoints with a real per-call provider charge — image generation and screenshot→code — were serving
// anonymous callers at 10 an hour per IP with no global anonymous ceiling. At roughly ₹3.3 an image
// that is about ₹33 an hour per address, across as many addresses as someone cares to use, billed to
// NavBharatAI, with nothing to charge it to. A rate limiter bounds the RATE; nothing bounded the SPEND.

describe('the refusal an anonymous caller gets', () => {
  it('is a 401 asking them to sign in, not a generic error', () => {
    const r = anonymousAiRefusal('image generation');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('login_required');
  });

  it('names what they GET by signing in, not just what they cannot do', () => {
    // An error that only says "no" invites a reload. The credit is the actual reason to sign up, and
    // signing up is the step that gives it to them — so this is a conversion prompt, not a toll gate.
    const r = anonymousAiRefusal('image generation');
    expect(String(r.body.error)).toMatch(/sign in/i);
    expect(String(r.body.error)).toMatch(/free NavBharatAI credit/i);
  });

  it('names the specific thing the visitor just tried', () => {
    expect(String(anonymousAiRefusal('image generation').body.error)).toContain('image generation');
    expect(String(anonymousAiRefusal('screenshot to code').body.error)).toContain('screenshot to code');
    expect(anonymousAiRefusal('screenshot to code').body.noun).toBe('screenshot to code');
  });

  it('leaks no provider or model name — the engine is always NavBharatAI', () => {
    const text = JSON.stringify(anonymousAiRefusal('image generation'));
    for (const vendor of ['gemini', 'google', 'openai', 'claude', 'anthropic', 'glm', 'kimi', 'grok']) {
      expect(text.toLowerCase(), vendor).not.toContain(vendor);
    }
  });
});
