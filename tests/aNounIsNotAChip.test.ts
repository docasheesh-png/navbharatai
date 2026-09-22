/**
 * A NOUN MENTIONED IN THE BRIEF IS NOT A CHIP THE USER CHOSE (admin 2026-09-22, the clinic-logo
 * screenshot: "image irrelevant ban rahi hai, prompt se koi lena dena hi nahi hai").
 *
 * Type chip: Photograph. Style chip: Realistic. Brief: "A minimalist photograph of a clinic logo …
 * shot with a shallow depth of field … studio lighting … professional photography." Measured, the
 * engine received a prompt asking for a photograph AND commanding "flat vector style … no
 * photorealism" AND listing "photorealistic" among the things to avoid — because "Photograph"
 * matches no purpose pattern, the purpose fell through to the WORDS, found the noun "logo", and that
 * noun overruled a sentence of camera direction from the same text. The picture that came back was
 * a shallow-depth-of-field blur of nothing. Then the note told the user to select the chip they had
 * already selected.
 */
import { describe, it, expect } from 'vitest';
import { craftImagePrompt, detectPurpose, detectPurposeWithSource, withInlineNegative } from '../src/server/lib/imagePromptCraft';

const SCREENSHOT = 'A minimalist photograph of a clinic logo. The logo is a stylized, abstract representation of a human figure with a subtle heartbeat line integrated, in shades of calm blue and white. Clean, modern, and professional. Shot with a shallow depth of field, highlighting the logo against a soft, neutral background. Studio lighting, high detail, sharp focus, professional photography.';

describe('where a purpose came from is part of the answer', () => {
  it('names the source, and detectPurpose is unchanged for every existing caller', () => {
    expect(detectPurposeWithSource('App Icon', 'coffee shop')).toEqual({ purpose: 'icon', source: 'type' });
    expect(detectPurposeWithSource('Photograph', 'a logo for my cafe')).toEqual({ purpose: 'logo', source: 'words' });
    expect(detectPurposeWithSource('Photograph', 'a cat on a wall')).toEqual({ purpose: 'general', source: 'none' });
    expect(detectPurpose('Photograph', 'a logo for my cafe')).toBe('logo');
  });
});

describe('🔴 the screenshot: a photograph OF a logo is a photograph', () => {
  it('sends ONE coherent photo brief — no logo direction, no "no photorealism", the camera terms applied', () => {
    const c = craftImagePrompt({ prompt: SCREENSHOT, style: 'photo', size: 'wide', type: 'Photograph' });
    const sent = withInlineNegative(c);
    expect(c.purpose).toBe('general');
    expect(sent).not.toContain('LOGO MARK');
    expect(sent).not.toContain('no photorealism');
    expect(c.negative).not.toContain('photorealistic');
    // The photo negatives DO apply: this is a photo request, and realism drifts to illustration otherwise.
    expect(c.negative).toContain('illustration');
    // The prompt still opens with the user's own words.
    expect(sent.startsWith('A minimalist photograph of a clinic logo')).toBe(true);
  });

  it('…and the impossible note ("set the type to Photograph") is gone', () => {
    const c = craftImagePrompt({ prompt: SCREENSHOT, style: 'photo', size: 'wide', type: 'Photograph' });
    expect(c.notes.some((n) => /realistic-photo style was not applied/.test(n))).toBe(false);
  });

  it('realism in WORDS alone is enough — the chip need not be set', () => {
    const c = craftImagePrompt({ prompt: 'a realistic photo of my shop signboard logo', size: 'square', type: 'Photograph' });
    expect(c.purpose).toBe('general');
    expect(c.prompt).not.toContain('LOGO MARK');
  });
});

describe('🔒 what deliberately does NOT change', () => {
  it('a purpose CHOSEN on the type chip still wins over the Realistic chip, with a note that is now actionable', () => {
    const c = craftImagePrompt({ prompt: 'a clinic', style: 'photo', size: 'square', type: 'Modern app logo' });
    expect(c.purpose).toBe('logo');
    expect(c.prompt).toContain('LOGO MARK');
    const note = c.notes.find((n) => /realistic-photo style was not applied/.test(n));
    expect(note).toBeTruthy();
    expect(note).toContain('change the Image type');
    expect(note).not.toContain('Set the Image type to "Photograph"');
  });

  it('a chip-chosen logo keeps its authority even when the words ask for a photo — the user picked it on purpose', () => {
    const c = craftImagePrompt({ prompt: SCREENSHOT, style: 'photo', size: 'wide', type: 'Modern app logo' });
    expect(c.purpose).toBe('logo');
    expect(c.prompt).toContain('LOGO MARK');
  });

  it('a plain "logo for my cafe" with no photo words is still a logo brief', () => {
    const c = craftImagePrompt({ prompt: 'a logo for my cafe', size: 'square', type: 'Photograph' });
    expect(c.purpose).toBe('logo');
    expect(c.prompt).toContain('LOGO MARK');
  });

  it('a logo for a PHOTOGRAPHY studio is still a logo — "photography" names the subject, not the image', () => {
    const c = craftImagePrompt({ prompt: 'logo for a photography studio', size: 'square', type: 'Photograph' });
    expect(c.purpose).toBe('logo');
  });

  it('a banner is not photo-hostile, so a photo of a banner subject was never overruled and still is not', () => {
    const c = craftImagePrompt({ prompt: 'a realistic photo of a beach for a website banner', style: 'photo', size: 'wide', type: 'Photograph' });
    expect(c.purpose).toBe('banner');
    expect(c.notes.some((n) => /not applied/.test(n))).toBe(false);
  });
});
