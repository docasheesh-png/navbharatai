import { describe, it, expect } from 'vitest';
import { buildAdminReportRecord, appLabelFromPrompt, classifyReportTier } from '../src/server/AgentV3/AdminBuildReportStore';
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

describe('classifyReportTier — free/paid column mapping', () => {
  it('maps the real billing tier strings', () => {
    expect(classifyReportTier('paid')).toBe('paid');
    expect(classifyReportTier('free (welcome bonus — cheap engines)')).toBe('free');
    expect(classifyReportTier('free-list (admin/tester)')).toBe('admin');
    expect(classifyReportTier('billing-off (no charge)')).toBe('free');
  });
  it('is unknown for empty/absent tiers', () => {
    expect(classifyReportTier(null)).toBe('unknown');
    expect(classifyReportTier(undefined)).toBe('unknown');
    expect(classifyReportTier('   ')).toBe('unknown');
  });
});

describe('buildAdminReportRecord', () => {
  it('captures verified context metadata + a readable app label', () => {
    const rec = buildAdminReportRecord(baseReport(), {
      userId: 'u1', email: 'user@example.com', name: 'Asheesh', workspaceId: 'ws-1', buildId: 'b-9', reportedAt: 5_000,
    });
    expect(rec.meta.userId).toBe('u1');
    expect(rec.meta.email).toBe('user@example.com');
    expect(rec.meta.name).toBe('Asheesh');
    expect(rec.meta.workspaceId).toBe('ws-1');
    expect(rec.meta.buildId).toBe('b-9');
    expect(rec.meta.ok).toBe(true);
    expect(rec.meta.appLabel).toBe('Build a hospital management app');
    expect(rec.meta.reportedAt).toBe(5_000);
    // buildMs is endedAt − startedAt from the report (2000 − 1000 in baseReport).
    expect(rec.meta.buildMs).toBe(1_000);
    // The id is deterministic from reportedAt + workspaceId (sanitised).
    expect(rec.meta.id).toBe('5000_ws-1');
  });

  it('derives the free/paid tier from the report billing (admin free/paid column)', () => {
    const paid = buildAdminReportRecord(baseReport({ billing: { userTier: 'paid', billedUsd: 0.5, billedInr: 42, powerMode: false, powerLevel: 'off', noClaude: false } } as Partial<BuildDiagnosticsReport>), {
      userId: 'u', email: 'e@x.com', workspaceId: 'w', reportedAt: 1,
    });
    expect(paid.meta.userTier).toBe('paid');
    expect(paid.meta.tier).toBe('paid');
    expect(paid.meta.billedInr).toBe(42);
    expect(paid.meta.billedUsd).toBe(0.5);

    const free = buildAdminReportRecord(baseReport({ billing: { userTier: 'free-list (admin/tester)', billedUsd: 0, billedInr: 0, powerMode: false, powerLevel: 'weak', noClaude: true } } as Partial<BuildDiagnosticsReport>), {
      userId: 'u', email: 'e@x.com', name: null, workspaceId: 'w', reportedAt: 1,
    });
    expect(free.meta.tier).toBe('admin');
    expect(free.meta.name).toBeNull();
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
