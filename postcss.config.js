// Make the app's CSS work on the browsers our users actually have.
//
// ADMIN REPORT 2026-08-21, with a photo: on a tablet the installed app rendered as raw HTML — stacked
// logos, default fonts, a white page, and the "Skip to main content" accessibility link (which is
// supposed to be invisible) sitting at the top of the screen. That last detail is the whole diagnosis:
// `.sr-only` is a Tailwind utility, and it lives inside `@layer utilities`.
//
// WHAT ACTUALLY HAPPENED. Tailwind v4 landed here on 2026-08-12, and v4's output requires a modern
// engine — it officially targets Chrome 111+ / Safari 16.4+. Our built stylesheet carries
// `@layer` (4 blocks), `oklch()` (187 uses) and `color-mix()` (1,727 uses). A browser that does not
// understand `@layer` does not skip the at-rule and keep going: by the CSS spec it discards the whole
// block. Every utility class in the app disappears at once. That tablet's Android System WebView is
// older than 111, so the app it downloaded from the Play Store had no styling at all — while the same
// build looked perfect on every modern phone we tested on.
//
// THIS IS NOT A TABLET BUG AND NOT AN APP BUG. The same stylesheet serves navbharatai.com, so any
// older browser — an old Android phone, a school computer, a cheap tablet — has been getting the same
// broken page since 2026-08-12. We simply had not seen one until now. For an app whose whole purpose
// is to reach the next hundred million users of Bharat, "works only on a recent phone" is not a
// trade-off we get to make quietly.
//
// THE FIX IS PROGRESSIVE ENHANCEMENT, NOT A DOWNGRADE. Each plugin below ADDS a fallback the old
// engine understands and LEAVES the modern value in place after it, so a modern browser still picks
// the modern one — nothing about the design changes for anyone who was already fine.
//
//   1. cascade-layers — rewrites `@layer` into plain rules that keep the same cascade order. This is
//      the one that matters: without it, an old engine has no styles at all.
//   2. oklab-function  — emits an rgb() fallback before each oklch() colour.
//   3. color-mix       — emits a computed fallback before each color-mix().
//   4. progressive-custom-properties — the one that is easy to leave out and then wonder why colours
//      are still wrong. Tailwind v4 puts its whole palette in CUSTOM PROPERTIES
//      (`--color-emerald-600: oklch(...)`), and a custom property accepts ANY tokens, so nothing
//      "fails" until the value is USED — at which point the old engine throws the declaration away and
//      the element loses its colour. This plugin re-declares the fallback outside an `@supports` and
//      the modern value inside one, which is the only correct way to give a custom property two
//      values. Verified by counting `@supports (color: oklch(...))` blocks in the built CSS, not by
//      trusting that adding a plugin did something.
//
// ⚠️ DO NOT "SIMPLIFY" THIS FILE AWAY. Deleting it does not produce a visibly broken build on a modern
// machine — `npm run build` stays green and the site looks identical in a current browser. The damage
// is invisible from here and lands only on the users least able to work around it. `cssLegacy.test.ts`
// exists so that removal fails CI instead of failing a user.

export default {
  plugins: {
    '@csstools/postcss-oklab-function': { preserve: true, subFeatures: { displayP3: false } },
    '@csstools/postcss-color-mix-function': { preserve: true },
    '@csstools/postcss-progressive-custom-properties': {},
    '@csstools/postcss-cascade-layers': {},
  },
};
