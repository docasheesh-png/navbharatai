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

  it('renders a "Report" button with a sent acknowledgement (no download/copy label)', () => {
    expect(panel).toMatch(/reportSent \? 'Report sent' : 'Report'/);
  });

  it('no user-facing button downloads, copies, or opens report history anymore', () => {
    // The old wiring is gone from the UI (the buttons no longer call these).
    expect(panel).not.toContain("onClick={() => downloadDiagnostics('download')}");
    expect(panel).not.toContain("onClick={() => downloadDiagnostics('copy')}");
    expect(panel).not.toContain('onClick={toggleHistoryReport}');
    expect(panel).not.toContain('onClick={() => void toggleHistoryReport()}');
    // The mobile footer report action submits to admin instead of downloading. Since 2026-08-04 it
    // opens the "which build?" picker first — still a submit path, still no report content shown.
    expect(panel).toContain("buildReport: () => { setMobileSheet(null); void openReportPicker('sheet'); }");
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
    expect(panel).toContain('if (pickedBuildId) body.buildId = pickedBuildId;');
    expect(agentv3).toContain("please pick another build");
  });

  it('one build in the chat stays one click — the picker never blocks reporting', () => {
    expect(panel).toContain('if (builds.length < 2) { void sendReportToAdmin(); return; }');
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
});

describe('Admin UI — Build Reports tab', () => {
  it('AdminDashboard has a reports tab that reads the admin endpoint', () => {
    expect(dash).toContain("id: 'reports'");
    expect(dash).toContain('Build Reports');
    expect(dash).toContain("'/api/admin/build-reports'");
    expect(dash).toContain('downloadSelectedReport');
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
