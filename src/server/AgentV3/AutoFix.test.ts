import { describe, it, expect, afterEach } from 'vitest';
import {
  autoFixEnabled, reviewerAutoFixEnabled, autoFixMaxAttempts, filterActionableErrors,
  formatRuntimeErrors, buildRepairPrompt, autoFixWarning, reviewerAutofixOutcome,
  reviewerFixBudgetMs, reviewerFixShouldRetry,
  reviewCriticalUnresolvedSummary,
  runtimeVerifiedRecord, runtimeUncheckedRecord, runtimeErrorsRemainRecord, type RuntimeError,
  isFatalRuntimeError, fatalRuntimeErrorCount,
} from './AutoFix';

// C9-RETRY (admin dashboard autopsy 2026-08-02): "Reviewer critical not resolved" was the TOP failure
// pattern (29% of failed user reports). The repair pass had a flat 120s cap and ONE attempt — timeouts
// and one-shot provider flakes shipped the criticals unresolved. These lock the two class fixes.
describe('reviewerFixBudgetMs — repair budget scales with findings and clamps to headroom', () => {
  it('base is the old 120s for a single finding with unlimited headroom (no regression)', () => {
    expect(reviewerFixBudgetMs(1, Infinity)).toBe(120_000);
  });
  it('more findings get more time, capped at 5 minutes', () => {
    expect(reviewerFixBudgetMs(2, Infinity)).toBe(180_000);
    expect(reviewerFixBudgetMs(3, Infinity)).toBe(240_000);
    expect(reviewerFixBudgetMs(10, Infinity)).toBe(300_000); // MAX
  });
  it('clamps to the wall-clock headroom minus a 30s safety margin (never starts a doomed repair)', () => {
    expect(reviewerFixBudgetMs(3, 150_000)).toBe(120_000); // 150s left → 120s budget
    expect(reviewerFixBudgetMs(1, 100_000)).toBe(70_000);
  });
  it('never below the 60s floor, and defends nonsense input', () => {
    expect(reviewerFixBudgetMs(1, 45_000)).toBe(60_000);
    expect(reviewerFixBudgetMs(0, Infinity)).toBe(120_000);
    expect(reviewerFixBudgetMs(NaN as never, Infinity)).toBe(120_000);
  });
});

describe('reviewerFixShouldRetry — ONE bounded retry, never after a timeout, never without headroom', () => {
  it('grants a single retry after a completed-but-failed pass with real headroom', () => {
    expect(reviewerFixShouldRetry(1, 300_000, false)).toBe(true);
    expect(reviewerFixShouldRetry(1, Infinity, false)).toBe(true);
  });
  it('hard-bounds at 2 attempts total', () => {
    expect(reviewerFixShouldRetry(2, Infinity, false)).toBe(false);
    expect(reviewerFixShouldRetry(3, Infinity, false)).toBe(false);
  });
  it('NEVER retries after a timeout — the raced-out runner may still be editing (overlap = corruption risk)', () => {
    expect(reviewerFixShouldRetry(1, Infinity, true)).toBe(false);
    expect(reviewerFixShouldRetry(1, 999_999, true)).toBe(false);
  });
  it('refuses a retry that the wall clock would cut off anyway (needs > 150s)', () => {
    expect(reviewerFixShouldRetry(1, 150_000, false)).toBe(false);
    expect(reviewerFixShouldRetry(1, 150_001, false)).toBe(true);
  });
});

