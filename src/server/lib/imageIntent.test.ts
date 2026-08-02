import { describe, it, expect } from 'vitest';
import { detectImageIntent, extractImagePrompt, imageGenGuidance, imageGenToolPointer } from './imageIntent';

describe('detectImageIntent', () => {
  it('triggers on a clear CREATE-verb + IMAGE-noun request (English + Hinglish)', () => {
    expect(detectImageIntent('generate an image of a mountain sunrise').wants).toBe(true);
    expect(detectImageIntent('ek red car ka logo banao').wants).toBe(true);
    expect(detectImageIntent('draw me a cat').wants).toBe(true);
    expect(detectImageIntent('make a poster for my event').wants).toBe(true);
  });
  it('does NOT trigger on a handling/analysis request (the veto — no surprise picture)', () => {
    expect(detectImageIntent('how do I add an image to my app?').wants).toBe(false);
    expect(detectImageIntent('please analyze this image').wants).toBe(false);
    expect(detectImageIntent('resize this photo').wants).toBe(false);
    expect(detectImageIntent('what is the capital of India?').wants).toBe(false);
  });
  it('extracts the subject, stripping the command lead-in', () => {
    expect(extractImagePrompt('generate an image of a mountain sunrise').toLowerCase()).toContain('mountain sunrise');
  });
});

describe('imageGenGuidance / imageGenToolPointer — every AI points image requests to the dedicated tool', () => {
  it('names the exact AI Image Gen navigation path (matches AppKnowledgeBase)', () => {
    const g = imageGenGuidance();
    expect(g).toContain('Home → Other AI → AI Image Gen');
    expect(g).toContain('AI Image Gen');
    expect(g.length).toBeGreaterThan(40);
  });
  it('the Free-chat pointer also carries the exact path (so even the inline generator guides)', () => {
    expect(imageGenToolPointer()).toContain('Home → Other AI → AI Image Gen');
  });
  it('never leaks an underlying image provider name (white-label law)', () => {
    const blob = `${imageGenGuidance()} ${imageGenToolPointer()}`.toLowerCase();
    for (const vendor of ['pollinations', 'openai', 'dall', 'stable diffusion', 'gemini', 'flux', 'midjourney']) {
      expect(blob).not.toContain(vendor);
    }
  });
});
