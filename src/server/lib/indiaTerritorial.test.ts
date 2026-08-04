import { describe, it, expect } from 'vitest';
import { INDIA_TERRITORIAL_INTEGRITY } from './prompts';
import { buildProfessionalSystemPrompt } from '../professionals/engine';
import { buildImagePrompt, wantsIndiaMap, INDIA_MAP_IMAGE_DIRECTIVE } from './imageGen';

describe('INDIA_TERRITORIAL_INTEGRITY — the India-first territorial/map directive', () => {
  it('names every region per the Government of India official position', () => {
    for (const region of ['Jammu & Kashmir', 'Ladakh', 'Aksai Chin', 'Pakistan-occupied Kashmir', 'Arunachal Pradesh']) {
      expect(INDIA_TERRITORIAL_INTEGRITY).toContain(region);
    }
    expect(INDIA_TERRITORIAL_INTEGRITY).toMatch(/official position of the Government of India/i);
    expect(INDIA_TERRITORIAL_INTEGRITY).toMatch(/integral part[s]? of India/i);
  });

  it('stays respectful, not inflammatory (acknowledges other claims, states India\'s position)', () => {
    expect(INDIA_TERRITORIAL_INTEGRITY).toMatch(/respectful and non-inflammatory/i);
    expect(INDIA_TERRITORIAL_INTEGRITY).toMatch(/acknowledge such claims exist/i);
  });

  it('is injected into the Professionals system prompt (every professional inherits the stance)', () => {
    const sys = buildProfessionalSystemPrompt({
      id: 'x', name: 'Test AI', systemPrompt: 'You are a test.', disclaimer: '',
    } as any);
    expect(sys).toContain(INDIA_TERRITORIAL_INTEGRITY);
  });
});

describe('wantsIndiaMap / buildImagePrompt — map-of-India image guard', () => {
  it('fires only when BOTH India and a map/boundary word are present', () => {
    expect(wantsIndiaMap('map of India')).toBe(true);
    expect(wantsIndiaMap('bharat ka naksha banao')).toBe(true);
    expect(wantsIndiaMap('india border outline')).toBe(true);
    // Not a map, or not India → untouched.
    expect(wantsIndiaMap('a beautiful sunset over India')).toBe(false);
    expect(wantsIndiaMap('world map')).toBe(false);
    expect(wantsIndiaMap('logo for a fintech app')).toBe(false);
  });

  it('appends the official-boundary directive to a map-of-India image prompt', () => {
    const p = buildImagePrompt({ prompt: 'a clean map of India for a school poster' } as any);
    expect(p).toContain(INDIA_MAP_IMAGE_DIRECTIVE);
    expect(p).toMatch(/Survey of India/);
  });

  it('leaves a non-map image prompt exactly as before (no directive)', () => {
    const p = buildImagePrompt({ prompt: 'a cute cat wearing sunglasses' } as any);
    expect(p).not.toContain(INDIA_MAP_IMAGE_DIRECTIVE);
  });
});
