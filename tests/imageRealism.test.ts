/**
 * REALISM WAS UNREACHABLE — that, not the prompt wording, was why the images looked like that.
 *
 * ADMIN REPORT 2026-08-16: a soft, isometric, grey 512×512 blob, with "is type ki photo generate kar
 * raha hai … realistic image banane ke liye jo kuch ho sake karo".
 *
 * 🔒 THE FINDING: the six style chips were minimal / vibrant / dark / gradient / flat / 3d — and NOT ONE
 * of them asks for a photograph. The attached image is precisely what `3d` is specified to produce
 * ("3D render, isometric, depth, shadows"). The engine did exactly as told; the user had no way to ask
 * for anything else. Worse, the `3d` enhancer contains the WORD "realistic", so a user typing
 * "realistic" and picking 3D was reinforcing the very thing they were trying to escape.
 *
 * Three things were wrong and all three are fixed here:
 *   1. no photographic style existed at all;
 *   2. the resolution was low — `icon` generated 512×512, and an app icon has a KNOWN required size of
 *      1024×1024 for both stores, so every icon we produced had to be upscaled before it could be used;
 *   3. the picker LIED about the sizes — it advertised 512×512 while the server generated 1024.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { craftImagePrompt, withInlineNegative } from '../src/server/lib/imagePromptCraft';
import { IMAGE_STYLE_ENHANCERS, IMAGE_SIZE_PIXELS } from '../src/server/lib/imageGen';

const client = readFileSync(join(__dirname, '../src/components/ide/AIImageGenerator.tsx'), 'utf8');

describe('🔒 a user can finally ask for a real photograph', () => {
  it('the Realistic chip exists in the picker', () => {
    expect(client).toContain("id: 'photo'");
    expect(client).toContain('Realistic');
  });

  it('and both prompt layers know it', () => {
    expect(IMAGE_STYLE_ENHANCERS.photo).toBeTruthy();
    expect(craftImagePrompt({ prompt: 'a cup of chai', style: 'photo' }).prompt).toContain('photograph');
  });
});

describe('🔒 the direction is CAMERA language, not the word “realistic”', () => {
  // Adjectives like "realistic, high quality, 4k" are nearly inert on a diffusion model. A focal
  // length implies a perspective, an aperture implies depth of field, a light source implies shadow
  // behaviour — those actually move the output.
  const p = craftImagePrompt({ prompt: 'a cup of chai on a wooden table', style: 'photo' }).prompt;

  it('names a lens, an aperture and a light source', () => {
    expect(p).toMatch(/50mm/);
    expect(p).toMatch(/f\/2/);
    expect(p).toMatch(/natural light/);
    expect(p).toMatch(/depth of field/);
  });

  it('🔒 does NOT lean on the empty words', () => {
    const styleClause = p.slice(p.indexOf('Style:'), p.indexOf('.', p.indexOf('Style:')));
    expect(styleClause).not.toMatch(/\b4k\b|\b8k\b|hyper-?realistic/i);
  });
});

describe('🔒 a photo request is pushed AWAY from illustration', () => {
  it('the negatives name what realism keeps drifting into', () => {
    const c = craftImagePrompt({ prompt: 'a chai stall at dawn', style: 'photo' });
    for (const bad of ['illustration', 'cartoon', '3d render', 'cgi', 'painting']) {
      expect(c.negative, bad).toContain(bad);
    }
    expect(withInlineNegative(c)).toContain('Avoid:');
  });

  it('🔒 a NON-photo request never gets them — "no illustration" is nonsense on a logo brief', () => {
    for (const style of ['minimal', 'flat', '3d', undefined]) {
      const c = craftImagePrompt({ prompt: 'a mountain logo', style });
      expect(c.negative, String(style)).not.toContain('cartoon');
    }
  });

  it('🔒 and a DROPPED photo chip does not leave its negatives behind', () => {
    // "flat vector" contradicts photo, so the chip yields to the user's words (existing rule). The
    // negatives must yield with it — otherwise we would be fighting the user's own request.
    const c = craftImagePrompt({ prompt: 'a flat vector illustration of a bird', style: 'photo' });
    expect(c.negative).not.toContain('illustration, cartoon');
    expect(c.notes.join(' ')).toContain('took priority');
  });
});

describe('🔒 resolution — the other half of “soft”', () => {
  it('an app icon is generated at the size the stores actually require', () => {
    // Play and the App Store both demand 1024×1024. At 512 every icon a user made had to be upscaled
    // before it could be submitted — we were shipping the one size the store rejects.
    expect(IMAGE_SIZE_PIXELS.icon).toEqual({ w: 1024, h: 1024 });
  });

  // 🔴 CHANGED 2026-09-18, and the ORIGINAL PIN IS THE THING BEING CORRECTED — read this before
  // restoring it. It asserted `min(w,h) >= 864`, which encodes the 2026-08-16 premise that a bigger
  // free image is a sharper one. That premise is false past the model's trained resolution: a
  // latent-diffusion model asked for materially more than ~1 MP smears and repeats texture instead
  // of adding detail, so 1280×1280 (1.64 MP) was soft for the OPPOSITE reason 512 was. The admin
  // reported the blur again on 2026-09-18 with the bigger numbers already live, which is the
  // evidence that raising them had not worked.
  //
  // The replacement is STRONGER, not laxer: it pins the real property (a megapixel count inside the
  // band the weights were fitted at) instead of a proxy for it, and adds two constraints the old
  // pin did not have. The regression the old test actually guarded — a return to tiny 512 images —
  // is still caught, by the lower bound of the band.
  it('every size sits inside the model’s native ~1 MP band — not under it, and not over it', () => {
    for (const [id, px] of Object.entries(IMAGE_SIZE_PIXELS)) {
      const mp = (px.w * px.h) / 1_000_000;
      expect(mp, `${id} is under-sampled (the pre-08-16 512 bug)`).toBeGreaterThanOrEqual(0.7);
      expect(mp, `${id} is over-sampled (the 08-16 bug: bigger, and blurrier)`).toBeLessThanOrEqual(1.3);
    }
  });

  it('🔒 every dimension is a multiple of 16, so no downsample lands off the latent grid', () => {
    // The latent grid steps in 8s; 16 keeps every downsample integral. Off-grid dimensions are
    // resampled at the edges, which is a second, independent source of the mush being fixed here.
    for (const [id, px] of Object.entries(IMAGE_SIZE_PIXELS)) {
      expect(px.w % 16, `${id} width`).toBe(0);
      expect(px.h % 16, `${id} height`).toBe(0);
    }
  });

  it('🔒 each size is the EXACT aspect ratio its hint promises the model', () => {
    // The ratio hint and the pixel request are two statements of one intent; when they disagree the
    // model is being told to compose for one frame and render into another.
    expect(IMAGE_SIZE_PIXELS.square.w / IMAGE_SIZE_PIXELS.square.h).toBe(1);
    expect(IMAGE_SIZE_PIXELS.icon.w / IMAGE_SIZE_PIXELS.icon.h).toBe(1);
    expect(IMAGE_SIZE_PIXELS.wide.w / IMAGE_SIZE_PIXELS.wide.h).toBeCloseTo(16 / 9, 5);
    expect(IMAGE_SIZE_PIXELS.portrait.w / IMAGE_SIZE_PIXELS.portrait.h).toBeCloseTo(3 / 4, 5);
  });

  it('🔒 but stays MODERATE — a timeout on the free provider would fall through to a PAID one', () => {
    // Chasing pixels would quietly turn a ₹0 image into a billed one. 1600 is the ceiling this
    // reasoning allows; anything larger needs the timeout re-measured first, not just raised.
    for (const [id, px] of Object.entries(IMAGE_SIZE_PIXELS)) {
      expect(Math.max(px.w, px.h), id).toBeLessThanOrEqual(1600);
    }
  });

  it('the aspect ratios still mean what their names say', () => {
    expect(IMAGE_SIZE_PIXELS.square.w).toBe(IMAGE_SIZE_PIXELS.square.h);
    expect(IMAGE_SIZE_PIXELS.wide.w / IMAGE_SIZE_PIXELS.wide.h).toBeCloseTo(16 / 9, 1);
    expect(IMAGE_SIZE_PIXELS.portrait.w / IMAGE_SIZE_PIXELS.portrait.h).toBeCloseTo(3 / 4, 1);
  });
});

describe('🔒 the picker no longer lies about what it will produce', () => {
  it('every size the client advertises matches what the server generates', () => {
    // It advertised 512×512 while the server made 1024, and "App Icon 192×192" while it made 512.
    // Every number the user read was wrong — a small dishonesty that also hid the real problem.
    for (const [id, px] of Object.entries(IMAGE_SIZE_PIXELS)) {
      const row = new RegExp(`id: '${id}',[^}]*w: (\\d+), h: (\\d+), desc: '(\\d+)×(\\d+)'`).exec(client);
      expect(row, `no client row for size "${id}"`).not.toBeNull();
      expect(Number(row![1]), `${id} width`).toBe(px.w);
      expect(Number(row![2]), `${id} height`).toBe(px.h);
      // …and the label a human reads matches the numbers beside it.
      expect(Number(row![3]), `${id} label width`).toBe(px.w);
      expect(Number(row![4]), `${id} label height`).toBe(px.h);
    }
  });
});
