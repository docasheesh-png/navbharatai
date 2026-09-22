import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE IMAGE STUDIO OPENS ON FREE, EVERY TIME (admin-mandated 2026-09-22).
 *
 * Admin, verbatim: *"jab koi user navbharatai free me mode badal kar image genrator ai me swich
 * kare, to default free mode open hona chahiye. abhi paid mode open ho raha hai."*
 *
 * ⚠️ THIS REVERSES A DOCUMENTED DECISION, and the reversal is the point of this file. The tier used
 * to be persisted in `localStorage`, on a reading of an earlier instruction that is quoted in the
 * component: *"the toggle is a PREFERENCE — 'user uske kabhi bhi free aur paid me convert kar sake',
 * and a preference that resets on every panel open is not one."* That was a fair reading and it
 * produced exactly the reported outcome: a user who pressed Pro once was on the paid tier on every
 * visit afterwards, having chosen it only on the first.
 *
 * 🔑 MONEY POINTS THE SAME WAY, which is what makes free the safe default and not merely the
 * requested one: a Pro image costs real rupees per press, so a REMEMBERED Pro is a charge nobody
 * decided on this visit. The half of the older instruction that still binds — "kabhi bhi convert
 * kar sake" — is untouched: the toggle still switches instantly, for as long as the panel is open.
 */

const GEN = readFileSync(join(process.cwd(), 'src/components/ide/AIImageGenerator.tsx'), 'utf8');
/** Comments stripped, so a rule about the CODE is never satisfied by prose that merely mentions it. */
const code = GEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('every open starts on free', () => {
  it('🔴 the initial tier is the literal \'free\', not a function that reads storage', () => {
    expect(code).toMatch(/useState<'free' \| 'pro'>\('free'\)/);
    expect(code).not.toMatch(/useState<'free' \| 'pro'>\(readTier\)/);
  });

  it('🔒 nothing reads the tier back, and nothing writes it', () => {
    // A key nothing reads is a key the next reader would trust, so it is removed rather than left.
    expect(code).not.toMatch(/imagegen\.tier/);
    expect(code).not.toMatch(/TIER_KEY/);
    expect(code).not.toMatch(/function readTier/);
  });

  it('🔒 the OTHER remembered thing on this panel is deliberately untouched', () => {
    // The options fold is a layout convenience that costs nothing to get wrong, so it still
    // persists. This assertion is what makes the change above a decision about MONEY rather than a
    // blanket "stop remembering anything", which would have been a different and worse change.
    expect(code).toMatch(/OPTIONS_KEY/);
    expect(code).toMatch(/readOptionsOpen/);
  });
});

describe('every AI can tell the user, and the old promise is gone from the copy', () => {
  it('🔴 AppKnowledgeBase no longer says the tier is remembered', () => {
    // CLAUDE.md's sync rule: a navigation or behaviour change lands in the same commit. This one
    // matters more than most, because that entry is what every AI quotes back when a user asks why
    // they were charged — and it used to promise the opposite of what now happens.
    const kb = readFileSync(join(process.cwd(), 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    const entry = kb.slice(kb.indexOf("id: 'ai_image_gen'"), kb.indexOf("id: 'ai_image_gen'") + 30000);
    expect(entry).toMatch(/IT ALWAYS OPENS ON FREE/);
    expect(entry).not.toMatch(/toggle at the top right of the screen \(2026-09-18\) — your choice is remembered/);
    expect(entry).toMatch(/Pro is one tap away/);
  });

  it('🔴 …and it names the new TEXT opacity slider as separate from the background one', () => {
    const kb = readFileSync(join(process.cwd(), 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    const entry = kb.slice(kb.indexOf("id: 'ai_image_gen'"), kb.indexOf("id: 'ai_image_gen'") + 30000);
    expect(entry).toMatch(/TEXT OPACITY with the slider directly under Size/);
    expect(entry).toMatch(/SEPARATE slider/);
    expect(entry).toMatch(/'text opacity'/);
  });
});

describe('🔒 what did NOT change — the toggle still works, and Pro is still gated', () => {
  it('the user can still switch either way while the panel is open', () => {
    expect(code).toMatch(/setChosenTier/);
    expect(code).toMatch(/if \(!dead\) setChosenTier\(t\)/);
  });

  it('a press is still kept separate from what is DISPLAYED when Pro is off', () => {
    // The original protection: only an explicit false forces Free, and the press itself is not
    // discarded — so the moment Pro is confirmed available the user's choice takes effect.
    expect(code).toMatch(/proAvailable === false \? 'free' : chosenTier/);
    expect(code).toMatch(/useState<ImageProAvailability>\(null\)/);
  });

  it('the panel still asks the server before the user types', () => {
    expect(code).toContain('fetchImageProAvailable()');
  });

  it('🔒 WHITE-LABEL — no vendor or model name reaches this surface', () => {
    const lower = code.toLowerCase();
    for (const bad of ['pollinations', 'flux', 'z-image', 'wavespeed', 'replicate', 'openai', 'dall', 'midjourney', 'stability', 'gemini', 'grok']) {
      expect(lower, `leaked "${bad}"`).not.toContain(bad);
    }
  });
});
