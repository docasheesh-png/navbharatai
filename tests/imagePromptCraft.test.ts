/**
 * The prompt IS the quality — so this is where the quality is tested.
 *
 * ADMIN REQUEST 2026-08-14: make AI Image Gen dramatically better. The model was never the ceiling;
 * "App Icon — coffee shop" plus a style word is roughly what someone types into a free image site,
 * and it leaves composition, framing, margins and background to the model's guess — which is why AI
 * images look amateur.
 *
 * Two things must hold at once, and they pull against each other:
 *   • enough ART DIRECTION that an icon reads at 48px and a banner leaves room for a headline;
 *   • never OVERRIDING the user, never contradicting them, never repeating what they already said.
 * A prompt that argues with the request produces worse images than no direction at all.
 */

import { describe, it, expect } from 'vitest';
import {
  craftImagePrompt,
  detectPurpose,
  styleConflictsWithPrompt,
  requestedText,
  withInlineNegative,
} from '../src/server/lib/imagePromptCraft';

describe('what is this image FOR', () => {
  it('reads the selected type', () => {
    expect(detectPurpose('App Icon', 'coffee shop')).toBe('icon');
    expect(detectPurpose('Website banner', 'yoga studio')).toBe('banner');
    expect(detectPurpose('Avatar', 'a woman')).toBe('avatar');
    expect(detectPurpose('Background', 'mountains')).toBe('background');
  });

  it('🔒 also reads the user’s OWN words — the type is not always sent as a field', () => {
    // The client has historically mashed the type INTO the prompt ("App Icon — coffee shop"), and a
    // user who simply types "logo for my cafe" deserves the same direction as one who tapped a chip.
    expect(detectPurpose(undefined, 'a logo for my cafe')).toBe('logo');
    expect(detectPurpose(undefined, 'App Icon — coffee shop')).toBe('icon');
    expect(detectPurpose('', 'wallpaper of the himalayas')).toBe('background');
  });

  it('falls back to general rather than guessing wrong', () => {
    expect(detectPurpose(undefined, 'a cat sitting on a wall')).toBe('general');
    expect(detectPurpose(undefined, '')).toBe('general');
  });
});

describe('🔒 the direction that makes each kind actually usable', () => {
  it('an ICON is told to survive being shrunk — the whole job of an icon', () => {
    const c = craftImagePrompt({ prompt: 'coffee shop', type: 'App Icon' });
    expect(c.prompt).toMatch(/48×48|48x48/);
    expect(c.prompt).toContain('safe margin');
    expect(c.prompt.toLowerCase()).toContain('centred');
    expect(c.negative).toContain('text');       // an icon with text is unreadable when small
  });

  it('🔒 a BANNER leaves room for the headline — otherwise the copy lands on a face', () => {
    const c = craftImagePrompt({ prompt: 'yoga studio', type: 'Website banner' });
    expect(c.prompt).toContain('off-centre');
    expect(c.prompt.toLowerCase()).toContain('empty');
    // And it must not bake text in, since the headline is added later in HTML.
    expect(c.prompt).toContain('no text of any kind');
  });

  it('🔒 an AVATAR is framed for a CIRCLE, which is a decision made before the shot', () => {
    const c = craftImagePrompt({ prompt: 'friendly founder', type: 'Avatar' });
    expect(c.prompt).toContain('CIRCLE');
    expect(c.negative).toContain('cropped forehead');
  });

  it('a LOGO is told to work in one colour and at small size', () => {
    const c = craftImagePrompt({ prompt: 'mountain trekking brand', type: 'Modern app logo' });
    expect(c.prompt).toContain('single colour');
    expect(c.negative).toContain('photorealistic');
  });

  it('a BACKGROUND is told to stay out of the way of text', () => {
    const c = craftImagePrompt({ prompt: 'soft abstract', type: 'Background' });
    expect(c.prompt).toContain('readable');
    expect(c.negative).toContain('central subject');
  });

  it('a general request still gets the quality floor, without invented direction', () => {
    const c = craftImagePrompt({ prompt: 'a cat on a wall' });
    expect(c.purpose).toBe('general');
    expect(c.prompt).toContain('production quality');
    expect(c.prompt).not.toContain('APP ICON');
  });
});

describe('🔒 the universal AI tells are excluded', () => {
  it('every image gets the negatives a viewer notices instantly', () => {
    const c = craftImagePrompt({ prompt: 'anything' });
    for (const tell of ['garbled text', 'watermark', 'extra fingers', 'jpeg artifacts', 'border frame']) {
      expect(c.negative, tell).toContain(tell);
    }
  });

  it('🔒 inline negatives are phrased as "Avoid:", never a bare list', () => {
    // A raw list of unwanted words inside a positive prompt is read by some models as a request FOR
    // them — the classic way a negative prompt backfires.
    const inline = withInlineNegative(craftImagePrompt({ prompt: 'a shop', type: 'App Icon' }));
    expect(inline).toContain('Avoid:');
    expect(inline.indexOf('Avoid:')).toBeGreaterThan(inline.indexOf('a shop'));
  });

  it('a crafted prompt with no negatives returns unchanged', () => {
    const c = { prompt: 'x', negative: '', notes: [], purpose: 'general' as const };
    expect(withInlineNegative(c)).toBe('x');
  });
});

