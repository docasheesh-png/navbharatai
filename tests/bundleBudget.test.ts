import { describe, it, expect } from 'vitest';
import { checkBudget, BUDGETS, LAST_MEASURED, isBudgetExcludedJs, firstPaintJsFiles } from '../scripts/bundleBudget.mjs';

describe('bundle-budget (P-TQA.5)', () => {
  it('passes when every measure is within budget', () => {
    // Fed with what `main` LAST MEASURED rather than a hardcoded triple: this is the case CI runs on
    // every push, so if it ever fails, the build genuinely is over budget.
    const r = checkBudget({ ...LAST_MEASURED, largestChunkName: 'index.js' });
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('fails when the largest chunk exceeds budget', () => {
    const r = checkBudget({
      largestChunkGzipKB: BUDGETS.largestChunkGzipKB + 1, largestChunkName: 'index.js',
      totalJsGzipKB: 100, totalCssGzipKB: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/Largest JS chunk/);
    expect(r.violations.join(' ')).toContain('index.js');
  });

  it('fails when total JS exceeds budget', () => {
    const r = checkBudget({ largestChunkGzipKB: 10, totalJsGzipKB: BUDGETS.totalJsGzipKB + 50, totalCssGzipKB: 10 });
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/Total JS/);
  });

  it('fails when total CSS exceeds budget', () => {
    const r = checkBudget({ largestChunkGzipKB: 10, totalJsGzipKB: 100, totalCssGzipKB: BUDGETS.totalCssGzipKB + 5 });
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/Total CSS/);
  });

  it('reports MULTIPLE violations at once — one run tells you everything that is over', () => {
    // A gate that stopped at the first violation would make fixing a bloated build a guessing game of
    // one CI round per number. Count updated 3 -> 4 when first-paint JS was added as its own budget
    // (2026-09-10); the guarantee being asserted is unchanged.
    const r = checkBudget({
      largestChunkGzipKB: 9999, firstPaintJsGzipKB: 9999, totalJsGzipKB: 9999, totalCssGzipKB: 9999,
      largestChunkName: 'x.js',
    });
    expect(r.violations).toHaveLength(4);
    // Named individually, so the assertion says WHICH four rather than merely how many.
    const all = r.violations.join(' | ');
    for (const expected of [/First-paint JS/, /Largest JS chunk/, /Total JS/, /Total CSS/]) {
      expect(all).toMatch(expected);
    }
  });

  it('budgets are realistic (above the current measured sizes, so CI passes today)', () => {
    // Compared against LAST_MEASURED, not against numbers copied into this file. The old copies
    // (567 / 918 / 33) had gone stale, so this test was asserting against a build that no longer
    // existed — and it broke the moment the largest-chunk ceiling was tightened for a real win.
    for (const k of ['largestChunkGzipKB', 'firstPaintJsGzipKB', 'totalJsGzipKB', 'totalCssGzipKB'] as const) {
      expect(BUDGETS[k]).toBeGreaterThan(LAST_MEASURED[k]);
    }
  });

  it('budgets stay CLOSE to the measurement — a ceiling with no floor is not a gate', () => {
    // The failure this guards is the one the script's own header warns about: raising a ceiling to
    // admit a regression. A budget more than ~60% above what `main` measures has stopped saying
    // "no unchecked growth" and started saying "anything goes".
    for (const k of ['largestChunkGzipKB', 'firstPaintJsGzipKB', 'totalJsGzipKB', 'totalCssGzipKB'] as const) {
      expect(BUDGETS[k]).toBeLessThan(LAST_MEASURED[k] * 1.6);
    }
  });

  it('excludes lazy opt-in chunks (web-llm) from the budget, but nothing else', () => {
    // The on-device LLM chunk is fetched only when the Offline-Thinking beta is enabled, so it must not
    // count against the main-app budget.
    expect(isBudgetExcludedJs('webllm-DT0Ab8E6.js')).toBe(true);
    // Everything that IS part of the main app load stays budgeted.
    expect(isBudgetExcludedJs('index-abc123.js')).toBe(false);
    expect(isBudgetExcludedJs('OfflineAI-xyz.js')).toBe(false);
    expect(isBudgetExcludedJs('CodeStudio-abc.js')).toBe(false);
  });
});

/**
 * 🔒 THE FIRST-PAINT GUARD MUST MEASURE FIRST PAINT (found 2026-09-10).
 *
 * `largestChunkGzipKB` was reasoned about throughout bundleBudget.mjs as "the entry EVERY user
 * downloads". That was true on 2026-08-24, when the entry WAS the largest chunk. By 2026-09-10 the
 * largest chunk was OfflineAI-*.js — a LAZY chunk first paint never fetches — while the real
 * first-paint cost (entry + both modulepreloads) was 495.8 KB, roughly double the 250.3 the gate
 * reported, with firebase-vendor's 188.9 KB guarded by nothing tighter than the 1720 KB total.
 *
 * The failure mode was silent and in the future: let any lazy chunk drift to ~390 KB and it becomes
 * "the largest", after which the entry could double with this gate reporting success throughout.
 */
describe('first-paint JS — what every visitor downloads before anything renders', () => {
  const HTML = `<!doctype html><html><head>
    <link rel="icon" href="/logo.png" />
    <script type="module" crossorigin src="/assets/index-D5BCSeIt.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-vendor-DMcK27rl.js">
    <link rel="modulepreload" crossorigin href="/assets/firebase-vendor-BFblkh6P.js">
    <link rel="stylesheet" crossorigin href="/assets/index-DJBpZj52.css">
  </head><body></body></html>`;

  it('reads the ENTRY and every modulepreload out of the emitted HTML', () => {
    expect(firstPaintJsFiles(HTML)).toEqual([
      'index-D5BCSeIt.js', 'react-vendor-DMcK27rl.js', 'firebase-vendor-BFblkh6P.js',
    ]);
  });

  it('ignores CSS, icons and anything that is not a preloaded module', () => {
    const files = firstPaintJsFiles(HTML);
    expect(files.some((f) => f.endsWith('.css'))).toBe(false);
    expect(files.some((f) => f.includes('logo'))).toBe(false);
  });

  it('🔒 a lazily-imported route contributes NOTHING — that is the whole point of the metric', () => {
    // Vite emits no preload link for a dynamic import, so a `lazy()` route cannot appear here. If it
    // ever did, splitting a route would stop reducing the number it exists to reduce.
    expect(firstPaintJsFiles(HTML)).not.toContain('OfflineAI-CPsdJdsN.js');
  });

  it('is empty for HTML with no module script, so the caller can refuse to guess', () => {
    expect(firstPaintJsFiles('<!doctype html><html><body>nothing</body></html>')).toEqual([]);
    expect(firstPaintJsFiles('')).toEqual([]);
    expect(firstPaintJsFiles(null as unknown as string)).toEqual([]);
  });

  it('fails the budget when first paint is over, and names the files', () => {
    const r = checkBudget({
      ...LAST_MEASURED, largestChunkName: 'index.js',
      firstPaintJsGzipKB: BUDGETS.firstPaintJsGzipKB + 1,
      firstPaintFiles: ['index-abc.js', 'firebase-vendor-def.js'],
    });
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toMatch(/First-paint JS/);
    expect(r.violations.join(' ')).toContain('firebase-vendor-def.js');
  });

  it('🔒 an UNMEASURABLE first paint is a violation, never a pass', () => {
    // The dangerous direction: a caller that omits the field would otherwise sail through the one
    // gate that matters most, and report green while nobody knows what the app costs to load.
    for (const bad of [undefined, null, NaN, 'lots']) {
      const r = checkBudget({ ...LAST_MEASURED, largestChunkName: 'index.js', firstPaintJsGzipKB: bad as never });
      expect(r.ok, String(bad)).toBe(false);
      expect(r.violations.join(' ')).toMatch(/could not be measured/);
    }
  });

  it('is reported FIRST, because it is the line a person should read first', () => {
    const r = checkBudget({
      ...LAST_MEASURED, largestChunkName: 'index.js',
      firstPaintJsGzipKB: BUDGETS.firstPaintJsGzipKB + 1,
      totalJsGzipKB: BUDGETS.totalJsGzipKB + 1,
    });
    expect(r.violations[0]).toMatch(/First-paint JS/);
  });
});
