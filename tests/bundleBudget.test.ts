import { describe, it, expect } from 'vitest';
import { checkBudget, BUDGETS, isBudgetExcludedJs } from '../scripts/bundleBudget.mjs';

describe('bundle-budget (P-TQA.5)', () => {
  it('passes when every measure is within budget', () => {
    const r = checkBudget({
      largestChunkGzipKB: 567, largestChunkName: 'index.js',
      totalJsGzipKB: 918, totalCssGzipKB: 33,
    });
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
    // current ≈ largest 567, total JS 918, CSS 33 — budgets must exceed these.
    expect(BUDGETS.largestChunkGzipKB).toBeGreaterThan(567);
    expect(BUDGETS.totalJsGzipKB).toBeGreaterThan(918);
    expect(BUDGETS.totalCssGzipKB).toBeGreaterThan(33);
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