describe('runtime-verification honesty records (rule 5 — checked-clean vs couldn\'t-check vs errors-remain)', () => {
  it('runtimeVerifiedRecord: an honest POSITIVE — captured a real session, no errors (info, resolved)', () => {
    const r = runtimeVerifiedRecord();
    expect(r.phase).toBe('autofix');
    expect(r.code).toBe('RUNTIME_VERIFIED');
    expect(r.severity).toBe('info');
    expect(r.autoResolved).toBe(true);
    expect(r.message).toMatch(/no actionable console errors/i);
  });

  it('runtimeUncheckedRecord: could NOT capture → honest WARN, NEVER a clean guarantee (unresolved)', () => {
    const r = runtimeUncheckedRecord();
    expect(r.code).toBe('RUNTIME_UNCHECKED');
    expect(r.severity).toBe('warning');
    expect(r.autoResolved).toBe(false); // surfaces as a real unresolved caveat, not a green tick
    expect(r.message).toMatch(/not verified/i);
    expect(r.message).toMatch(/not a clean-runtime guarantee/i);
    expect(r.message).not.toMatch(/\bclean\b(?!-runtime)/i); // must never imply the runtime is clean
  });

  it('runtimeErrorsRemainRecord: residual errors are recorded DURABLY (warning) with the real count', () => {
    const errs: RuntimeError[] = [
      { t: 1, kind: 'error', text: 'x is not a function' },
      { t: 2, kind: 'error', text: 'Failed to fetch' },
    ];
    const r = runtimeErrorsRemainRecord(errs);
    expect(r.code).toBe('RUNTIME_ERRORS_REMAIN');
    expect(r.severity).toBe('warning');
    expect(r.autoResolved).toBe(false);
    expect(r.message).toMatch(/^2 runtime error/);
    expect(r.message).toMatch(/may still be present/i);
    // M3-S3.1: 'x is not a function' is app-crashing → the record names the crash count.
    expect(r.message).toMatch(/1 of them crash the app/i);
  });

  it('runtimeErrorsRemainRecord: no crash note when the residual errors are non-fatal (M3-S3.1)', () => {
    const r = runtimeErrorsRemainRecord([{ t: 1, kind: 'error', text: 'Failed to fetch' }]);
    expect(r.message).not.toMatch(/crash the app/i);
  });

  it('all three verdicts are advisory (never severity "error") — the runtime loop never blocks a build', () => {
    for (const r of [runtimeVerifiedRecord(), runtimeUncheckedRecord(), runtimeErrorsRemainRecord([])]) {
      expect(r.severity).not.toBe('error');
      expect(r.phase).toBe('autofix');
    }
  });
});

describe('reviewerAutofixOutcome — never claim "Auto-fixed" when the repair failed (deep-test 2026-07-18)', () => {
  it('a SUCCESSFUL pass records an honest "Auto-fixed" info line (auto-resolved)', () => {
    const r = reviewerAutofixOutcome(true, '3 critical issue(s)');
    expect(r.code).toBe('REVIEWER_AUTOFIX');
    expect(r.severity).toBe('info');
    expect(r.autoResolved).toBe(true);
    expect(r.message).toBe('Auto-fixed 3 critical issue(s) from the reviewer');
  });
  it('a FAILED pass NEVER says "Auto-fixed" — it warns the findings may remain, UNRESOLVED', () => {
    const r = reviewerAutofixOutcome(false, '3 critical issue(s)');
    expect(r.code).toBe('REVIEWER_AUTOFIX_INCOMPLETE');
    expect(r.severity).toBe('warning');
    expect(r.autoResolved).toBe(false);          // shows up as a real unresolved problem, not a green tick
    expect(r.message).not.toMatch(/Auto-fixed/);  // the exact fake-success string must never appear
    expect(r.message).toMatch(/may still be present/);
  });
});

