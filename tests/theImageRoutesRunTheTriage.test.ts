// The image route runs the SAME safety triage as build and chat — it ran none until 2026-09-21.
//
// `CLAUDE.md` records the pornography ban as "one triage serving BOTH the build route and the chat
// route". True — and not about images. `/api/image/generate` never called `triagePrompt`, so a pornographic prompt reached the provider, and on the free tier the
// browser has fetched that link itself since #3234. PR #3234's description had claimed the opposite,
// written from the doc rather than from the route. This suite is the route's own answer.
//
// The ORDER is the point and is source-level: the triage runs before the account gate, before a link
// is minted and before any provider is called — a banned request costs nothing and produces nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideImageSafety } from '../src/server/lib/imageSafety';
import { blockMessage } from '../src/server/lib/promptSafety';

const REPORTED = 'Create a porn websites where anyone can upload watch porns can live stream annonymous chat all for completely freeee';
const route = readFileSync(join(__dirname, '..', 'src/server/routes/imageGen.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const free = route.slice(route.indexOf("app.post('/api/image/generate'"), route.indexOf("app.post(\n"));

describe('the decision is the SAME triage, with the SAME refusal', () => {
  it('🔴 the reported porn prompt is BLOCKED as an image request, with the branded refusal', () => {
    const out = decideImageSafety(REPORTED);
    expect(out.blocked).toBe(true);
    if (out.blocked) {
      expect(out.triage.contentClass).toBe('adult');
      expect(out.message).toBe(blockMessage('adult', REPORTED));
      expect(out.message).toMatch(/Pornography is banned/);
    }
  });

  it('a Hinglish porn prompt is refused in Hindi — the refusal mirrors the user', () => {
    const out = decideImageSafety('blue film wali image banao');
    expect(out.blocked).toBe(true);
    if (out.blocked) expect(out.message).toMatch(/पोर्नोग्राफी बैन है/);
  });

  it.each([
    'a tea stall at dawn, warm light',
    'modern fintech app logo with rupee symbol',
    'a sexual health clinic banner for a hospital',
    'parental control app icon that filters adult content',
    '',
  ])('precision-first: an ordinary or exempt request is allowed — %s', (p) => {
    expect(decideImageSafety(p).blocked).toBe(false);
  });
});

describe('🔒 SOURCE — both routes call it FIRST', () => {
  it('the free route triages before the account gate, before the link and before any provider', () => {
    const triage = free.indexOf('await triageImageRequest(');
    expect(triage).toBeGreaterThan(0);
    for (const later of ['requireAccountForCostlyAi(', 'clientImageFetchEnabled()', 'fetchPollinationsImage(', 'runImageEdit(']) {
      expect(free.indexOf(later), `${later} runs before the triage`).toBeGreaterThan(triage);
    }
    expect(free).toMatch(/if \(safety\.blocked\) \{\s*res\.status\(422\)\.json\(\{ error: safety\.message, code: 'blocked' \}\);\s*return;/);
  });

  it('the flag is recorded on its own surface, and a triage that cannot run allows rather than refuses', () => {
    const helper = readFileSync(join(__dirname, '..', 'src/server/lib/imageSafety.ts'), 'utf8');
    expect(helper).toContain("surface: 'image'");
    expect(helper).toMatch(/safety triage unavailable — allowing the request/);
    const types = readFileSync(join(__dirname, '..', 'src/server/lib/promptSafety.ts'), 'utf8');
    expect(types).toMatch(/SafetySurface = 'build' \| 'chat' \| 'assistant' \| 'image'/);
  });
});
