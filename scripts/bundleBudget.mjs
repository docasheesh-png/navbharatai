// P-TQA.5 — Frontend bundle-size budget enforcement.
//
// Runs in CI AFTER `vite build` (`npm run test:bundle`). Reads dist/assets, computes the
// GZIPPED size of every JS/CSS chunk, and fails (exit 1) if any budget is exceeded — so a
// new dependency can't silently bloat the bundle without someone deciding to raise the
// ceiling. The pure `checkBudget()` is unit-tested in tests/bundleBudget.test.ts.
//
// Budgets reflect CURRENT reality + ~15% headroom (an honest "no further bloat" guard, not
// an aspirational target that would fail today). NOTE: the main entry chunk is large
// (~590 KB gz) — splitting it via manualChunks is a known, separate optimisation; this
// budget stops it from growing unchecked in the meantime.
//
// KNOWN TOTAL-JS GROWTH DRIVER (root cause of the 2026-07-20 total-JS bump 1050→1200):
// the offline assistant (`src/lib/offlineAssistant.ts`) imports the ENTIRE server feature
// catalog `APP_KNOWLEDGE_BASE` (`src/server/AppContext/AppKnowledgeBase.ts`) into the CLIENT
// bundle, so every new user-facing feature/recipe entry legitimately grows total JS. This
// is intentional feature growth, not accidental bloat — hence the budget is raised, per the
// "if intentional, raise the budget" guidance below. The deeper optimisation (ship only the
// client-navigation KB entries to the browser and keep the server-only build-recipe entries
// out of the client bundle, or lazy-load them) is a separate, carefully-tested change — see
// PROGRESS.md open root cause. Until then this budget tracks the honest current size.
//
// SECOND TOTAL-JS DRIVER (2026-08-04, bump 1200→1300): Code Studio's real persistent shell needs a
// real terminal emulator — xterm.js, ~70 KB gzipped — because a genuine TTY speaks ANSI (colours,
// cursor movement, in-place progress bars, `top`, `vim`) that no list-of-lines renderer can display.
// It is imported DYNAMICALLY (`ShellTerminal.tsx`), so it is its own chunk and only downloads for
// someone who actually opens a terminal; nobody pays for it on first paint. That is why the LARGEST
// CHUNK budget is untouched — this is not main-bundle growth. Total JS counts every chunk including
// lazy ones, so the total budget absorbs the honest new capability instead of the gate being skipped.
//
// THIRD TOTAL-JS DRIVER (2026-08-11, bump 1300→1450): the master import handler makes the BROWSER read
// the project archive, which needs a streaming zip reader — @zip.js/zip.js, ~44 KB gzipped. jszip is
// already bundled and was rejected here for a real reason, recorded in `src/lib/browserZipImport.ts`:
// its `loadAsync` materializes the WHOLE archive in memory, so a 1 GB zip would need 1-2 GB in the tab
// and crash exactly the phone users the feature exists to help. zip.js reads the central directory and
// inflates only the kept entries. Same shape as xterm above — `await import('@zip.js/zip.js')` makes it
// its own chunk that downloads only for someone who actually imports a project, so first paint is
// unaffected and the LARGEST CHUNK budget sees none of it.
//
// WHY THE HEADROOM IS BIGGER THIS TIME (the reason this gate kept going red on innocent PRs). Each
// previous bump set the ceiling flush against whatever `main` measured that day: the 1300 above was set
// when total JS was ~1231 KB, and by 2026-08-11 `main` measured 1299.8 KB — 0.2 KB of room. At that
// point the gate no longer says "no unchecked bloat", it says "no further features", and the next
// legitimate PR fails for existing growth it did not cause. The largest-chunk budget had drifted into
// the same state (650 ceiling against a 648.5 KB entry). So both ceilings are now set from a MEASURED
// current size plus real headroom (~7-8%), and the measurements below are dated so a future session can
// see the drift instead of inferring it. Keep that discipline on the next bump: measure, then leave room.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// NOT A BUMP — A REGRESSION THAT WAS FIXED INSTEAD (2026-08-11). Recorded here because this file is
// where the next session will look for "why did the bundle move", and the honest answer is that one
// change made it move the WRONG way and was reverted at the source rather than absorbed by a ceiling.
//
// Voice chat became a paid feature and its button went onto EVERY AI including the free chat (admin:
// "sabhi me laga do"). `ProfessionalVoiceButton` imported `SonicChat` statically, which dragged the
// whole audio pipeline — mic capture, PCM resampling, playback scheduling, the waveform — into the
// MAIN chunk: someone who only ever types a message downloaded a voice-call engine to do it. CI caught
// it as a budget breach. The fix is a `lazy()` import behind `Suspense` (the surface only renders after
// the user accepts the consent card, so it costs nothing), and the largest chunk went 645.3 → 640.9 KB
// — SMALLER than before the feature landed. `tests/voiceBilling.test.ts` asserts the import stays lazy.
//
// The lesson worth keeping: raising a ceiling to admit a main-chunk regression hides it behind a bigger
// number. Split first, measure, and only then decide whether the REMAINDER is honest feature growth.

export const BUDGETS = {
  /** Largest single JS chunk, gzipped. Measured 648.5 KB on 2026-08-11 (the main entry). */
  largestChunkGzipKB: 700,
  /** Sum of all JS chunks INCLUDING lazy ones, gzipped. Measured 1347.6 KB on 2026-08-11 (feature KB +
   *  the lazily loaded xterm terminal emulator + the lazily loaded zip reader — see header). */
  totalJsGzipKB: 1450,
  /** Sum of all CSS, gzipped. Measured 39.3 KB on 2026-08-11. */
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

/**
 * LAZY, OPT-IN chunks that are NEVER part of the main app's initial load — so they must not count
 * against the app bundle budget. Today this is the on-device LLM (web-llm), a ~2 MB chunk fetched only
 * when a user turns on the Offline-Thinking beta (named `webllm-*` via vite manualChunks). The budget
 * still protects every eagerly-loaded chunk. Pure predicate so it's unit-testable.
 */
export const EXCLUDED_CHUNK_PREFIXES = ['webllm'];
export function isBudgetExcludedJs(file) {
  return EXCLUDED_CHUNK_PREFIXES.some((p) => file.startsWith(p));
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
    if (file.endsWith('.js') && isBudgetExcludedJs(file)) continue; // opt-in lazy chunk (e.g. web-llm)
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
