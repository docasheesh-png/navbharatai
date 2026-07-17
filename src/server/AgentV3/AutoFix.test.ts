import { describe, it, expect, afterEach } from 'vitest';
import {
  autoFixEnabled, reviewerAutoFixEnabled, autoFixMaxAttempts, filterActionableErrors,
  formatRuntimeErrors, buildRepairPrompt, autoFixWarning, type RuntimeError,
} from './AutoFix';

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

  it('enables only on AGENTV3_AUTOFIX=on', () => {
    process.env.AGENTV3_AUTOFIX = 'on';
    expect(autoFixEnabled()).toBe(true);
    process.env.AGENTV3_AUTOFIX = '1';
    expect(autoFixEnabled()).toBe(false); // strict 'on'
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
