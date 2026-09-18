/**
 * THE PRO IMAGE PRICE IS ONE NUMBER, IN THREE FILES (admin 2026-09-18: *"price bhi 1 inr / image karo"*).
 *
 * The price the user is SHOWN lives in the browser; the price they are CHARGED lives on the server.
 * They are the same promise to the same person, and until this test existed there were three
 * independent copies of it — `IMAGE_PRO_PRICE_INR` on the server, `PRICE_INR` in the Pro studio, and
 * the bare string `'Pro ₹2'` on the free/pro toggle. Moving ₹2 → ₹1 meant three edits, and the third
 * is exactly the one a future change forgets.
 *
 * The client cannot import the server module (it would pull server code into the browser bundle), so
 * the drift is caught here instead — the same idiom `privacyPolicyTruth.test.ts` uses to stop the
 * policy and the pixel drifting apart.
 *
 * Also pinned: the MARGIN. A price is only safe against a cost, and a cost that rises above the price
 * would otherwise be discovered on an invoice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  IMAGE_PRO_PRICE_INR,
  IMAGE_PRO_COST_USD_DEFAULT,
  imageProCostUsd,
  imageProMargin,
  imageProMarginWarning,
  imageProModel,
  buildImageProRequest,
} from '../src/server/lib/imageProGen';

const studio = readFileSync('src/components/ide/ImageStudioPro.tsx', 'utf8');
const toggle = readFileSync('src/components/ide/AIImageGenerator.tsx', 'utf8');

/** The literal a `const NAME = <digits>;` declares, comments stripped so prose cannot answer for code. */
function constNumber(src: string, name: string): number {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const m = code.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*;`));
  expect(m, `${name} not found as a numeric constant`).not.toBeNull();
  return Number(m![1]);
}

describe('one price, three files', () => {
  it('the admin asked for ₹1 and the server charges ₹1', () => {
    expect(IMAGE_PRO_PRICE_INR).toBe(1);
  });

  it('the Pro studio shows the SAME number it will be charged', () => {
    expect(constNumber(studio, 'PRICE_INR')).toBe(IMAGE_PRO_PRICE_INR);
  });

  it('the free/pro toggle shows it too — it used to be a bare string', () => {
    expect(constNumber(toggle, 'PRO_PRICE_INR')).toBe(IMAGE_PRO_PRICE_INR);
    // 🔒 The reversion this guards: a hardcoded rupee figure back in that label. Comments are
    // stripped first — the constant's own doc quotes the old `'Pro ₹2'` as the thing being fixed,
    // and a guard that its own explanation can trip is a guard nobody keeps.
    const code = toggle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/'Pro ₹\d/);
    expect(code).toContain('`Pro ₹${PRO_PRICE_INR}`');
  });
});

describe('the price covers the cost — Z-Image Turbo, not the engine it replaced', () => {
  it('the recorded cost is Z-Image Turbo\'s $0.005, not FLUX.2 Klein\'s $0.014', () => {
    expect(IMAGE_PRO_COST_USD_DEFAULT).toBe(0.005);
    expect(imageProCostUsd({})).toBe(0.005);
  });

  it('₹1 still recovers the cost ~2× at a realistic rupee', () => {
    const m = imageProMargin(95.76);
    expect(m.costInr).toBeCloseTo(0.4788, 4);
    expect(m.marginInr).toBeCloseTo(0.5212, 4);
    expect(m.healthy).toBe(true);
    expect(m.ratio).toBeGreaterThan(2);
  });

  it('the break-even rupee is ₹200/$ — the headroom, as something falsifiable', () => {
    expect(imageProMargin(95.76).breakEvenUsdInr).toBeCloseTo(200, 6);
  });

  it('…and it cannot invert silently: past break-even the warning fires', () => {
    expect(imageProMarginWarning(95.76)).toBeNull();
    const warn = imageProMarginWarning(250);
    expect(warn).toContain('₹');
    // White-Label Law: an admin-facing warning still names no vendor.
    for (const v of ['z-image', 'alibaba', 'tongyi', 'wavespeed', 'openai', 'flux']) {
      expect(warn!.toLowerCase()).not.toContain(v);
    }
  });

  it('a malformed cost falls back to the known price, never to zero', () => {
    // A cost of 0 would report infinite margin on the exact panel used to judge the price.
    for (const raw of ['', '   ', 'abc', '-1', '0', 'NaN']) {
      expect(imageProCostUsd({ IMAGE_PRO_COST_USD: raw }), raw).toBe(IMAGE_PRO_COST_USD_DEFAULT);
    }
  });
});

describe('Z-Image is a FAMILY — the mode picks the model', () => {
  it('words alone generate; a picture is edited', () => {
    expect(imageProModel({}, 'text-to-image')).toBe('z-image-turbo');
    expect(imageProModel({}, 'image-to-image')).toBe('z-image-edit');
    expect(imageProModel({}, 'image-text-to-image')).toBe('z-image-edit');
  });

  it('defaults to generation when no mode is given, so an old caller cannot start editing', () => {
    expect(imageProModel({})).toBe('z-image-turbo');
  });

  it('each half is pinnable on its own, and pinning one must not pin the other', () => {
    const env = { IMAGE_PRO_TEXT_MODEL: 'host/zit-v2' };
    expect(imageProModel(env, 'text-to-image')).toBe('host/zit-v2');
    expect(imageProModel(env, 'image-to-image')).toBe('z-image-edit');
  });

  it('IMAGE_PRO_MODEL is the escape hatch for a host that serves one endpoint for everything', () => {
    const env = { IMAGE_PRO_MODEL: 'one-endpoint', IMAGE_PRO_TEXT_MODEL: 'ignored' };
    expect(imageProModel(env, 'text-to-image')).toBe('one-endpoint');
    expect(imageProModel(env, 'image-to-image')).toBe('one-endpoint');
  });

  it('🔒 THE BUG THIS PREVENTS: an edit request must not be sent to the generation model', () => {
    // Sending Z-Image-Turbo a picture and an instruction would return a fresh image and quietly
    // ignore one of them — a request that succeeds and answers the wrong question, which is the
    // half-working state the second absolute rule forbids.
    const body = buildImageProRequest(
      { prompt: 'make the shirt red', initImage: 'data:image/png;base64,AAAA', size: 'square' },
      { w: 1024, h: 1024 },
      {},
    );
    expect(body.model).toBe('z-image-edit');
    expect(body.image_url).toBe('data:image/png;base64,AAAA');
  });

  it('a words-only request still names the generation model', () => {
    const body = buildImageProRequest({ prompt: 'a chai stall at dawn', size: 'square' }, { w: 1024, h: 1024 }, {});
    expect(body.model).toBe('z-image-turbo');
    expect(body.image_url).toBeUndefined();
  });
});
