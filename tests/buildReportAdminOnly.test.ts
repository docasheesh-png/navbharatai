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
    expect(panel).toContain('setMobileSheet(null); void sendReportToAdmin();');
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
