// P-TQA.5 — Frontend bundle-size budget enforcement.
//
// Runs in CI AFTER `vite build` (`npm run test:bundle`). Reads dist/assets, computes the
// GZIPPED size of every JS/CSS chunk, and fails (exit 1) if any budget is exceeded — so a
// new dependency can't silently bloat the bundle without someone deciding to raise the
// ceiling. The pure `checkBudget()` is unit-tested in tests/bundleBudget.test.ts.
//
// Budgets reflect CURRENT reality + ~15% headroom (an honest "no further bloat" guard, not
// an aspirational target that would fail today). NOTE: the main entry chunk is large
// (~567 KB gz) — splitting it via manualChunks is a known, separate optimisation; this
// budget stops it from growing unchecked in the meantime.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const BUDGETS = {
  /** Largest single JS chunk, gzipped. Current main ≈ 567 KB. */
  largestChunkGzipKB: 650,
  /** Sum of all JS chunks, gzipped. Current ≈ 1051 KB (2026-07-20: legitimate feature growth —
   *  app-wide TirangaLoader + the day's merged feature batch tipped the old 1050 ceiling by 0.7 KB).
   *  Deliberate ratchet raise, kept tight so the gate still bites; a real reduction lives on the
   *  roadmap as main-chunk code-splitting (index chunk is ~591 KB gzipped). */
  totalJsGzipKB: 1080,
  /** Sum of all CSS, gzipped. Current ≈ 33 KB. */
  totalCssGzipKB: 50,
};

/**
 * Pure budget check. `measured` = { largestChunkGzipKB, largestChunkName, totalJsGzipKB,
 * totalCssGzipKB }. Returns { ok, violations[] }. No I/O — unit-tested directly.
 */
export function checkBudget(measured, budgets = BUDGETS) {
  const violations = [];
  if (measured.largestChunkGzipKB > budgets.largestChunkGzipKB) {
    violations.push(
      `Largest JS chunk ${measured.largestChunkName || ''} is ${measured.largestChunkGzipKB.toFixed(1)} KB gzipped ` +
      `> budget ${budgets.largestChunkGzipKB} KB`,
    );
  }
  if (measured.totalJsGzipKB > budgets.totalJsGzipKB) {
    violations.push(`Total JS is ${measured.totalJsGzipKB.toFixed(1)} KB gzipped > budget ${budgets.totalJsGzipKB} KB`);
  }
  if (measured.totalCssGzipKB > budgets.totalCssGzipKB) {
    violations.push(`Total CSS is ${measured.totalCssGzipKB.toFixed(1)} KB gzipped > budget ${budgets.totalCssGzipKB} KB`);
  }
  return { ok: violations.length === 0, violations };
}

/** Measure the gzipped sizes of the built bundle. Returns the `measured` shape above. */
export function measureDist(distDir = 'dist') {
  const assetsDir = join(distDir, 'assets');
  if (!existsSync(assetsDir)) {
    throw new Error(`No build found at ${assetsDir} — run \`vite build\` first.`);
  }
  let totalJs = 0;
  let totalCss = 0;
  let largestChunkGzip = 0;
  let largestChunkName = '';
  for (const file of readdirSync(assetsDir)) {
    const gz = gzipSync(readFileSync(join(assetsDir, file))).length;
    if (file.endsWith('.js')) {
      totalJs += gz;
      if (gz > largestChunkGzip) { largestChunkGzip = gz; largestChunkName = file; }
    } else if (file.endsWith('.css')) {
      totalCss += gz;
    }
  }
  const KB = 1024;
  return {
    largestChunkGzipKB: largestChunkGzip / KB,
    largestChunkName,
    totalJsGzipKB: totalJs / KB,
    totalCssGzipKB: totalCss / KB,
  };
}

// Run as a CLI: measure dist/, check budgets, report, exit non-zero on violation.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const measured = measureDist('dist');
    const { ok, violations } = checkBudget(measured);
    console.log('Bundle size (gzipped):');
    console.log(`  largest chunk : ${measured.largestChunkGzipKB.toFixed(1)} KB  (${measured.largestChunkName})  [budget ${BUDGETS.largestChunkGzipKB} KB]`);
    console.log(`  total JS      : ${measured.totalJsGzipKB.toFixed(1)} KB  [budget ${BUDGETS.totalJsGzipKB} KB]`);
    console.log(`  total CSS     : ${measured.totalCssGzipKB.toFixed(1)} KB  [budget ${BUDGETS.totalCssGzipKB} KB]`);
    if (!ok) {
      console.error('\n❌ Bundle budget exceeded:');
      for (const v of violations) console.error('   • ' + v);
      console.error('\nReduce the bundle (code-split / drop a dep) or, if intentional, raise the budget in scripts/bundleBudget.mjs.');
      process.exit(1);
    }
    console.log('\n✅ Bundle within budget.');
  } catch (err) {
    console.error('Bundle budget check failed:', err?.message || err);
    process.exit(1);
  }
}
