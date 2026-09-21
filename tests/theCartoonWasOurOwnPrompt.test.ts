/**
 * "Cartoon jaisi image banti hai abhi" — the admin, 2026-09-21, asking whether the free tier could
 * be more realistic and more cinematic.
 *
 * 🔴 IT COULD, AND THE ENGINE WAS NEVER THE PROBLEM: OUR OWN PROMPT ASKED FOR THE CARTOON. Traced
 * from a real request before anything was changed, the default free screen sent, verbatim:
 *
 *     "Modern app logo — a man drinking chai in a Delhi street at night … Design as a LOGO MARK:
 *      flat vector style … **no photorealism** … Avoid: … photorealistic, 3D render …"
 *
 * Three separate defects produced that, and each is locked below.
 *   1. The image-type chip is COMPULSORY and there was no neutral entry, so every request was
 *      forced into one of eight art briefs — and the default was a LOGO.
 *   2. Choosing the Realistic chip did not help: the logo brief's "no photorealism" and its
 *      "photorealistic" negative stayed in the same prompt as "photograph, 50mm lens at f/2".
 *      Realism was unreachable in practice.
 *   3. There was no way to ask for CINEMATIC at all — exactly as realism was unreachable before
 *      the `photo` chip was added in 2026-08-16.
 *
 * ⚠️ Several assertions are SOURCE-level or whole-prompt. `tsc` and `vitest` cannot see a prompt
 * that contradicts itself — every one of these failures produced a perfectly successful response
 * containing a picture nobody wanted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  craftImagePrompt, detectPurpose, realismInWords, withInlineNegative,
} from '../src/server/lib/imagePromptCraft';
import { IMAGE_STYLE_ENHANCERS, imageSubjectPrompt, buildImagePrompt } from '../src/server/lib/imageGen';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const FREE = 'src/components/ide/AIImageGenerator.tsx';
const ROUTE = 'src/server/routes/imageGen.ts';
const client = read(FREE);

/** The picker's own first entries — the defaults a user who touches nothing actually gets. */
function clientDefaultType(): string {
  const m = /const IMAGE_TYPES = \[[\s\S]*?\n\s*'([^']+)',/.exec(client);
  expect(m, 'IMAGE_TYPES could not be read from the picker').not.toBeNull();
  return m![1];
}
function clientDefaultStyle(): string {
  const m = /const \[style, setStyle\] = useState\('([^']+)'\)/.exec(client);
  expect(m, 'the style default could not be read from the picker').not.toBeNull();
  return m![1];
}

/** Exactly what the free route now sends, for a given screen state. */
function sent(userWords: string, type: string, style: string, size = 'square'): string {
  const effective = `${type}${userWords ? ` — ${userWords}` : ''}`;
  const body = { prompt: effective, style, size, type };
  return withInlineNegative(craftImagePrompt({
    prompt: imageSubjectPrompt(body as never), style, size, type,
  }));
}

describe('🔴 the defaults no longer command a cartoon', () => {
  it('the picker opens on a NEUTRAL image type, not a logo', () => {
    // The whole bug in one line: a compulsory chip whose default was "Modern app logo".
    expect(clientDefaultType()).toBe('Photograph');
    expect(clientDefaultType().toLowerCase()).not.toContain('logo');
  });

  it('🔴 and that label resolves to NO purpose — the "scene" trap', () => {
    // `PURPOSE_PATTERNS` matches the bare word "scene" as an ILLUSTRATION brief, so a label like
    // "Photo / Scene" would have re-created the same bug one word further along.
    expect(detectPurpose(clientDefaultType(), '')).toBe('general');
  });

  it('the picker opens on Realistic', () => {
    expect(clientDefaultStyle()).toBe('photo');
  });

  it('🔴 so an untouched screen describing a scene gets NO anti-realism instruction', () => {
    const p = sent('a man drinking chai in a Delhi street at night', clientDefaultType(), clientDefaultStyle());
    // Case-insensitive on purpose: the type label leads the prompt as "Photograph — …", and
    // `freshTerms` then drops the same word from the style direction rather than repeating it. The
    // realism ask is present either way, and it is present FIRST, which is where models weight most.
    expect(p.toLowerCase()).toContain('photograph');
    expect(p).toContain('50mm lens at f/2');
    for (const banned of ['no photorealism', 'flat vector', 'LOGO MARK', 'photorealistic, 3D render']) {
      expect(p, `the default prompt still says "${banned}"`).not.toContain(banned);
    }
  });
});

