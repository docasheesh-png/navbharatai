import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkspaceReports } from '../src/components/admin/WorkspaceBuildReports';

/**
 * EVERY APP HAS A "v" THAT OPENS ITS BUILD REPORTS, AND "ALL BUILDS" LIVES ON THE APPS PAGE (admin 2026-10-15:
 * "apps ke andar hi har app me ek 'v' button … click krne se us app ka build report open ho jaye" and "build
 * se All builds wala colom hata dena").
 *
 * What `tsc` cannot see, and this holds:
 *   1. the All builds card moved — it is no longer on the Build tab and it IS on the Apps page, with its
 *      filters, its "taken" mark and its per-build Copy / Download (no report and no mark was lost);
 *   2. every Apps card carries the "v", the orphaned ones too (the report outlives the workspace);
 *   3. the panel reads the answer honestly — 404 is "no report on file", a failure is an error with retry,
 *      never an empty list that looks like "nothing wrong";
 *   4. Copy / Download from the panel are the DASHBOARD's own functions, because those write the "taken"
 *      mark (one report must not reach two sessions).
 */
const dash = readFileSync('src/components/AdminDashboard.tsx', 'utf8');
const panel = readFileSync('src/components/admin/BuiltAppsPanel.tsx', 'utf8');
const body = readFileSync('src/components/admin/WorkspaceBuildReports.tsx', 'utf8');

/** The source of one admin page's block: from its `activeTab === '<id>' && (` to the next sibling page. */
function pageBlock(id: string): string {
  const start = dash.indexOf(`{activeTab === '${id}' && (`);
  expect(start, `page ${id}`).toBeGreaterThan(-1);
  const next = dash.indexOf('\n          {activeTab === ', start + 10);
  return dash.slice(start, next === -1 ? undefined : next);
}

describe('All builds moved from the Build tab to the Apps page', () => {
  it('is on the Apps page, with its filters, its taken mark and its downloads', () => {
    const apps = pageBlock('apps');
    expect(apps).toContain('All builds — every user, no submit needed');
    expect(apps).toContain('<ReportFilterBar');
    expect(apps).toContain('markBuildTaken(b.workspaceId');
    expect(apps).toContain('downloadWorkspaceReport(b.workspaceId)');
    expect(apps).toContain('downloadWorkspaceReport(b.workspaceId, h.id)');
  });
  it('is NOT on the Build tab any more', () => {
    expect(pageBlock('reports')).not.toContain('All builds — every user, no submit needed');
    expect(pageBlock('reports')).not.toContain('pagedAllBuilds');
  });
  it('its list is loaded when the Apps page opens, not the Build tab', () => {
    expect(dash).toContain("if (activeTab !== 'apps') return; // the All builds card lives on the Apps page");
    expect(dash).not.toMatch(/if \(activeTab !== 'reports'\) return;\s*void fetchAllBuildsRef/);
  });
});

describe('every app card has the "v"', () => {
  it('BuiltAppsPanel renders it from the one card renderer (live, held, banned and orphaned alike)', () => {
    expect(panel).toContain('onViewReport({ workspaceId: d.workspaceId');
    expect(panel).toContain('title="View build report"');
    // ONE renderer serves the orphaned list too — the button is not special-cased away from it.
    expect((panel.match(/onViewReport\(\{/g) || []).length).toBe(1);
    expect(panel).toMatch(/orphan/);
  });
  it('the dashboard opens a dialog for the chosen app, closable by button, backdrop and Escape', () => {
    expect(dash).toContain('onViewReport={setReportApp}');
    expect(dash).toContain('aria-label={`Build reports of ${reportApp.appName}`}');
    expect(dash).toContain("e.key === 'Escape') setReportApp(null)");
  });
  it('Copy / Download in the panel are the dashboard\'s own (they write the "taken" mark)', () => {
    expect(dash).toContain('onCopy={(ws, buildId) => void copyWorkspaceReport(ws, buildId)}');
    expect(dash).toContain('onDownload={(ws, buildId) => void downloadWorkspaceReport(ws, buildId)}');
    expect(body).not.toMatch(/\/download/); // no second download path that could skip the mark
  });
});

describe('the panel reads the route honestly', () => {
  it('404 is "no report on file", never an empty success', () => {
    expect(readWorkspaceReports(404, { error: 'No build reports recorded for this workspace.' })).toEqual({ kind: 'none' });
  });
  it('a failure is an error carrying the server\'s own words', () => {
    expect(readWorkspaceReports(500, { error: 'boom' })).toEqual({ kind: 'error', message: 'boom' });
    expect(readWorkspaceReports(403, null)).toEqual({ kind: 'error', message: 'The server answered 403.' });
  });
  it('a 200 in a shape nobody knows is an error, not an empty list', () => {
    expect(readWorkspaceReports(200, {}).kind).toBe('error');
    expect(readWorkspaceReports(200, 'html').kind).toBe('error');
  });
  it('a real answer keeps what is typed and drops what is not', () => {
    const a = readWorkspaceReports(200, {
      latest: { startedAt: 5, ok: false, summary: 'S', rootCause: 'R', prompt: 'P', junk: 1 },
      history: [{ id: 'h1', startedAt: 1, ok: true, prompt: 'p' }, { nope: true }, { id: 'h2', ok: 'yes' }],
    });
    expect(a).toEqual({
      kind: 'found',
      latest: { startedAt: 5, ok: false, summary: 'S', rootCause: 'R', prompt: 'P' },
      history: [
        { id: 'h1', startedAt: 1, ok: true, prompt: 'p', summary: undefined },
        { id: 'h2', startedAt: undefined, ok: undefined, prompt: undefined, summary: undefined },
      ],
    });
  });
  it('only the latest existing (no history) is still "found"', () => {
    expect(readWorkspaceReports(200, { latest: { ok: true } }).kind).toBe('found');
  });
});
