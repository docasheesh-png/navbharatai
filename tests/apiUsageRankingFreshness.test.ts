import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { summariseUsage, NOT_A_PROVIDER } from '../src/server/lib/usageLedger';

describe('API usage ranking reports history without inventing chain order', () => {
  const dashboard = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
  it('offers a real refresh using the existing analytics request', () => {
    expect(dashboard).toContain('onClick={fetchAnalytics} disabled={loading} aria-label="Refresh API usage ranking"');
    expect(dashboard).toContain("fetch('/api/admin/analytics', { headers })");
  });
  it('updates freshness only on a successful validated response', () => {
    expect(dashboard).toContain("if (a.ok) { setAnalytics(a.value); setAnalyticsError(''); setAnalyticsRefreshedAt(Date.now()); }");
    expect(dashboard).toContain('Last refreshed:');
    expect(dashboard).toContain('Refresh failed. Previously loaded figures may be stale.');
  });
  it('explains the retained-history scope and excludes test-bot inference from claims', () => {
    expect(dashboard).toContain('All retained chat usage records, not the current routing priority.');
    expect(dashboard).toContain('Admin provider test-bot calls are separate.');
    expect(dashboard).toContain('Changing the chain does not reset this history.');
  });
  it('keeps Mitrify and Qubax actual usage in the generic ledger, ranked by counts', () => {
    const rows = ['VERTEX', 'MITRIFY', 'VERTEX', 'QUBAX', 'VERTEX', 'MITRIFY', 'NONE'];
    const usage = summariseUsage(rows.map(providerName => ({ providerName, usageMeasured: false })), () => NaN);
    const ranked = Object.entries(usage.byProvider).filter(([name]) => !(name in NOT_A_PROVIDER)).sort((a, b) => b[1].requests - a[1].requests);
    expect(ranked.map(([name, row]) => [name, row.requests])).toEqual([['VERTEX', 3], ['MITRIFY', 2], ['QUBAX', 1]]);
    expect(usage.calls).toBe(7);
    expect(usage.byProvider.MITRIFY.unpriced).toBe(2);
    expect(usage.byProvider.QUBAX.unpriced).toBe(1);
  });
  it('does not invent records for providers absent from the usage ledger', () => {
    expect(summariseUsage([{ providerName: 'VERTEX' }], () => NaN).byProvider).not.toHaveProperty('MITRIFY');
  });
});
