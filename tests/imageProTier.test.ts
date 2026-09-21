import { EDIT_STRENGTH, MAX_EDIT_STRENGTH, PRESERVE_DIRECTIVE } from '../src/lib/imageEdit';
import { describe, it, expect } from 'vitest';
import {
  IMAGE_PRO_PRICE_INR, IMAGE_PRO_MAX_BATCH,
  imageProMode, imageProCount, imageProQuotedInr, imageProConfigured,
  imageProAuthHeaders, buildImageProRequest, parseImageProResponse,
  imageProFailureMessage, parseDataUrl, base64Bytes, initImageTooLarge,
  IMAGE_PRO_COST_USD_DEFAULT, imageProCostUsd, imageProMargin, imageProMarginWarning,
} from '../src/server/lib/imageProGen';

const PX = { w: 1024, h: 1024 };
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('the mode is derived from the payload, not from a control', () => {
  it('words alone are a fresh generation', () => {
    expect(imageProMode({ prompt: 'a tiger' })).toBe('text-to-image');
  });
  it('a reference alone is a re-imagining', () => {
    expect(imageProMode({ initImage: DATA_URL })).toBe('image-to-image');
  });
  it('a reference with words is a directed edit', () => {
    expect(imageProMode({ prompt: 'make it night', initImage: DATA_URL })).toBe('image-text-to-image');
  });
  it('neither is NOT a request — the route must say so rather than guess', () => {
    expect(imageProMode({})).toBeNull();
    expect(imageProMode({ prompt: '   ' })).toBeNull();
  });
});

describe('what it costs, and the bound on what one request can spend', () => {
  it('quotes the price per image, exactly as the user is told', () => {
    // 🔄 ₹2 → ₹1 on 2026-09-18, when the engine moved from FLUX.2 Klein 4B ($0.014) to Z-Image Turbo
    // ($0.005) — a third of the cost at a higher arena ranking, so the cut is a real cut and not a
    // squeezed margin. What this case guards is unchanged: the quote is the price times the count,
    // with no rounding of its own. See tests/theProPriceIsOneNumber.test.ts for the three-file pin.
    expect(IMAGE_PRO_PRICE_INR).toBe(1);
    expect(imageProQuotedInr({ prompt: 'x' })).toBe(IMAGE_PRO_PRICE_INR);
    expect(imageProQuotedInr({ prompt: 'x', count: 3 })).toBe(3 * IMAGE_PRO_PRICE_INR);
  });

  it('🔒 a batch is clamped, so one request can never spend without limit', () => {
    expect(imageProCount({ count: 999 })).toBe(IMAGE_PRO_MAX_BATCH);
    expect(imageProQuotedInr({ count: 999 })).toBe(IMAGE_PRO_MAX_BATCH * IMAGE_PRO_PRICE_INR);
  });

  it('🔒 a junk or negative count is one image, never zero and never NaN rupees', () => {
    for (const bad of [undefined, null, 'abc', -5, 0, NaN] as unknown[]) {
      expect(imageProCount({ count: bad as number })).toBe(1);
      expect(imageProQuotedInr({ count: bad as number })).toBe(IMAGE_PRO_PRICE_INR);
    }
  });
});

describe('🔒 half-configured is NOT configured (the second absolute rule)', () => {
  it('needs BOTH a key and an endpoint', () => {
    expect(imageProConfigured({ IMAGE_PRO_KEY: 'k' } as never)).toBe(false);
    expect(imageProConfigured({ IMAGE_PRO_ENDPOINT: 'https://h/x' } as never)).toBe(false);
    expect(imageProConfigured({ IMAGE_PRO_KEY: 'k', IMAGE_PRO_ENDPOINT: 'https://h/x' } as never)).toBe(true);
  });

  it('a whitespace-only key reads as UNSET, not as configured', () => {
    // The BRAVE_API_KEY lesson: a stray newline pasted into a console field must not produce a
    // console that says "configured" while every call is rejected.
    expect(imageProConfigured({ IMAGE_PRO_KEY: '  \n ', IMAGE_PRO_ENDPOINT: 'https://h/x' } as never)).toBe(false);
  });

  it('the kill switch wins over a complete configuration', () => {
    expect(imageProConfigured({
      IMAGE_PRO_KEY: 'k', IMAGE_PRO_ENDPOINT: 'https://h/x', IMAGE_PRO_ENABLED: 'off',
    } as never)).toBe(false);
  });
});

