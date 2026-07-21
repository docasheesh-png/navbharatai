import { describe, it, expect } from 'vitest';
import { redactProvidersText, redactProviderError, hasProviderLeak } from './providerRedaction';

const FORBIDDEN = /\b(glm|kimi|claude|anthropic|sonnet|opus|haiku|gemini|vertex|grok|xai|openai|gpt|deepseek|moonshot|z\.?ai|bedrock)\b|(glm|kimi|claude|gemini|grok|gpt)[-/][\w.:-]+/i;

describe('redactProvidersText — the shared White-Label anonymizer (no length cap)', () => {
  it('degrades vendor names to NavBharatAI and model ids to "the model", for every provider', () => {
    const samples = [
      'Provider GLM failed: 429 from Z.ai — falling back',
      'claude-opus-4-8 rate limited; switching to Sonnet',
      'Kimi (Moonshot) timed out, retrying on gemini-2.5-pro',
      'xAI Grok returned an error; Anthropic backstop engaged',
      'OpenAI gpt-4o quota exceeded',
      'glm-5.2 and kimi-k2.7-code both unavailable, Vertex fallback; Haiku used',
    ];
    for (const s of samples) {
      const out = redactProvidersText(s);
      expect(out, `leaked from: ${s}`).not.toMatch(FORBIDDEN);
    }
  });

  it('does NOT truncate (unlike redactProviderError) — a long root cause survives whole', () => {
    const long = 'the build failed because ' + 'x'.repeat(400) + ' at the end';
    expect(redactProvidersText(long).length).toBeGreaterThan(300);
  });

  it('strips URLs, git tokens and secrets', () => {
    expect(redactProvidersText('see https://x-access-token:ghp_SECRET123456@github.com/a/b.git')).not.toContain('ghp_SECRET123456');
    expect(redactProvidersText('bearer: abcdef123456')).toContain('[redacted]');
  });

  it('leaves benign text unchanged; returns "" for nullish', () => {
    expect(redactProvidersText('the import errored (repository not found)')).toBe('the import errored (repository not found)');
    expect(redactProvidersText(undefined)).toBe('');
    expect(redactProvidersText(null)).toBe('');
  });
});

describe('redactProviderError — the capped chat/error variant', () => {
  it('caps at 200 chars and scrubs providers', () => {
    expect(redactProviderError('x'.repeat(500)).length).toBeLessThanOrEqual(200);
    expect(redactProviderError('Provider GLM failed')).toContain('NavBharatAI');
    expect(redactProviderError('claude-opus-4-8 rate limited')).toContain('the model');
    expect(redactProviderError('')).toBe('');
  });
});

describe('hasProviderLeak — the guard used by regression tests', () => {
  it('flags any surviving vendor/model token and clears clean text', () => {
    expect(hasProviderLeak('built by GLM')).toBe(true);
    expect(hasProviderLeak('claude-opus-4-8')).toBe(true);
    expect(hasProviderLeak('gemini flash')).toBe(true);
    expect(hasProviderLeak('NavBharatAI built your app')).toBe(false);
    expect(hasProviderLeak('the model repaired a bug')).toBe(false);
  });
});