describe('🔴 no prompt may ask for a photograph and forbid one', () => {
  const SCREENS: Array<[string, string, string]> = [
    ['a man drinking chai in a Delhi street at night', 'Photograph', 'photo'],
    ['a Mumbai street at night in the rain', 'Photograph', 'cinematic'],
    ['realistic photo of a tea stall', 'Photograph', 'minimal'],
    ['a coffee shop logo with a bean', 'Photograph', 'photo'],
    ['a chai cup', 'App icon', 'photo'],
    ['a chai cup', 'Modern app logo', 'cinematic'],
    ['a wide hero shot of the Himalayas', 'Website banner', 'photo'],
    ['a portrait of a chai wala', 'Avatar', 'photo'],
  ];

  it('never both, on any combination of the two chips', () => {
    for (const [words, type, style] of SCREENS) {
      const p = sent(words, type, style);
      const asksForPhoto = /\bphotograph\b|cinematic film still/.test(p);
      const forbidsPhoto = /no photorealism|Avoid:[^.]*\bphotorealistic\b/.test(p);
      expect(
        asksForPhoto && forbidsPhoto,
        `"${type}" + "${style}" produced a prompt that asks for a photo AND forbids one:\n${p}`,
      ).toBe(false);
    }
  });

  it('a logo/icon brief still gets its flat direction — precision is not traded for realism', () => {
    const icon = sent('a chai cup', 'App icon', 'photo');
    expect(icon).toContain('APP ICON');
    expect(icon).toContain('48×48');
    const logo = sent('a coffee shop logo with a bean', 'Photograph', 'photo');
    expect(logo).toContain('LOGO MARK');
  });

  it('and the user is TOLD which way the conflict went', () => {
    const c = craftImagePrompt({ prompt: 'a chai cup', style: 'photo', size: 'square', type: 'App icon' });
    expect(c.notes.join(' ')).toContain('realistic-photo style was not applied');
    // One explanation, not two — the style-was-set-aside note must not also fire.
    expect(c.notes.filter((n) => n.includes('took priority over the selected style'))).toHaveLength(0);
  });
});

describe('🙋 "realistic" in the user’s own words counts', () => {
  it('an explicit ask is recognised, in English and Hinglish', () => {
    for (const m of [
      'realistic photo of a Mumbai street', 'a photorealistic tea stall', 'cinematic shot of a train',
      'photo of a chai wala', 'portrait of a farmer', 'a real photo of a village', 'asli photo chahiye',
      'lifelike rendering of a temple',
    ]) expect(realismInWords(m), m).toBe(true);
  });

  it('🔴 but naming a photographic SUBJECT is not asking for a photograph', () => {
    // "logo for a photography studio" is a LOGO brief. Reading it as a realism request would hand a
    // photographer a snapshot instead of a mark — the precision half of this rule.
    for (const m of [
      'logo for a photography studio', 'icon for a photo gallery app', 'a camera shop banner',
      'photobooth app icon', 'illustration of a camera', '',
    ]) expect(realismInWords(m), m).toBe(false);
  });

  it('typed realism reaches the prompt even with the Minimal chip left on', () => {
    const p = sent('realistic photo of a tea stall', 'Photograph', 'minimal');
    expect(p).toContain('Avoid:');
    expect(p).toContain('cartoon');
  });
});

