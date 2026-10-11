// AgentV3 — A BUILT APP MUST FEEL LIKE AN APP, NOT LIKE A WEBSITE IN A FRAME (admin 2026-10-11).
//
// Admin, verbatim: *"navbharatai jo app banaye aur navbharatai khud dono ko real netiv app feel aye
// aisa banao! aur bhi jyada micro polish karo!!"*
//
// 🔴 WHAT WAS MISSING, MEASURED BEFORE WRITING ANYTHING. NavBharatAI's OWN shell has had native polish
// since 2026-07-08 (`src/lib/nativeShell.ts` — splash, status bar, haptics, back button, keyboard inset)
// and its `index.html` already carries `viewport-fit=cover` and the Apple meta tags. **The apps it BUILDS
// got none of it.** `appDefaults.ts` ensured exactly one viewport tag:
//
//     <meta name="viewport" content="width=device-width, initial-scale=1.0" />
//
// and its presence test is `name=["']viewport["']`. **Vite's own template always ships a viewport**, so
// the tag was never added — and therefore `viewport-fit=cover` never arrived. That one missing token is
// the largest tell of all: without it `env(safe-area-inset-*)` resolves to **0px on every device**, so a
// header sits under the notch and a bottom bar sits under the home indicator, and a generated app's
// safe-area CSS silently does nothing. An `ensure`-only patcher cannot fix an attribute on a tag that
// already exists, which is why this module UPGRADES as well as ensures.
//
// 🔑 THE DIVISION OF LABOUR, and it is deliberate:
//   · **Deterministic (this module)** — everything that is true for every app and that a model forgets:
//     the viewport token, the Apple meta tags, and a behaviour-only CSS baseline. Always right, costs no
//     model call, cannot be "forgotten" on a long build.
//   · **The prompt (`nativeFeelBuildRule`)** — only what needs per-field judgement: `inputmode` on the
//     right input, a 44px target on the app's own controls, a pressed state on its own components.
//
// ⚠️ NO COLOUR IN THE CSS, ON PURPOSE. Every rule here is BEHAVIOUR (touch, scroll, selection, sizing).
// Colour belongs to the app's own design and to `docs/claude/THEME_RULES.md`; a baseline that painted
// anything would fight the app's theme and would be the wrong kind of help.
//
// ⚠️ AND IT MUST NEVER FIGHT THE APP. Every selector is low-specificity, the block is injected once
// (marker-guarded, so re-running is a no-op), and anything an app really needs — a drawing canvas that
// wants `touch-action: none`, a text view that wants selection — overrides it with any more specific
// selector. The baseline is a floor, not a ceiling.
//
// PURE — no I/O, no clock. Never throws.

import { envFlag } from '../lib/envFlag';

/** Is the native-feel baseline on? Default ON — its absence is the defect, so the env is a kill switch. */
export function nativeFeelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) return envFlag('AGENTV3_NATIVE_FEEL', true);
  const raw = String(env.AGENTV3_NATIVE_FEEL ?? '').trim().toLowerCase();
  return !(raw === 'off' || raw === 'false' || raw === '0' || raw === 'no');
}

/** The marker that makes injection idempotent across rebuilds and re-runs. */
export const NATIVE_FEEL_MARKER = 'nbai-native-feel';

/**
 * 🔴 A STYLESHEET FILE, NOT AN INLINE `<style>` — AND A GUARD CAUGHT ME GETTING THAT WRONG.
 *
 * The first version injected the whole baseline as an inline `<style>` in the generated app's
 * `index.html`, and `tests/theBootGuardRanOnOneLaneOfTwo.test.ts` failed: it caps what WE persist into a
 * user's own `index.html` at 2,000 bytes. That cap exists because an 18 KB preview shim once got saved
 * into a user's source (*"299 bytes in, 18 KB out"*), and ~2.5 KB of our CSS is exactly the shape it
 * watches for. **The guard was right and the design was wrong** — so the baseline is a FILE, the way
 * `appDefaults` already ships the manifest, the icon and the service worker: the document grows by one
 * `<link>`, the CSS is cacheable, and the user can read, edit or delete one obvious file.
 */
export const NATIVE_FEEL_HREF = '/nbai-native.css';

/**
 * Add `viewport-fit=cover` to a viewport that lacks it. PURE.
 *
 * This is the whole reason the module exists: `appDefaults`'s presence test sees Vite's existing viewport
 * and adds nothing, so the token never arrives and every `env(safe-area-inset-*)` in the app reads 0px.
 * A viewport that already has it is returned untouched; a document with no viewport at all is left to
 * `appDefaults`'s own ensure (which now writes the token itself).
 */
