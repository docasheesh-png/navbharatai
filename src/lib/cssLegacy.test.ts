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
// vite.config.ts counts too: it states the browser floor the CSS minifier and the JS transform aim
// at (see "the browser floor" below), so a build older than EITHER file cannot answer for it.
const configMtimeMs = Math.max(
  statSync(join(root, 'postcss.config.js')).mtimeMs,
  statSync(join(root, 'vite.config.ts')).mtimeMs,
);
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
    // The fallback must come as a plain rgb()/hex value OUTSIDE the @supports guard. Which of the two
    // is the minifier's choice (esbuild kept rgb(), Lightning CSS writes hex) — both are understood by
    // every engine, so the assertion names the property, not one spelling of it.
    expect(css).toMatch(/--color-[a-z]+-\d+:\s*(?:rgb\(|#[0-9a-f]{3,8}\b)/i);
  });

  it('never leaves a modern colour without a fallback an old engine can fall back to', () => {
    // THE VITE 8 INCIDENT (2026-09-28). postcss.config.js emits `border-color:#2496ed33` before each
    // `border-color:color-mix(...)`; the new minifier, aiming at a newer default floor, folded the pair
    // into ONE `border-color:oklab(.../.2)`. The declaration an old engine could read was gone, and
    // nothing above noticed — oklch() was still present, @supports was still present. So this reads
    // every declaration outside an @supports guard and asks the only question that matters to an old
    // engine: if it throws this value away, is there an earlier one in the same rule to keep?
    expect(unguardedModernColours(css).slice(0, 5)).toEqual([]);
  });

  it('writes breakpoints in the media-query syntax an old engine can parse', () => {
    // `@media (width>=64rem)` is Media Queries 4 range syntax — Chrome 104, Safari 16.4. An engine
    // older than that does not match the query, so every responsive layout silently falls back to
    // the phone layout. `(min-width:64rem)` means the same thing and works everywhere.
    expect(css).not.toMatch(/@media[^{]*\(\s*(?:width|height)\s*[<>]=?/);
  });
});

// THE BROWSER FLOOR (2026-09-28). The fallbacks above are only half of it: the bundler also decides,
// from its target, which syntax it is allowed to leave in the output — and that default moved under us
// in the Vite 6 -> 8 upgrade (Chrome 87 -> ~107) without one line of ours changing. So the floor is
// stated in vite.config.ts, and the OUTPUT is checked against it.
describe('the browser floor is stated, not inherited from a bundler default', () => {
  const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');

  it('vite.config.ts pins both the JS target and the CSS target', () => {
    expect(viteConfig).toMatch(/\btarget:\s*\[[^\]]*'chrome87'/);
    expect(viteConfig).toMatch(/\bcssTarget:\s*\[[^\]]*'chrome87'/);
  });

  const builtJs = existsSync(assets)
    ? readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => join(assets, f))
        .filter((f) => statSync(f).mtimeMs >= configMtimeMs)
    : [];

  it.runIf(builtJs.length > 0)('the built JS carries no syntax newer than that floor', () => {
    // Logical assignment (`??=`, `||=`, `&&=`) is ES2021 — Chrome 85, but the transform only lowers
    // it when the target says so. Under Vite 8's default target 150+ of them reached the bundle; one
    // unparseable token and an old engine runs none of the app's JavaScript at all.
    const js = builtJs.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const op of ['??=', '||=', '&&=']) expect(js.includes(op), `${op} in the built JS`).toBe(false);
  });
});

/**
 * Every declaration OUTSIDE an @supports guard whose value an old engine cannot parse (oklch/oklab/
 * lab/lch/color-mix) and that has no earlier declaration of the same property in the same rule to fall
 * back to. A small character scanner rather than a regex, because the answer depends on nesting.
 */
function unguardedModernColours(css: string): string[] {
  const modern = /\b(?:oklch|oklab|lab|lch|color-mix)\(/i;
  const bad: string[] = [];
  const frames: { prelude: string; decls: string[] }[] = [{ prelude: '', decls: [] }];
  let buf = '';
  let paren = 0;
  let quote = '';
  const flushDecl = () => {
    const d = buf.trim();
    if (d) frames[frames.length - 1].decls.push(d);
    buf = '';
  };
  const judge = (frame: { prelude: string; decls: string[] }) => {
    if (frames.some((f) => f.prelude.startsWith('@supports')) || frame.prelude.startsWith('@supports')) return;
    const seen = new Map<string, boolean>(); // property -> has a plain (fallback) value been declared
    for (const d of frame.decls) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      const value = d.slice(i + 1);
      if (modern.test(value)) {
        if (!seen.get(prop)) bad.push(`${frame.prelude.slice(0, 80)} { ${d.slice(0, 80)} }`);
      } else {
        seen.set(prop, true);
      }
    }
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      buf += c;
      if (c === '\\') buf += css[++i] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '\\') { buf += c + (css[++i] ?? ''); continue; }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '(') paren++;
    if (c === ')') paren = Math.max(0, paren - 1);
    if (paren > 0) { buf += c; continue; }
    if (c === '{') { frames.push({ prelude: buf.trim(), decls: [] }); buf = ''; continue; }
    if (c === ';') { flushDecl(); continue; }
    if (c === '}') {
      flushDecl();
      const frame = frames.pop();
      if (frame && frames.length > 0) judge(frame);
      if (frames.length === 0) frames.push({ prelude: '', decls: [] });
      continue;
    }
    if (c === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 1; continue; }
    buf += c;
  }
  return bad;
}
