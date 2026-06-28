import { describe, it, expect } from 'vitest';
import { BuildDiagnostics, renderDiagnosticsText } from './BuildDiagnostics';
import type { AgentEvent } from './types';

let clock = 1000;
const now = () => (clock += 10);

function fresh() {
  clock = 1000;
  return new BuildDiagnostics({ sessionId: 's1', prompt: 'build a todo app', model: 'claude-sonnet-4-6', framework: 'vite-react', now });
}

describe('BuildDiagnostics', () => {
  it('records an explicit issue (e.g. a provider fallback)', () => {
    const d = fresh();
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'CLAUDE failed, fell back to CLAUDE_HAIKU', autoResolved: true, detail: 'overloaded' });
    const r = d.report();
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].code).toBe('PROVIDER_FALLBACK');
    expect(r.counts.warnings).toBe(1);
    expect(r.counts.autoResolved).toBe(1);
  });

  it('derives a TOOL_ERROR from a failed tool_result event', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_result', agent: 'architect', callId: 'c1', ok: false, summary: 'npm install failed: ERESOLVE', ts: 1 } as AgentEvent);
    const r = d.report();
    expect(r.issues[0].code).toBe('TOOL_ERROR');
    expect(r.issues[0].message).toContain('npm install failed');
  });

  it('captures readiness blockers (unresolved) and warnings (auto-resolved) from the done event', () => {
    const d = fresh();
    d.ingestEvent({ type: 'done', ok: false, summary: 'NOT READY', ts: 1, readiness: { score: 40, ready: false, blockers: ['unresolved import ./Foo'], warnings: ['no error boundary'] } } as AgentEvent);
    const r = d.report();
    const blocker = r.issues.find((i) => i.code === 'READINESS_BLOCKER');
    const warn = r.issues.find((i) => i.code === 'READINESS_WARNING');
    expect(blocker?.autoResolved).toBe(false);
    expect(warn?.autoResolved).toBe(true);
  });

  it('finish(ok=true) back-fills tool errors and nudges as auto-resolved', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_result', agent: 'frontend', callId: 'c1', ok: false, summary: 'tsc error', ts: 1 } as AgentEvent);
    d.record({ phase: 'build', severity: 'warning', code: 'NO_BUILD_NUDGE', message: 'model narrated a plan without building', autoResolved: false });
    d.finish(true, 'Build complete.');
    const r = d.report();
    expect(r.ok).toBe(true);
    expect(r.issues.every((i) => i.autoResolved)).toBe(true);
    expect(r.counts.unresolved).toBe(0);
  });

  it('finish(ok=false) keeps tool errors/nudges UNRESOLVED', () => {
    const d = fresh();
    d.record({ phase: 'build', severity: 'warning', code: 'NO_BUILD_NUDGE', message: 'no files', autoResolved: false });
    d.finish(false, 'failed');
    expect(d.report().counts.unresolved).toBe(1);
  });

  it('renders a readable text report', () => {
    const d = fresh();
    d.record({ phase: 'sandbox', severity: 'error', code: 'SANDBOX_TIMEOUT', message: 'Sandbox.create timed out after 45000ms', autoResolved: false });
    d.finish(false);
    const text = renderDiagnosticsText(d.report());
    expect(text).toContain('Build Diagnostics Report');
    expect(text).toContain('SANDBOX_TIMEOUT');
    expect(text).toContain('UNRESOLVED');
  });

  it('clean build → zero issues, friendly text', () => {
    const d = fresh();
    d.finish(true, 'done');
    const r = d.report();
    expect(r.counts.total).toBe(0);
    expect(renderDiagnosticsText(r)).toContain('No issues recorded');
  });
});