describe('🔒 the user always wins', () => {
  it('their subject LEADS the prompt — models weight the opening most', () => {
    const c = craftImagePrompt({ prompt: 'a red tractor in a field', type: 'Illustration', style: 'vibrant' });
    expect(c.prompt.startsWith('a red tractor in a field')).toBe(true);
  });

  it('🔒 a style chip that CONTRADICTS their words is dropped, not merged', () => {
    // "dark moody" + Minimal's "clean white background" is a muddle that satisfies neither.
    const c = craftImagePrompt({ prompt: 'dark moody logo for a bar', style: 'minimal' });
    expect(c.prompt).not.toContain('white space');
    expect(c.notes.join(' ')).toContain('took priority');
  });

  it('🔒 and they are TOLD the chip was set aside — they tapped it, after all', () => {
    const c = craftImagePrompt({ prompt: 'flat vector icon', style: '3d' });
    expect(c.notes.length).toBeGreaterThan(0);
  });

  it('a non-conflicting chip is applied normally', () => {
    const c = craftImagePrompt({ prompt: 'a mountain', style: 'vibrant' });
    expect(c.prompt).toContain('Style:');
    expect(c.notes).toEqual([]);
  });

  it('🔒 never repeats a word the user already wrote', () => {
    const c = craftImagePrompt({ prompt: 'a minimalist clean logo', style: 'minimal' });
    // Just the Style clause — slicing to the end would sweep in the fixed quality line, whose
    // "clean edges" is a different phrase and legitimately stays.
    const from = c.prompt.indexOf('Style:');
    const styleClause = c.prompt.slice(from, c.prompt.indexOf('.', from));
    expect(styleClause).not.toContain('minimalist');
    expect(styleClause).not.toContain('clean');
  });
});

describe('🔒 honest about text, because no image model can spell', () => {
  it('finds text the user asked for, quoted or named', () => {
    expect(requestedText('logo with the name SHARMA CAFE')).toBe('SHARMA CAFE');
    expect(requestedText('a sign that says "Open Daily"')).toBe('Open Daily');
    expect(requestedText('logo for a cafe')).toBe('');
  });

  it('warns the user instead of quietly shipping gibberish', () => {
    const c = craftImagePrompt({ prompt: 'logo with the name SHARMA CAFE', type: 'Modern app logo' });
    expect(c.notes.join(' ')).toContain('SHARMA CAFE');
    expect(c.notes.join(' ')).toMatch(/unreliable at spelling/);
    // …and still gives the model its best chance.
    expect(c.prompt).toContain('spelled correctly');
  });

  it('says nothing about text when none was asked for', () => {
    expect(craftImagePrompt({ prompt: 'a mountain' }).notes).toEqual([]);
  });
});

describe('mechanics', () => {
  it('adds the aspect ratio the model understands', () => {
    expect(craftImagePrompt({ prompt: 'x', size: 'wide' }).prompt).toContain('16:9');
    expect(craftImagePrompt({ prompt: 'x', size: 'portrait' }).prompt).toContain('3:4');
    expect(craftImagePrompt({ prompt: 'x', size: 'nonsense' }).prompt).not.toContain('Aspect ratio');
  });

  it('🔒 stays within the provider limit however much is added', () => {
    const c = craftImagePrompt({ prompt: 'a '.repeat(3000), type: 'App Icon', style: 'vibrant', size: 'wide' });
    expect(c.prompt.length).toBeLessThanOrEqual(2000);
    expect(withInlineNegative(c).length).toBeLessThanOrEqual(2000);
  });

  it('survives an empty or junk request without throwing', () => {
    for (const input of [{ prompt: '' }, { prompt: null as never }, {} as never]) {
      expect(() => craftImagePrompt(input)).not.toThrow();
    }
    // A type with no prompt is still a valid request — the direction alone describes an image.
    expect(craftImagePrompt({ prompt: '', type: 'App Icon' }).prompt).toContain('APP ICON');
  });

  it('🔒 no vendor or model name ever appears — this text can reach the user', () => {
    const c = craftImagePrompt({ prompt: 'a shop logo', type: 'Modern app logo', style: 'flat' });
    const all = [c.prompt, c.negative, ...c.notes].join(' ');
    expect(all).not.toMatch(/gemini|grok|pollinations|openai|dall|midjourney|stable diffusion/i);
  });
});
