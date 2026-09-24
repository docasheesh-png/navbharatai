import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  CUSTOM_SIZE_ID,
  CUSTOM_STEP,
  DEFAULT_CUSTOM_SIZE,
  MAX_CUSTOM_PIXELS,
  MAX_CUSTOM_PX,
  MIN_CUSTOM_PX,
  clampCustomSide,
  describeSize,
  resolveCustomSize,
  stepCustomSide,
} from '../src/lib/imageSize';
import { IMAGE_SIZE_PIXELS, imagePixelsFor, isValidImageGenRequest } from '../src/server/lib/imageGen';

/**
 * 🔴 AN IMAGE SIZE SELECTOR THAT COULD NOT BE CHANGED (admin 2026-09-21).
 *
 * THE CAUSE, and it was one CSS class in a different file from the broken control: a footer carrying
 * `backdrop-blur`. An element with a `backdrop-filter` — exactly like `transform` and `filter` —
 * becomes the CONTAINING BLOCK for every `position: fixed` descendant. So the selector's
 * `fixed inset-0` sheet resolved against that ~100px footer strip instead of the viewport, the
 * panel's `overflow-hidden` clipped what was left, and the list opened where nobody could see it.
 *
 * 🔑 THE FIX IS A PORTAL, NOT DELETING THE BLUR. Removing the blur fixes today and leaves the trap
 * armed: any ancestor later gaining a transform, a filter or `contain` re-breaks it, silently, from
 * a file nobody was editing. `createPortal(…, document.body)` takes the sheet out of the ancestor
 * chain entirely, so no call site can steal its containing block ever again.
 */

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments are prose. A note quoting a class must not decide whether a case passes. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/**
 * The sheets that do NOT yet render through a portal, as of 2026-09-21.
 *
 * ⚠️ THIS IS A RATCHET, NOT AN ALLOWLIST — the same shape as the theme-colour baseline. A NEW file
 * with a full-screen sheet must portal from its first line; these nine are existing screens that
 * work from where they are mounted today and were deliberately NOT swept inside a feature PR, because
 * changing nine unrelated dialogs at once makes a regression in any of them indistinguishable from
 * this feature's own. Recorded as an open root cause in PROGRESS.md; the number may only go down.
 */
const NOT_YET_PORTALLED = [
  'src/App.tsx',
  'src/components/AdminDashboard.tsx',
  'src/components/agentv3/AgentV3Panel.tsx',
  'src/components/agentv3/HostingChooser.tsx',
  'src/components/history/HistoryPopup.tsx',
  'src/components/ide/BotBuilder.tsx',
  'src/components/ide/NavAppStore.tsx',
  'src/components/sda/DoseCalculator.tsx',
];

