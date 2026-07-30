import { describe, it, expect } from 'vitest';
import { buildAdminReportRecord, appLabelFromPrompt } from '../src/server/AgentV3/AdminBuildReportStore';
import type { BuildDiagnosticsReport } from '../src/server/AgentV3/BuildDiagnostics';

function baseReport(over: Partial<BuildDiagnosticsReport> = {}): BuildDiagnosticsReport {
  return {
    schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt: 1_000,
    endedAt: 2_000,
    ok: true,
    prompt: 'Build a hospital management app\nwith RBAC and billing',
    summary: 'Built the app successfully.',
    rootCause: undefined,
    counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
    issues: [],
    ...over,
  } as BuildDiagnosticsReport;
}

describe('appLabelFromPrompt', () => {
  it('uses the first non-empty line, capped', () => {
    expect(appLabelFromPrompt('Build a hospital app\nmore detail')).toBe('Build a hospital app');
    expect(appLabelFromPrompt('   \n  Restaurant POS  \n x')).toBe('Restaurant POS');
  });
  it('falls back to a placeholder for empty/absent prompts', () => {
    expect(appLabelFromPrompt('')).toBe('Untitled build');
    expect(appLabelFromPrompt(undefined)).toBe('Untitled build');
    expect(appLabelFromPrompt(null)).toBe('Untitled build');
  });
});

describe('buildAdminReportRecord', () => {
  it('captures verified context metadata + a readable app label', () => {
    const rec = buildAdminReportRecord(baseReport(), {
      userId: 'u1', email: 'user@example.com', workspaceId: 'ws-1', buildId: 'b-9', reportedAt: 5_000,
    });
    expect(rec.meta.userId).toBe('u1');
    expect(rec.meta.email).toBe('user@example.com');
    expect(rec.meta.workspaceId).toBe('ws-1');
    expect(rec.meta.buildId).toBe('b-9');
    expect(rec.meta.ok).toBe(true);
    expect(rec.meta.appLabel).toBe('Build a hospital management app');
    expect(rec.meta.reportedAt).toBe(5_000);
    // The id is deterministic from reportedAt + workspaceId (sanitised).
    expect(rec.meta.id).toBe('5000_ws-1');
  });

  it('snapshots the report (trimmed) so the admin copy cannot later change or vanish', () => {
    const rec = buildAdminReportRecord(baseReport({ summary: 'ok' }), {
      userId: 'u', email: 'e@x.com', workspaceId: 'w', reportedAt: 1,
    });
    expect(rec.report.schema).toBe('navbharatai.v3.build-diagnostics/1');
    expect(rec.report.startedAt).toBe(1_000);
  });

  it('handles a failed build and a missing workspace id honestly', () => {
    const rec = buildAdminReportRecord(baseReport({ ok: false, prompt: '', buildId: 'bx' }), {
      userId: null, email: null, workspaceId: null, reportedAt: 42,
    });
    expect(rec.meta.ok).toBe(false);
    expect(rec.meta.userId).toBeNull();
    expect(rec.meta.appLabel).toBe('Untitled build');
    // buildId falls back to the report's own buildId when the context omits it.
    expect(rec.meta.buildId).toBe('bx');
    expect(rec.meta.id).toBe('42_nows');
  });
});
