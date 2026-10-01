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
  it('the screen opens on Free, never stores the choice, and leaves for Paid rather than flipping', () => {
    const gen = code(read('src/components/ide/AIImageGenerator.tsx'));
    expect(gen).toContain("useState<ImageTier>('free')");
    // Both pages are still reachable, and leaving one is an explicit act with its own control.
    expect(gen).toContain("setTier('paid')");
    expect(gen).toContain("setTier('free')");
    expect(gen).not.toContain('aria-label="Image mode"');
    // A remembered Paid is a charge the user did not decide on this visit.
    expect(gen).not.toMatch(/localStorage\.[a-zA-Z]+\([^)]*tier/i);
    // The chosen mode reaches the server on every request.
    expect(gen).toContain('tier: tierNow,');
  });

  it('the developer API has no image permission and no image door', () => {
    expect(API_SCOPES as readonly string[]).not.toContain('ai:images');
    for (const r of Object.values(SCOPE_ROUTES)) expect(r.path).not.toMatch(/image/);
    expect(code(read('src/server/routes/developerApi.ts'))).not.toMatch(/\/api\/images\//);
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

  it('AppKnowledgeBase describes one tool with two modes, the price, and names the TEXT opacity slider', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    const entry = kb.slice(kb.indexOf("id: 'ai_image_gen'"), kb.indexOf("id: 'ai_image_gen'") + 30000);
    expect(entry).toMatch(/FREE AND PAID ARE TWO SEPARATE PAGES/); // 2026-10-01: a page, not a chip
    expect(entry).toMatch(/FREE mode is free for everyone, with no daily limit and no charge/);
    expect(entry).toMatch(/the first 5 Paid images every day are FREE, then ₹1 per image/);
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
