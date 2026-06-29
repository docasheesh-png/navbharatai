import { describe, it, expect } from 'vitest';
import {
  debtKey, mergeDebt, prioritizeDebt, summarizeDebt,
  type DebtItem, type IncomingFinding,
} from '../src/server/AppMakerLab/intelligence/TechnicalDebtTracker';

/**
 * P-PME.3 — technical debt tracker (pure merge / prioritize / summarize).
 */
const f = (over: Partial<IncomingFinding>): IncomingFinding => ({
  category: 'lint', severity: 'low', message: 'something', ...over,
});

describe('TechnicalDebtTracker — debtKey', () => {
  it('is stable for the same finding and differs across files', () => {
    expect(debtKey(f({ file: 'a.ts' }))).toBe(debtKey(f({ file: 'a.ts' })));
    expect(debtKey(f({ file: 'a.ts' }))).not.toBe(debtKey(f({ file: 'b.ts' })));
  });
});

describe('TechnicalDebtTracker — mergeDebt', () => {
  it('adds new findings with firstSeen=lastSeen', () => {
    const merged = mergeDebt([], [f({ file: 'a.ts' })], '2026-01-01T00:00:00Z');
    expect(merged).toHaveLength(1);
    expect(merged[0].firstSeen).toBe('2026-01-01T00:00:00Z');
    expect(merged[0].lastSeen).toBe('2026-01-01T00:00:00Z');
  });

  it('refreshes lastSeen + keeps firstSeen for a recurring finding', () => {
    const first = mergeDebt([], [f({ file: 'a.ts' })], '2026-01-01T00:00:00Z');
    const second = mergeDebt(first, [f({ file: 'a.ts' })], '2026-02-01T00:00:00Z');
    expect(second).toHaveLength(1); // deduped
    expect(second[0].firstSeen).toBe('2026-01-01T00:00:00Z');
    expect(second[0].lastSeen).toBe('2026-02-01T00:00:00Z');
  });

  it('retains prior debt not seen this round (debt persists until resolved)', () => {
    const prior: DebtItem = {
      key: debtKey(f({ file: 'old.ts' })), category: 'lint', severity: 'low', file: 'old.ts',
      message: 'something', firstSeen: '2025-01-01T00:00:00Z', lastSeen: '2025-01-01T00:00:00Z',
    };
    const merged = mergeDebt([prior], [f({ file: 'new.ts' })], '2026-01-01T00:00:00Z');
    expect(merged).toHaveLength(2);
  });
});

describe('TechnicalDebtTracker — prioritizeDebt', () => {
  it('puts CRITICAL security first, then by severity', () => {
    const now = '2026-01-01T00:00:00Z';
    const items = mergeDebt([], [
      f({ category: 'lint', severity: 'high', file: 'a.ts', message: 'lint-high' }),
      f({ category: 'security', severity: 'critical', file: 'b.ts', message: 'sec-crit' }),
      f({ category: 'architecture', severity: 'medium', file: 'c.ts', message: 'arch-med' }),
    ], now);
    const sorted = prioritizeDebt(items);
    expect(sorted[0].message).toBe('sec-crit');       // critical security first
    expect(sorted[1].message).toBe('lint-high');      // then high
    expect(sorted[2].message).toBe('arch-med');       // then medium
  });
});

describe('TechnicalDebtTracker — summarizeDebt', () => {
  it('counts by severity + critical-security', () => {
    const now = '2026-01-01T00:00:00Z';
    const items = mergeDebt([], [
      f({ category: 'security', severity: 'critical', file: 'a.ts', message: 's1' }),
      f({ category: 'lint', severity: 'low', file: 'b.ts', message: 'l1' }),
      f({ category: 'lint', severity: 'low', file: 'c.ts', message: 'l2' }),
    ], now);
    const s = summarizeDebt(items);
    expect(s.total).toBe(3);
    expect(s.bySeverity.critical).toBe(1);
    expect(s.bySeverity.low).toBe(2);
    expect(s.criticalSecurity).toBe(1);
  });
});
