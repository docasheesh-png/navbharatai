/**
 * 🔒 A `var(--…)` IN CLIENT CODE MUST NAME A VARIABLE THAT REALLY EXISTS.
 *
 * 🔴 THE BUG THIS WAS WRITTEN FOR, found 2026-09-20 while migrating inline styles, and LIVE in three
 * shipped components at the time: `style={{ color: 'var(--color-on-accent)' }}`.
 *
 * `--color-on-accent` is declared inside `@theme inline`, and **`@theme inline` emits no custom
 * property at all** — that is what `inline` MEANS: the utility (`text-on-accent`) gets the resolved
 * value baked in, and no `--color-*` variable ever reaches the stylesheet. Verified against the built
 * CSS rather than reasoned about: of `--color-surface`, `--color-ink`, `--color-well`, `--color-scrim`
 * and `--color-on-accent`, the bundle contains **none**, while `--text-muted`, `--surface-well`,
 * `--scrim` and `--accent` — declared in `@layer base` — are all there.
 *
 * So `var(--color-on-accent)` resolved to nothing, `color` fell back to the inherited `--text-body`,
 * and the label on a solid indigo button rendered near-black on Light at about 2.2:1. The utility
 * class worked; the raw var did not. **Nothing failed** — not tsc, not a test, not the ratchet, which
 * counts literals and has no opinion about a var that does not exist.
 *
 * ⚠️ THE CLASS, not the instance: any component may reach for a token name it read in `@theme inline`
 * and get a silent no-op. This test is the only thing that can see it, so it reads SOURCE.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

/** A source with every `@theme …{ … }` block blanked — `inline` emits no property, so those names
 *  are not variables the stylesheet has. Blanked rather than skipped so offsets and the rest survive. */
function withoutThemeBlocks(src: string): string {
  let body = src;
  for (let i = body.indexOf('@theme'); i !== -1; i = body.indexOf('@theme', i + 1)) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    let depth = 0;
    for (let j = open; j < body.length; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') { depth--; if (depth === 0) { body = body.slice(0, i) + ' '.repeat(j + 1 - i) + body.slice(j + 1); break; } }
    }
  }
  return body;
}

/**
 * The three ways this app really declares a custom property, and all three are needed:
 *   a CSS declaration            `--accent: #818cf8;`
 *   a style-object key           `'--nbai-pane': '70%'` or `['--nb-angle' as string]: …`
 *   an imperative set            `el.style.setProperty('--nb-font-scale', …)`
 * A name set imperatively in `a11y.ts` and read in a stylesheet is perfectly legitimate, so a scan
 * that saw only the first form would report half the app as broken and be switched off within a week.
 */
function declarationsIn(src: string): string[] {
  const body = withoutThemeBlocks(src);
  return [
    ...[...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    ...[...body.matchAll(/\[?\s*['"`](--[\w-]+)['"`](?:[^\]\n]*\])?\s*:/g)].map((m) => m[1]),
    ...[...body.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)].map((m) => m[1]),
  ];
}

/** Every client source file — `src/**` minus the server, the same scope the colour ratchet uses. */
function clientFiles(dir = join(ROOT, 'src'), acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (relative(join(ROOT, 'src'), full).startsWith('server')) continue;
      clientFiles(full, acc);
    } else if (/\.(tsx?|css)$/.test(name)) acc.push(full);
  }
  return acc;
}

const FILES = clientFiles();

/**
 * Declared app-wide — every client file, not only the stylesheets.
 *
 * ⚠️ FILE-LOCAL WAS TOO NARROW, and the codebase said so immediately: `--nbai-pane` is written by
 * `splitPane.ts` and read by `AgentV3Panel.tsx`. A variable crossing modules is ordinary and correct.
 * What this guard is for is narrower and sharper: a name that exists NOWHERE — which is exactly what
 * a `--color-*` token is, because `@theme inline` emits no property for it.
 */
function globalVars(): Set<string> {
  const out = new Set<string>();
  for (const f of FILES) for (const v of declarationsIn(readFileSync(f, 'utf8'))) out.add(v);
  return out;
}

describe('every var(--…) a style uses is a variable that exists', () => {
  const declared = globalVars();

  it('🔒 the scan really found the palette — a canary, so a parse that matched nothing cannot pass', () => {
    expect(declared.has('--text-muted')).toBe(true);
    expect(declared.has('--accent')).toBe(true);
    expect(declared.has('--on-accent')).toBe(true);
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('🔒 a `--color-*` name is NOT declared — @theme inline emits nothing, which is the whole bug', () => {
    expect(declared.has('--color-on-accent')).toBe(false);
    expect(declared.has('--color-surface')).toBe(false);
  });

  it('no client file references a variable nothing declares', () => {
    const missing: string[] = [];
    for (const f of FILES) {
      if (/\.test\.tsx?$/.test(f)) continue;                 // a test names a var, it does not render one
      const src = readFileSync(f, 'utf8');
      // A variable the app sets anywhere is legitimate — a split pane's width, a confetti particle's
      // hue, and the CSS these panels generate for the USER'S OWN app (`--brand-primary`,
      // `--bg-secondary`), which is somebody else's stylesheet and never ours to declare.
      for (const m of src.matchAll(/var\((--[\w-]+)\s*(?:,|\))/g)) {
        if (m[0].endsWith(',')) continue;                      // an explicit fallback cannot render as nothing
        if (m[1].startsWith('--tw-')) continue;                // Tailwind's own internals
        if (declared.has(m[1])) continue;
        missing.push(`${relative(ROOT, f)}: ${m[1]}`);
      }
    }
    expect(missing, `undeclared CSS variables:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('🔒 proven by reversion — the check would catch the bug it was written for', () => {
    const declaredNow = globalVars();
    // The exact shape that shipped: a theme name that only ever existed inside `@theme inline`.
    expect(declaredNow.has('--color-on-accent')).toBe(false);
    expect(declaredNow.has('--on-accent')).toBe(true);
  });
});
