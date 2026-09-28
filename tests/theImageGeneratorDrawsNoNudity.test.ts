import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  scanPollinationsPrompt,
  normalizeForScan,
  assertPollinationsPromptSafe,
  PollinationsPromptBlockedError,
  POLLINATIONS_BLOCK_MESSAGE,
} from '../src/server/lib/pollinationsGuard';
import { pollinationsImageUrl, fetchPollinationsImage } from '../src/server/lib/imageGen';
import { triagePrompt } from '../src/server/lib/promptSafety';

// GOOGLE PLAY REJECTED THE ANDROID UPDATE ON 2026-09-28 (Sexual Content and Profanity + AI-Generated
// Content). Its evidence was a screenshot of "Image Generator AI FREE", style "Photograph", showing a
// realistic nude woman. The platform triage let the request through (it is written for app-building
// prompts and waits for "porn" + "site/app"), and the provider's own NSFW filter was never asked for.

const env = {} as NodeJS.ProcessEnv;

describe('the gap this closes — measured, not assumed', () => {
  it('the platform triage alone lets nude-picture requests through (why an image scan is needed)', () => {
    // If this ever starts failing, the triage learned images too — good news, and this case can go.
    expect(triagePrompt('nude woman').verdict).toBe('allow');
    expect(triagePrompt('porn').verdict).toBe('allow');
  });
});

describe('the Pollinations word scan refuses sexual and vulgar picture requests', () => {
  const blocked = [
    // The shapes a reviewer types first.
    'nude woman', 'naked girl on beach', 'topless woman', 'porn', 'sexy girl in bikini', 'hot girl',
    'woman in lingerie', 'woman without clothes', 'girl taking a shower', 'couple in bed', 'NSFW art',
    'realistic photo of a woman, no clothes', 'see-through dress', 'erotic painting', 'seductive pose',
    // Disguises.
    'n u d e woman', 'n.u.d.e girl', 's-e-x', 'nud3 girl', 'p0rn', '$exy lady', 'NUDE', 'nu​de woman',
    // Hinglish and Devanagari.
    'nangi ladki', 'bina kapdo ke ladki', 'ladki kapde utarti hui', 'नंगी लड़की', 'सेक्सी लड़की', 'अश्लील फोटो',
    // Profanity — the policy is "Sexual Content AND Profanity", and a picture can carry text.
    'poster that says fuck you', 'madarchod', 'चूतिया',
  ];
  for (const p of blocked) {
    it(`refuses: ${JSON.stringify(p)}`, () => {
      expect(scanPollinationsPrompt(p).ok).toBe(false);
    });
  }

  it('labels the category for the admin record, never for the user', () => {
    expect(scanPollinationsPrompt('nude woman')).toMatchObject({ ok: false, category: 'sexual' });
    expect(scanPollinationsPrompt('fuck')).toMatchObject({ ok: false, category: 'profanity' });
    // The user's message names no word, no rule and no provider.
    expect(POLLINATIONS_BLOCK_MESSAGE).not.toMatch(/nude\b.*woman|pollinations|flux|provider/i);
    expect(POLLINATIONS_BLOCK_MESSAGE).toContain('NavBharatAI');
  });
});

describe('…and does NOT refuse the ordinary pictures people make every day', () => {
  // Each one contains a banned word's letters, or a word left off the list on purpose.
  const allowed = [
    'a classroom poster for Class 5', 'shop banner for Sharma Electronics brand', 'a red button icon',
    'chicken breast recipe poster', 'breast cancer awareness poster', 'a cock crowing at sunrise',
    'comic strip about a cat', 'LED strip light product photo', 'hot tea in a kulhad', 'bathroom showroom banner',
    'swimsuit sale banner for a sports shop', 'lustrous hair salon poster', 'shiitake mushroom dish',
    'Essex countryside', 'Sussex cottage', 'a massive bass guitar', '4k wallpaper of mountains',
    '1024 x 768 banner', '₹499 sale poster', 'Holi festival colours', 'Diwali diya on a doorstep',
    'Plan A B C diagram', 'ek sundar gaon ka drishya', 'background chod do, sirf logo', 'grasshopper on a leaf',
    'a mother holding her baby', 'wedding couple in traditional dress', 'man taking a photo of a lake',
  ];
  for (const p of allowed) {
    it(`allows: ${JSON.stringify(p)}`, () => {
      expect(scanPollinationsPrompt(p)).toEqual({ ok: true });
    });
  }
});

describe('normalisation undoes disguises without rewriting real text', () => {
  it('joins spaced-out single letters, only in runs of three or more', () => {
    expect(normalizeForScan('n u d e')).toBe('nude');
    expect(normalizeForScan('a big dog')).toBe('a big dog');
  });
  it('maps look-alike digits only inside tokens that also hold a letter', () => {
    expect(normalizeForScan('p0rn')).toBe('porn');
    expect(normalizeForScan('1024 x 768')).toBe('1024 x 768');
  });
});

describe('the URL builder is the choke point — no link for a banned prompt, from any caller', () => {
  it('throws instead of building a link', () => {
    expect(() => pollinationsImageUrl('nude woman', 'square', env)).toThrow(PollinationsPromptBlockedError);
    expect(() => assertPollinationsPromptSafe('naked girl')).toThrow(PollinationsPromptBlockedError);
  });

  it('asks the provider for its own NSFW filter on every link (the second net)', () => {
    const url = pollinationsImageUrl('a blue robot', 'square', env);
    expect(new URL(url).searchParams.get('safe')).toBe('true');
  });

  it('the server fetch refuses BEFORE calling the provider, and says "blocked", not "failed"', async () => {
    const fetchImpl = vi.fn();
    const out = await fetchPollinationsImage('topless woman', 'square', { env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toEqual({ blocked: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('every caller scans before it reaches Pollinations (source guard)', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/imageGen.ts'), 'utf8');
  const chat = readFileSync(join(process.cwd(), 'src/server/routes/chat.ts'), 'utf8');

  it('the image route refuses a banned prompt before minting the browser link', () => {
    const scanAt = route.indexOf('scanPollinationsPrompt(prompt)');
    const linkAt = route.indexOf('pollinationsImageUrl(prompt');
    expect(scanAt).toBeGreaterThan(-1);
    expect(linkAt).toBeGreaterThan(scanAt);
  });

  it('free chat answers a blocked picture with the refusal, not "try again later"', () => {
    expect(chat).toMatch(/if \(pr\.blocked\)\s*\{[\s\S]{0,300}POLLINATIONS_BLOCK_MESSAGE/);
  });
});