describe('auth header shapes', () => {
  it('defaults to `Key`, and supports the two other schemes hosts use', () => {
    expect(imageProAuthHeaders({ IMAGE_PRO_KEY: 'abc' } as never)).toEqual({ Authorization: 'Key abc' });
    expect(imageProAuthHeaders({ IMAGE_PRO_KEY: 'abc', IMAGE_PRO_AUTH_SCHEME: 'bearer' } as never))
      .toEqual({ Authorization: 'Bearer abc' });
    expect(imageProAuthHeaders({ IMAGE_PRO_KEY: 'abc', IMAGE_PRO_AUTH_SCHEME: 'x-key' } as never))
      .toEqual({ 'x-key': 'abc' });
  });
  it('no key ⇒ no header at all, rather than an empty credential', () => {
    expect(imageProAuthHeaders({} as never)).toEqual({});
  });
});

describe('the request body', () => {
  it('carries the reference image only when there is one', () => {
    const t2i = buildImageProRequest({ prompt: 'a tiger' }, PX);
    expect(t2i.image_url).toBeUndefined();
    expect(t2i.strength).toBeUndefined();

    const i2i = buildImageProRequest({ initImage: DATA_URL }, PX);
    expect(i2i.image_url).toBe(DATA_URL);
  });

  it('🔴 a DIRECTED edit stays closer to the original than a wordless re-imagining', () => {
    // ⚠️ THIS ASSERTION USED TO RUN THE OTHER WAY, with a comment reasoning that a reference WITH
    // words "has instructions to follow and needs room to follow them". That is the bug the admin
    // reported on 2026-09-21 — "image+text to image me image badal jane ka dar hai" — and this test
    // is where it was locked in. Words say WHAT to change; they never ask for MORE of the picture to
    // change, and at 0.85 a user's own photo comes back as somebody else's. The wordless case is the
    // one that asked for no specific thing, so a re-render is the whole request there.
    const reimagine = buildImageProRequest({ initImage: DATA_URL }, PX).strength as number;
    const directed = buildImageProRequest({ prompt: 'make it night', initImage: DATA_URL }, PX).strength as number;
    expect(directed).toBeLessThan(reimagine);
    expect(directed).toBe(EDIT_STRENGTH.directed);
    expect(reimagine).toBe(EDIT_STRENGTH.reimagine);
  });

  it('an explicit strength wins inside the range, is capped, and junk falls back', () => {
    expect(buildImageProRequest({ initImage: DATA_URL, strength: 0.3 }, PX).strength).toBe(0.3);
    // Capped: "keep my picture" is the promise, so even an explicit 1.0 may not void the reference.
    expect(buildImageProRequest({ initImage: DATA_URL, strength: 1 }, PX).strength).toBe(MAX_EDIT_STRENGTH);
    expect(buildImageProRequest({ initImage: DATA_URL, strength: 9 }, PX).strength).toBe(EDIT_STRENGTH.reimagine);
    expect(buildImageProRequest({ initImage: DATA_URL, strength: NaN }, PX).strength).toBe(EDIT_STRENGTH.reimagine);
  });

  it('🔒 an edit carries the preservation brief; a fresh generation carries only the words', () => {
    const fresh = buildImageProRequest({ prompt: 'a tiger' }, PX).prompt as string;
    expect(fresh).toBe('a tiger');
    expect(fresh).not.toContain('SAME image');
    const edit = buildImageProRequest({ prompt: 'make the shirt red', initImage: DATA_URL }, PX).prompt as string;
    expect(edit).toContain('make the shirt red');
    expect(edit).toContain(PRESERVE_DIRECTIVE);
  });

  it('asks for the exact pixels it was given', () => {
    const b = buildImageProRequest({ prompt: 'x' }, { w: 1280, h: 720 });
    expect(b.width).toBe(1280);
    expect(b.height).toBe(720);
    expect(b.image_size).toEqual({ width: 1280, height: 720 });
  });
});

