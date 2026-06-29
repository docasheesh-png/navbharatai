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

  it('fires onUpdate in REAL TIME after every record / ingest / finish', () => {
    const reports: number[] = [];
    const d = new BuildDiagnostics({ now, onUpdate: (r) => reports.push(r.counts.total) });
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'x', autoResolved: true });
    d.ingestEvent({ type: 'tool_result', agent: 'architect', callId: 'c', ok: false, summary: 'boom', ts: 1 } as AgentEvent);
    d.finish(false);
    // 1 after record, 2 after the failed tool_result, and a final emit on finish.
    expect(reports).toEqual([1, 2, 2]);
  });

  it('captures problem narration lines (struggles the agent talks about)', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'port 5173 is not responding yet', ts: 1 } as AgentEvent);
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'Building the UI…', ts: 2 } as AgentEvent); // ignored (no problem keyword)
    const r = d.report();
    expect(r.issues.filter((i) => i.code === 'AGENT_NOTE')).toHaveLength(1);
    expect(r.issues[0].message).toContain('not responding');
  });

  it('clean build → zero issues, friendly text', () => {
    const d = fresh();
    d.finish(true, 'done');
    const r = d.report();
    expect(r.counts.total).toBe(0);
    expect(renderDiagnosticsText(r)).toContain('No issues recorded');
  });
});

describe('BuildDiagnostics — full activity timeline (minute-by-minute, names the hang)', () => {
  it('records every tool call and its completion (with duration) — not only failures', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_call', agent: 'frontend', tool: 'write_file', input: {}, callId: 'c1', ts: 1000 } as AgentEvent);
    d.ingestEvent({ type: 'tool_result', agent: 'frontend', callId: 'c1', ok: true, summary: 'wrote', ts: 3000 } as AgentEvent);
    const r = d.report();
    expect(r.issues.find((i) => i.code === 'TOOL_CALL')?.message).toContain('write_file');
    const done = r.issues.find((i) => i.code === 'TOOL_DONE');
    expect(done?.message).toContain('write_file');
    expect(done?.message).toContain('2s'); // 3000 − 1000 ms
  });

  it('records NORMAL narration as an AGENT_STEP (the timeline), not only problems', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'Building the calculator UI', ts: 1 } as AgentEvent);
    expect(d.report().issues.find((i) => i.code === 'AGENT_STEP')?.message).toContain('Building the calculator UI');
  });

  it('heartbeat() adds a minute marker that NAMES the in-flight tool (so a hang is visible)', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_call', agent: 'frontend', tool: 'bash', input: {}, callId: 'c1', ts: 1000 } as AgentEvent);
    d.heartbeat();
    const hb = d.report().issues.find((i) => i.code === 'HEARTBEAT');
    expect(hb?.message).toContain('still working');
    expect(hb?.message).toContain('bash'); // names what is in-flight
  });

  it('finish(false) names the tool the build was STUCK on (in-flight, never completed)', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_call', agent: 'frontend', tool: 'npm run dev', input: {}, callId: 'c1', ts: 1000 } as AgentEvent);
    // No tool_result → the call is still in-flight when the build is stopped at the deadline.
    d.finish(false, 'timed out');
    const stuck = d.report().issues.find((i) => i.code === 'STUCK_TOOL');
    expect(stuck?.message).toContain('npm run dev');
    expect(stuck?.severity).toBe('error');
  });
});

