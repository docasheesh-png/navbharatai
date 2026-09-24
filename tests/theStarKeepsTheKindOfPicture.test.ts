/**
 * THE ⭐ MUST NOT CHANGE WHAT THE PICTURE IS, AND THE AVOID LIST MUST NOT REPEAT THE PROMPT
 * (admin 2026-09-22: "to fix karo sab" — the two halves of the clinic-logo report that the first fix
 * left open, and recorded as open).
 *
 * HALF ONE. The style chip DEFAULTS to Realistic and most people never touch it. The enhancer was
 * handed "Style: Realistic" for the brief "clinic logo" and rewrote a logo into "a minimalist
 * photograph of a clinic logo, shot with a shallow depth of field…" — words the craft layer then
 * obeyed. Two modules, two rules about what a chip may overrule. Now there is ONE
 * (`resolveImageBrief`), the ⭐ asks it, and a rewrite that turns a flat mark into a photograph is
 * refused the way a rewrite that drops a phone number already is.
 *
 * HALF TWO. The prompt said "sharp, professionally composed, coherent lighting, production quality"
 * and then, 500 characters later, "Avoid: … blurry, out of focus, low resolution, cluttered
 * composition …" — into a provider with one string and no negative field, which this module has
 * always said may read such a list as a request. A negative whose positive the prompt already carries
 * adds no instruction; dropping it can only remove a risk. `IMAGE_GEN_INLINE_NEGATIVE=full` restores
 * the long list without a deploy, so the two can be compared on real pictures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  enhancerUserMessage, decideEnhanced, resolveEnhanceBrief, keepTheKindLine, changedTheKind, enhanceImagePrompt,
} from '../src/server/lib/imagePromptEnhancer';
import { craftImagePrompt, resolveImageBrief, withInlineNegative, compactNegative } from '../src/server/lib/imagePromptCraft';

const LOGO = { prompt: 'clinic logo', type: 'Photograph', style: 'Realistic', styleId: 'photo', colorHint: 'No preference' };
const PHOTO_REWRITE = 'A minimalist photograph of a clinic logo, shot with a shallow depth of field, studio lighting, professional photography.';
const FLAT_REWRITE = 'A clinic logo: an abstract human figure with a heartbeat line, calm blue and white, flat vector mark, clean geometry, centred on a plain background.';

describe('one owner of precedence — the craft layer and the star cannot disagree', () => {
  it('the star resolves the brief with the SAME function the craft layer builds from', () => {
    const viaStar = resolveEnhanceBrief(LOGO);
    const viaCraft = resolveImageBrief({ prompt: LOGO.prompt, type: LOGO.type, style: LOGO.styleId });
    expect(viaStar).toEqual(viaCraft);
    expect(viaStar.purpose).toBe('logo');
    expect(viaStar.realismLoses).toBe(true);
    expect(viaStar.styleApplies).toBe(false);
  });

  it('craftImagePrompt is built from the resolver — not from a second reading of the chips', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/lib/imagePromptCraft.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function craftImagePrompt('));
    expect(fn).toContain('resolveImageBrief(input)');
    expect(fn).not.toContain('detectPurposeWithSource(input.type');
  });
});

describe('🔴 the screenshot: a chip nobody chose must not turn a logo into a photograph', () => {
  it('the star is NOT told "Style: Realistic" for a logo brief, and IS told to keep it a flat mark', () => {
    const u = enhancerUserMessage(LOGO);
    expect(u).not.toContain('Style: Realistic');
    expect(u).toContain('Keep it what it is: a LOGO');
    expect(u).toContain('Do NOT describe it as a photograph');
    expect(u).toContain('Brief: clinic logo');
  });

  it('…while a photo subject still gets the style forwarded, exactly as before', () => {
    const u = enhancerUserMessage({ ...LOGO, prompt: 'a tea stall' });
    expect(u).toContain('Style: Realistic');
    expect(u).not.toContain('Keep it what it is');
  });

  it('a rewrite that turned the logo into a photograph is REFUSED, with the user’s words kept', () => {
    const out = decideEnhanced('clinic logo', PHOTO_REWRITE, true, resolveEnhanceBrief(LOGO));
    expect(out.ok).toBe(false);
    expect((out as { reason: string }).reason).toBe('changed-kind');
    expect((out as { message: string }).message).toContain('different kind of picture');
  });

  it('a rewrite that kept it a flat mark is accepted', () => {
    const out = decideEnhanced('clinic logo', FLAT_REWRITE, true, resolveEnhanceBrief(LOGO));
    expect(out.ok).toBe(true);
  });

  it('the whole call refuses the same rewrite end-to-end', async () => {
    const out = await enhanceImagePrompt(LOGO, async () => ({ content: PHOTO_REWRITE, ok: true }));
    expect(out.ok).toBe(false);
    expect((out as { reason: string }).reason).toBe('changed-kind');
  });
});

describe('🔒 what deliberately does NOT change', () => {
  it('a photo brief may be rewritten with camera language — only a flat mark is protected', () => {
    const brief = resolveEnhanceBrief({ ...LOGO, prompt: 'a tea stall' });
    expect(changedTheKind(brief, 'A roadside tea stall at dawn, 35mm, warm light, shallow depth of field')).toBe(false);
  });

  it('without a styleId there is nothing to resolve against, so the label is forwarded as before', () => {
    const u = enhancerUserMessage({ prompt: 'clinic logo', type: 'Photograph', style: 'Realistic' });
    expect(u).toContain('Style: Realistic');
    expect(decideEnhanced('clinic logo', PHOTO_REWRITE, true).ok).toBe(true);
  });

  it('a logo CHOSEN on the type chip is protected the same way, and named as a logo', () => {
    const b = resolveEnhanceBrief({ prompt: 'a clinic', type: 'Modern app logo', style: 'Realistic', styleId: 'photo' });
    expect(keepTheKindLine(b)).toContain('a LOGO');
    const icon = resolveEnhanceBrief({ prompt: 'a clinic', type: 'App Icon', style: 'Realistic', styleId: 'photo' });
    expect(keepTheKindLine(icon)).toContain('an APP ICON');
  });

  it('a photo asked for IN WORDS is a photo, and the star may keep it one', () => {
    const b = resolveEnhanceBrief({ prompt: 'a realistic photo of my shop signboard logo', type: 'Photograph', style: 'Realistic', styleId: 'photo' });
    expect(b.realismLoses).toBe(false);
    expect(keepTheKindLine(b)).toBe('');
  });

  it('the route forwards the id and the client sends it — the rule never guesses an id from a label', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/imageGen.ts'), 'utf8');
    const client = readFileSync(join(process.cwd(), 'src/components/ide/AIImageGenerator.tsx'), 'utf8');
    expect(route).toContain('styleId: vstring(');
    expect(route).toContain("styleId: typeof body.styleId === 'string' ? body.styleId : undefined");
    expect(client).toContain('styleId: style,');
  });
});

describe('the Avoid list does not repeat what the prompt already says', () => {
  const logo = craftImagePrompt({ prompt: 'clinic logo', style: 'photo', size: 'square', type: 'Photograph' });

  it('drops every negative whose positive form the prompt already carries', () => {
    const tail = withInlineNegative(logo, {}).split('Avoid:')[1] ?? '';
    for (const gone of ['blurry', 'out of focus', 'low resolution', 'jpeg artifacts', 'cluttered composition', 'awkward crop', 'harsh flash']) {
      expect(tail, gone).not.toContain(gone);
    }
  });

  it('…and keeps every negative that has no positive form', () => {
    const tail = withInlineNegative(logo, {}).split('Avoid:')[1] ?? '';
    for (const kept of ['watermark', 'gibberish writing', 'extra fingers', 'photorealistic', 'mockup frame', 'drop shadow']) {
      expect(tail, kept).toContain(kept);
    }
  });

  it('a negative is dropped ONLY when its positive is really in the prompt', () => {
    expect(compactNegative('blurry, watermark', 'a sharp photo', {})).toBe('watermark');
    expect(compactNegative('blurry, watermark', 'a soft dreamy photo', {})).toBe('blurry, watermark');
  });

  it('`crafted.negative` itself is untouched — a provider with a real negative field still gets the whole list', () => {
    expect(logo.negative).toContain('blurry');
  });

  it('IMAGE_GEN_INLINE_NEGATIVE=full restores the complete list, with no deploy', () => {
    const full = withInlineNegative(logo, { IMAGE_GEN_INLINE_NEGATIVE: 'full' });
    expect(full).toContain('blurry, out of focus, low resolution');
    expect(withInlineNegative(logo, { IMAGE_GEN_INLINE_NEGATIVE: 'full' }).length).toBeGreaterThan(withInlineNegative(logo, {}).length);
  });

  it('the prompt still opens with the user’s words and the compaction never touches them', () => {
    const sent = withInlineNegative(logo, {});
    expect(sent.startsWith('clinic logo')).toBe(true);
    expect(sent).toContain('LOGO MARK');
  });
});
