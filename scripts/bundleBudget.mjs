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
// -- 2026-09-09: THE CEILING WAS SPENT, AND THE MEASUREMENT PROVES WHOSE GROWTH SPENT IT. -------
//
// This is the exact failure mode the 2026-08-11 note above warns about, arriving on schedule: a
// ceiling set flush against reality stops meaning "no unchecked bloat" and starts meaning "no further
// features", and the PR that pays for it is whichever innocent one happens to be next.
//
// MEASURED, not assumed, before touching the number (the discipline this file demands):
//   * with the change that failed CI:     1600.2 KB local / 1600.4 KB on the runner
//   * with that change's UI reverted:     1599.7 KB  <- already 99.98% of the ceiling
//   * so the failing PR's own contribution was 0.5 KB, and the other 113.6 KB of the
//     1486.1 -> 1599.7 drift since 2026-08-24 was already on main before it existed.
//
// AND IT IS NOT A FIRST-PAINT REGRESSION, which is the question the note above says to answer FIRST.
// The largest chunk -- the one every visitor downloads -- did not move at all (250.3 KB against a 400
// ceiling), because the added surface is an admin-only card inside the already-`lazy()` AdminDashboard
// route. Nobody but an admin opening that screen downloads a byte of it. That is what makes absorbing
// the remainder honest here rather than a ceiling hiding a regression.
//
// 1720 = today's runner measurement + ~7.5% headroom, the same proportion the 1486.1 -> 1600 bump
// used. Set from a measurement, with room, and dated -- keep that discipline on the next bump.
//
// NOTE FOR THE NEXT SESSION, recorded rather than acted on: the entry chunk has SHRUNK 354.9 -> 250.3
// KB since the last measurement (more route splitting landed), so the 400 ceiling now permits ~150 KB
// of silent first-paint drift. Tightening it would lock that win in. It is deliberately NOT done in
// this edit -- that is a judgement call with its own failure risk for somebody else's PR, and this
// change exists to unblock a gate, not to re-tune every ceiling while doing it.

// -- 2026-09-10: THE FIRST-PAINT GUARD WAS NOT MEASURING FIRST PAINT. ---------------------------
//
// Found while deciding whether to tighten the 400 ceiling the note above defers. The answer turned
// out to be that tightening it would have improved a number that had quietly stopped meaning what
// every comment in this file says it means.
//
// `largestChunkGzipKB` is the biggest chunk, whichever one that is, and this file reasons about it
// everywhere as the entry -- "the entry EVERY user downloads", and the instruction to a future
// session that "the question to answer first is *what did I just put on the first-paint path*".
// That was true on 2026-08-24, when the entry WAS the largest chunk at 354.9 KB. It is not true now.
//
// MEASURED on 2026-09-10, reading `dist/index.html` -- the document the browser actually receives:
//   entry            index-*.js          247.7 KB gz   <- downloaded on first paint
//   modulepreload    react-vendor-*.js    59.2 KB gz   <- downloaded on first paint
//   modulepreload    firebase-vendor-*.js 188.9 KB gz  <- downloaded on first paint
//   FIRST-PAINT JS                       495.8 KB gz
//   ...while `largestChunkGzipKB` reported 250.3 KB for OfflineAI-*.js, a LAZY chunk that first
//   paint does not fetch at all.
//
// So the guard was reporting a number ~2x smaller than the real first-paint cost, about a file the
// user does not download, while `firebase-vendor` -- 188.9 KB that EVERY visitor pays before seeing
// anything -- was guarded by nothing tighter than the 1720 KB total. The failure mode is silent and
// in the future: let any lazy chunk drift to ~390 KB and it becomes "the largest", after which the
// entry could double from 247 to 399 KB with this gate reporting success the whole way.
//
// THE FIX IS TO MEASURE THE THING, NOT TO TUNE THE PROXY. `firstPaintJsGzipKB` is the entry script
// plus every `modulepreload` in the emitted HTML -- by construction exactly what the browser must
// fetch before it can render, read from the build output rather than inferred from a filename
// convention. `largestChunkGzipKB` is KEPT (it still catches a single chunk ballooning anywhere in
// the app) but its comment no longer claims to be the first-paint guard, because it is not.
//
// 560 = 495.8 + ~13% headroom, the same discipline the other ceilings use.
//
// ⚠️ NOT OPTIMISED IN THIS CHANGE, and recorded so it is not mistaken for acceptable: 495.8 KB before
// anything renders is a lot, and 38% of it is Firebase, which a visitor who never signs in still
// pays for in full. Making that lazy is a real change with real risk and belongs in its own PR --
// this one exists to make the number VISIBLE and GUARDED, which is the precondition for improving it.

export const LAST_MEASURED = {
  largestChunkGzipKB: 250.3,
  firstPaintJsGzipKB: 495.8,
  totalJsGzipKB: 1600.4,
  totalCssGzipKB: 47.4,
};

