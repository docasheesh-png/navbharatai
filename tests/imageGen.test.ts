import { describe, it, expect } from 'vitest';
import {
  buildImagePrompt, parseImagePartsResponse, imageGenModels, imageGenConfigured,
  isValidImageGenRequest, IMAGE_STYLE_ENHANCERS, IMAGE_SIZE_RATIOS,
  isImageRefusal, extractResponseText, IMAGE_REFUSAL_MESSAGE,
  geminiImageConfigured, grokImageKey, grokImageModel, parseGrokImageResponse,
  pollinationsEnabled, pollinationsImageUrl, IMAGE_SIZE_PIXELS,
} from '../src/server/lib/imageGen';

/**
 * AI Image Gen pure core (admin autopsy 2026-07-20): the tile shipped with NO server side —
 * the client hot-linked a third-party image site. These tests lock the real core: prompt
 * composition, honest no-image parsing, env-tunable model ladder, and key gating.
 */

describe('buildImagePrompt', () => {
  it('composes prompt + style enhancer + aspect hint', () => {
    const p = buildImagePrompt({ prompt: 'fintech logo', style: 'dark', size: 'wide' });
    expect(p).toContain('fintech logo');
    expect(p).toContain(IMAGE_STYLE_ENHANCERS.dark);
    expect(p).toContain('16:9');
  });
  it('unknown style/size are ignored, prompt is bounded', () => {
    const p = buildImagePrompt({ prompt: 'x'.repeat(5000), style: 'nope', size: 'nope' });
    expect(p.length).toBeLessThan(2100);
    expect(p).not.toContain('Style:');
    expect(p).not.toContain('Aspect ratio');
  });
  it('every client size id maps to a ratio', () => {
    for (const id of ['square', 'wide', 'portrait', 'icon']) expect(IMAGE_SIZE_RATIOS[id]).toBeTruthy();
  });
});

describe('parseImagePartsResponse', () => {
  it('extracts the first inline image part', () => {
    const resp = { candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] };
    expect(parseImagePartsResponse(resp)).toEqual({ mimeType: 'image/png', base64: 'AAAA' });
  });
  it('defaults mimeType to image/png when missing', () => {
    const resp = { candidates: [{ content: { parts: [{ inlineData: { data: 'BBBB' } }] } }] };
    expect(parseImagePartsResponse(resp)!.mimeType).toBe('image/png');
  });
  it('HONESTY: text-only or malformed responses yield null — never a placeholder', () => {
    expect(parseImagePartsResponse({ candidates: [{ content: { parts: [{ text: 'sorry' }] } }] })).toBeNull();
    expect(parseImagePartsResponse({})).toBeNull();
    expect(parseImagePartsResponse(null)).toBeNull();
  });
});

describe('isImageRefusal — honest refusal vs transient failure (the "spiderman" case)', () => {
  it('a text-only, no-image response is treated as a content refusal (change the prompt)', () => {
    const resp = { candidates: [{ content: { parts: [{ text: 'I can’t create that copyrighted character.' }] } }] };
    expect(isImageRefusal(resp)).toBe(true);
    expect(extractResponseText(resp)).toMatch(/copyrighted/i);
  });
  it('an explicit block/finish reason is a refusal', () => {
    expect(isImageRefusal({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).toBe(true);
    expect(isImageRefusal({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] })).toBe(true);
    expect(isImageRefusal({ candidates: [{ finishReason: 'RECITATION', content: { parts: [] } }] })).toBe(true);
  });
  it('a response that DID return an image is NOT a refusal', () => {
    const resp = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] };
    expect(isImageRefusal(resp)).toBe(false);
  });
  it('an empty/malformed response (a thrown-rung shape) is NOT a refusal — that stays transient', () => {
    expect(isImageRefusal({})).toBe(false);
    expect(isImageRefusal(null)).toBe(false);
    expect(isImageRefusal({ candidates: [{ content: { parts: [] } }] })).toBe(false);
  });
  it('the refusal message is actionable and white-label (no vendor/model name)', () => {
    expect(IMAGE_REFUSAL_MESSAGE).toMatch(/NavBharatAI/);
    expect(IMAGE_REFUSAL_MESSAGE).toMatch(/original/i);
    expect(IMAGE_REFUSAL_MESSAGE).not.toMatch(/gemini|google|pollinations|openai|dall|imagen/i);
  });
});

