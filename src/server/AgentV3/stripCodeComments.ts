// A COMMENTED-OUT IMPORT IS NOT AN IMPORT (autopsy 31dc61fd, 2026-09-20).
//
// 🔴 THE DEFECT THIS EXISTS FOR. `WorkspaceMemory.extractFacts` ran its import, symbol, route and
// reference regexes over RAW source, so anything that merely LOOKED like code — a commented-out
// import, a usage example in a docblock, a block-commented experiment — entered the project graph as
// a real fact. That graph is not a side channel: `analyzeArchitecture` reads it for
// `unresolvedImports` (which the release gate counts as a HARD BLOCKER) and
// `collectDependencyIssues` reads it for "missing dependency".
//
// ⚠️ AND IT FIRED ON EVERY SINGLE vite-react BUILD, because the trigger is OUR OWN SCAFFOLD.
// `ViteReactProviderContents.ts` writes this line into every generated `vite.config.ts`:
//
//     // `import { useStore } from 'stores/useStore'` resolves at BUILD & RUNTIME too — not just in
//
// Measured, not reasoned about: that line yields the specifier `stores/useStore`, whose package root
// is `stores`, which is in no package.json — so `evaluate` reported "1 missing dependency(ies)" and
// dropped build confidence to "35% (Low)" on an app that was complete and rendering. In the report
// that found this, the architect and then the reviewer between them spent three greps, a shell grep
// and a repeated `evaluate` proving it was a phantom, and the reviewer's own conclusion was filed as
// a finding: *"`stores` dependency warning is a false positive."*
//
// 🔑 THE RULE ALREADY EXISTED IN THIS REPO — TWICE — AND NOT WHERE IT MATTERED MOST.
// `SpaFallbackAnalysis` and `ProjectIntegrityChecks` each carry a private `stripComments`, and the
// second one's doc comment states this exact rule: *"so a commented-out `.focus()` / import never
// counts."* They have already drifted (one substitutes a space, the other nothing). This module is
// the one implementation; the fact that the rule was written twice and still missing from the
// graph builder is the class, not the instance.
//
// 🔒 IT IS NEVER APPLIED TO SECURITY SCANNING. A key pasted into a comment is a leaked key, so
// `scanSecurity` keeps the raw source deliberately — see the call site in `WorkspaceMemory`.

/** Blank a run of text, keeping its newlines and its exact length. */
function blank(run: string): string {
  return run.replace(/[^\n]/g, ' ');
}

/**
 * Remove line and block comments from JS/TS source, PRESERVING length and line structure.
 *
 * ⚠️ LENGTH-PRESERVING ON PURPOSE, and it is not decoration. Deleting a comment outright can JOIN
 * the tokens either side of it (`foo/*c*​/.bar()` → `foo.bar()`), inventing code that was never
 * written — the same class of false fact this module exists to remove. Blanking cannot.
 *
 * ⚠️ THE `[^:]` GUARD IS WHAT KEEPS A URL A URL. Without it, `from 'https://esm.sh/react'` loses
 * everything from `//` onwards and a REAL import disappears — turning a false-positive bug into a
 * false-negative one, which is strictly worse. Both existing copies in this repo carry the same
 * guard; it is kept rather than re-invented.
 *
 * Best-effort by design: it is a lexer's job to know that `//` inside a string literal is not a
 * comment, and this is a regex. The error it can still make is to strip a `//` that sits inside a
 * string — which can only ever DELETE a candidate fact, never invent one, so it fails in the
 * direction that costs nothing here.
 *
 * Pure.
 */
export function stripCodeComments(source: string): string {
  const src = typeof source === 'string' ? source : '';
  if (!src) return '';
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix: string) => prefix + blank(match.slice(prefix.length)));
}

/**
 * Blank every comment a MARKUP scanner could mistake for markup, keeping length and lines (autopsy
 * 4541f1cf, 2026-09-30).
 *
 * 🔴 THE DEFECT. The accessibility and design linters read the words INSIDE comments as tags. Two
 * comments in our own templates were enough to put a false finding on every one of the 40 golden
 * scaffolds: `// data-theme on <html> pins the app…` in `src/theme.tsx` was read as an `<html>` with no
 * `lang`, and `/* The picture: a real <img>… *​/` in the design kit's CSS was read as an image with no
 * `alt` — which cost every app built after it 8 points of its accessibility score. A comment is never
 * shipped to a screen reader; no rule about the screen may read one.
 *
 * Differs from `stripCodeComments` in two places, both because markup is the input here:
 *   • `<!-- … -->` is blanked too (an HTML comment hides tags as surely as a JS one).
 *   • A `//` counts as a line comment only after a line start, whitespace or `;{}` — never after a
 *     quote, a `(` or a `:`. So `src="//cdn…"`, `url(//…)` and `https://…` stay intact: stripping the
 *     rest of THAT line would delete real tags, and an unseen `<img>` is a missed finding.
 *
 * Pure. Idempotent. Never applied to security scanning (a key in a comment is still a leaked key).
 */
export function stripCommentsForMarkup(source: string): string {
  const src = typeof source === 'string' ? source : '';
  if (!src) return '';
  return src
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s;{}])\/\/[^\n]*/gm, (match, prefix: string) => prefix + blank(match.slice(prefix.length)));
}
