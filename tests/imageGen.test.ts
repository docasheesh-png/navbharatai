import { describe, it, expect } from 'vitest';
import {
  buildImagePrompt, parseImagePartsResponse, imageGenModels, imageGenConfigured,
  isValidImageGenRequest, IMAGE_STYLE_ENHANCERS, IMAGE_SIZE_RATIOS,
  isImageRefusal, extractResponseText, IMAGE_REFUSAL_MESSAGE,
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
  it('is true only when an image key env is present', () => {
    expect(imageGenConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(imageGenConfigured({ GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(imageGenConfigured({ GOOGLE_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(true);
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
