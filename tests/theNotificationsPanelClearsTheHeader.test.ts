/**
 * THE NOTIFICATIONS PANEL WAS UNDER THE HEADER FROM THE DAY IT SHIPPED.
 *
 * 🔴 Admin, 2026-09-22, with a screenshot: *"notifications, open kare to notifications header me
 * chupp raha hai, crop ho raha hai. isko thoda niche sarkao!! jisse crop na do! center me kar do!!"*
 *
 * The panel sat at `top-12` — **48px**. The app header is `3.5rem` — **56px** — and it begins BELOW
 * the device notch, because App.tsx pads the app ROOT by `--nb-safe-top`. A `position: fixed` panel
 * is anchored to the VIEWPORT and receives none of that padding, so it started inside the header's
 * band and the header's higher z-index painted over its first rows.
 *
 * Measured in real Chromium against the built stylesheet, before the fix:
 *
 *     notch 0px  (web, desktop)      → header 0–56    → panel top 48 →  **8px hidden**
 *     notch 47px (the admin's phone) → header 47–103  → panel top 48 → **55px hidden**
 *
 * So this was never a device quirk to reproduce on a phone: **it was clipped on every screen ever**,
 * and the notch only decided by how much. 48 < 56 with no notch at all. A number chosen to look
 * right, against a header whose height it never consulted.
 *
 * ## What this file guards, and why a unit test can guard it at all
 *
 * The fix is not "64px instead of 48px" — that would be the same mistake with a luckier constant.
 * The offset is DERIVED from the two facts that decide it: the notch (`--nb-safe-top`) and the
 * header's own height. What a test can check is exactly that derivation, and the one thing that
 * would silently undo it:
 *
 * 🔑 **`HEADER_H` is a restatement of a fact App.tsx owns.** A fixed element cannot inherit the
 * header's height, so the number has to be written twice — and two copies of one fact is the
 * drifted-copy class this repo has paid for repeatedly (`safeRelPath` ×4, `tagsOnLine` ×2, the HTML
 * boot guard ×2). So the last block below READS App.tsx and fails when the two disagree. Change the
 * header's height and this test tells you the panel needs moving, instead of a user finding out.
 *
 * ⚠️ What a unit test deliberately does NOT claim: that the panel *renders* clear of the header.
 * That was established by measuring the real component's real class string against the real built
 * CSS at 6 viewports × 3 notch depths — 18 combinations, 0px hidden, 0px off the bottom, equal
 * margins at every one. jsdom has no layout, so it cannot repeat that, and a test that pretended to
 * would be worse than this one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HEADER_H, PANEL_GAP, PANEL_TOP } from '../src/components/NotificationBell';

const root = resolve(__dirname, '..');
const source = readFileSync(resolve(root, 'src/components/NotificationBell.tsx'), 'utf8');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');

/** The panel's own element — the one `fixed` block that carries the offset. */
const panel = /<div\s+style=\{\{ top: PANEL_TOP \}\}\s+className="([^"]+)"/.exec(source);

describe('the panel starts below the header, not inside it', () => {
  it('is positioned by the derived offset, never by a hand-typed top', () => {
    expect(panel, 'the panel must be positioned by PANEL_TOP').toBeTruthy();
    // `top-12` is the exact defect: 48px against a 56px header.
    expect(panel![1]).not.toMatch(/\btop-\d/);
  });

  it('clears the notch AND the header AND leaves a gap — all three, or it can still clip', () => {
    // Dropping any one of these re-creates a real, shipped bug: without the notch it clips by 55px
    // on the admin's phone, without the header height it clips by 8px everywhere, without the gap
    // it touches the header's border and reads as cropped even when it is not.
    expect(PANEL_TOP).toContain('var(--nb-safe-top, 0px)');
    expect(PANEL_TOP).toContain(HEADER_H);
    expect(PANEL_TOP).toContain(PANEL_GAP);
  });

  it('the offset is genuinely larger than the header it has to clear', () => {
    // Guards the arithmetic itself rather than its spelling: whatever the three parts are, the
    // notch-free case must still land past 56px.
    const rem = (v: string) => (v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v));
    expect(rem(HEADER_H) + rem(PANEL_GAP)).toBeGreaterThan(rem(HEADER_H));
    expect(rem(HEADER_H) + rem(PANEL_GAP)).toBeGreaterThan(48); // the old top-12
  });
});

describe('it is centred, and it fits', () => {
  it('is centred rather than pinned to an edge', () => {
    // Admin: "center me kar do". The panel opens from the SIDEBAR now — there is no corner control
    // left for it to hang off, and equal margins are also what stops it clipping either edge (the
    // 2026-09-16 bug, when `absolute right-0` ran it off the left of narrow phones).
    expect(panel![1]).toContain('left-1/2');
    expect(panel![1]).toContain('-translate-x-1/2');
    expect(panel![1]).not.toMatch(/\bright-\d/);
  });

  it('its height is measured from where it actually starts, not from the top of the screen', () => {
    // `max-h-[70vh]` was measured from the viewport top while the panel starts ~111px down it, so a
    // full inbox ran off the bottom on a short screen. The reserve is the notch + the header + the
    // gap + a bottom margin, which is 3.5 + 0.5 + 1 = 5rem beyond the notch.
    expect(panel![1]).toContain('max-h-[calc(100vh-var(--nb-safe-top,0px)-5rem)]');
    // dvh where the browser has it: on a phone the URL bar makes vh and dvh differ by real pixels.
    expect(panel![1]).toContain('supports-[height:100dvh]:max-h-[calc(100dvh-var(--nb-safe-top,0px)-5rem)]');
    expect(panel![1]).not.toContain('70vh');
  });

  it('still cannot overflow either side on a narrow phone', () => {
    expect(panel![1]).toContain('max-w-[calc(100vw-1.5rem)]');
  });
});

describe('the header height written here is the header height App.tsx uses', () => {
  /**
   * App.tsx is `h-screen`, pads its root by `--nb-safe-top`, and sizes the content area as
   * `100vh - <header> - var(--nb-safe-top)`. That subtraction IS the header's height, stated by the
   * file that owns it. Read it back rather than trusting the copy in NotificationBell.
   */
  const declared = [
    ...app.matchAll(/calc\(100d?vh-([\d.]+rem)-var\(--nb-safe-top\)\)/g),
  ].map((m) => m[1]);

  it('App.tsx really does state a header height (or this guard is asleep)', () => {
    // Without this, a refactor that changed how App.tsx spells the calc would leave the block below
    // vacuously passing over an empty list — a guard that cannot fail, which is not a guard.
    expect(declared.length).toBeGreaterThan(0);
  });

  it('every one of them matches HEADER_H', () => {
    for (const h of declared) {
      expect(
        h,
        `App.tsx reserves ${h} for the header but NotificationBell offsets the panel by ${HEADER_H} — ` +
          'the panel will start inside the header again. Update HEADER_H.',
      ).toBe(HEADER_H);
    }
  });
});