describe('reviewCriticalUnresolvedSummary — honest verdict when reviewer criticals ship unfixed (deep-test 2026-07-21)', () => {
  it('never claims success/"console clean" and states the app is not fully working', () => {
    const s = reviewCriticalUnresolvedSummary(2);
    expect(s).not.toMatch(/console is clean|no runtime errors|✅|successful/i);
    expect(s).toMatch(/isn't fully working/);
    expect(s).toMatch(/2 critical issues/);
  });
  it('promises the user was NOT charged (the "working app or free" law is visible)', () => {
    expect(reviewCriticalUnresolvedSummary(3)).toMatch(/have NOT been charged/);
  });
  it('is actionable — tells the user how to get them fixed', () => {
    expect(reviewCriticalUnresolvedSummary(1)).toMatch(/fix it|continue/i);
  });
  it('grammatical for the singular case (1 critical issue / it / isn\'t)', () => {
    const s = reviewCriticalUnresolvedSummary(1);
    expect(s).toMatch(/1 critical issue that isn't/);
    expect(s).not.toMatch(/issues/);
  });
  it('WHITE-LABEL: never names a provider/model (findings stay admin-only)', () => {
    const s = reviewCriticalUnresolvedSummary(2).toLowerCase();
    for (const v of ['glm', 'kimi', 'claude', 'sonnet', 'opus', 'gemini', 'grok', 'moonshot', 'anthropic', 'vertex']) {
      expect(s).not.toContain(v);
    }
  });
  it('clamps a zero/negative count to at least one (never "0 critical issues")', () => {
    expect(reviewCriticalUnresolvedSummary(0)).toMatch(/1 critical issue that/);
  });
});

describe('AutoFix flags (R4 §2.3)', () => {
  const prevOn = process.env.AGENTV3_AUTOFIX;
  const prevN = process.env.AGENTV3_AUTOFIX_ATTEMPTS;
  afterEach(() => {
    if (prevOn === undefined) delete process.env.AGENTV3_AUTOFIX; else process.env.AGENTV3_AUTOFIX = prevOn;
    if (prevN === undefined) delete process.env.AGENTV3_AUTOFIX_ATTEMPTS; else process.env.AGENTV3_AUTOFIX_ATTEMPTS = prevN;
  });

  it('is OFF by default (opt-in, never a surprise paid pass)', () => {
    delete process.env.AGENTV3_AUTOFIX;
    expect(autoFixEnabled()).toBe(false);
  });

  it('enables on any explicit yes, and stays off when unset', () => {
    // CONTRACT CHANGED DELIBERATELY (audit finding #1, 2026-08-09): the old strictness was the
    // DEFECT, not a safeguard — rejecting `true`/`1` bought no safety (an admin typing them plainly
    // means ON) while `on` vs `true` silently disagreed across the codebase. One shared parser now
    // accepts every spelling of yes/no; an opt-in still requires an EXPLICIT yes, which is the part
    // that actually mattered.
    for (const v of ['on', 'true', '1', 'ON']) {
      process.env.AGENTV3_AUTOFIX = v;
      expect(autoFixEnabled(), v).toBe(true);
    }
    for (const v of ['off', 'false', '0', '']) {
      process.env.AGENTV3_AUTOFIX = v;
      expect(autoFixEnabled(), v).toBe(false);
    }
    delete process.env.AGENTV3_AUTOFIX;
    expect(autoFixEnabled()).toBe(false);
  });

  it('reviewer [CRITICAL] auto-fix is ON by default (v5.0 must never knowingly ship its own diagnosed defect)', () => {
    const prev = process.env.AGENTV3_REVIEWER_AUTOFIX;
    try {
      // The 2026-07-07 bug: the reviewer found a real [CRITICAL] on a successful build, but the C9
      // repair was gated on the opt-in AGENTV3_AUTOFIX (off in prod) — diagnosed, then shipped broken.
      delete process.env.AGENTV3_REVIEWER_AUTOFIX;
      expect(reviewerAutoFixEnabled()).toBe(true);
      process.env.AGENTV3_REVIEWER_AUTOFIX = 'off';
      expect(reviewerAutoFixEnabled()).toBe(false); // explicit kill switch only
      process.env.AGENTV3_REVIEWER_AUTOFIX = 'on';
      expect(reviewerAutoFixEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_REVIEWER_AUTOFIX; else process.env.AGENTV3_REVIEWER_AUTOFIX = prev;
    }
  });

  it('defaults to 1 attempt and hard-caps at 3', () => {
    delete process.env.AGENTV3_AUTOFIX_ATTEMPTS;
    expect(autoFixMaxAttempts()).toBe(1);
    process.env.AGENTV3_AUTOFIX_ATTEMPTS = '2';
    expect(autoFixMaxAttempts()).toBe(2);
    process.env.AGENTV3_AUTOFIX_ATTEMPTS = '99';
    expect(autoFixMaxAttempts()).toBe(3);
    process.env.AGENTV3_AUTOFIX_ATTEMPTS = '0';
    expect(autoFixMaxAttempts()).toBe(1);
    process.env.AGENTV3_AUTOFIX_ATTEMPTS = 'abc';
    expect(autoFixMaxAttempts()).toBe(1);
  });
});

describe('filterActionableErrors', () => {
  it('drops benign noise (favicon, sourcemap, ResizeObserver, vite hmr)', () => {
    const errs: RuntimeError[] = [
      { t: 1, kind: 'request-failed', text: 'GET /favicon.ico 404' },
      { t: 2, kind: 'error', text: 'Failed to load resource: app.js.map' },
      { t: 3, kind: 'warning', text: 'ResizeObserver loop completed with undelivered notifications.' },
      { t: 4, kind: 'log', text: '[vite] connected.' },
      { t: 5, kind: 'error', text: "TypeError: Cannot read properties of undefined (reading 'map')" },
    ];
    const out = filterActionableErrors(errs);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('Cannot read properties of undefined');
  });

  it('de-duplicates repeated errors', () => {
    const errs: RuntimeError[] = [
      { t: 1, kind: 'error', text: 'ReferenceError: foo is not defined' },
      { t: 2, kind: 'error', text: 'ReferenceError: foo is not defined' },
    ];
    expect(filterActionableErrors(errs)).toHaveLength(1);
  });

  it('returns [] for non-array / junk input (never throws)', () => {
    expect(filterActionableErrors(undefined)).toEqual([]);
    expect(filterActionableErrors(null)).toEqual([]);
    expect(filterActionableErrors('oops')).toEqual([]);
    expect(filterActionableErrors([null, {}, { text: '' }])).toEqual([]);
  });
});

// M3-S3.1 — distinguish an app that actually CRASHED at runtime from benign console chatter, so the
// "really works" verdict and the repair pass focus on real crashes.
describe('isFatalRuntimeError + fatalRuntimeErrorCount (M3-S3.1)', () => {
  it('flags real app-crashing errors as fatal', () => {
    for (const t of [
      "TypeError: Cannot read properties of undefined (reading 'map')",
      'x.forEach is not a function',
      'ReferenceError: foo is not defined',
      'Error: Maximum update depth exceeded',
      'Rendered more hooks than during the previous render',
      'Warning: Objects are not valid as a React child',
      'Minified React error #310',
    ]) {
      expect(isFatalRuntimeError(t), t).toBe(true);
    }
  });

  it('does NOT flag benign noise or a plain non-crash log', () => {
    for (const t of ['GET /favicon.ico 404', 'Download the React DevTools', '[HMR] update applied', 'Slow network is detected', 'User clicked the save button', '']) {
      expect(isFatalRuntimeError(t), t).toBe(false);
    }
  });

  it('counts only the crashing errors in a mixed list', () => {
    const errs: RuntimeError[] = [
      { t: 1, kind: 'error', text: "Cannot read properties of null (reading 'id')" },
      { t: 2, kind: 'log', text: 'saved successfully' },
      { t: 3, kind: 'error', text: 'ReferenceError: bar is not defined' },
      { t: 4, kind: 'warning', text: 'ResizeObserver loop' },
    ];
    expect(fatalRuntimeErrorCount(errs)).toBe(2);
    expect(fatalRuntimeErrorCount([])).toBe(0);
    expect(fatalRuntimeErrorCount(undefined as never)).toBe(0);
  });
});

describe('repair prompt + warning', () => {
  const errs: RuntimeError[] = [{ t: 1, kind: 'error', text: 'TypeError: x is not a function' }];

  it('buildRepairPrompt embeds the errors and forbids a from-scratch rebuild', () => {
    const p = buildRepairPrompt(errs);
    expect(p).toContain('TypeError: x is not a function');
    expect(p).toContain('without rebuilding from');
    expect(p).toContain('console_errors');
  });

  it('formatRuntimeErrors caps the list', () => {
    const many: RuntimeError[] = Array.from({ length: 30 }, (_, i) => ({ t: i, kind: 'error', text: `err ${i}` }));
    expect(formatRuntimeErrors(many, 5).split('\n')).toHaveLength(5);
  });

  it('autoFixWarning is honest about remaining errors', () => {
    const w = autoFixWarning(errs);
    expect(w).toContain('may still remain');
    expect(w).toContain('TypeError: x is not a function');
  });
});
