import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Build report → admin-only (admin 2026-07-29): the user can no longer download, copy or browse the
 * build report. A single "Report" button submits it to the admin inbox; the admin reads/downloads it
 * from the AdminDashboard "Build Reports" tab. These tests lock that wiring at the source level.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const agentv3 = read('src/server/routes/agentv3.ts');
const admin = read('src/server/routes/admin.ts');
const dash = read('src/components/AdminDashboard.tsx');

describe('User UI — single Report button, no report content shown', () => {
  it('has a sendReportToAdmin handler that POSTs to the admin endpoint', () => {
    expect(panel).toContain('sendReportToAdmin');
    expect(panel).toContain("'/api/agentv3/report-to-admin'");
    expect(panel).toContain('method: \'POST\'');
  });

  // Label wiring UPDATED 2026-08-04 (admin: "report (1), report (2) aise — jisse duplicate report na
  // ho"): the inline ternary became the shared pure `reportButtonLabel`, so the desktop pill and the
  // mobile More sheet cannot drift. The invariant this test exists for is unchanged and still checked
  // below: one send-only Report button, no download/copy/history anywhere in the user UI.
  it('renders the Report button through the shared label helper (send-only, never download/copy)', () => {
    expect(panel).toContain('reportButtonLabel');
    expect(panel).toContain("from './reportSendCount'");
    expect(panel).not.toContain('Download report');
    expect(panel).not.toContain('Copy report');
  });

  it('no user-facing button downloads, copies, or opens report history anymore', () => {
    // The old wiring is gone from the UI (the buttons no longer call these).
    expect(panel).not.toContain("onClick={() => downloadDiagnostics('download')}");
    expect(panel).not.toContain("onClick={() => downloadDiagnostics('copy')}");
    expect(panel).not.toContain('onClick={toggleHistoryReport}');
    expect(panel).not.toContain('onClick={() => void toggleHistoryReport()}');
    // The report action lives in the mobile More sheet (the footer slot it also occupied was a
    // duplicate and now opens Code Studio — see v3FooterApi.test.ts) and still SENDS, never downloads.
    // Since 2026-08-04 it opens the "which build?" picker first, which itself ends in
    // sendReportToAdmin — same invariant (submit-only), one step earlier in the path.
    expect(panel).toContain("setMobileSheet(null); void openReportPicker('sheet');");
    expect(panel).toContain('sendReportToAdmin');
  });
});

/**
 * PICK WHICH BUILD (admin 2026-08-04). "Report" could only send the LATEST build, so a problem from
 * an earlier edit was unreportable. The picker fixes that WITHOUT re-opening the report to users:
 * a row shows only what the user already watched happen.
 */
describe('Report picker — choose the build, still never see the report', () => {
  const picker = read('src/lib/reportPicker.ts');

  it('the server has a picker mode that returns the stripped list, not the history metadata', () => {
    expect(agentv3).toContain("req.query.picker === '1'");
    expect(agentv3).toContain('pickerItems(entries)');
  });

  it('the picker list is built by the tested strip — never by spreading the history entry', () => {
    // A spread would carry summary / rootCause / counts (our analysis, admin-only) onto a user screen.
    expect(picker).not.toMatch(/\.\.\.entry/);
    expect(picker).toContain('label: reportLabel(entry.prompt)');
  });

  it('a picked build is submitted by id, and a missing one fails honestly', () => {
    expect(panel).toContain('if (picked) body.buildId = picked.id;');
    expect(agentv3).toContain("please pick another build");
  });

  it('one build in the chat stays one click — the picker never blocks reporting', () => {
    expect(panel).toContain('if (builds.length < 2) { void sendReportToAdmin(); return; }');
  });

  it('the send count follows the build that was REPORTED, not the one on screen', () => {
    // Reporting a past build must not inflate the current build's tally, or the number the
    // duplicate-report guard depends on stops being true.
    expect(panel).toContain('const countKeyFor = (picked?: ReportPickerItem): string =>');
    expect(panel).toContain('bumpReportSendCount(countKeyFor(picked))');
  });

  it('the submit path validates the active build, like the download path always did', () => {
    // Sibling of the P0 export guard: the client was already sending activeBuildId/promptHash and the
    // server ignored both, so Report could submit a DIFFERENT app's report.
    const at = agentv3.indexOf("app.post('/api/agentv3/report-to-admin'");
    expect(at).toBeGreaterThan(-1);
    const route = agentv3.slice(at, at + 4000);
    expect(route).toContain('body.activeBuildId');
    expect(route).toContain('reportMatchesActiveBuild');
  });
});

describe('Server — report-to-admin + admin-only retrieval', () => {
  it('exposes POST /api/agentv3/report-to-admin (user submits, no content returned)', () => {
    expect(agentv3).toContain("app.post('/api/agentv3/report-to-admin'");
    expect(agentv3).toContain('buildAdminReportRecord');
    expect(agentv3).toContain('saveAdminBuildReport');
  });

  it('admin retrieval routes are gated by verifyAdminToken', () => {
    expect(admin).toMatch(/app\.get\('\/api\/admin\/build-reports',\s*verifyAdminToken/);
    expect(admin).toMatch(/app\.get\('\/api\/admin\/build-reports\/:id',\s*verifyAdminToken/);
  });

  // DELETE / CLEAR (admin 2026-08-16: "delete karne ka option do — agar space kha rahi ho").
  it('the delete + clear routes are admin-gated, and clearing requires an explicit confirm', () => {
    expect(admin).toMatch(/app\.delete\('\/api\/admin\/build-reports\/:id',\s*verifyAdminToken/);
    expect(admin).toMatch(/app\.post\('\/api\/admin\/build-reports\/clear',\s*verifyAdminToken/);
    // The bulk wipe is irreversible — a stray request must not trigger it.
    const at = admin.indexOf("'/api/admin/build-reports/clear'");
    expect(admin.slice(at, at + 400)).toContain('.confirm !== true');
    expect(admin).toContain('deleteAllAdminBuildReports');
    expect(admin).toContain('deleteAdminBuildReport(');
  });
});

describe('Admin UI — Build Reports tab', () => {
  it('AdminDashboard has a reports tab that reads the admin endpoint', () => {
    expect(dash).toContain("id: 'reports'");
    expect(dash).toContain('Build Reports');
    expect(dash).toContain("'/api/admin/build-reports'");
    expect(dash).toContain('downloadSelectedReport');
  });

  it('the reports tab can DELETE a report and CLEAR all — with a confirm, calling the right endpoints', () => {
    expect(dash).toContain('deleteReport');
    expect(dash).toContain('clearAllReports');
    expect(dash).toContain("method: 'DELETE'");
    expect(dash).toContain("'/api/admin/build-reports/clear'");
    // The bulk clear must confirm before it wipes (irreversible).
    expect(dash).toMatch(/clearAllReports[\s\S]{0,400}window\.confirm/);
    expect(dash).toContain('JSON.stringify({ confirm: true })');
  });
});

describe('KB — build report is admin-only', () => {
  it('the agentv3_build_report entry describes the Report button, not download/copy', () => {
    const e = APP_KNOWLEDGE_BASE.find((f) => f.id === 'agentv3_build_report');
    expect(e).toBeTruthy();
    expect(e!.path).toContain('"Report" button');
    expect(e!.description.toLowerCase()).toContain('sent to the navbharatai team');
    expect(e!.description.toLowerCase()).toContain('not shown');
  });
});
