/**
 * THE NOTICE WAS HALF OFF THE LEFT EDGE OF A REAL PHONE (admin screenshot, 2026-09-14).
 *
 * The card centred itself twice. `-translate-x-1/2` on the element, and `translate(-50%, …)` in the
 * entry/exit keyframes — which reads as redundant belt-and-braces and is in fact ADDITIVE, because
 * Tailwind v4 compiles that utility to the STANDALONE `translate` property while the animation uses
 * `transform`, and CSS applies `translate` first and `transform` after. Composed: -100% of the card's
 * own width, so its RIGHT edge sat on the screen's centre line and everything left of that was gone.
 *
 * ⚠️ WHY NOBODY CAUGHT IT, AND THE REASON THIS FILE EXISTS. Under Tailwind v3 the same utility
 * compiled INTO `transform`, where the animation simply replaced it — the pair was genuinely correct
 * when it was written, and the dependency upgrade broke it with nothing failing anywhere. jsdom does
 * not compose transforms, so no render test can see this; the only thing that can is a rule about
 * what the source is allowed to contain.
 *
 * 🔒 THE RULE, STATED AS A RULE RATHER THAN AS THIS ONE BUG: an element whose position is animated by
 * one of our own keyframes must not ALSO be positioned by a Tailwind translate utility. One owner for
 * the element's offset, whichever owner it is.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const css = read('src/index.css');
const notice = read('src/components/TestingNotice.tsx');

/** The class attribute of the notice's outer element — comments stripped, since this file's own
 *  explanation of the bug naturally contains the very strings being forbidden. */
const noticeClasses = notice
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('🔴 the card is centred by exactly ONE mechanism', () => {
  it('the element does not position itself with a translate utility', () => {
    // Its `transform` belongs to the animation. If centring ever moves back here, the two compose
    // again and the card walks off the screen a second time.
    expect(noticeClasses).not.toMatch(/-translate-x-1\/2/);
    expect(noticeClasses).not.toMatch(/-translate-y-1\/2/);
  });

  it('it is centred by insets + auto margin instead, which need no transform', () => {
    expect(noticeClasses).toContain('mx-auto');
    expect(noticeClasses).toMatch(/left-\[calc\(env\(safe-area-inset-left/);
    expect(noticeClasses).toMatch(/right-\[calc\(env\(safe-area-inset-right/);
    expect(noticeClasses).toContain('max-w-md');
  });

  it('🔒 the keyframes move on Y only — they must never centre on X', () => {
    const frames = css.slice(
      css.indexOf('@keyframes nb-testing-notice-in'),
      css.indexOf('.nb-testing-notice-in '),
    );
    expect(frames.length).toBeGreaterThan(0);
    expect(frames).not.toMatch(/translate\(\s*-50%/);
    expect(frames).not.toMatch(/translateX/);
    // …and they do still animate, so this cannot be satisfied by deleting the motion.
    expect(frames).toMatch(/transform:\s*translateY\(/);
  });
});

describe('🔒 the same collision cannot be introduced by a NEW animation', () => {
  // The general form of the bug, so the next notice/toast/sheet someone adds is covered too: one of
  // OUR keyframes (`nb-…`) that centres on X is only ever correct if nothing else also does, and
  // that is a coupling no reader would think to check. Forbid it outright — Y motion is all these
  // entry animations need, and centring belongs in layout.
  it('no nb-* keyframe centres on the X axis', () => {
    const offenders: string[] = [];
    const re = /@keyframes\s+(nb-[\w-]+)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      // Walk to the matching close brace — keyframe bodies contain nested blocks.
      let depth = 1;
      let i = re.lastIndex;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
      }
      const body = css.slice(re.lastIndex, i);
      if (/translate\(\s*-?\d+%/.test(body) || /translateX/.test(body)) offenders.push(m[1]);
    }
    expect(offenders, `these keyframes centre/move on X: ${offenders.join(', ')}`).toEqual([]);
  });
});
