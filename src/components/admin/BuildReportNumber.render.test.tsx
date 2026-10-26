import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BuildReportNumber } from './BuildReportNumber';
import { isFailedBuildPage } from '../../lib/failedBuildReports';

describe('report numbers on both private lists', () => {
  it('renders the server rank, total and as-of explanation, not an array position', () => {
    const html = renderToStaticMarkup(<BuildReportNumber numbering={{ ordinal: 604, total: 604, asOf: 1792540800000 }} kind="permanent" />);
    expect(html).toContain('#604'); expect(html).toContain('of 604 assigned');
    expect(html).toContain('Permanent failed-report number'); expect(html).toContain('never renumbered');
  });
  it('labels chronological All-builds ranks without calling them permanent', () => {
    const html = renderToStaticMarkup(<BuildReportNumber numbering={{ ordinal: 12, total: 40, asOf: 1792540800000 }} kind="chronological" />);
    expect(html).toContain('#12'); expect(html).toContain('Chronological rank'); expect(html).not.toContain('Permanent failed-report');
  });
  it('describes failed chronological ranks without confusing the latest-workspace cohort', () => {
    const html = renderToStaticMarkup(<BuildReportNumber numbering={{ ordinal: 1, total: 10, asOf: 100 }} kind="failed-chronological" />);
    expect(html).toContain('retained failed reports');
    expect(html).toContain('late-arriving reports');
    expect(html).not.toContain('latest-per-workspace');
    expect(html).not.toContain('never renumbered');
  });
  it('shows loading without blocking the report row', () => {
    expect(renderToStaticMarkup(<BuildReportNumber />)).toContain('…');
  });
  it('shows compact n/a for missing, incomplete and malformed numbering', () => {
    for (const numbering of [{ ordinal: null, total: null, asOf: null }, { ordinal: 0, total: 1, asOf: 100 }]) {
      const html = renderToStaticMarkup(<BuildReportNumber numbering={numbering} />);
      expect(html).toContain('—'); expect(html).toContain('n/a'); expect(html).not.toContain('#0'); expect(html).not.toContain('#1');
    }
  });
  it('does not misdiagnose every missing number as a legacy record', () => {
    const html = renderToStaticMarkup(<BuildReportNumber numbering={{ ordinal: null, total: null, asOf: null, reason: 'snapshot_miss' }} kind="permanent" />);
    expect(html).toContain('—'); expect(html).toContain('n/a'); expect(html).not.toContain('written before numbering'); expect(html).toContain('current numbering snapshot');
    expect(html).not.toContain('#1');
    expect(isFailedBuildPage({ reports: [{ workspaceId: 'a', historyId: '1', startedAt: 1, endedAt: 2, appLabel: 'Synthetic', numbering: { ordinal: null, total: null, asOf: null, reason: 'private-server-error' } }], nextCursor: null, scanned: 1 })).toBe(false);
    expect(() => renderToStaticMarkup(<BuildReportNumber numbering={{ ordinal: null, total: null, asOf: null, reason: '__proto__' } as any} />)).not.toThrow();
  });
  it('rejects malformed supplied numbering at the failed-page state boundary', () => {
    const row = { workspaceId: 'synthetic', historyId: '1', startedAt: 1, endedAt: 2, appLabel: 'Synthetic fixture' };
    expect(isFailedBuildPage({ reports: [{ ...row, numbering: { ordinal: -1, total: 10, asOf: 100 } }], nextCursor: null, scanned: 1 })).toBe(false);
    expect(isFailedBuildPage({ reports: [{ ...row, numbering: { ordinal: 2, total: 10, asOf: 100 } }], nextCursor: null, scanned: 1 })).toBe(true);
  });
  it('wires both lists and preserves authenticated read boundaries and pre-filter numbering', () => {
    const admin = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    const failed = readFileSync('src/components/admin/FailedBuildReportsPage.tsx', 'utf8');
    expect(admin).toContain('<BuildReportNumber numbering={b.numbering} kind="chronological" />');
    expect(failed).toContain('<BuildReportNumber numbering={r.numbering} kind="failed-chronological" />');
    expect(admin).toContain('before filters'); expect(failed).toContain('not just this batch');
    expect(failed).toContain('Numbering is chronological'); expect(admin).toContain('retained-failure chronological ranks on /failedbr');
    expect(failed).toContain('r.permanentReportId');
    const routes = readFileSync('src/server/routes/admin.ts', 'utf8');
    const section = routes.slice(routes.indexOf("app.get('/api/admin/all-builds',"), routes.indexOf("app.get('/api/admin/all-builds/:workspaceId',"));
    expect(section).toContain('verifyAdminToken');
    expect(section).not.toContain('readBuildReportNumbers');
    expect(section).not.toContain('numberBuildReports');
    expect(routes).toContain("app.post('/api/admin/all-builds/numbers', verifyAdminToken");
    const failedRoutes = readFileSync('src/server/routes/failedReports.ts', 'utf8');
    expect(failedRoutes).toContain("app.get('/api/failedbr/reports', readGate");
    expect(failedRoutes).toContain("app.post('/api/failedbr/report-numbers', readGate");
    const listRoute = failedRoutes.slice(failedRoutes.indexOf("app.get('/api/failedbr/reports',"), failedRoutes.indexOf("app.get('/api/failedbr/reports/:workspaceId"));
    expect(listRoute).not.toContain('readBuildReportNumbers');
  });
});