describe('the response parser handles every shape a host might answer with', () => {
  it('fal-style images[].url', () => {
    expect(parseImageProResponse({ images: [{ url: 'https://h/a.png' }] })).toEqual({ url: 'https://h/a.png' });
  });
  it('OpenAI-style data[].b64_json', () => {
    expect(parseImageProResponse({ data: [{ b64_json: 'QUJD' }] }))
      .toEqual({ base64: 'QUJD', mimeType: 'image/png' });
  });
  it('BFL-style result.sample', () => {
    expect(parseImageProResponse({ result: { sample: 'https://h/b.png' } })).toEqual({ url: 'https://h/b.png' });
  });
  it('Replicate-style output[]', () => {
    expect(parseImageProResponse({ output: ['https://h/c.png'] })).toEqual({ url: 'https://h/c.png' });
  });
  it('a data URL anywhere is decoded rather than treated as a link', () => {
    expect(parseImageProResponse({ images: [{ url: DATA_URL }] }))
      .toEqual({ base64: 'iVBORw0KGgo=', mimeType: 'image/png' });
  });
  it('honours a declared content type instead of assuming png', () => {
    expect(parseImageProResponse({ images: [{ b64_json: 'QUJD', content_type: 'image/webp' }] }))
      .toEqual({ base64: 'QUJD', mimeType: 'image/webp' });
  });

  it('🔒 NO image is null — never a placeholder, so failure stays honest', () => {
    for (const empty of [null, undefined, {}, { images: [] }, { data: [{}] }, { output: [] }, 'nope', 42]) {
      expect(parseImageProResponse(empty)).toBeNull();
    }
  });
});

describe('attachment validation', () => {
  it('reads a data URL and rejects anything else', () => {
    expect(parseDataUrl(DATA_URL)).toEqual({ mimeType: 'image/png', base64: 'iVBORw0KGgo=' });
    expect(parseDataUrl('https://h/a.png')).toBeNull();
    expect(parseDataUrl('data:image/png;base64,')).toBeNull();
    expect(parseDataUrl('')).toBeNull();
  });

  it('sizes base64 without decoding it', () => {
    expect(base64Bytes('QUJD')).toBe(3);      // "ABC"
    expect(base64Bytes('QUJDRA==')).toBe(4);  // "ABCD"
    expect(base64Bytes('')).toBe(0);
  });

  it('bounds the attachment at 8 MB', () => {
    const under = `data:image/png;base64,${'A'.repeat(1000)}`;
    const over = `data:image/png;base64,${'A'.repeat(12_000_000)}`;
    expect(initImageTooLarge(under)).toBe(false);
    expect(initImageTooLarge(over)).toBe(true);
  });
});

describe('🔒 WHITE-LABEL LAW — no user-facing string may name the vendor or the model', () => {
  const FORBIDDEN = [
    'flux', 'klein', 'bfl', 'black forest', 'fal.ai', 'fal-ai', 'replicate', 'stability',
    'openai', 'dall', 'midjourney', 'gemini', 'grok', 'claude', 'pollinations',
  ];

  it('every failure message is branded and names nothing', () => {
    for (const kind of ['unconfigured', 'failed', 'timeout'] as const) {
      const msg = imageProFailureMessage(kind).toLowerCase();
      expect(msg).toContain('navbharatai');
      for (const bad of FORBIDDEN) expect(msg, `${kind} leaked "${bad}"`).not.toContain(bad);
    }
  });

  it('🔒 "not configured" and "the host errored" are not distinguishable to a user', () => {
    // A visitor is not entitled to diagnose our infrastructure, and the difference is ours to fix —
    // the same reasoning the published-app gateway applies to `app-cap` vs `owner-empty`. What they
    // ARE told is the thing they can act on: Free still works.
    expect(imageProFailureMessage('unconfigured')).toMatch(/free/i);
    expect(imageProFailureMessage('failed')).toMatch(/nothing was charged/i);
  });

  it('🔒 a failure always states that nothing was charged', () => {
    // "Working result or free" is only credible if the user is TOLD, at the moment it matters.
    expect(imageProFailureMessage('failed')).toMatch(/nothing was charged/i);
    expect(imageProFailureMessage('timeout')).toMatch(/nothing was charged/i);
  });
});

