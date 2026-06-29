import { defineConfig } from 'vitest/config';

// Vitest configuration for NavBharatAI.
// As modules are extracted from the server monolith (Phase 1+), colocated
// *.test.ts files will be added and picked up by the include glob below.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
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
