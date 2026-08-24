import { describe, it, expect } from 'vitest';
import { checkBudget, BUDGETS, LAST_MEASURED, isBudgetExcludedJs } from '../scripts/bundleBudget.mjs';

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

  it('reports MULTIPLE violations at once', () => {
    const r = checkBudget({
      largestChunkGzipKB: 9999, totalJsGzipKB: 9999, totalCssGzipKB: 9999, largestChunkName: 'x.js',
    });
    expect(r.violations).toHaveLength(3);
  });

  it('budgets are realistic (above the current measured sizes, so CI passes today)', () => {
    // Compared against LAST_MEASURED, not against numbers copied into this file. The old copies
    // (567 / 918 / 33) had gone stale, so this test was asserting against a build that no longer
    // existed — and it broke the moment the largest-chunk ceiling was tightened for a real win.
    for (const k of ['largestChunkGzipKB', 'totalJsGzipKB', 'totalCssGzipKB'] as const) {
      expect(BUDGETS[k]).toBeGreaterThan(LAST_MEASURED[k]);
    }
  });

  it('budgets stay CLOSE to the measurement — a ceiling with no floor is not a gate', () => {
    // The failure this guards is the one the script's own header warns about: raising a ceiling to
    // admit a regression. A budget more than ~60% above what `main` measures has stopped saying
    // "no unchecked growth" and started saying "anything goes".
    for (const k of ['largestChunkGzipKB', 'totalJsGzipKB', 'totalCssGzipKB'] as const) {
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
