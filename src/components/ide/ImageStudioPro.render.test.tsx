import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The paid studio's structure, asserted from its source.
 *
 * ⚠️ WHY SOURCE AND NOT A RENDER: the admin's requirements here are LAYOUT ones — "results inputbox
 * ke upar ane chahiye aur inputbox niche footer me ho" — and `renderToStaticMarkup` produces no
 * layout at all. A DOM assertion would prove the elements exist, which was never in doubt; what
 * needs pinning is the ORDER and the flex roles that put them there, and those are in the source.
 */
const PRO = readFileSync(join(__dirname, 'ImageStudioPro.tsx'), 'utf8');
const GEN = readFileSync(join(__dirname, 'AIImageGenerator.tsx'), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('🔒 the admin’s layout: results above, input in the footer', () => {
  it('the canvas is declared before the footer, and only the canvas scrolls', () => {
    const src = code(PRO);
    const canvas = src.indexOf('flex-1 min-h-0 overflow-y-auto');
    const footer = src.indexOf('shrink-0 border-t');
    expect(canvas, 'the scrolling canvas is missing').toBeGreaterThan(-1);
    expect(footer, 'the pinned footer is missing').toBeGreaterThan(-1);
    // Source order IS visual order in a column flexbox — this is the whole inversion the admin asked
    // for, and reversing these two is exactly how it would be undone.
    expect(canvas).toBeLessThan(footer);
  });

  it('the newest result is scrolled to, so a new image lands where the eye already is', () => {
    expect(code(PRO)).toMatch(/scrollIntoView/);
  });

  it('🔒 the input is a real footer — it does not scroll away with the results', () => {
    // `shrink-0` on the footer and `min-h-0` on the canvas are what keep the bar pinned; without the
    // second, a long feed pushes the bar off the bottom of the panel instead of scrolling inside it.
    expect(code(PRO)).toMatch(/shrink-0[^"]*border-t/);
    expect(code(PRO)).toMatch(/flex-1 min-h-0/);
  });
});

describe('🔒 all three jobs are handled, and the mode is derived not chosen', () => {
  it('names each of the three modes the admin listed', () => {
    for (const m of ['text-to-image', 'image-to-image', 'image-text-to-image']) {
      expect(code(PRO), `mode ${m} missing`).toContain(m);
    }
  });

  it('a reference can arrive by button, by drop AND by paste', () => {
    const src = code(PRO);
    expect(src, 'no file picker').toMatch(/type="file"/);
    expect(src, 'no drop handler').toMatch(/onDrop=/);
    // Paste is the one that actually matters: a reference image is far more often on the clipboard
    // than in a folder, and a studio that cannot take a paste feels broken before it is used.
    expect(src, 'no paste handler').toMatch(/'paste'/);
  });

  it('there is NO mode selector — choosing it is the app’s job, not the user’s', () => {
    // A fourth control the user has to get right is exactly what deriving the mode avoids. If a
    // selector ever appears, the server's derivation and the UI's can disagree, and the badge lies.
    expect(code(PRO)).not.toMatch(/setMode\(/);
  });
});

describe('🔒 money is stated before it is taken, and never hidden', () => {
  it('the per-image price is on screen, not only in a bill afterwards', () => {
    expect(code(PRO)).toMatch(/per image/);
  });
  it('each result carries what it actually cost', () => {
    expect(code(PRO)).toMatch(/chargedInr/);
  });
  it('the free tier advertises no price at all', () => {
    // The free path must stay visibly free — the admin's instruction was "free image ko aise hi
    // rahne do", and a ₹ sign on it would contradict that before a user even pressed anything.
    const free = code(GEN).split("tier === 'pro'")[0];
    expect(free).not.toMatch(/₹/);
  });
});

describe('🔒 the toggle is a control, reachable from BOTH tiers', () => {
  it('replaced the static Free badge with two real buttons', () => {
    const src = code(GEN);
    expect(src).toMatch(/role="tablist"/);
    expect(src).toMatch(/\['free', 'pro'\]/);
  });

  it('🔴 the toggle is rendered OUTSIDE the free-only block, or Pro would be a one-way door', () => {
    // The header hides its title block in Pro but must never hide the toggle: every Pro failure
    // message tells the user to switch back to Free, and that instruction has to be followable.
    const src = code(GEN);
    const freeOnlyBlock = src.indexOf("{tier === 'free' && (");
    const toggle = src.indexOf('role="tablist"');
    const bodySwap = src.indexOf("{tier === 'pro' ? (");
    expect(freeOnlyBlock).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(freeOnlyBlock);
    expect(toggle, 'the toggle must be in the header, above the body swap').toBeLessThan(bodySwap);
  });

  it('defaults to free, and an unreadable stored value also means free', () => {
    const src = code(GEN);
    expect(src).toMatch(/localStorage\.getItem\(TIER_KEY\) === 'pro' \? 'pro' : 'free'/);
    expect(src).toMatch(/catch \{\s*return 'free';/);
  });
});

describe('🔒 WHITE-LABEL — the paid surface names no vendor', () => {
  it('neither component mentions the model or any provider', () => {
    for (const [name, src] of [['ImageStudioPro', PRO], ['AIImageGenerator', GEN]] as const) {
      const lower = code(src).toLowerCase();
      for (const bad of ['flux', 'klein', 'bfl', 'black forest', 'fal.ai', 'replicate', 'pollinations', 'openai', 'dall', 'midjourney', 'stability']) {
        expect(lower, `${name} leaked "${bad}"`).not.toContain(bad);
      }
    }
  });
});

describe('🔒 UI language — English only, per the 2026-09-14 rule', () => {
  it('no Devanagari reaches either screen', () => {
    // A price rendered in one region's script is what triggered that rule; this file adds a price.
    for (const [name, src] of [['ImageStudioPro', PRO], ['AIImageGenerator', GEN]] as const) {
      expect(code(src), `${name} contains Devanagari`).not.toMatch(/[ऀ-ॿ]/);
    }
  });
});