describe('BuildDiagnostics — AI Diagnosis Bundle (raw logs, LLM I/O, full errors)', () => {
  it('#3 records a sandbox command\'s raw stdout/stderr/exit code', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm install', exitCode: 1, stdout: 'added 0 packages', stderr: 'npm ERR! ERESOLVE could not resolve react@19', durationMs: 4200 });
    const r = d.report();
    expect(r.commands).toHaveLength(1);
    expect(r.commands![0].exitCode).toBe(1);
    expect(r.commands![0].stderr).toContain('ERESOLVE');
    // a failed command also lands on the timeline as an error marker
    const marker = r.issues.find((i) => i.code === 'SANDBOX_CMD_FAILED');
    expect(marker?.severity).toBe('error');
    expect(marker?.message).toContain('exit 1');
  });

  it('#3 a successful command is info (not an error) on the timeline', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm run build', exitCode: 0, stdout: 'built in 3s', stderr: '' });
    const r = d.report();
    expect(r.issues.find((i) => i.code === 'SANDBOX_CMD')?.severity).toBe('info');
    expect(r.issues.find((i) => i.code === 'SANDBOX_CMD_FAILED')).toBeUndefined();
  });

  it('#3 caps very large command output (keeps the tail where the error lives)', () => {
    const d = fresh();
    const huge = 'x'.repeat(50_000) + 'THE_REAL_ERROR_AT_THE_END';
    d.recordCommand({ command: 'tsc', exitCode: 2, stdout: '', stderr: huge });
    const cap = d.report().commands![0].stderr;
    expect(cap.length).toBeLessThan(5000);
    expect(cap).toContain('THE_REAL_ERROR_AT_THE_END'); // tail preserved
    expect(cap).toContain('truncated');
  });

  it('#4 records an LLM call and flags a max_tokens (truncated) finish', () => {
    const d = fresh();
    d.recordLlmCall({ model: 'claude-opus-4', promptPreview: 'build a todo', promptChars: 12, responsePreview: 'import React', responseChars: 12, finishReason: 'max_tokens', toolCalls: 0, inputTokens: 100, outputTokens: 8000, latencyMs: 9000, ok: true });
    const r = d.report();
    expect(r.llmCalls).toHaveLength(1);
    expect(r.llmCalls![0].finishReason).toBe('max_tokens');
    const trunc = r.issues.find((i) => i.code === 'LLM_TRUNCATED');
    expect(trunc?.severity).toBe('warning');
  });

  it('#4 a failed model call is captured as an error on the timeline', () => {
    const d = fresh();
    d.recordLlmCall({ model: 'grok-3', finishReason: null, toolCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 200, ok: false, error: 'provider overloaded' });
    const r = d.report();
    expect(r.llmCalls![0].ok).toBe(false);
    expect(r.issues.find((i) => i.code === 'LLM_CALL_FAILED')?.message).toContain('overloaded');
  });

  it('#4 a normal (end_turn) call adds NO timeline noise, only the channel record', () => {
    const d = fresh();
    d.recordLlmCall({ model: 'claude-opus-4', finishReason: 'end_turn', toolCalls: 1, inputTokens: 50, outputTokens: 200, latencyMs: 1500, ok: true });
    const r = d.report();
    expect(r.llmCalls).toHaveLength(1);
    expect(r.issues).toHaveLength(0); // success + not truncated → no struggle marker
  });

  it('#1 keeps the FULL error message (un-truncated) alongside the short timeline line', () => {
    const d = fresh();
    const long = 'Error: ' + 'detail '.repeat(300) + 'ROOT_CAUSE_FRAME';
    d.ingestEvent({ type: 'error', message: long, ts: 1 } as AgentEvent);
    const r = d.report();
    // timeline line is short (sliced)
    expect(r.issues.find((i) => i.code === 'BUILD_ERROR')?.message.length).toBeLessThanOrEqual(800);
    // full-error channel keeps the whole thing (incl. the tail root cause)
    expect(r.errors).toHaveLength(1);
    expect(r.errors![0].message).toContain('ROOT_CAUSE_FRAME');
  });

  it('renders commands, LLM calls and full errors in the text report', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm install', exitCode: 1, stdout: '', stderr: 'ERESOLVE' });
    d.recordLlmCall({ model: 'claude-opus-4', finishReason: 'max_tokens', toolCalls: 0, inputTokens: 1, outputTokens: 8000, latencyMs: 5000, ok: true, responsePreview: 'partial code' });
    d.recordFullError({ message: 'TypeError: x is not a function', stack: 'at App (src/App.tsx:10)', phase: 'build' });
    const text = renderDiagnosticsText(d.report());
    expect(text).toContain('Sandbox commands');
    expect(text).toContain('ERESOLVE');
    expect(text).toContain('LLM calls');
    expect(text).toContain('Full errors');
    expect(text).toContain('src/App.tsx:10');
  });
});