describe('imageGenModels', () => {
  it('has a non-empty default ladder and honours the env override', () => {
    const prev = process.env.IMAGE_GEN_MODEL;
    try {
      delete process.env.IMAGE_GEN_MODEL;
      expect(imageGenModels().length).toBeGreaterThan(0);
      process.env.IMAGE_GEN_MODEL = 'model-a, model-b';
      expect(imageGenModels()).toEqual(['model-a', 'model-b']);
    } finally {
      if (prev === undefined) delete process.env.IMAGE_GEN_MODEL; else process.env.IMAGE_GEN_MODEL = prev;
    }
  });
});

describe('imageGenConfigured', () => {
  it('is always true while the free Pollinations provider is on (no key needed)', () => {
    expect(imageGenConfigured({} as NodeJS.ProcessEnv)).toBe(true);
    expect(imageGenConfigured({ IMAGE_GEN_POLLINATIONS: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it('is true when a Gemini OR Grok/xAI key is present, even with Pollinations off', () => {
    const off = { IMAGE_GEN_POLLINATIONS: 'off' };
    expect(imageGenConfigured({ ...off, GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(imageGenConfigured({ ...off, GROK_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(imageGenConfigured({ ...off, XAI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('Pollinations free provider (admin: "free wala chalu karo")', () => {
  it('is enabled by default, off only via the explicit kill switch', () => {
    expect(pollinationsEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(pollinationsEnabled({ IMAGE_GEN_POLLINATIONS: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(pollinationsEnabled({ IMAGE_GEN_POLLINATIONS: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it('builds a URL with the prompt, the size pixels, no-logo, and a model', () => {
    const url = pollinationsImageUrl('a blue robot', 'wide', {} as NodeJS.ProcessEnv);
    expect(url.startsWith('https://image.pollinations.ai/prompt/')).toBe(true);
    expect(url).toContain(encodeURIComponent('a blue robot'));
    expect(url).toContain(`width=${IMAGE_SIZE_PIXELS.wide.w}`);
    expect(url).toContain(`height=${IMAGE_SIZE_PIXELS.wide.h}`);
    expect(url).toContain('nologo=true');
    expect(url).toContain('model=flux');
  });
  it('defaults to square pixels for an unknown size and honours a model override', () => {
    const url = pollinationsImageUrl('x', 'nope', { IMAGE_GEN_POLLINATIONS_MODEL: 'turbo' } as unknown as NodeJS.ProcessEnv);
    expect(url).toContain(`width=${IMAGE_SIZE_PIXELS.square.w}`);
    expect(url).toContain('model=turbo');
  });
});

describe('Grok image fallback (keeps the feature alive when Gemini is access-denied)', () => {
  it('geminiImageConfigured is true ONLY for a Gemini key, not a Grok key', () => {
    expect(geminiImageConfigured({ GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(geminiImageConfigured({ GROK_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
  it('grokImageKey accepts either env name; grokImageModel is env-tunable with a default', () => {
    expect(grokImageKey({ GROK_API_KEY: 'a' } as unknown as NodeJS.ProcessEnv)).toBe('a');
    expect(grokImageKey({ XAI_API_KEY: 'b' } as unknown as NodeJS.ProcessEnv)).toBe('b');
    expect(grokImageKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(grokImageModel({} as NodeJS.ProcessEnv)).toBe('grok-2-image');
    expect(grokImageModel({ IMAGE_GEN_GROK_MODEL: 'grok-3-image' } as unknown as NodeJS.ProcessEnv)).toBe('grok-3-image');
  });
  it('parseGrokImageResponse extracts the b64_json image, null when absent (never a placeholder)', () => {
    expect(parseGrokImageResponse({ data: [{ b64_json: 'ZZZZ' }] })).toEqual({ mimeType: 'image/png', base64: 'ZZZZ' });
    expect(parseGrokImageResponse({ data: [{ url: 'http://x' }] })).toBeNull();
    expect(parseGrokImageResponse({ data: [] })).toBeNull();
    expect(parseGrokImageResponse(null)).toBeNull();
  });
});

describe('isValidImageGenRequest', () => {
  it('accepts a real request, rejects junk', () => {
    expect(isValidImageGenRequest({ prompt: 'logo' })).toBe(true);
    expect(isValidImageGenRequest({ prompt: 'logo', style: 'dark', size: 'wide' })).toBe(true);
    expect(isValidImageGenRequest({ prompt: '' })).toBe(false);
    expect(isValidImageGenRequest({ prompt: 1 })).toBe(false);
    expect(isValidImageGenRequest(null)).toBe(false);
  });
});
