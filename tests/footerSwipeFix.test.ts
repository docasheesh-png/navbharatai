import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * ADMIN REPORT 2026-09-14 (phone, mobile Safari, the WEBSITE — not the packaged app): "footer par
 * press kar ke up swipe kiya jaye to puri app upar chali jati hai... app upar chali gayi, niche white
 * screen hai" — pressing near the bottom nav and swiping up moved the WHOLE app upward, leaving a
 * white gap below it.
 *
 * The app shell's own vh/dvh sizing was already correct everywhere (App.tsx's root `h-screen
 * supports-[height:100dvh]:h-[100dvh]`, the content area's matching pair, `body, #root`'s
 * `height: 100dvh` override) — this is a DIFFERENT class of bug from `tests/mobileScrollGeometry.test.ts`.
 * Two things were missing:
 *   1. `<html>` (the real `document.scrollingElement`, not `<body>`) had no `overflow: hidden` of its
 *      own — `body`/`#root` did, but html's own box was left scrollable, and iOS Safari's own
 *      address-bar collapse/expand animation can transiently make it scroll independently of body.
 *   2. The fixed bottom nav bar inherited the app-wide `touch-action: pan-x pan-y` rule (needed so
 *      ordinary scroll views keep working), but it has no scrollable content of its own — a real
 *      native tab bar never pans under a swipe, so a drag starting there should never be read as a
 *      pan gesture at all.
 */

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the fixed bottom nav cannot drag the whole app up (EduTube-adjacent report, 2026-09-14)', () => {
  it('<html> is not an independent scroll container — overflow: hidden alongside its overscroll-behavior rule', () => {
    const css = read('src/index.css');
    const i = css.indexOf('html, body {');
    expect(i).toBeGreaterThan(-1);
    const rule = css.slice(i, css.indexOf('}', i));
    expect(rule).toContain('overscroll-behavior-y: none;');
    expect(rule).toContain('overflow: hidden;');
  });

  it('the fixed bottom nav opts OUT of the app-wide pan gesture — it has nothing to pan', () => {
    const app = read('src/App.tsx');
    const i = app.indexOf('<nav className="fixed bottom-0 left-0 right-0');
    expect(i).toBeGreaterThan(-1);
    const body = app.slice(i, i + 1600);
    expect(body).toContain("touchAction: 'none'");
  });

  it('ordinary scrollable content is untouched — the pan-x/pan-y rule still exists for it', () => {
    // Regression guard: this fix must not have deleted the rule ordinary scroll views rely on, only
    // scoped where it applies (see zoomLock.test.ts for the native-shell scoping of this same rule).
    const css = read('src/index.css');
    expect(css).toContain('touch-action: pan-x pan-y;');
  });
});
