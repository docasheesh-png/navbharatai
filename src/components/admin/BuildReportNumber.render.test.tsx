import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BuildReportNumber } from './BuildReportNumber';
import { isFailedBuildPage } from '../../lib/failedBuildReports';

describe('report numbers on both private lists', () => {
  it('renders the server rank, total and as-of explanation, not an array position', () => {
    const html = renderToStaticMarkup(<BuildReportNumber numbering={{ ordinal: 604, total: 604, asOf: 1792540800000 }} />);
    expect(html).toContain('#604'); expect(html).toContain('of 604 retained reports as of');
    expect(html).toContain('Oldest is 1'); expect(html).toContain('not a permanent report ID');
  });
  it('shows loading without blocking the report row', () => {
    expect(renderToStaticMarkup(<BuildReportNumber />)).toContain('Number loading');
  });
  it('shows explicit unavailable state during missing, incomplete and malformed numbering', () => {
    for (const numbering of [{ ordinal: null, total: null, asOf: null }, { ordinal: 0, total: 1, asOf: 100 }]) {
      const html = renderToStaticMarkup(<BuildReportNumber numbering={numbering} />);
      expect(html).toContain('Number unavailable'); expect(html).not.toContain('#0'); expect(html).not.toContain('#1');
    }
  });
  it('rejects malformed supplied numbering at the failed-page state boundary', () => {
    const row = { workspaceId: 'synthetic', historyId: '1', startedAt: 1, endedAt: 2, appLabel: 'Synthetic fixture' };
    expect(isFailedBuildPage({ reports: [{ ...row, numbering: { ordinal: -1, total: 10, asOf: 100 } }], nextCursor: null, scanned: 1 })).toBe(false);
    expect(isFailedBuildPage({ reports: [{ ...row, numbering: { ordinal: 2, total: 10, asOf: 100 } }], nextCursor: null, scanned: 1 })).toBe(true);
  });
  it('wires both lists and preserves authenticated read boundaries and pre-filter numbering', () => {
    const admin = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
    const failed = readFileSync('src/components/admin/FailedBuildReportsPage.tsx', 'utf8');
    expect(admin).toContain('<BuildReportNumber numbering={b.numbering} />');
    expect(failed).toContain('<BuildReportNumber numbering={r.numbering} />');
    expect(admin).toContain('before filters'); expect(failed).toContain('not just this batch');
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
