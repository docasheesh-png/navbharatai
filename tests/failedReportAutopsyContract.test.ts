import { describe, expect, it } from 'vitest';
import { isFailedReportAutopsyView } from '../src/lib/failedReportAutopsy';
const digest = 'a'.repeat(64);
const record = { expectedRevision: 0, revision: 1, reportDigest: digest, status: 'in_progress',
  summary: 'All returned evidence still needs its full itemized review.', ledgerUrl: '', reason: 'Begin review',
  blockers: '', mutationId: '12345678-1234-1234-1234-123456789abc', actor: 'admin:owner', updatedAt: 100,
  workspaceId: 'app', historyId: '100', counts: { total: 2, resolved: 0, blocked: 0 }, verification: null };
const view = { reportDigest: digest, revision: 1, state: 'in_progress', record };
describe('autopsy client response contract', () => {
  it('accepts honest absent, current and explicitly stale records', () => {
    expect(isFailedReportAutopsyView({ reportDigest: digest, revision: 0, state: 'not_started', record: null })).toBe(true);
    expect(isFailedReportAutopsyView(view)).toBe(true);
    expect(isFailedReportAutopsyView({ ...view, state: 'stale', reportDigest: 'b'.repeat(64) })).toBe(true);
  });
  it('rejects fabricated states, impossible counts and missing verification shapes', () => {
    for (const data of [
      { ...view, state: 'done' }, { ...view, state: 'stale' }, { ...view, revision: 0 },
      { ...view, record: { ...record, status: undefined } }, { ...view, record: { ...record, verification: undefined } },
      { ...view, record: { ...record, verification: {} } }, { ...view, record: { ...record, counts: { total: 2, resolved: 3, blocked: 0 } } },
      { ...view, record: { ...record, counts: { total: 2, resolved: 0, blocked: -1 } } },
      { ...view, state: 'done', record: { ...record, status: 'done' } },
    ]) expect(isFailedReportAutopsyView(data)).toBe(false);
  });
});
