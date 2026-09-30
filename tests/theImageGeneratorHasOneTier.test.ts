import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SCOPE_ROUTES } from '../src/server/lib/developerApi';
import { API_SCOPES } from '../src/server/lib/ApiKeyManager';
import { WALLET_FEATURES } from '../src/server/lib/walletFeature';

/**
 * THE IMAGE GENERATOR HAS ONE TIER (admin-mandated 2026-09-23; priced after 5 free a day since 2026-09-30).
 *
 * Admin, verbatim: *"aap free image ho rakho … permanently remove kar do!!!"*. There is no second,
 * charged tier — no switch on the screen, no second route, no API door that sells a picture, and no
 * wallet line for one. These assertions are stated as what EXISTS, so a charged image tier cannot
 * come back as a side effect of another change.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the image generator has one tier', () => {
  it('the server registers exactly three image routes: generate, relay, enhance-prompt', () => {
    const route = code(read('src/server/routes/imageGen.ts'));
    const paths = [...route.matchAll(/'(\/api\/image\/[a-z/-]+)'/g)].map((m) => m[1]).sort();
    expect(paths).toEqual(['/api/image/enhance-prompt', '/api/image/generate', '/api/image/relay']);
  });

  it('the screen carries no tier state and no tier switch', () => {
    const gen = code(read('src/components/ide/AIImageGenerator.tsx'));
    expect(gen).not.toMatch(/useState<'free'/);
    expect(gen).not.toMatch(/role="tablist"/);
  });

  it('the developer API has no image permission and no image door', () => {
    expect(API_SCOPES as readonly string[]).not.toContain('ai:images');
    for (const r of Object.values(SCOPE_ROUTES)) expect(r.path).not.toMatch(/image/);
    expect(code(read('src/server/routes/developerApi.ts'))).not.toMatch(/\/api\/images\//);
  });

  // 🔁 2026-09-30 (admin: "per day 5 image free for user, uske bad 1₹/image"): the ONE generator now
  // has a daily allowance and a price after it, so the wallet has exactly one image line. Still one
  // tier: one screen, one route, no switch.
  it('the wallet has exactly one image line — the per-image charge after the free ones', () => {
    expect(WALLET_FEATURES.filter((f) => /image/.test(f.id)).map((f) => f.id)).toEqual(['image']);
  });

  it('🔒 the options fold is still remembered on the device — a layout convenience, not money', () => {
    const gen = code(read('src/components/ide/AIImageGenerator.tsx'));
    expect(gen).toMatch(/OPTIONS_KEY/);
    expect(gen).toMatch(/readOptionsOpen/);
  });

  it('AppKnowledgeBase describes one tool, its price, and names the TEXT opacity slider', () => {
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    const entry = kb.slice(kb.indexOf("id: 'ai_image_gen'"), kb.indexOf("id: 'ai_image_gen'") + 30000);
    expect(entry).toMatch(/the first 5 images every day are FREE, then ₹1 per image/);
    expect(entry).not.toMatch(/TWO TIERS/);
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
