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
      // Honest "no-regression" floors set just below today's measured coverage
      // (lines 63.6% · functions 73.5% · branches 79.5%) — same philosophy as the
      // bundle-size budget (P-TQA.5): green today, blocks a real drop tomorrow.
      // Enforced only on a coverage run (`npm run test:coverage` / CI) — the plain
      // `npx vitest run` test step is unaffected and stays fast.
      thresholds: {
        lines: 60,
        functions: 68,
        branches: 72,
        statements: 60,
      },
    },
  },
});
