import { describe, it, expect } from 'vitest';
import {
  IMAGE_PRO_PRICE_INR, IMAGE_PRO_MAX_BATCH,
  imageProMode, imageProCount, imageProQuotedInr, imageProConfigured,
  imageProAuthHeaders, buildImageProRequest, parseImageProResponse,
  imageProFailureMessage, parseDataUrl, base64Bytes, initImageTooLarge,
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
  it('quotes ₹2 per image, exactly as the user is told', () => {
    expect(IMAGE_PRO_PRICE_INR).toBe(2);
    expect(imageProQuotedInr({ prompt: 'x' })).toBe(2);
    expect(imageProQuotedInr({ prompt: 'x', count: 3 })).toBe(6);
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

  it('🔒 a bare reference stays CLOSER to the original than a directed edit does', () => {
    // A reference with no words is a re-imagining and should stay recognisable; a reference WITH
    // words has instructions to follow and needs room to follow them. If these two are ever equal,
    // one of the two jobs is being done badly.
    const reimagine = buildImageProRequest({ initImage: DATA_URL }, PX).strength as number;
    const directed = buildImageProRequest({ prompt: 'make it night', initImage: DATA_URL }, PX).strength as number;
    expect(reimagine).toBeLessThan(directed);
  });

  it('an explicit strength always wins, and a junk one falls back to the default', () => {
    expect(buildImageProRequest({ initImage: DATA_URL, strength: 0.3 }, PX).strength).toBe(0.3);
    expect(buildImageProRequest({ initImage: DATA_URL, strength: 9 }, PX).strength).toBe(0.65);
    expect(buildImageProRequest({ initImage: DATA_URL, strength: NaN }, PX).strength).toBe(0.65);
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