export function withViewportFitCover(html: string): { html: string; changed: boolean } {
  const src = String(html ?? '');
  const tag = /<meta\b[^>]*name=["']viewport["'][^>]*>/i.exec(src);
  if (!tag) return { html: src, changed: false };
  if (/viewport-fit\s*=/i.test(tag[0])) return { html: src, changed: false };
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  if (!content) return { html: src, changed: false };
  const upgraded = tag[0].replace(
    content[0],
    content[0].replace(content[1], `${content[1].trim().replace(/,\s*$/, '')}, viewport-fit=cover`),
  );
  return { html: src.replace(tag[0], upgraded), changed: true };
}

/** The `<head>` tags a phone needs, each with the reason it is not optional. PURE. */
export function nativeFeelHeadTags(): Array<{ test: RegExp; tag: string; label: string }> {
  return [
    // iOS "Add to Home Screen": without this the app opens inside Safari's chrome, which is the
    // difference between an app and a bookmark.
    {
      test: /name=["']apple-mobile-web-app-capable["']/i,
      tag: '<meta name="apple-mobile-web-app-capable" content="yes" />',
      label: 'apple-mobile-web-app-capable',
    },
    // `black-translucent` lets the app paint behind the status bar — which is only safe BECAUSE
    // viewport-fit=cover + the safe-area padding below keep content out from under it.
    {
      test: /name=["']apple-mobile-web-app-status-bar-style["']/i,
      tag: '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
      label: 'apple-mobile-web-app-status-bar-style',
    },
    // Android/Chrome equivalent of the above for an installed PWA.
    {
      test: /name=["']mobile-web-app-capable["']/i,
      tag: '<meta name="mobile-web-app-capable" content="yes" />',
      label: 'mobile-web-app-capable',
    },
    // Rotating a phone otherwise re-flows every font size on iOS, which looks like a broken layout.
    {
      test: /name=["']format-detection["']/i,
      tag: '<meta name="format-detection" content="telephone=no" />',
      label: 'format-detection',
    },
  ];
}

/**
 * The behaviour-only baseline. Each rule is here because its ABSENCE is a specific, visible tell that
 * the thing on screen is a web page. Nothing here paints.
 */
export const NATIVE_FEEL_CSS = `/* ${NATIVE_FEEL_MARKER}: native-feel baseline from NavBharatAI — behaviour only, no colour.
   Any of this can be overridden by your own CSS with a more specific selector. */
:root {
  /* The notch and the home indicator, as variables the app can use anywhere. They resolve to real
     values ONLY because the viewport carries viewport-fit=cover; without it every one of them is 0. */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
}
html {
  /* Rotating the phone must not resize text (iOS "text autosizing"). */
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body {
  /* The grey/blue flash on every tap is the single most recognisable "this is a website" signal. */
  -webkit-tap-highlight-color: transparent;
  /* Stops the rubber-band that reveals blank space behind the page, and the accidental
     pull-to-refresh that throws away app state mid-task. */
  overscroll-behavior-y: contain;
}
@media (pointer: coarse) {
  /* Removes the ~300 ms double-tap-zoom wait, so a tap registers the instant the finger lifts.
     Scrolling and pinch-zoom are untouched. Only on touch input — a mouse needs none of it. */
  a, button, [role="button"], input, select, textarea, label, summary {
    touch-action: manipulation;
  }
  /* Long-pressing a button should not select its text or raise the text menu. Content keeps its
     selection: this names controls only, never a paragraph. */
  a, button, [role="button"], nav, [role="tablist"], [role="tab"] {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  /* iOS ZOOMS THE WHOLE PAGE when a focused input's font is under 16px, then leaves it zoomed. */
  input, select, textarea {
    font-size: max(16px, 1rem);
  }
  /* A finger has no hover. Without this, a tapped control keeps its hover look afterwards, which
     reads as a stuck button; and a real pressed state is what makes a tap feel answered. */
  a:hover, button:hover, [role="button"]:hover { }
  a:active, button:active, [role="button"]:active {
    transform: scale(0.97);
  }
  /* Momentum scrolling inside the app's own scrollers, not just the document. */
  [class*="scroll"], [class*="overflow"], main, [role="main"] {
    -webkit-overflow-scrolling: touch;
  }
}
/* A LOADING SCREEN HAS A SHAPE. A spinner in an empty rectangle says nothing about what is coming and
   makes the same wait feel longer; a block where the content will be makes it feel shorter, which is why
   every native list does it. NavBharatAI's own client has had this since P-UX.2
   ("src/components/ui/Skeleton.tsx") — a BUILT app had nothing, so the build rule could ask for "the
   shape of what is coming" and hand the model nothing to use with it. Now there is ".nb-skeleton".

   🎨 AND IT STILL CHOOSES NO COLOUR. "currentColor" is the app's OWN text colour, so the placeholder is
   right in light mode, in dark mode, and in a theme this file has never seen; a hex here would have been
   wrong in at least one of them. The app sizes the block; this supplies only the fill-from-your-own-
   colour and the motion.
   WARNING: no backticks anywhere in this block — it lives inside a TS template literal, and one
   backtick ends the string. This file broke on exactly that the first time it was written. */
.nb-skeleton {
  background-color: currentColor;
  opacity: 0.11;
  border-radius: 0.5rem;
  animation: nb-skeleton-pulse 1.6s ease-in-out infinite;
  /* A placeholder is decoration — it must never swallow a tap meant for what loads underneath it. */
  pointer-events: none;
}
@keyframes nb-skeleton-pulse {
  0%, 100% { opacity: 0.11; }
  50% { opacity: 0.2; }
}
@media (prefers-reduced-motion: reduce) {
  .nb-skeleton { animation: none; }
}

/* A press that moves must still feel instant, and must not animate for someone who asked it not to. */
a, button, [role="button"] { transition: transform 90ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  a, button, [role="button"] { transition: none; }
  a:active, button:active, [role="button"]:active { transform: none; }
}`;

/** The one `<link>` the document gains. PURE. */
export function nativeFeelLinkTag(): string {
  return `<link rel="stylesheet" href="${NATIVE_FEEL_HREF}" data-${NATIVE_FEEL_MARKER}="1" />`;
}

/** Is the baseline already linked from this document? Keeps a rebuild from stacking copies. PURE. */
export function hasNativeFeel(html: string): boolean {
  return new RegExp(`data-${NATIVE_FEEL_MARKER}|${NATIVE_FEEL_HREF.replace('/', '\\/')}`).test(String(html ?? ''));
}

/** The stylesheet file itself, for `appDefaults`'s standalone-file set. PURE. */
export function nativeFeelStylesheet(): string {
  return NATIVE_FEEL_CSS + '\n';
}

/**
 * The prompt rule — ONLY the parts that need per-field judgement, so it never repeats what the CSS
 * above already guarantees. Lines, so it drops into the prompt arrays the way the other rules do.
 * Empty when the switch is off. PURE.
 */
export function nativeFeelBuildRule(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!nativeFeelEnabled(env)) return [];
  return [
    '    • 📱 MAKE IT FEEL LIKE AN APP, NOT A WEB PAGE. NavBharatAI already injects the baseline (safe-area',
    '      variables, instant taps, no tap flash, 16px inputs, a pressed state) — do NOT re-declare those.',
    '      What only YOU can do, per element:',
    '      – Give every text input the right keyboard: `inputMode="numeric"` for amounts/PIN/OTP, `"tel"`,',
    '        `"email"`, `"search"`, `"decimal"`; plus `autoComplete`, and `enterKeyHint="search|send|done"`.',
    '        A phone keyboard that arrives wrong is the loudest "this is a website" signal there is.',
    '      – Every tappable thing is at least 44x44px of real touch area (padding counts, font size does not).',
    '      – A fixed header pads with `env(safe-area-inset-top)` / `var(--safe-top)`; a bottom bar or FAB pads',
    '        with `var(--safe-bottom)`. Without it the notch covers your header and the home bar covers your nav.',
    '      – Never a hover-only affordance: anything a mouse reveals on hover must be visible or tappable.',
    '      – Loading shows the SHAPE of what is coming: `<div className="nb-skeleton" style={{height:"1rem"}} />`',
    '        blocks laid out like the real rows or cards, never a spinner alone in an empty screen. The',
    '        class is already defined for you and takes your own text colour, so it is right in any theme.',
    '      – SCROLL LIKE AN APP, and only you know this app\'s router: opening a NEW screen starts at the',
    '        TOP, and going BACK returns the list to the exact position it was at. A screen that opens',
    '        half-way down, or a list that forgets where you were, is the clearest "this is a web page"',
    '        signal left once the rest of this list is handled.',
    '      – Lists scroll; they do not paginate with tiny numbered links.',
  ];
}
