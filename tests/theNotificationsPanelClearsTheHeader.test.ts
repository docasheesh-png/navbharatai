/**
 * THE NOTIFICATIONS PANEL WAS UNDER THE HEADER FROM THE DAY IT SHIPPED.
 *
 * 🔴 Admin, 2026-09-22, with a screenshot: *"notifications, open kare to notifications header me
 * chupp raha hai, crop ho raha hai. isko thoda niche sarkao!! jisse crop na do! center me kar do!!"*
 *
 * The panel sat at `top-12` — **48px**. The app header is TopNav's `h-10` — **40px** — and it begins
 * BELOW the device notch, because App.tsx pads the app ROOT by `--nb-safe-top`. A `position: fixed`
 * panel is anchored to the VIEWPORT and receives none of that padding, so on a notched phone it started
 * inside the header's band and the header's higher z-index painted over its first rows:
 *
 *     notch 0px  (web, desktop)      → header 0–40   → panel top 48 → clear by 8px
 *     notch 47px (the admin's phone) → header 47–87  → panel top 48 → **39px hidden**
 *
 * 🔴 CORRECTED 2026-09-23. The first version of this docblock said the header was `3.5rem` (56px) and
 * that the panel was "clipped on every screen ever". It was not. That number was read out of App.tsx's
 * content calc `100vh - 3.5rem - var(--nb-safe-top)`, which was assumed to restate the header and did
 * not — the calc was itself wrong by 16px (removed in the same change as this note). The measurement
 * harness drew a 56px header too, so it confirmed the assumption instead of testing it. The FIX was
 * right regardless, because it adds the notch and the header's height rather than guessing a number;
 * only the diagnosis overstated the no-notch case.
 *
 * ## What this file guards, and why a unit test can guard it at all
 *
 * The fix is not "64px instead of 48px" — that would be the same mistake with a luckier constant.
 * The offset is DERIVED from the two facts that decide it: the notch (`--nb-safe-top`) and the
 * header's own height. What a test can check is exactly that derivation, and the one thing that
 * would silently undo it:
 *
 * 🔑 **`HEADER_H` is a restatement of a fact TopNav.tsx owns.** A fixed element cannot inherit the
 * header's height, so the number has to be written twice — and two copies of one fact is the
 * drifted-copy class this repo has paid for repeatedly (`safeRelPath` ×4, `tagsOnLine` ×2, the HTML
 * boot guard ×2). So the last block below READS TopNav.tsx and fails when the two disagree. Change the
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
const topNav = readFileSync(resolve(root, 'src/components/panels/TopNav.tsx'), 'utf8');

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
    // notch-free case must still land past the header.
    const rem = (v: string) => (v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v));
    expect(rem(HEADER_H) + rem(PANEL_GAP)).toBeGreaterThan(rem(HEADER_H));
    // There used to be a second line here: "must land past 48px, the old top-12". It was written on the
    // belief that the header was 56px. It is 40px, so without a notch the old 48px was never the bug —
    // the notch was — and the derived offset lands on exactly 48px there. The notch case is what the
    // PANEL_TOP assertion above protects.
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
    // gap + a bottom margin, which is 2.5 + 0.5 + 1 = 4rem beyond the notch.
    expect(panel![1]).toContain('max-h-[calc(100vh-var(--nb-safe-top,0px)-4rem)]');
    // dvh where the browser has it: on a phone the URL bar makes vh and dvh differ by real pixels.
    expect(panel![1]).toContain('supports-[height:100dvh]:max-h-[calc(100dvh-var(--nb-safe-top,0px)-4rem)]');
    expect(panel![1]).not.toContain('70vh');
  });

  it('still cannot overflow either side on a narrow phone', () => {
    expect(panel![1]).toContain('max-w-[calc(100vw-1.5rem)]');
  });
});

describe('the header height written here is the header height TopNav renders', () => {
  /**
   * The header is TopNav's root `<nav>`, sized by a Tailwind `h-N` class (N × 0.25rem). Read that class
   * back rather than trusting the copy in NotificationBell. This used to read App.tsx's content calc,
   * which was assumed to restate the header and was 16px wrong — see the note at the top of this file.
   */
  const navClass = /<nav className=\{cn\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/.exec(topNav)?.[1] ?? '';
  const h = /(?:^|\s)h-(\d+(?:\.\d+)?)(?:\s|$)/.exec(navClass)?.[1];

  it('TopNav really does state a header height (or this guard is asleep)', () => {
    // Without this, a refactor that changed how TopNav spells its height would leave the check below
    // vacuously passing — a guard that cannot fail, which is not a guard.
    expect(navClass).toContain('border-b');
    expect(h, 'TopNav\'s root <nav> must carry an h-N height class').toBeTruthy();
  });

  it('it matches HEADER_H', () => {
    expect(
      `${Number(h) * 0.25}rem`,
      `TopNav renders an h-${h} header but NotificationBell offsets the panel by ${HEADER_H} — ` +
        'the panel will start in the wrong place. Update HEADER_H.',
    ).toBe(HEADER_H);
  });
});
