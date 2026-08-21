import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// ADMIN REPORT 2026-08-21, with a photo of a tablet: the installed app rendered as raw HTML — stacked
// logos, default fonts, a white page, and the "Skip to main content" link (which is supposed to be
// invisible) sitting at the top of the screen.
//
// That last detail IS the diagnosis. `.sr-only` is a Tailwind utility, and Tailwind v4 emits every
// utility inside `@layer utilities`. A browser that does not understand `@layer` does not skip the
// at-rule and carry on — per the CSS spec it discards the entire block. So on an engine older than
// Chrome 111 (Tailwind v4's stated floor), every utility class in the app vanishes at once.
//
// WHY A TEST AND NOT JUST A FIX: deleting postcss.config.js leaves `npm run build` green and the site
// pixel-identical on any machine a developer owns. The breakage is invisible from here and lands only
// on people with older phones and cheaper tablets — the users this product exists to reach. Nothing
// but a test can hold that.

const root = process.cwd();
const config = readFileSync(join(root, 'postcss.config.js'), 'utf8');

describe('the CSS build must keep working on older browser engines', () => {
  it('flattens cascade layers — without this, an old engine has NO styles at all', () => {
    expect(config).toContain('@csstools/postcss-cascade-layers');
  });

  it('gives oklch() and color-mix() a fallback the old engine understands', () => {
    expect(config).toContain('@csstools/postcss-oklab-function');
    expect(config).toContain('@csstools/postcss-color-mix-function');
  });

  it('carries the fallbacks into CUSTOM PROPERTIES, where Tailwind v4 keeps its palette', () => {
    // Easy to leave out and then wonder why colours are still wrong: a custom property accepts any
    // tokens, so `--color-emerald-600: oklch(...)` "works" until it is USED, and only then does the
    // old engine throw the declaration away and the element lose its colour.
    expect(config).toContain('@csstools/postcss-progressive-custom-properties');
  });

  it('KEEPS the modern values — this is a fallback, not a downgrade', () => {
    // `preserve: true` is what leaves the modern colour in place after the fallback, so a current
    // browser still renders exactly what it rendered before.
    expect(config).toMatch(/preserve:\s*true/);
  });

  it('every plugin it names is a real, installed dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of [
      '@csstools/postcss-cascade-layers',
      '@csstools/postcss-oklab-function',
      '@csstools/postcss-color-mix-function',
      '@csstools/postcss-progressive-custom-properties',
    ]) {
      expect(deps[name], `${name} is used by postcss.config.js but not declared`).toBeTruthy();
    }
  });
});

// When a build is present (CI runs one), check the OUTPUT rather than the intent. A config that is
// present but silently not applied would pass every assertion above.
const assets = join(root, 'dist', 'assets');
const builtCss = existsSync(assets)
  ? readdirSync(assets).filter((f) => f.startsWith('index-') && f.endsWith('.css')).map((f) => join(assets, f))
  : [];

// A BUILD THAT EXISTS IS NOT A BUILD THAT IS CURRENT (admin 2026-08-21).
//
// The guard used to be `builtCss.length > 0` — "there is a stylesheet, so check it". But a working
// tree can easily hold a dist/ built BEFORE postcss.config.js gained these plugins, and then this
// suite reads an artifact that predates the very fix it is testing and reports two failures that look
// exactly like "the app is broken". That cost a real debugging detour, and the misdiagnosis was the
// expensive part: the assertions were right, the code was right, and only the input was stale.
//
// So freshness is checked, not assumed: a stylesheet older than the config cannot be evidence about
// that config. mtime is the honest signal here — CI clones and then builds, so its CSS is always
// newer; a developer who edits or pulls the config without rebuilding gets the skip they deserve.
//
// (This is the same mistake as treating a stale preview URL as a live preview — "the artifact exists"
// standing in for "the artifact is valid". Naming it here so the pattern is recognised next time.)
const configMtimeMs = statSync(join(root, 'postcss.config.js')).mtimeMs;
const freshCss = builtCss.filter((f) => statSync(f).mtimeMs >= configMtimeMs);
const staleBuild = builtCss.length > 0 && freshCss.length === 0;

// A SILENT skip is how a check quietly stops covering anything, so the skip states itself. This is the
// suite-level version of the rule the build gates already follow: "could not run" is its own outcome,
// and it must be visible — never dressed up as a pass, never as a failure.
describe.runIf(staleBuild)('the built stylesheet — NOT CHECKED this run', () => {
  it('dist/ predates postcss.config.js, so it cannot answer for it — run `npm run build` to check the real output', () => {
    expect(staleBuild).toBe(true);
  });
});

describe.runIf(freshCss.length > 0)('the built stylesheet itself', () => {
  const css = freshCss.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('contains no @layer at all — the one thing that took the whole app down', () => {
    expect(css).not.toContain('@layer');
  });

  it('still ships the modern colours for browsers that support them', () => {
    expect(css).toContain('oklch(');
    expect(css).toContain('@supports');
  });

  it('declares the palette in a form an old engine can actually use', () => {
    // The fallback must come as a plain rgb()/hex value OUTSIDE the @supports guard.
    expect(css).toMatch(/--color-[a-z]+-\d+:\s*rgb\(/);
  });
});
