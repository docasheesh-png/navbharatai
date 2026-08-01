import { describe, it, expect } from 'vitest';
import { detectImageIntent, extractImagePrompt } from '../src/server/lib/imageIntent';

/**
 * Free-chat inline image generation (admin 2026-08-01): a plain-text request to CREATE a picture must
 * trigger generation, while a request to HANDLE/analyse an existing image (or an unrelated message) must
 * NOT. Precision is the whole point — a false positive turns a normal question into a surprise picture.
 */
describe('detectImageIntent — positive (should generate)', () => {
  const yes = [
    'generate an image of a mountain sunrise',
    'create a modern logo for a coffee shop',
    'make me a picture of a cat wearing sunglasses',
    'draw a red sports car',
    'design a poster for a music festival',
    'a wallpaper of the Himalayas',
    'ek image banao ek robot ki',
    'red rose ka photo banao',
    'mujhe ek logo banao neele rang me',
    'तस्वीर बनाओ एक शेर की',
  ];
  for (const m of yes) {
    it(`YES: "${m}"`, () => expect(detectImageIntent(m).wants).toBe(true));
  }
});

describe('detectImageIntent — negative (should NOT generate)', () => {
  const no = [
    'how do I add an image to my app?',
    'how to upload a photo in my website',
    'resize this image for me',
    'explain what is in this photo',
    'image kaise lagau apni site me',
    'what is the best logo size for android',
    'tell me a joke',
    'build me a todo app',
    'meri app me ek button add karo',
  ];
  for (const m of no) {
    it(`NO: "${m}"`, () => expect(detectImageIntent(m).wants).toBe(false));
  }
});

describe('extractImagePrompt — strips the command, keeps the subject', () => {
  it('drops "generate an image of"', () => {
    expect(extractImagePrompt('generate an image of a mountain sunrise').toLowerCase()).toContain('mountain sunrise');
    expect(extractImagePrompt('generate an image of a mountain sunrise').toLowerCase()).not.toMatch(/^generate/);
  });
  it('drops a trailing "banao"', () => {
    expect(extractImagePrompt('ek robot banao').toLowerCase()).not.toMatch(/banao/);
  });
  it('falls back to the full message when stripping would empty it', () => {
    expect(extractImagePrompt('make an image').length).toBeGreaterThan(0);
  });
  it('the intent carries a usable prompt', () => {
    const r = detectImageIntent('create a logo of a blue elephant');
    expect(r.wants).toBe(true);
    expect(r.prompt.toLowerCase()).toContain('blue elephant');
  });
});
