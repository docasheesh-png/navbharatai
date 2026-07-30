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
    // The mobile footer report action now sends to admin instead of downloading.
    expect(panel).toContain('buildReport: () => { setMobileSheet(null); void sendReportToAdmin(); }');
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
