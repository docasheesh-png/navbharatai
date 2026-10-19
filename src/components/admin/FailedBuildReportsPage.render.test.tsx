import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FailedBuildReportsPage } from './FailedBuildReportsPage';
import { routeForPath } from '../../lib/deepLinkRoute';
import { readFileSync } from 'node:fs';
import { isFailedBuildPage } from '../../lib/failedBuildReports';

describe('private failed-report page', () => {
  it('routes the exact URL through the existing admin sign-in flow, preserving its URL', () => {
    expect(routeForPath('/failedbr/')?.view).toBe('admin');
    expect(routeForPath('/failedbr?token=bad')).toBeNull();
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("['/admin', '/failedbr']");
    expect(app).toContain('failedReports={');
    const panel = readFileSync('src/components/panels/AdminLoginPanel.tsx', 'utf8');
    expect(panel.indexOf('!isAdmin ?')).toBeLessThan(panel.indexOf('failedReports ? <FailedBuildReportsPage'));
  });
  it('renders honest loading and connection instructions without a report or credential', () => {
    const html = renderToStaticMarkup(<FailedBuildReportsPage token="never-in-markup" onLogout={() => {}} />);
    expect(html).toContain('Private'); expect(html).toContain('Waiting for reports');
    expect(html).toContain('does not connect an AI account automatically');
    expect(html).not.toContain('never-in-markup'); expect(html).not.toContain('nbfr_');
    expect(html).not.toContain('No failed builds');
  });
  it('does not accept an error response as a successful empty page', () => {
    expect(isFailedBuildPage({ error: 'Unauthorized' })).toBe(false);
    expect(isFailedBuildPage({ reports: [], nextCursor: null, scanned: 2 })).toBe(true);
    expect(isFailedBuildPage({ reports: [{ workspaceId: 4 }], nextCursor: null, scanned: 2 })).toBe(false);
  });
});
