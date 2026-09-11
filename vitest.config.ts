import { defineConfig } from 'vitest/config';

// Vitest configuration for NavBharatAI.
// As modules are extracted from the server monolith (Phase 1+), colocated
// *.test.ts files will be added and picked up by the include glob below.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
    // WHY THIS IS SET, AND WHY 20s (2026-08-06). Vitest's default is 5s, and CI's ONLY test run is now
    // the INSTRUMENTED one (`vitest run --coverage`), where everything is 2–5× slower. Measured: a
    // SimpleBuilder test that takes 1158ms on its own took 5665ms under coverage in a full run — it
    // failed CI, having asserted nothing about time. At a 5s default, INSTRUMENTATION SPEED decides
    // pass/fail rather than correctness, and every test that drifts near the line becomes a red build
    // that teaches people to re-run rather than to look.
    //
    // 20s is chosen to be far above real work and far below "a hang nobody notices": a genuinely stuck
    // test still fails, just later. Raising it is NOT the same as hiding a slow test — the durations are
    // still printed, and a test that grows toward this number is still worth chasing.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      // Only measure code that actually has tests colocated/targeted — measuring the entire
      // 120k-LOC tree (incl. UI components with no unit tests) would produce a meaningless
      // single-digit number and a threshold gate that's pure noise. The CI gate
      // (scripts/coverageGate.mjs) enforces a real, honest floor over the tested surface.
      include: ['src/server/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'src/server/**/*.test.ts'],
      // Honest "no-regression" floors set just below the measured coverage — same philosophy as the
      // bundle-size budget (P-TQA.5): green today, blocks a real drop tomorrow.
      // Enforced only on a coverage run (`npm run test:coverage` / CI) — the plain
      // `npx vitest run` test step is unaffected and stays fast.
      //
      // ⚠️ THE VITEST 4 UPGRADE (2026-09-10) CHANGED THE RULER, NOT THE COVERAGE. Read this before
      // "restoring" branches to 72.
      //
      // Vitest 4's v8 provider does AST-aware remapping unconditionally — the toggle that was
      // `coverage.experimentalAstAwareRemapping` in v3 does not exist in v4's options at all. It counts
      // against the nodes the compiler really emits, so every denominator moved, measured on the same
      // tree with the same 1,523 files and 20,490 tests passing under both versions:
      //
      //                 vitest 2            vitest 4
      //   statements    71.99% (117,020)    63.22% (71,596)
      //   branches      83.86% ( 38,672)    60.70% (56,004)
      //   functions     86.54% (  6,369)    70.32% (11,170)
      //   lines         71.99%              64.52%
      //
      // Note the denominators move in BOTH directions — fewer statements, far more branches and
      // functions — which is what a redefinition looks like and what a real coverage loss does not.
      // Not one test stopped running, so no source lost its coverage.
      //
      // Only `branches` fell below its floor, so only `branches` is re-baselined (72 → 57: just under
      // the honest 60.7%, with the same ~3-point buffer `lines` has always had). The other three are
      // deliberately LEFT ALONE — lowering a floor that still passes would weaken the gate for nothing.
      // ⚠️ `functions` now clears 68 by only 2.3 points, a thinner margin than this file was designed
      // around; if it trips on an unrelated change, that is this upgrade's accounting and not a
      // regression — re-baseline it to ~67 then, rather than hunting for lost tests.
      thresholds: {
        lines: 60,
        functions: 68,
        branches: 57,
        statements: 60,
      },
    },
  },
});
