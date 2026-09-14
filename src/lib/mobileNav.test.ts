import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOBILE_NAV_CONTENT_HEIGHT, MOBILE_NAV_TOTAL_HEIGHT, MOBILE_SAFE_BELOW_VAR, DEVICE_SAFE_BOTTOM } from './mobileNav';

describe('the mobile tab bar height', () => {
  it('includes the device inset, which is the whole point', () => {
    // The bar is 3.5rem of taps PLUS the iPhone home-indicator strip. A page that reserves only the
    // 3.5rem hides its bottom row — the Professionals composer — by exactly the inset.
    expect(MOBILE_NAV_TOTAL_HEIGHT).toContain(MOBILE_NAV_CONTENT_HEIGHT);
    expect(MOBILE_NAV_TOTAL_HEIGHT).toContain('safe-area-inset-bottom');
  });

  it('falls back to 0, so the web is byte-identical to the old pb-14', () => {
    expect(MOBILE_NAV_TOTAL_HEIGHT).toContain('0px');
  });
});

describe('the bar and the space reserved for it cannot disagree (locked)', () => {
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

  it('BOTH the bar and the page reservation read the shared constant', () => {
    // App.tsx already shares a BOOLEAN for whether the bar exists, after that drifted twice. It still
    // hand-typed the HEIGHT in two places, which is how the inset went missing from one of them.
    expect(app.split('MOBILE_NAV_TOTAL_HEIGHT').length - 1).toBeGreaterThanOrEqual(3); // import + 2 uses
  });

  it('no longer reserves a bare pb-14 for a bar that is taller than that', () => {
    expect(app).not.toContain('showsGlobalMobileNav ? "pb-14"');
  });

  it('reserves nothing when the bar is not rendered', () => {
    // Focus mode and Code Studio hide the bar; reserving 56px for a bar that is not there leaves a
    // dead strip, which this file's own history records as a real past bug.
    expect(app).toContain('showsGlobalMobileNav ? { paddingBottom: MOBILE_NAV_TOTAL_HEIGHT } : undefined');
  });
});

describe('every professional gets the compact header (locked)', () => {
  const chat = readFileSync(resolve(__dirname, '../components/professionals/ProfessionalChat.tsx'), 'utf8');

  it('is ONE component, so the trim reaches all of them at once', () => {
    expect(chat).toContain('export function ProfessionalChat');
    expect(chat).toContain('config.name');
  });

  it('uses the shorter header row', () => {
    expect(chat).toContain('px-4 py-2 border-b border-white/5');
    expect(chat).not.toContain('px-4 py-3 border-b border-white/5');
  });

  it('lets a long name truncate instead of wrapping the header onto a second row', () => {
    // "Pet-Care / Dog-Training AI" would otherwise wrap and give back the height just saved.
    expect(chat).toContain('truncate min-w-0');
  });

  it('keeps the composer compact', () => {
    expect(chat).toContain('px-3 py-2 border-t border-white/5');
  });
});

/**
 * 🔴 THE FIFTH DRIFT — the first one that ADDED space instead of losing it (admin, 2026-09-14,
 * screenshot of NavBharatAI Pro on a phone with the dead strip drawn in red):
 *   "footer aur input box ke bich me yeh itna sara space khali kyu rakha hai? … input box ko niche
 *    sarka do, jisse yeh space use ho jayega aur chating area ki visibility aur badh jayegi."
 *
 * Three layers each solved "clear the home indicator" without knowing the others had. Layer 1
 * (`body { padding-bottom: env(...) }`) is DEAD — `body, #root { height: 100dvh; overflow: hidden }`,
 * so #root starts at the TOP of body's content box and a bottom padding neither moves nor crops it.
 * Layer 2 (the app root's reservation) is already exactly the bar. Layer 3 — the composer's own
 * `pb-[env(safe-area-inset-bottom)]` — was therefore pure surplus: one whole inset of untouchable
 * strip between the composer and the bar on every phone with a home indicator or gesture bar.
 */
describe('who owns the device inset — one answer, published from one boolean', () => {
  const nav = readFileSync(resolve(__dirname, './mobileNav.ts'), 'utf8');
  const pro = readFileSync(resolve(__dirname, '../components/agentv3/AgentV3Panel.tsx'), 'utf8');
  const offline = readFileSync(resolve(__dirname, '../components/offline/OfflineAI.tsx'), 'utf8');
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

  it('the bar being visible means the composer adds NOTHING — the page already reserved it', () => {
    expect(MOBILE_SAFE_BELOW_VAR).toBe('--nb-safe-below');
    // The two properties are set in ONE function, from ONE boolean, so they cannot disagree about
    // who owns the inset — the discipline this whole module exists to enforce.
    const body = nav.slice(nav.indexOf('export function publishMobileNavHeight'));
    // Both properties are written inside the SAME function body, by name.
    expect(body).toContain('MOBILE_NAV_HEIGHT_VAR');
    expect(body).toContain('MOBILE_SAFE_BELOW_VAR');
    expect(body).toMatch(/MOBILE_SAFE_BELOW_VAR,\s*visible\s*\?\s*'0px'\s*:\s*DEVICE_SAFE_BOTTOM/);
  });

  it('the fallback is the real inset, so the two are exact opposites', () => {
    // `--nb-bottom-nav` defaults to 0 (reserve nothing until told the bar exists); this one defaults
    // to the inset (keep clearing it until told the page has). Opposite defaults, same reason: the
    // untold state must be the one that behaves exactly as it did before the variable existed.
    expect(DEVICE_SAFE_BOTTOM).toContain('safe-area-inset-bottom');
    expect(MOBILE_NAV_TOTAL_HEIGHT).toContain('safe-area-inset-bottom');
  });

  it('🔴 neither composer hard-codes the inset any more — that WAS the dead strip', () => {
    // ⚠️ Comments are stripped first: both files now QUOTE the old value while explaining why it
    // went, and a guard that cannot tell a comment from code would fail on its own documentation.
    const code = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const [name, src] of [['Pro', pro], ['Offline AI', offline]] as const) {
      expect(code(src), name).not.toContain('pb-[env(safe-area-inset-bottom)]');
      expect(code(src), name).toContain('var(--nb-safe-below, env(safe-area-inset-bottom, 0px))');
    }
  });

  it('the stylesheet carries the default, for SSR and the paint before the effect runs', () => {
    expect(css).toContain('--nb-safe-below: env(safe-area-inset-bottom, 0px)');
  });

  it("🔒 SHEETS ARE NOT THIS VARIABLE'S BUSINESS — they already had an owner", () => {
    // I first added `--nb-safe-below` to `.nb-sheet-over-nav` as well, reasoning that a sheet painting
    // OVER the bar must clear the home indicator itself. `sheetOverlayGeometry.test.ts` rejected it,
    // and it was right: sheets have owned that inset since they were written, through
    // `--nb-safe-bottom`, and `max(var(--nb-safe-bottom), var(--nb-bottom-nav))` already answers both
    // cases. Adding mine would have made a FOURTH owner of one inset — precisely the bug this change
    // exists to remove. This variable is for elements the PAGE reserves for, and nothing else.
    expect(css).toContain('--nb-safe-bottom: env(safe-area-inset-bottom, 0px);');
    expect(css).toMatch(/\.nb-sheet-over-nav\s*\{\s*--nb-bottom-nav:\s*0px;\s*\}/);
  });
});
