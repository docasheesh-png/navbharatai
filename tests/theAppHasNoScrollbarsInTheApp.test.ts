import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 A NATIVE APP DOES NOT PAINT A SCROLL TRACK (admin 2026-09-19, phone screenshot:
 * "right side me blue vertical light … yeh website ka feel deti hai. isko mobile app me se hata do").
 *
 * Android and iOS both draw a TRANSIENT scroll indicator that fades when the finger lifts. A bar that
 * sits there while you read belongs to a browser, and it was the loudest web tell left in the shell.
 *
 * Two things are locked here, because the second is what made the first hard to see.
 *
 * 1. THE HIDE IS REAL AND IT IS GATED. `html.nb-native-shell` is added to <html> by index.html's
 *    pre-paint script only when `window.Capacitor` exists, so the WEBSITE keeps its scrollbar — a
 *    desktop visitor has a pointer and genuinely needs a bar to drag. A global hide would take it from
 *    them, which is why this asserts the gate as hard as it asserts the hide.
 *
 * 2. THE RULE MUST BE UNLAYERED, AND CARRY `html`. Both are cascade facts, not style:
 *      • `@layer base` loses to any unlayered rule, and `.custom-scrollbar` is declared in that layer;
 *      • `.nb-native-shell *` and `.custom-scrollbar` are both (0,1,0), so an unlayered `<style>` block
 *        rendered into the body would beat it on source order alone.
 *    `html.nb-native-shell` is (0,1,1) and unlayered, so it wins by construction rather than by luck —
 *    and luck is exactly what a future inline <style> would re-roll.
 *
 * 🔎 AND THE DUPLICATE THAT HID THE CAUSE. `.custom-scrollbar` was defined twice: in index.css inside
 * `@layer base` (indigo, via the standard `scrollbar-color`) and again in an unlayered <style> inside
 * App.tsx (white, via `::-webkit-scrollbar-thumb`). The App.tsx copy read like the winner and was DEAD:
 * since Chromium 121 a non-auto `scrollbar-color`/`scrollbar-width` makes the engine ignore every
 * `::-webkit-scrollbar` pseudo-element on that box. The screenshot is indigo, not grey — mechanism and
 * observation agree. One scrollbar, one definition, enforced below.
 */

const root = process.cwd();
const cssPath = join(root, 'src/index.css');

/** CSS with comments removed — a rule must never be "found" inside prose that explains it. */
function cssWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Byte ranges of every `@layer <name> { … }` block, by brace matching on comment-free CSS. */
function layerRanges(css: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const opener = /@layer\s+[\w\s,-]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

function isInsideALayer(css: string, offset: number): boolean {
  return layerRanges(css).some(([from, to]) => offset > from && offset < to);
}

/** Every client-side source file (the website + the app shell; the server renders no CSS). */
function clientSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'server' && dir.endsWith('src')) continue; // src/server is not shipped to a browser
        walk(full);
        continue;
      }
      if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(root, 'src'));
  return out;
}

describe('the app hides every scrollbar, and the website keeps its own', () => {
  const css = cssWithoutComments(readFileSync(cssPath, 'utf8'));

  it('index.css hides the scrollbar for the native shell, on both mechanisms', () => {
    const standard = /html\.nb-native-shell[^{]*\{[^}]*scrollbar-width:\s*none/;
    const webkit = /html\.nb-native-shell[^{]*::-webkit-scrollbar[^{]*\{[^}]*display:\s*none/;

    expect(standard.test(css), 'the standard properties are what Chromium 121+ actually reads').toBe(true);
    expect(webkit.test(css), 'the pseudo-element is what older engines read').toBe(true);
  });

  it('the hide is UNLAYERED, so it beats `.custom-scrollbar` in @layer base', () => {
    const at = css.search(/html\.nb-native-shell[^{]*\{[^}]*scrollbar-width:\s*none/);
    expect(at, 'the rule must exist before its layer can be judged').toBeGreaterThan(-1);
    expect(
      isInsideALayer(css, at),
      'inside @layer base this rule would LOSE to every unlayered rule, including the one it replaces',
    ).toBe(false);
  });

  it('the hide carries `html`, so it cannot be out-specified by an inline <style>', () => {
    // `.nb-native-shell *` alone is (0,1,0) — a tie with `.custom-scrollbar`, decided by source order.
    const bare = /(^|[^l])\.nb-native-shell\s*\*?[^{]*\{[^}]*scrollbar-width:\s*none/m;
    expect(bare.test(css), 'an unqualified .nb-native-shell hide would win only by source order').toBe(false);
  });

  it('it is GATED — the website is never stripped of its scrollbar', () => {
    // Any rule that hides a scrollbar must name the native-shell class. `.no-scrollbar` and the
    // textarea rule are opt-in by a class the author chose, which is a different thing from a global.
    const hides = [...css.matchAll(/([^{}]+)\{[^}]*(?:scrollbar-width:\s*none|display:\s*none)[^}]*\}/g)]
      .map((m) => m[1].trim())
      .filter((sel) => sel.includes('scrollbar') || sel.includes('nb-native-shell'));
    for (const sel of hides) {
      const gated = sel.includes('nb-native-shell') || sel.includes('.no-scrollbar') || sel.includes('textarea');
      expect(gated, `"${sel}" hides a scrollbar for everyone, website visitors included`).toBe(true);
    }
  });

  it('keeps the box scrollable — it hides the bar, it does not stop the scroll', () => {
    const block = css.match(/html\.nb-native-shell[^{]*::-webkit-scrollbar[^{]*\{([^}]*)\}/);
    expect(block, 'the webkit hide must exist').toBeTruthy();
    expect(block![1]).not.toMatch(/overflow/);
    // `display:none` on the pseudo-element is the technique `.no-scrollbar` has used here for months:
    // the bar is gone, the box still scrolls. `visibility` would leave the track's width behind.
    expect(block![1]).toMatch(/display:\s*none/);
  });
});

describe('one scrollbar, one definition', () => {
  it('`.custom-scrollbar` is declared in exactly one file', () => {
    const definers = clientSources().filter((file) =>
      /\.custom-scrollbar(::|\s*\{)/.test(cssWithoutComments(readFileSync(file, 'utf8'))),
    );
    expect(
      definers.map((f) => f.replace(root + '/', '')),
      'a second copy is how a rule goes dead without anything failing',
    ).toEqual(['src/index.css']);
  });

  it('`.no-scrollbar` is declared in exactly one file', () => {
    const definers = clientSources().filter((file) =>
      /\.no-scrollbar(::|\s*\{)/.test(cssWithoutComments(readFileSync(file, 'utf8'))),
    );
    expect(definers.map((f) => f.replace(root + '/', ''))).toEqual(['src/index.css']);
  });
});
