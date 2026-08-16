import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLOBAL_MOBILE_NAV_Z, PLAYER_Z } from './WebAppPlayer';

/**
 * The App Mart player must own the whole screen (admin screenshot 2026-08-16: "game khelte hain to
 * screen cut ho jati hai" — a game's on-screen joystick sitting behind HOME / AI / PREVIEW).
 *
 * Two independent things had to be true, and neither was:
 *   1. the player must paint ABOVE the global mobile tab bar, and
 *   2. `position: fixed` must actually mean "the viewport" — which it only does while no ancestor
 *      creates a containing block via transform / filter / backdrop-filter.
 *
 * Both are asserted here rather than trusted, because a cut-off game is precisely the sort of bug
 * that returns the next time someone raises a z-index in an unrelated file.
 */

const APP_TSX = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');
const PLAYER_TSX = readFileSync(join(__dirname, 'WebAppPlayer.tsx'), 'utf8');

/**
 * Strip comments before scanning for a FORBIDDEN pattern.
 *
 * The file explains the `z-[${n}]` trap in prose so the next reader does not fall into it, and a
 * naive scan flags that explanation — firing on the documentation of the fix is the fastest way to
 * get a guard deleted. (Same lesson as `firestoreIndexSafe.test.ts`.)
 */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the store player covers every piece of NavBharatAI chrome', () => {
  it('paints above the global mobile tab bar', () => {
    expect(PLAYER_Z).toBeGreaterThan(GLOBAL_MOBILE_NAV_Z);
  });

  it('tracks the tab bar\'s REAL z-index in App.tsx, so the two cannot drift apart', () => {
    // The constant here is a copy of a number that lives in another file. A copy that nobody checks
    // is how "the game is cut off" comes back — so the check is the point of this test, not the
    // arithmetic above it.
    const navZ = /fixed bottom-0 left-0 right-0 z-\[(\d+)\]/.exec(APP_TSX);
    expect(navZ, 'could not find the global mobile nav in App.tsx — has it been renamed?').toBeTruthy();
    expect(
      Number(navZ![1]),
      `App.tsx renders the mobile tab bar at z-${navZ?.[1]}, but WebAppPlayer assumes ${GLOBAL_MOBILE_NAV_Z}. ` +
      'Update GLOBAL_MOBILE_NAV_Z (and check PLAYER_Z still clears it) or the player will be covered again.',
    ).toBe(GLOBAL_MOBILE_NAV_Z);
  });

  it('is portalled to document.body, so no transformed ancestor can re-anchor its `fixed`', () => {
    // `position: fixed` stops being viewport-relative inside ANY transformed/filtered ancestor, and
    // the store is reached through animated panels — so full-screen was a hope, not a guarantee,
    // until the portal removed every ancestor from the question.
    expect(PLAYER_TSX).toContain('createPortal');
    expect(PLAYER_TSX).toContain('document.body');
  });

  it('applies the z-index as an inline style, never a computed Tailwind class', () => {
    // Tailwind's JIT only emits classes it finds as literal text, so `z-[${n}]` compiles to NOTHING
    // and fails silently — the player would slip back under the tab bar with no error to notice.
    expect(PLAYER_TSX).toContain('zIndex: PLAYER_Z');
    expect(codeOnly(PLAYER_TSX)).not.toMatch(/z-\[\$\{/);
  });

  it('keeps its own controls clear of the notch and the home indicator', () => {
    // Now that the player really starts at the top of the screen, ✕ would otherwise sit under the
    // status bar. A player you cannot close is worse than one that is cut off.
    expect(PLAYER_TSX).toContain('env(safe-area-inset-top, 0px)');
    expect(PLAYER_TSX).toContain('env(safe-area-inset-bottom, 0px)');
  });
});