export const BUDGETS = {
  /** Largest single JS chunk, gzipped, lazy ones included. Measured 250.3 KB on 2026-09-10 -- which
   *  was OfflineAI, NOT the entry. This is a "no single chunk balloons" guard and nothing more; the
   *  first-paint guard is `firstPaintJsGzipKB` below. See the 2026-09-10 note. */
  largestChunkGzipKB: 400,
  /** What the browser must download before it can render: the entry script plus every modulepreload
   *  in the emitted index.html. Measured 495.8 KB on 2026-09-10. THIS is the number that tracks what
   *  every visitor pays on a cold load, and the one to answer for before adding a static import. */
  firstPaintJsGzipKB: 560,
  /** Sum of all JS chunks INCLUDING lazy ones, gzipped. Measured 1600.4 KB on 2026-09-09 on the CI
   *  runner (1600.2 locally). Raised from 1600, whose headroom two weeks of feature growth had spent
   *  down to 0.3 KB -- see the dated note above for the per-change measurement behind this. */
  totalJsGzipKB: 1720,
  /** Sum of all CSS, gzipped. Measured 47.4 KB on 2026-09-09. */
  totalCssGzipKB: 55,
};

/**
 * Pure budget check. `measured` = { largestChunkGzipKB, largestChunkName, totalJsGzipKB,
 * totalCssGzipKB }. Returns { ok, violations[] }. No I/O — unit-tested directly.
 */
export function checkBudget(measured, budgets = BUDGETS) {
  const violations = [];
  // FIRST — because it is the one a human should read first when several fail together. A build that
  // is over on first paint has a problem every visitor feels; being over on total JS means a lazy
  // chunk somewhere grew, which almost nobody feels on any given visit.
  //
  // 🔒 An UNMEASURABLE first paint is a violation, never a pass. `measureDist` throws when it cannot
  // read the emitted HTML, but `checkBudget` is pure and takes whatever it is handed — and a caller
  // that omitted the field would otherwise sail through the one gate that matters most, silently.
  if (typeof measured.firstPaintJsGzipKB !== 'number' || !Number.isFinite(measured.firstPaintJsGzipKB)) {
    violations.push(
      'First-paint JS could not be measured (no entry script / modulepreload set was reported). ' +
      'That is reported as a failure rather than a pass: an unmeasured first paint is not a small one.',
    );
  } else if (measured.firstPaintJsGzipKB > budgets.firstPaintJsGzipKB) {
    violations.push(
      `First-paint JS is ${measured.firstPaintJsGzipKB.toFixed(1)} KB gzipped > budget ` +
      `${budgets.firstPaintJsGzipKB} KB — this is what EVERY visitor downloads before anything renders` +
      `${measured.firstPaintFiles?.length ? ` (${measured.firstPaintFiles.join(', ')})` : ''}`,
    );
  }
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

/**
 * The JS files the browser must fetch before it can render, read from the EMITTED HTML. PURE.
 *
 * Deliberately parsed out of `index.html` rather than guessed from a filename convention: the entry
 * is whatever `<script type="module">` the build actually wrote, and its statically-imported chunks
 * are whatever it `modulepreload`ed. Both are facts about the document the browser receives, so this
 * cannot drift the way "assume the entry is called index-*" would the day the naming changes.
 *
 * Dynamic imports are absent by construction — Vite emits no preload link for them — so a route that
 * is `lazy()` correctly costs nothing here. That is the whole point of the metric.
 */
export function firstPaintJsFiles(html) {
  const out = [];
  const src = /<script[^>]+type="module"[^>]*\ssrc="([^"]+\.js)"/g;
  const pre = /<link[^>]+rel="modulepreload"[^>]*\shref="([^"]+\.js)"/g;
  for (const re of [src, pre]) {
    for (const m of String(html ?? '').matchAll(re)) {
      const file = m[1].split('/').pop();
      if (file && !out.includes(file)) out.push(file);
    }
  }
  return out;
}

/** Measure the gzipped sizes of the built bundle. Returns the `measured` shape above. */
export function measureDist(distDir = 'dist') {
  const assetsDir = join(distDir, 'assets');
  if (!existsSync(assetsDir)) {
    throw new Error(`No build found at ${assetsDir} — run \`vite build\` first.`);
  }
  // 🔒 THROW RATHER THAN REPORT ZERO. A missing or script-less index.html means the build did not
  // produce a loadable app at all; reporting 0 KB of first paint would turn that into the greenest
  // possible result. The existing "No build found" throw above sets the same precedent.
  const htmlPath = join(distDir, 'index.html');
  if (!existsSync(htmlPath)) {
    throw new Error(`No ${htmlPath} — cannot determine what first paint downloads.`);
  }
  const firstPaintFiles = firstPaintJsFiles(readFileSync(htmlPath, 'utf8'));
  if (firstPaintFiles.length === 0) {
    throw new Error(`${htmlPath} references no module script — cannot determine what first paint downloads.`);
  }
  let firstPaintJs = 0;
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
      if (firstPaintFiles.includes(file)) firstPaintJs += gz;
    } else if (file.endsWith('.css')) {
      totalCss += gz;
    }
  }
  const KB = 1024;
  return {
    largestChunkGzipKB: largestChunkGzip / KB,
    largestChunkName,
    firstPaintJsGzipKB: firstPaintJs / KB,
    firstPaintFiles,
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
    // Printed FIRST and named for what it costs, because this is the line a person should read when
    // deciding whether a change was worth it. The chunk list is included so "it grew" is immediately
    // "it grew because THIS is now loaded eagerly" rather than a number to go hunting behind.
    console.log(`  first paint   : ${measured.firstPaintJsGzipKB.toFixed(1)} KB  [budget ${BUDGETS.firstPaintJsGzipKB} KB]  ← every visitor, before anything renders`);
    console.log(`                  ${measured.firstPaintFiles.join(' + ')}`);
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
