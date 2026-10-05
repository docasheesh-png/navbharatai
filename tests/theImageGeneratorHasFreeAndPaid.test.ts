import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SCOPE_ROUTES } from '../src/server/lib/developerApi';
import { API_SCOPES } from '../src/server/lib/ApiKeyManager';
import { WALLET_FEATURES } from '../src/server/lib/walletFeature';

/**
 * THE IMAGE GENERATOR HAS A FREE MODE AND A PAID MODE, ON ONE SCREEN (admin 2026-09-30).
 *
 * History: on 2026-09-23 the admin removed the paid tier (*"aap free image ho rakho … permanently
 * remove kar do!!!"*), and this file was "the image generator has one tier". On 2026-09-30 the admin
 * asked for both again: *"pahle ek system tha, free + paid (dono the) wahi bana do!"*. What stays from
 * the one-tier rule is its shape: one screen, one route, no API door that sells a picture, and one
 * wallet line. What changed: a Free / Paid switch on that screen, with Free the default on every visit.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the image generator has a free mode and a paid mode', () => {
  it('the server registers exactly three image routes: generate, relay, enhance-prompt', () => {
    const route = code(read('src/server/routes/imageGen.ts'));
    const paths = [...route.matchAll(/'(\/api\/image\/[a-z/-]+)'/g)].map((m) => m[1]).sort();
    expect(paths).toEqual(['/api/image/enhance-prompt', '/api/image/generate', '/api/image/relay']);
  });

  // 🔁 2026-10-01 — PAID IS A PAGE, NOT A CHIP (admin: "user jab paid me swich kare, to ek dam new
  // page open ho, abhi usi page me paid aur free swich ho ja rahe hai"). The two assertions this test
  // used to make — exactly one `role="tablist"` and the `['free', 'paid']` chip map — pinned the
  // in-place toggle BY NAME, and that toggle is what the admin asked to be removed: pressing it
  // changed the mode without regenerating, so a watermarked FREE picture stayed on screen under a lit
  // PAID label. They are replaced here by the rules that still matter, and the page's own behaviour
  // is locked in `thePaidPageAndTheIndianFace.test.ts`.
  // 🔁 2026-10-05 — FREE MODE REMOVED on the admin's word, after the free provider's anonymous door
  // answered 402 to every request. One screen, which shows the price and says so on every request.
  it('one screen: no mode toggle, no Free page, and every request tells the server the price was shown', () => {
    const gen = code(read('src/components/ide/AIImageGenerator.tsx'));
    expect(gen).not.toContain('setTier(');
    expect(gen).not.toContain('Switch to Paid');
    expect(gen).not.toContain('Free mode');
    expect(gen).not.toContain("mode === 'client-fetch'");
    expect(gen).toContain("tier: 'paid',");
    // A remembered choice that charges is still forbidden, even with nothing left to choose.
    expect(gen).not.toMatch(/localStorage\.[a-zA-Z]+\([^)]*tier/i);
  });

  // 🔁 2026-10-04 — THE IMAGE DOOR IS BACK, ON THE ADMIN'S WORD. It was removed with the paid tier on
  // 2026-09-23. When the free image provider began refusing every keyless request, the admin ruled:
  // "user ko saaf saaf bolo ki API keys chahiye … user ko navbhatai api keys ka offer den". A NavBharatAI
  // key cannot make an app's pictures without this door. It is priced exactly like Paid mode (5 free a
  // day, then the admin's ₹1) and charged to the same single wallet line — never a second price.
  it('the developer API image door exists, needs the Images permission, and uses the one image price', () => {
    expect(API_SCOPES as readonly string[]).toContain('ai:images');
    expect(SCOPE_ROUTES['ai:images' as keyof typeof SCOPE_ROUTES]).toEqual({ method: 'POST', path: '/api/v1/images/generations' });
    const route = code(read('src/server/routes/developerApi.ts'));
    expect(route).toMatch(/app\.post\('\/api\/images\/generations', ipLimiter, apiKeyAuth, requireScope\('ai:images'\)/);
    // Q-616 (2026-10-05): the price is decided and HELD in the one shared reservation, which this door
    // and the Image Generator both call — never a second copy of the rule.
    const hold = code(read('src/server/lib/imageHold.ts'));
    expect(hold).toContain('imageFeeForCount(');
    expect(hold).toContain("feature: 'image'");
    expect(code(read('src/server/lib/apiKeyImage.ts'))).toContain('reserveImage(');
  });

  // 🔁 2026-09-30 (admin: "per day 5 image free for user, uske bad 1₹/image"): Paid mode has a daily
  // allowance and a price after it, so the wallet has exactly one image line. Free mode charges nothing.
  it('the wallet has exactly one image line — the per-image charge after the free ones', () => {
    expect(WALLET_FEATURES.filter((f) => /image/.test(f.id)).map((f) => f.id)).toEqual(['image']);
  });

  it('🔒 the options fold is still remembered on the device — a layout convenience, not money', () => {
    const gen = code(read('src/components/ide/AIImageGenerator.tsx'));
    expect(gen).toMatch(/OPTIONS_KEY/);
    expect(gen).toMatch(/readOptionsOpen/);
  });

  it('AppKnowledgeBase describes one tool with one price, and names the TEXT opacity slider', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    const entry = kb.slice(kb.indexOf("id: 'ai_image_gen'"), kb.indexOf("id: 'ai_image_gen'") + 30000);
    // 2026-10-05: one screen, one price — and the entry must not tell an AI that a Free mode exists.
    expect(entry).toMatch(/ONE SCREEN, ONE PRICE \(2026-10-05\): the first 5 images every day are FREE, then ₹1 per image/);
    expect(entry).toMatch(/There is no Free mode any more/);
    expect(entry).not.toMatch(/no daily limit/);
    expect(entry).toMatch(/TEXT OPACITY with the slider directly under Size/);
    expect(entry).toMatch(/SEPARATE slider/);
  });

  it('🔒 WHITE-LABEL — no vendor or model name reaches the screen', () => {
    const lower = code(read('src/components/ide/AIImageGenerator.tsx')).toLowerCase();
    for (const bad of ['pollinations', 'flux', 'z-image', 'wavespeed', 'replicate', 'openai', 'dall', 'midjourney', 'stability', 'gemini', 'grok']) {
      expect(lower, `leaked "${bad}"`).not.toContain(bad);
    }
  });
});
