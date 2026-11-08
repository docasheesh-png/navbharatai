import { describe, it, expect } from 'vitest';
import { scrubVendorBrands, mentionsVendorBrand, scrubVendorBrandsInPayload } from './brandScrub';

const LEAKS = [
  'GLM-4.7-Flash rate limited', 'Z.ai 429', 'Kimi K2 timeout', 'OpenAI 500', 'gpt-4o-mini failed',
  'ChatGPT down', 'Claude Sonnet overloaded', 'Grok-4 error', 'Gemini 2.5 Flash quota', 'DeepSeek V4 busy',
  'OpenRouter 402', 'Groq limit', 'DeepInfra 503', 'Cloudflare Workers AI error', 'CheaperInference down',
  'Surplus rejected', 'AWS Bedrock throttled', 'Nova Sonic failed', 'Pollinations image error', 'Vertex AI timeout',
];

describe('brandScrub (white-label law)', () => {
  it.each(LEAKS)('scrubs %s', (raw) => {
    const out = scrubVendorBrands(raw);
    expect(mentionsVendorBrand(out)).toBe(false);
    expect(out).toContain('NavBharatAI');
  });
  it('removes version suffixes too', () => {
    expect(scrubVendorBrands('GLM-4.7-Flash rate limited')).toBe('NavBharatAI rate limited');
    expect(scrubVendorBrands('Gemini 2.5 Flash quota')).toBe('NavBharatAI quota');
  });
  it('collapses repeated replacements', () => {
    expect(scrubVendorBrands('OpenRouter / Groq / DeepInfra all failed')).toBe('NavBharatAI all failed');
  });
  it('leaves ordinary text alone', () => {
    expect(scrubVendorBrands('Please try again later.')).toBe('Please try again later.');
    expect(mentionsVendorBrand('A glimpse of the gladiator')).toBe(false);
  });
  it('scrubs only user-visible payload fields and masks model names', () => {
    const out = scrubVendorBrandsInPayload({ error: 'GLM 429', code: 'GLM_LIMIT', model: 'glm-4.7-flash', data: 'OpenAI' });
    expect(out).toEqual({ error: 'NavBharatAI 429', code: 'GLM_LIMIT', model: 'navbharatai', data: 'OpenAI' });
  });
});
