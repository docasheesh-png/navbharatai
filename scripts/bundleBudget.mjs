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

// -- 2026-08-24: THE ROUTE-LEVEL SPLIT. Read this before changing either JS number. -------------
//
// App.tsx statically imported 16 route-level views (GitPanel, Settings, Billing, the v5.0 surface,
// AdminDashboard, Doctor AI, Professionals, ...). None is the default view, and all render inside the
// view switcher's <Suspense>, so nobody needed them on first paint -- but a static import is a static
// import, and they sat in the entry chunk for every visitor. They are now `lazy()`.
//
// The MEASURED result, and the honest trade in it:
//   * largest chunk (the entry EVERY user downloads): 640.3 -> 354.9 KB gz -- 285 KB less, 45% off
//   * total JS across all chunks:                     1441  -> 1486   KB gz -- 45 KB MORE
//
// Total grew because splitting is not free: the build went from 92 chunks to 183, and each carries
// module-wrapper overhead. That is the right trade -- the entry is paid by everyone on every cold
// visit, while the new chunks are paid only by someone who actually opens that screen -- but it IS a
// real increase and it is recorded here as one rather than waved through.
//
// `output.experimentalMinChunkSize: 10_000` was tried against exactly this (104 of the chunks are
// under 2 KB) and REJECTED on measurement: it merged 183 chunks down to 145 and saved 8 KB of total,
// while pushing the entry back UP to 360.6 KB. It made the number that matters worse to improve the
// number that does not. Do not re-propose it without new measurements.
//
// THE LARGEST-CHUNK CEILING IS DELIBERATELY TIGHTENED, NOT LEFT AT 700. Leaving it there would let
// the entry chunk drift 345 KB back up in silence -- undoing this whole change with nothing failing.
// 400 KB is the new measurement plus ~13% headroom. If a future change needs more than that, the
// question to answer first is "what did I just put on the first-paint path", not "what should the
// ceiling be".

/**
 * What `main` actually measured when the budgets below were last set. EXPORTED so the unit test can
 * assert "every budget is above today's real size" without hardcoding its own copy of these numbers.
 *
 * It used to hardcode them (567 / 918 / 33), and by 2026-08-24 all three were from a long-dead build
 * — so the test asserted the budgets cleared a bar reality had left years behind, and it FAILED the
 * moment the largest-chunk ceiling was correctly tightened to 400. A number that must match another
 * number belongs in one place. Update this in the same edit as BUDGETS, always.
 */
export const LAST_MEASURED = {
  largestChunkGzipKB: 354.9,
  totalJsGzipKB: 1486.1,
  totalCssGzipKB: 47.7,
};

export const BUDGETS = {
  /** Largest single JS chunk, gzipped. Measured 354.9 KB on 2026-08-24 (the main entry). */
  largestChunkGzipKB: 400,
  /** Sum of all JS chunks INCLUDING lazy ones, gzipped. Measured 1486.1 KB on 2026-08-24 -- see the
   *  note above for why this rose while the chunk everyone downloads fell by 285 KB. */
  totalJsGzipKB: 1600,
  /** Sum of all CSS, gzipped. Measured 47.7 KB on 2026-08-24. */
  totalCssGzipKB: 55,
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