describe('💰 the real cost is ON THE CARD, and the margin cannot invert silently', () => {
  it('the engine’s published price is the default', () => {
    // $0.005/image — Z-Image Turbo at WaveSpeed/Atlas ($0.0047–$0.01 across vendors; the code takes
    // the middle). Supersedes FLUX.2 Klein 4B's admin-supplied $0.014, kept in the module as the
    // record. A model may not serve a paid tier without its price on the card.
    expect(imageProCostUsd({} as never)).toBe(0.005);
    expect(IMAGE_PRO_COST_USD_DEFAULT).toBe(0.005);
  });

  it('the price comfortably covers it across every plausible exchange rate', () => {
    for (const rate of [85, 87, 90, 95, 100]) {
      const m = imageProMargin(rate, {} as never);
      expect(m.healthy, `unhealthy at ₹${rate}/$`).toBe(true);
      expect(m.marginInr, `no margin at ₹${rate}/$`).toBeGreaterThan(0);
    }
  });

  it('reports the BREAK-EVEN rate, which is the number that could actually falsify it', () => {
    // ₹1 ÷ $0.005 = ₹200/$ — the rupee would have to HALVE again, wider headroom than ₹2 ÷ $0.014
    // gave (₹142.9). A ratio alone flatters; a break-even point can be checked against the real world.
    expect(imageProMargin(87, {} as never).breakEvenUsdInr).toBeCloseTo(200, 6);
  });

  it('the maths is right at a known rate, not just directionally right', () => {
    const m = imageProMargin(87, {} as never);
    expect(m.costInr).toBeCloseTo(0.435, 3);
    expect(m.marginInr).toBeCloseTo(0.565, 3);
    expect(m.ratio).toBeCloseTo(2.299, 2);
  });

  it('🔴 a cost that overtakes the price WARNS — it never quietly bleeds', () => {
    // The E2B_USD_PER_HOUR shape: an env value always beats the code, so warning is the only thing
    // the code can do. Here the provider has repriced 10x.
    const warning = imageProMarginWarning(87, { IMAGE_PRO_COST_USD: '0.14' } as never);
    expect(warning).toBeTruthy();
    expect(warning).toContain('NO LONGER COVERS COST');
    expect(warning).toContain('IMAGE_PRO_COST_USD');
    expect(imageProMargin(87, { IMAGE_PRO_COST_USD: '0.14' } as never).healthy).toBe(false);
  });

  it('a healthy margin produces NO warning — a guard that always fires is one nobody reads', () => {
    expect(imageProMarginWarning(87, {} as never)).toBeNull();
  });

  it('🔒 a MALFORMED cost falls back to the known price, never to zero', () => {
    // Number('') is 0, and a zero cost reports INFINITE margin on the very panel that exists to
    // catch a bad margin — the failure being guarded against, wearing a green tick.
    for (const bad of ['', '   ', 'abc', '0', '-1', 'NaN']) {
      expect(imageProCostUsd({ IMAGE_PRO_COST_USD: bad } as never), `"${bad}"`).toBe(IMAGE_PRO_COST_USD_DEFAULT);
    }
    expect(imageProMargin(87, { IMAGE_PRO_COST_USD: '0' } as never).ratio).toBeCloseTo(2.299, 2);
  });

  it('🔒 a junk exchange rate cannot produce NaN money', () => {
    for (const bad of [0, -5, NaN, Infinity] as number[]) {
      const m = imageProMargin(bad, {} as never);
      expect(Number.isFinite(m.costInr), `rate ${bad}`).toBe(true);
      expect(Number.isFinite(m.marginInr), `rate ${bad}`).toBe(true);
    }
  });

  it('🔒 the warning is ADMIN-ONLY text and must never be shown to a user', () => {
    // It names OUR cost, which is exactly what the White-Label Law keeps off a user's screen. This
    // pins the intent so a later change cannot casually return it in a response body.
    const warning = imageProMarginWarning(87, { IMAGE_PRO_COST_USD: '0.14' } as never) || '';
    expect(warning).toMatch(/^\[IMAGE PRO\]/);
  });
});