describe('🔒 a full-screen sheet is rendered into the body, so no ancestor can capture it', () => {
  const sheets = walk(join(ROOT, 'src'))
    .filter((f) => read(relative(ROOT, f)).includes('nb-sheet-overlay'))
    .map((f) => relative(ROOT, f).replace(/\\/g, '/'));

  it('found the sheets it is meant to be guarding', () => {
    // A path bug that matched nothing would make every assertion below vacuously pass.
    expect(sheets.length).toBeGreaterThanOrEqual(8);
  });

  it('🔴 the image selector and the text editor portal — these are the two that had to', () => {
    for (const f of ['src/components/ide/ImageOptionSelect.tsx', 'src/components/ide/TextOverlayEditor.tsx']) {
      const src = code(read(f));
      expect(src, `${f} does not portal`).toMatch(/createPortal\(/);
      expect(src, `${f} portals somewhere other than the body`).toMatch(/document\.body/);
    }
  });

  it('a NEW sheet must portal from its first line', () => {
    const offenders = sheets.filter((f) => !NOT_YET_PORTALLED.includes(f) && !code(read(f)).includes('createPortal'));
    expect(offenders, 'a new full-screen sheet was added without a portal').toEqual([]);
  });

  it('…and the ratchet only goes down', () => {
    // A file that gains a portal must leave the list, or the list quietly stops meaning anything.
    const fixed = NOT_YET_PORTALLED.filter((f) => sheets.includes(f) && code(read(f)).includes('createPortal'));
    expect(fixed, 'these now portal — remove them from NOT_YET_PORTALLED').toEqual([]);
    const gone = NOT_YET_PORTALLED.filter((f) => !sheets.includes(f));
    expect(gone, 'these no longer have a sheet — remove them from NOT_YET_PORTALLED').toEqual([]);
  });
});

describe('🔒 a custom size is one rule, shared by the picker and the generator', () => {
  it('rounds to a step a diffusion model is happy with', () => {
    expect(CUSTOM_STEP).toBe(64);
    expect(clampCustomSide(1000)).toBe(1024);
    expect(clampCustomSide(1030)).toBe(1024);
    expect(clampCustomSide(1060)).toBe(1088);
  });

  it('clamps to the per-side bounds', () => {
    expect(clampCustomSide(10)).toBe(MIN_CUSTOM_PX);
    expect(clampCustomSide(99999)).toBe(MAX_CUSTOM_PX);
  });

  it('anything unreadable falls back rather than reaching a provider', () => {
    expect(clampCustomSide('wide')).toBe(DEFAULT_CUSTOM_SIZE.w);
    expect(clampCustomSide(Number.NaN)).toBe(DEFAULT_CUSTOM_SIZE.w);
    expect(clampCustomSide(undefined)).toBe(DEFAULT_CUSTOM_SIZE.w);
    expect(resolveCustomSize(null, 'x')).toEqual(DEFAULT_CUSTOM_SIZE);
  });

  it('🔴 an over-large pair is scaled down TOGETHER, so the shape survives', () => {
    // Clamping only the longer side would hand a 3:1 banner back as something much squarer — and
    // the shape is the entire reason somebody chooses a custom size.
    const big = resolveCustomSize(1536, 1536);
    expect(big.w * big.h).toBeLessThanOrEqual(MAX_CUSTOM_PIXELS);
    expect(big.w).toBe(big.h);
    const wide = resolveCustomSize(1536, 512);
    expect(wide.w).toBeGreaterThan(wide.h);
  });

  it('never returns a pair over the area cap, for any pair inside the side bounds', () => {
    for (let w = MIN_CUSTOM_PX; w <= MAX_CUSTOM_PX; w += CUSTOM_STEP) {
      for (let h = MIN_CUSTOM_PX; h <= MAX_CUSTOM_PX; h += CUSTOM_STEP) {
        const r = resolveCustomSize(w, h);
        expect(r.w * r.h, `${w}x${h} resolved over the cap`).toBeLessThanOrEqual(MAX_CUSTOM_PIXELS);
        expect(r.w % CUSTOM_STEP).toBe(0);
        expect(r.h % CUSTOM_STEP).toBe(0);
      }
    }
  });

  it('🔴 an empty or missing side is a MISS, never a deliberate zero', () => {
    // Number(null) and Number('') are both 0, not NaN. Without an explicit guard, a field the user
    // cleared clamps to the 256px floor and a 1024-wide request silently becomes a thumbnail —
    // caught by this suite before it shipped, so it stays locked.
    expect(clampCustomSide(null)).toBe(DEFAULT_CUSTOM_SIZE.w);
    expect(clampCustomSide('')).toBe(DEFAULT_CUSTOM_SIZE.w);
    expect(clampCustomSide('   ')).toBe(DEFAULT_CUSTOM_SIZE.w);
    expect(clampCustomSide(true)).toBe(DEFAULT_CUSTOM_SIZE.w);
    // A real zero typed as a number is still a number, and still clamps to the floor.
    expect(clampCustomSide(0)).toBe(MIN_CUSTOM_PX);
    // And a string that genuinely spells a number is still read.
    expect(clampCustomSide('1024')).toBe(1024);
  });

  it('🔴 the shape survives the area cap for every over-large pair, not just the square', () => {
    // The first version scaled both sides and then rounded each to the NEAREST step, which could
    // push the pair back over the cap; recovering by stepping ONE side down changed the aspect
    // ratio (1536×1536 came back as 1216×1280). Flooring is what makes this hold everywhere.
    for (let w = MIN_CUSTOM_PX; w <= MAX_CUSTOM_PX; w += CUSTOM_STEP) {
      for (let h = MIN_CUSTOM_PX; h <= MAX_CUSTOM_PX; h += CUSTOM_STEP) {
        if (w * h <= MAX_CUSTOM_PIXELS) continue;
        const r = resolveCustomSize(w, h);
        const asked = w / h;
        const got = r.w / r.h;
        // Within one step on the longer side — the most the 64px grid can cost a ratio.
        expect(Math.abs(got - asked) / asked, `${w}x${h} became ${r.w}x${r.h}`).toBeLessThan(
          CUSTOM_STEP / Math.min(r.w, r.h),
        );
      }
    }
  });

  it('the +/− buttons move exactly one step and stop at the edges', () => {
    expect(stepCustomSide(1024, 1)).toBe(1024 + CUSTOM_STEP);
    expect(stepCustomSide(1024, -1)).toBe(1024 - CUSTOM_STEP);
    expect(stepCustomSide(MAX_CUSTOM_PX, 1)).toBe(MAX_CUSTOM_PX);
    expect(stepCustomSide(MIN_CUSTOM_PX, -1)).toBe(MIN_CUSTOM_PX);
  });

  it('the server resolves a preset by id and a custom size by its numbers', () => {
    expect(imagePixelsFor('wide')).toEqual(IMAGE_SIZE_PIXELS.wide);
    expect(imagePixelsFor('nonsense')).toEqual(IMAGE_SIZE_PIXELS.square);
    expect(imagePixelsFor(CUSTOM_SIZE_ID, 768, 1280)).toEqual({ w: 768, h: 1280 });
    // A custom id with no numbers is the default square, never a crash or a zero-sized request.
    expect(imagePixelsFor(CUSTOM_SIZE_ID)).toEqual(DEFAULT_CUSTOM_SIZE);
  });

  it('the free request validator accepts the two numbers and rejects junk', () => {
    expect(isValidImageGenRequest({ prompt: 'hi', size: CUSTOM_SIZE_ID, width: 768, height: 768 })).toBe(true);
    expect(isValidImageGenRequest({ prompt: 'hi', width: '768' })).toBe(false);
  });

  it('describeSize is the one place the "W × H" string is built', () => {
    expect(describeSize(1024, 768)).toBe('1024 × 768');
  });
});

describe('🔒 the two numbers really reach the server', () => {
  const routes = code(read('src/server/routes/imageGen.ts'));
  const free = code(read('src/components/ide/AIImageGenerator.tsx'));

  it('🔴 the request schema declares width and height', () => {
    // `vobject` DROPS a key it does not declare, so a width sent by the client and missing from the
    // schema would vanish between the picker and the generator with nothing failing — the picker
    // would print 768 × 1280 and the server would make a square.
    const declarations = routes.match(/width: vnumber\(/g) || [];
    expect(declarations.length, 'the schema is missing width').toBe(1);
    expect((routes.match(/height: vnumber\(/g) || []).length, 'the schema is missing height').toBe(1);
  });

  it('the generator sends them, and only for a custom size', () => {
    expect(free, 'the generator does not send a resolved custom size').toMatch(/size === CUSTOM_SIZE_ID \? resolveCustomSize\(/);
  });

  it('what is SENT is already through the server’s own clamp', () => {
    // So the number the picker printed and the number the generator receives are the same number —
    // the picker cannot advertise a size the server will quietly change.
    expect(free).toMatch(/resolveCustomSize\(custom[WH]/);
  });

  it('the picker offers the custom option', () => {
    expect(free).toContain('CUSTOM_SIZE_ID');
    expect(code(read('src/components/ide/CustomSizeFields.tsx'))).toMatch(/type="number"/);
  });

  it('the stepper shows what will REALLY be made, not what was typed', () => {
    const fields = code(read('src/components/ide/CustomSizeFields.tsx'));
    expect(fields).toMatch(/resolveCustomSize\(width, height\)/);
    expect(fields).toContain('Will be made at');
    expect(fields).toContain('keeping the same shape');
  });
});

describe('🔒 the free tier says what it is FOR, beside the box where it is used', () => {
  const free = code(read('src/components/ide/AIImageGenerator.tsx'));

  it('names the work it is good at', () => {
    expect(free).toMatch(/logos, icons, banners, illustrations/);
  });

  it('names no vendor and quotes no price on the free path', () => {
    const note = free.slice(free.indexOf('Free images are made'), free.indexOf('Free images are made') + 1200);
    expect(note).not.toMatch(/₹/);
    for (const bad of ['pollinations', 'flux', 'openai', 'dall', 'midjourney', 'stability']) {
      expect(note.toLowerCase()).not.toContain(bad);
    }
  });
});
