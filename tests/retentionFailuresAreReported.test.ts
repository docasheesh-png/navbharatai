import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { purgeFailureSummary } from '../src/server/lib/DataRetentionManager';

describe('scheduled retention failures are visible without disclosing record data', () => {
  it('reports failed top-level and nested policies, not successful or capped-only policies', () => {
    expect(purgeFailureSummary({
      totalDeleted: 3, collections: [
        { collection: 'admin_failed_report_autopsies', cutoffMs: 1, deleted: 1, error: 'private review data' },
        { collection: 'server_logs', cutoffMs: 1, deleted: 2, capped: true },
      ],
    }, {
      totalDeleted: 0, collections: [
        { collection: 'workspace_diagnostics_v3/*/history', cutoffMs: 1, deleted: 0, error: 'private workspace identifier' },
      ],
    })).toEqual({ count: 2, collections: ['admin_failed_report_autopsies', 'workspace_diagnostics_v3/*/history'], omitted: 0 });
  });
  it('bounds the output and never includes error text or arbitrary collection strings', () => {
    const summary = purgeFailureSummary({ totalDeleted: 0, collections: [
      ...Array.from({ length: 25 }, (_, index) => ({ collection: `store_${String(index).padStart(2, '0')}`,
        cutoffMs: 1, deleted: 0, error: 'DO_NOT_LOG_SECRET' })),
      { collection: 'DO_NOT_LOG/owner/private-row', cutoffMs: 1, deleted: 0, error: 'DO_NOT_LOG_SECRET' },
      { collection: 'x'.repeat(200), cutoffMs: 1, deleted: 0, error: 'DO_NOT_LOG_SECRET' },
    ] });
    expect(summary.count).toBe(27);
    expect(summary.collections).toHaveLength(20);
    expect(summary.omitted).toBe(6);
    expect(JSON.stringify(summary)).not.toContain('DO_NOT_LOG');
    expect(JSON.stringify(summary)).not.toContain('x'.repeat(200));
  });
  it('is silent when no policy failed', () => {
    expect(purgeFailureSummary({ collections: [], totalDeleted: 0 })).toEqual({ count: 0, collections: [], omitted: 0 });
  });
  it('the existing scheduler consumes both failure reports and emits the bounded warning', () => {
    const source = readFileSync(resolve(__dirname, '../server.ts'), 'utf8');
    const run = source.slice(source.indexOf('const runPurge ='), source.indexOf("scheduler.register({ id: 'retention-purge'"));
    expect(run).toContain('purgeFailureSummary(top ??');
    expect(run).toContain('nested ?? { collections: [], totalDeleted: 0 }');
    expect(run).toContain('if (failed.count)');
    expect(run).toContain('retention purge failed for ${failed.count} collection(s)');
    expect(run).toContain("failed.collections.join(', ')");
    expect(run).not.toMatch(/console\.(?:warn|log|error)\([^;]*\.error/);
  });
});