describe('🎬 cinematic is a real, separate option', () => {
  it('it exists in the picker and in BOTH prompt layers', () => {
    expect(client).toContain("id: 'cinematic'");
    expect(client).toContain('Cinematic');
    expect(IMAGE_STYLE_ENHANCERS.cinematic).toBeTruthy();
  });

  it('🔒 it is LIT, not merely "photo but more"', () => {
    const p = sent('a Mumbai street at night', 'Photograph', 'cinematic');
    // Lighting and lens language — the things that actually move a diffusion model.
    for (const term of ['anamorphic', 'key light', 'colour grading', 'film grain']) {
      expect(p, `cinematic is missing "${term}"`).toContain(term);
    }
    // And it is not the documentary photo brief wearing a different label.
    expect(p).not.toContain('50mm lens at f/2');
  });

  it('it brings its own negatives — flat light is the tell that it was never lit', () => {
    expect(sent('a street', 'Photograph', 'cinematic')).toContain('flat even lighting');
    expect(sent('a street', 'Photograph', 'photo')).not.toContain('flat even lighting');
  });
});

describe('🔴 the craft layer now owns style and ratio — it could not before', () => {
  it('the route hands it the SUBJECT, not a pre-decorated string', () => {
    expect(read(ROUTE)).toContain('imageSubjectPrompt(req.body)');
    expect(read(ROUTE)).not.toContain('prompt: buildImagePrompt(req.body)');
  });

  it('so the style words and the ratio appear exactly once', () => {
    const p = sent('a tea stall', 'Photograph', 'photo', 'wide');
    expect(p.match(/Aspect ratio/g) || [], 'the aspect ratio was written twice').toHaveLength(1);
    expect(p.match(/Style:/g) || [], 'the style was written twice').toHaveLength(1);
  });

  it('🔴 and the style-conflict guard finally bites', () => {
    // It has been right and powerless: it withholds its own style words when they contradict what
    // the user typed, but `buildImagePrompt` had already written those very words into the string
    // it received. Verified against a real request — "a dark moody neon street" with the Minimal
    // chip still carried "Style: minimalist, clean white background" into the engine.
    const p = sent('a dark moody neon street', 'Illustration', 'minimal');
    expect(p).not.toContain('minimalist');
    expect(p).not.toContain('clean white background');
  });

  it('the India-map directive survives the move', () => {
    expect(imageSubjectPrompt({ prompt: 'a map of India for a school poster' })).toContain('Survey of India');
    expect(imageSubjectPrompt({ prompt: 'a cute cat' })).not.toContain('Survey of India');
    // `buildImagePrompt` is untouched for every other caller.
    expect(buildImagePrompt({ prompt: 'x', style: 'dark', size: 'wide' })).toContain('Aspect ratio 16:9');
  });
});

describe('🔒 the realism direction does not fight itself', () => {
  it('shallow depth of field is not listed as a fault', () => {
    // `photo` asks for "shallow depth of field" — which IS selective blur — while PHOTO_NEGATIVE
    // used to avoid "blurry, soft focus". The whole-image case is still covered by BASE_NEGATIVE.
    const p = sent('a chai cup on a table', 'Photograph', 'photo');
    expect(p).toContain('shallow depth of field');
    const avoid = p.slice(p.indexOf('Avoid:'));
    expect(avoid).not.toContain('soft focus');
  });

  it('every style the picker offers is known to the server', () => {
    const ids = [...client.matchAll(/\{ id: '([a-z0-9]+)', label: '[^']+', desc: 'Real photo look'|\{ id: '([a-z0-9]+)'/g)]
      .map((m) => m[1] || m[2]).filter(Boolean);
    for (const id of ['photo', 'cinematic', 'minimal', 'vibrant', 'dark', 'gradient', 'flat', '3d']) {
      expect(ids, `the picker no longer offers "${id}"`).toContain(id);
      expect(IMAGE_STYLE_ENHANCERS[id], `the server does not know the style "${id}"`).toBeTruthy();
    }
  });
});
