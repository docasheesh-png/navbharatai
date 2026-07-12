import { describe, it, expect } from 'vitest';
import { BuildDiagnostics, renderDiagnosticsText, renderSessionDiagnosticsText, capSessionReports, formatProviderDelivery, deriveRootCause, capProblems, isExpectedNonzeroExit, type BuildDiagnosticsReport } from './BuildDiagnostics';
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
    expect(renderDiagnosticsText(r)).toContain('No problems recorded');
  });
});

describe('dedup (P-REPORT.1 — repeated identical entries collapse instead of bloating the timeline)', () => {
  it('collapses back-to-back identical tool calls into one entry with a repeatCount', () => {
    const d = fresh();
    for (let i = 0; i < 5; i++) d.ingestEvent({ type: 'tool_call', tool: 'write_file', callId: `c${i}`, ts: i } as unknown as AgentEvent);
    const r = d.report();
    // 5 identical "▶ write_file" TOOL_CALL entries collapse into ONE, not 5.
    const toolCalls = r.issues.filter((i) => i.code === 'TOOL_CALL');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].repeatCount).toBe(5);
    expect(r.counts.total).toBe(1);
  });

  it('does NOT collapse entries with different messages (different tool names)', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_call', tool: 'write_file', callId: 'c1' } as unknown as AgentEvent);
    d.ingestEvent({ type: 'tool_call', tool: 'read_file', callId: 'c2' } as unknown as AgentEvent);
    const r = d.report();
    expect(r.issues.filter((i) => i.code === 'TOOL_CALL')).toHaveLength(2);
  });

  it('does NOT collapse the same message if something else happened in between', () => {
    const d = fresh();
    d.record({ phase: 'build', severity: 'info', code: 'AGENT_STEP', message: 'Setting up your workspace…', autoResolved: true });
    d.record({ phase: 'build', severity: 'info', code: 'AGENT_STEP', message: 'Planning the file list…', autoResolved: true });
    d.record({ phase: 'build', severity: 'info', code: 'AGENT_STEP', message: 'Setting up your workspace…', autoResolved: true });
    const r = d.report();
    expect(r.issues).toHaveLength(3); // all three are distinct positions, no collapsing across a gap
  });
});

describe('problems (P-REPORT.2 — noise-free "problems only" view)', () => {
  it('excludes info-level entries (tool calls, heartbeats, progress narration)', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_call', tool: 'write_file', callId: 'c1' } as unknown as AgentEvent);
    d.heartbeat();
    d.record({ phase: 'build', severity: 'info', code: 'AGENT_STEP', message: 'Setting up your workspace…', autoResolved: true });
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'fell back to Haiku', autoResolved: true });
    const r = d.report();
    expect(r.issues.length).toBeGreaterThan(1); // the full timeline still has everything
    expect(r.problems).toHaveLength(1); // only the real warning survives
    expect(r.problems[0].code).toBe('PROVIDER_FALLBACK');
  });

  it('is an empty array (not undefined) on a clean build', () => {
    const d = fresh();
    d.finish(true, 'done');
    expect(d.report().problems).toEqual([]);
  });

  it('is bounded to the most recent entries even when a build produces an unusually large number of real problems', () => {
    const d = fresh();
    for (let i = 0; i < 400; i++) d.record({ phase: 'build', severity: 'error', code: 'E', message: `error ${i}`, autoResolved: false });
    const r = d.report();
    expect(r.problems.length).toBeLessThanOrEqual(300);
    expect(r.problems[r.problems.length - 1].message).toBe('error 399'); // newest kept
  });
});

describe('capProblems (bounds the problems view; shared by BuildDiagnostics.report() and trimReportForStorage)', () => {
  it('leaves a short list untouched', () => {
    const list = [{ ts: 1, phase: 'build' as const, severity: 'error' as const, code: 'E', message: 'x', autoResolved: false }];
    expect(capProblems(list)).toEqual(list);
  });
  it('keeps the newest (tail) entries when over the cap', () => {
    const list = Array.from({ length: 350 }, (_, i) => ({ ts: i, phase: 'build' as const, severity: 'error' as const, code: 'E', message: `m${i}`, autoResolved: false }));
    const capped = capProblems(list);
    expect(capped.length).toBe(300);
    expect(capped[capped.length - 1].message).toBe('m349');
    expect(capped[0].message).toBe('m50'); // the oldest 50 were dropped
  });
});

// Autopsy 2026-07-11 (Todo report): a fully-built app whose real-browser preview check "renders
// correctly" was STILL reported as BUILD_PARTIAL — the promised BUILD_PARTIAL→BUILD_SUCCESS upgrade
// was never wired, so deriveRootCause (last OUTCOME_*) reported a false verdict for a working app.
describe('recordPreviewVerified — the deferred BUILD_PARTIAL → BUILD_SUCCESS honesty upgrade', () => {
  it('upgrades a BUILD_PARTIAL to BUILD_SUCCESS once the browser confirmed the app renders (THE bug)', () => {
    const d = fresh();
    d.record({ phase: 'build', severity: 'info', code: 'OUTCOME_BUILD_PARTIAL', message: 'Build outcome: BUILD_PARTIAL', autoResolved: true });
    expect(d.recordPreviewVerified()).toBe(true);
    const r = d.report();
    // The report's root cause is now the honest, verified success — not the stale "partial".
    expect(r.rootCause).toBe('Build outcome: BUILD_SUCCESS');
    expect(r.issues[r.issues.length - 1].code).toBe('OUTCOME_BUILD_SUCCESS');
  });

  it('upgrades a PREVIEW_FAILED to BUILD_SUCCESS when a heal pass made it render', () => {
    const d = fresh();
    d.record({ phase: 'build', severity: 'info', code: 'OUTCOME_PREVIEW_FAILED', message: 'Build outcome: PREVIEW_FAILED', autoResolved: true });
    expect(d.recordPreviewVerified()).toBe(true);
    expect(d.report().rootCause).toBe('Build outcome: BUILD_SUCCESS');
  });

  it('NEVER papers over a real build failure — a TYPECHECK_FAILED is left untouched', () => {
    const d = fresh();
    d.record({ phase: 'build', severity: 'warning', code: 'OUTCOME_TYPECHECK_FAILED', message: 'Build outcome: TYPECHECK_FAILED', autoResolved: false });
    expect(d.recordPreviewVerified()).toBe(false);
    expect(d.report().rootCause).toBe('Build outcome: TYPECHECK_FAILED');
  });

  it('NEVER upgrades a BUILD_FAILED (no files produced)', () => {
    const d = fresh();
    d.record({ phase: 'build', severity: 'info', code: 'OUTCOME_BUILD_FAILED', message: 'Build outcome: BUILD_FAILED', autoResolved: true });
    expect(d.recordPreviewVerified()).toBe(false);
  });

  it('no-ops when no outcome was classified yet', () => {
    const d = fresh();
    expect(d.recordPreviewVerified()).toBe(false);
    expect(d.report().issues.find((i) => i.code.startsWith('OUTCOME_'))).toBeUndefined();
  });

  it('is idempotent — a second call after the upgrade does not stack another SUCCESS', () => {
    const d = fresh();
    d.record({ phase: 'build', severity: 'info', code: 'OUTCOME_BUILD_PARTIAL', message: 'Build outcome: BUILD_PARTIAL', autoResolved: true });
    expect(d.recordPreviewVerified()).toBe(true);
    expect(d.recordPreviewVerified()).toBe(false); // last outcome is already SUCCESS → nothing to do
    expect(d.report().issues.filter((i) => i.code === 'OUTCOME_BUILD_SUCCESS')).toHaveLength(1);
  });
});

describe('deriveRootCause (P-REPORT.3 — the root cause, not buried in 180 mixed entries)', () => {
  it('prefers the deterministic BuildOutcome classification above everything else', () => {
    const issues = [
      { ts: 1, phase: 'build' as const, severity: 'error' as const, code: 'BUILD_ERROR', message: 'some error', autoResolved: false },
      { ts: 2, phase: 'build' as const, severity: 'info' as const, code: 'OUTCOME_TYPECHECK_FAILED', message: 'Build outcome: TYPECHECK_FAILED', autoResolved: true },
    ];
    expect(deriveRootCause({ issues })).toBe('Build outcome: TYPECHECK_FAILED');
  });

  it('falls back to the reviewer\'s first [CRITICAL] finding when no outcome was recorded', () => {
    const review = '[CRITICAL] **Missing Features.css file** - the import has no matching file.\n[WARNING] logo path wrong.';
    expect(deriveRootCause({ issues: [], review })).toBe('Critical issue found by review: **Missing Features.css file** - the import has no matching file.');
  });

  it('falls back to the first fully-captured error', () => {
    const errors = [{ ts: 1, phase: 'build' as const, message: 'Cannot find module \'./Features.css\'' }];
    expect(deriveRootCause({ issues: [], errors })).toBe('Error: Cannot find module \'./Features.css\'');
  });

  it('falls back to the first real (non-info) problem on the timeline', () => {
    const issues = [
      { ts: 1, phase: 'build' as const, severity: 'info' as const, code: 'AGENT_STEP', message: 'Setting up…', autoResolved: true },
      { ts: 2, phase: 'tool' as const, severity: 'warning' as const, code: 'TOOL_ERROR', message: 'npm install failed', autoResolved: false },
    ];
    expect(deriveRootCause({ issues })).toBe('npm install failed');
  });

  it('reports an honest "no problems" once the build settled clean', () => {
    expect(deriveRootCause({ issues: [], ok: true })).toBe('Build completed successfully with no problems recorded.');
  });

  it('reports an honest "no specific error captured" for a settled failure with nothing recorded', () => {
    expect(deriveRootCause({ issues: [], ok: false })).toBe('Build did not succeed, but no specific error was captured.');
  });

  it('returns undefined while still running (ok not yet set) with nothing to report', () => {
    expect(deriveRootCause({ issues: [] })).toBeUndefined();
  });

  it('prefers an UNRESOLVED problem over an earlier, merely-routine auto-resolved one (real report regression)', () => {
    // Real report: a routine "Provider GLM failed — falling back" (auto-resolved — the resilience
    // mechanism WORKING as intended, not a failure) was chosen as root cause ahead of a genuine
    // unresolved pkill command failure later in the SAME build. The unresolved one is the real signal.
    const issues = [
      { ts: 1, phase: 'provider' as const, severity: 'warning' as const, code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed — falling back to the next provider', autoResolved: true },
      { ts: 2, phase: 'provider' as const, severity: 'warning' as const, code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed — falling back to the next provider', autoResolved: true },
      { ts: 3, phase: 'build' as const, severity: 'error' as const, code: 'SANDBOX_CMD_FAILED', message: '$ pkill -f "vite" || true → exit -1 (0s)', autoResolved: false },
    ];
    expect(deriveRootCause({ issues })).toBe('$ pkill -f "vite" || true → exit -1 (0s)');
  });

  it('prefers an error over a warning when both are auto-resolved and nothing is unresolved', () => {
    const issues = [
      { ts: 1, phase: 'provider' as const, severity: 'warning' as const, code: 'PROVIDER_FALLBACK', message: 'fell back to Haiku', autoResolved: true },
      { ts: 2, phase: 'build' as const, severity: 'error' as const, code: 'BUILD_ERROR', message: 'transient error, later recovered', autoResolved: true },
    ];
    expect(deriveRootCause({ issues })).toBe('transient error, later recovered');
  });
});

describe('renderDiagnosticsText — root cause first, problems (not the full noisy timeline) by default', () => {
  it('puts ROOT CAUSE at the top and lists only problems, noting how many info entries were omitted', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_call', tool: 'write_file', callId: 'c1' } as unknown as AgentEvent);
    d.record({ phase: 'build', severity: 'error', code: 'BUILD_ERROR', message: 'compile failed', autoResolved: false });
    d.finish(false, 'failed');
    const text = renderDiagnosticsText(d.report());
    const rootCauseIdx = text.indexOf('ROOT CAUSE:');
    const problemsIdx = text.indexOf('Problems (');
    expect(rootCauseIdx).toBeGreaterThan(-1);
    expect(problemsIdx).toBeGreaterThan(rootCauseIdx); // root cause comes BEFORE the problems list
    expect(text).toContain('compile failed');
    expect(text).not.toContain('▶ write_file'); // the info-level tool call is excluded from the default view
    expect(text).toMatch(/\+\d+ informational timeline entries/); // honestly notes what was omitted (no silent caps)
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

  it('#3 a command explicitly guarded with "|| true" never surfaces as an unresolved failure, even on a non-zero/signaled exit', () => {
    // Root-caused 2026-07-01: E2B's remote sandbox daemon can report exitCode -1 / "signal: terminated"
    // for the wrapper bash of a `pkill -f "vite" || true` command due to an external SIGTERM the guard
    // can't intercept — but the caller's `|| true` is unambiguous intent that this command's outcome
    // should never be treated as a real build problem.
    const d = fresh();
    d.recordCommand({ command: 'pkill -f "vite" || true', exitCode: -1, stdout: '', stderr: 'signal: terminated' });
    const r = d.report();
    expect(r.issues.find((i) => i.code === 'SANDBOX_CMD')?.severity).toBe('info');
    expect(r.issues.find((i) => i.code === 'SANDBOX_CMD_FAILED')).toBeUndefined();
    expect(r.issues.find((i) => i.code === 'SANDBOX_CMD')?.autoResolved).toBe(true);
    // the raw command record (for the AI Diagnosis Bundle) still keeps the real exit code — only the
    // timeline classification changes, no data is hidden.
    expect(r.commands![0].exitCode).toBe(-1);
  });

  it('#3 a REAL command failure (npm/tsc/vite non-zero) still surfaces as an unresolved failure', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm run build', exitCode: 1, stdout: '', stderr: 'Build failed' });
    const marker = d.report().issues.find((i) => i.code === 'SANDBOX_CMD_FAILED');
    expect(marker?.severity).toBe('error');
    expect(marker?.autoResolved).toBe(false);
  });

  it('#3 a routine inspector/probe exit is NOT a failure (grep no-match, pkill no-proc, ss/curl probe) — admin-authorized 2026-07-03', () => {
    // These all return non-zero WITHOUT anything being wrong. Flagging them made a clean build look
    // error-ridden (a real report showed 12 "errors", 6 of them just grep/curl/ss no-match exits).
    const routines: Array<{ command: string; exitCode: number }> = [
      { command: 'pkill -f "vite"', exitCode: -1 },                                  // no process / external signal
      { command: 'grep -c "ButtonType" dist/assets/index-abc.js', exitCode: 1 },      // grep: 0 matches
      { command: 'npx tsc --noEmit 2>&1 | grep -v "test|vitest"', exitCode: 1 },       // pipeline exit = grep's, not tsc's
      { command: 'ss -tlnp | grep -E "5173"', exitCode: 1 },                            // nothing listening
      { command: 'curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/', exitCode: 7 }, // conn refused (probe)
    ];
    for (const r of routines) {
      const d = fresh();
      d.recordCommand({ command: r.command, exitCode: r.exitCode, stdout: '', stderr: '' });
      const rep = d.report();
      expect(rep.issues.find((i) => i.code === 'SANDBOX_CMD_FAILED'), r.command).toBeUndefined();
      expect(rep.issues.find((i) => i.code === 'SANDBOX_CMD')?.severity, r.command).toBe('info');
    }
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

  it('#1 captures offending files on a compile failure (de-dupes by path, latest wins)', () => {
    const d = fresh();
    d.recordFile({ path: 'src/Calculator.tsx', content: 'const { input } = useCalculator();', note: 'referenced by a compile error' });
    d.recordFile({ path: 'src/useCalculator.ts', content: 'export function useCalculator(){ return { display } }' });
    d.recordFile({ path: 'src/Calculator.tsx', content: 'const { display } = useCalculator(); // fixed' }); // same path → replace
    const r = d.report();
    expect(r.generatedFiles).toHaveLength(2);
    expect(r.generatedFiles!.find((f) => f.path === 'src/Calculator.tsx')!.content).toContain('fixed');
    expect(r.generatedFiles!.find((f) => f.path === 'src/useCalculator.ts')!.note).toBeUndefined();
  });

  it('#1 caps very large file content', () => {
    const d = fresh();
    d.recordFile({ path: 'big.ts', content: 'x'.repeat(20_000) });
    expect(d.report().generatedFiles![0].content.length).toBeLessThan(6500);
    expect(d.report().generatedFiles![0].content).toContain('truncated');
  });

  it('captures a PREVIEW failure (in-browser/live) into a previewErrors channel + timeline', () => {
    const d = fresh();
    d.recordPreviewError({ source: 'in-browser', message: "Cannot resolve './x' imported by src/App.tsx" });
    const r = d.report();
    expect(r.previewErrors).toHaveLength(1);
    expect(r.previewErrors![0].source).toBe('in-browser');
    expect(r.previewErrors![0].message).toContain('Cannot resolve');
    const marker = r.issues.find((i) => i.code === 'PREVIEW_ERROR');
    expect(marker?.severity).toBe('error');
  });

  it('ignores an immediate duplicate preview error (same source+message)', () => {
    const d = fresh();
    d.recordPreviewError({ source: 'in-browser', message: 'boom' });
    d.recordPreviewError({ source: 'in-browser', message: 'boom' });
    expect(d.report().previewErrors).toHaveLength(1);
  });

  it('captures the FULL reviewer findings (not the truncated timeline line) + renders them', () => {
    const d = fresh();
    const longReview = '## Code Review\n' + Array.from({ length: 40 }, (_, i) => `[WARNING ${i}] small problem number ${i}`).join('\n');
    d.recordReview(longReview);
    const r = d.report();
    expect(r.review).toContain('small problem number 39'); // full list kept, not 400-char snippet
    const text = renderDiagnosticsText(r);
    expect(text).toContain('Quality review (all flagged problems)');
    expect(text).toContain('small problem number 39');
  });

  it('renders commands, LLM calls and full errors in the text report', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm install', exitCode: 1, stdout: '', stderr: 'ERESOLVE' });
    d.recordLlmCall({ model: 'claude-opus-4', finishReason: 'max_tokens', toolCalls: 0, inputTokens: 1, outputTokens: 8000, latencyMs: 5000, ok: true, responsePreview: 'partial code' });
    d.recordFullError({ message: 'TypeError: x is not a function', stack: 'at App (src/App.tsx:10)', phase: 'build' });
    d.recordFile({ path: 'src/Calculator.tsx', content: 'const { input } = useCalculator();', note: 'referenced by a compile error' });
    d.recordPreviewError({ source: 'in-browser', message: 'Run src/App.tsx: x is not defined' });
    const text = renderDiagnosticsText(d.report());
    expect(text).toContain('Sandbox commands');
    expect(text).toContain('ERESOLVE');
    expect(text).toContain('LLM calls');
    expect(text).toContain('Full errors');
    expect(text).toContain('src/App.tsx:10');
    expect(text).toContain('Offending files');
    expect(text).toContain('useCalculator');
    expect(text).toContain('Preview errors');
    expect(text).toContain('x is not defined');
  });
});

describe('provider delivery — "kaun sa reply kis provider se aaya" in the build report', () => {
  it('formatProviderDelivery orders dominant-first with singular/plural turns', () => {
    expect(formatProviderDelivery({ GLM: 18, CLAUDE: 2 })).toBe('GLM (18 turns), CLAUDE (2 turns)');
    expect(formatProviderDelivery({ CLAUDE: 1 })).toBe('CLAUDE (1 turn)');
    expect(formatProviderDelivery({ GLM: 1, CLAUDE: 9 })).toBe('CLAUDE (9 turns), GLM (1 turn)');
  });
  it('formatProviderDelivery returns null when nothing was recorded', () => {
    expect(formatProviderDelivery(undefined)).toBeNull();
    expect(formatProviderDelivery({})).toBeNull();
    expect(formatProviderDelivery({ GLM: 0 })).toBeNull();
  });
  it('recordProviderTurn accumulates per provider and surfaces in the report + text', () => {
    const d = new BuildDiagnostics({ now: () => clock });
    d.recordProviderTurn('GLM');
    d.recordProviderTurn('GLM');
    d.recordProviderTurn('CLAUDE');
    const r = d.report();
    expect(r.providerDelivery).toEqual({ GLM: 2, CLAUDE: 1 });
    // 2026-07-11: the headline now leads with the DOMINANT builder + keeps the full split after it.
    expect(renderDiagnosticsText(r)).toContain('Built by : GLM — full split: GLM (2 turns), CLAUDE (1 turn)');
  });
  it('omits the "Built by" line when no provider turns were recorded', () => {
    const d = new BuildDiagnostics({ now: () => clock });
    expect(d.report().providerDelivery).toBeUndefined();
    expect(renderDiagnosticsText(d.report())).not.toContain('Built by');
  });
});

describe('renderSessionDiagnosticsText — the FULL SESSION report (0 → last), not just the last build', () => {
  const mk = (over: Partial<BuildDiagnosticsReport>): BuildDiagnosticsReport => ({
    schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt: 1000,
    counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
    issues: [],
    problems: [],
    ...over,
  });

  it('stitches every build in order, with a per-build message header and a session total', () => {
    const b1 = mk({ prompt: 'make a note app', startedAt: 1000, endedAt: 2000, ok: true, counts: { total: 1, errors: 1, warnings: 0, autoResolved: 0, unresolved: 1 } });
    const b2 = mk({ prompt: 'add a login button', startedAt: 3000, endedAt: 4000, ok: false, counts: { total: 2, errors: 0, warnings: 2, autoResolved: 0, unresolved: 0 } });
    const out = renderSessionDiagnosticsText([b1, b2]);
    expect(out).toContain('FULL SESSION BUILD REPORT');
    expect(out).toContain('Builds in this session : 2');
    expect(out).toContain('BUILD 1 of 2');
    expect(out).toContain('BUILD 2 of 2');
    expect(out).toContain('Message: make a note app');
    expect(out).toContain('Message: add a login button');
    // session totals sum across builds: 1 error + (2 warnings) + 1 unresolved
    expect(out).toContain('1 error(s), 2 warning(s), 1 unresolved');
    // build 1 appears before build 2 (oldest → newest order preserved)
    expect(out.indexOf('make a note app')).toBeLessThan(out.indexOf('add a login button'));
  });

  it('handles an empty session without throwing', () => {
    expect(renderSessionDiagnosticsText([])).toContain('No builds recorded');
  });

  it('a single-build session still renders with the session header', () => {
    const out = renderSessionDiagnosticsText([mk({ prompt: 'solo build', ok: true })]);
    expect(out).toContain('Builds in this session : 1');
    expect(out).toContain('Message: solo build');
  });
});

describe('isExpectedNonzeroExit — routine non-zero exits that are NOT build failures', () => {
  it('exit 0 / null is never "expected non-zero"', () => {
    expect(isExpectedNonzeroExit('grep x f', 0)).toBe(false);
    expect(isExpectedNonzeroExit('grep x f', null)).toBe(false);
  });
  it('an explicit "|| true" guard is always routine', () => {
    expect(isExpectedNonzeroExit('pkill -f vite || true', -1)).toBe(true);
    expect(isExpectedNonzeroExit('anything-here || true', 3)).toBe(true);
  });
  it('inspector exit 1 (no match) and negative signals are routine; other codes are NOT', () => {
    for (const base of ['grep', 'pkill', 'pgrep', 'ss', 'netstat', 'lsof', 'fuser', 'ps', 'which']) {
      expect(isExpectedNonzeroExit(`${base} something`, 1), base).toBe(true);
      expect(isExpectedNonzeroExit(`${base} something`, -1), base).toBe(true);
      expect(isExpectedNonzeroExit(`${base} something`, 2), base).toBe(false); // a real syntax/other error still counts
    }
  });
  it('uses the LAST pipeline segment (grep-tailed tsc is grep, not tsc)', () => {
    expect(isExpectedNonzeroExit('npx tsc --noEmit 2>&1 | grep -v test', 1)).toBe(true);
    expect(isExpectedNonzeroExit('cat dist/x.js | grep -c Foo', 1)).toBe(true);
  });
  it('curl connection-probe exits (7/6/28) are routine; a real curl error (22) is not', () => {
    expect(isExpectedNonzeroExit('curl -s http://localhost:5173/', 7)).toBe(true);
    expect(isExpectedNonzeroExit('curl -s http://localhost:5173/', 28)).toBe(true);
    expect(isExpectedNonzeroExit('curl -f http://x/', 22)).toBe(false);
  });
  it('a genuine build command failing is NEVER routine', () => {
    expect(isExpectedNonzeroExit('npm install', 1)).toBe(false);
    expect(isExpectedNonzeroExit('npm run build', 1)).toBe(false);
    expect(isExpectedNonzeroExit('npx tsc --noEmit', 2)).toBe(false);
    expect(isExpectedNonzeroExit('vite build', 1)).toBe(false);
  });
});

describe('capSessionReports — the session download must actually LOAD (the "Load failed" fix)', () => {
  const mk = (id: number, size: number) => ({ id, pad: 'x'.repeat(size) });

  it('keeps everything when under budget (order preserved oldest → newest)', () => {
    const reports = [mk(1, 100), mk(2, 100), mk(3, 100)];
    const { kept, omitted } = capSessionReports(reports, 10_000);
    expect(kept.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(omitted).toBe(0);
  });

  it('drops the OLDEST builds first when over budget and counts them honestly', () => {
    // Each entry serializes to ~ size+20 bytes; budget fits ~2 of them.
    const reports = [mk(1, 500), mk(2, 500), mk(3, 500)];
    const { kept, omitted } = capSessionReports(reports, 1_100);
    expect(kept.map((r) => r.id)).toEqual([2, 3]); // newest kept, oldest dropped
    expect(omitted).toBe(1);
  });

  it('always keeps the newest build even when it alone exceeds the budget (never an empty report)', () => {
    const reports = [mk(1, 100), mk(2, 5_000)];
    const { kept, omitted } = capSessionReports(reports, 1_000);
    expect(kept.map((r) => r.id)).toEqual([2]);
    expect(omitted).toBe(1);
  });

  it('empty input → empty output, zero omitted', () => {
    expect(capSessionReports([], 1_000)).toEqual({ kept: [], omitted: 0 });
  });
});

describe('narration classification — long analytical prose is never a fake error (2026-07-07 x3)', () => {
  it('records a SURVEY containing "No error boundaries" as an info AGENT_STEP, not an error/rootCause', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    const survey = [
      "Here's an honest survey of the imported app:",
      '## App Survey', '| Layer | Technology |', '|---|---|', '| UI | React |',
      'Notable: No error boundaries. Package versions are fairly old.',
      'What would you like to do with this app?',
    ].join('\n');
    d.ingestEvent({ type: 'narration', agent: 'architect', text: survey, ts: 1 } as AgentEvent);
    const r = d.report();
    const note = r.issues.find((i) => i.message.startsWith("Here's an honest survey"));
    expect(note?.severity).toBe('info');
    expect(note?.code).toBe('AGENT_STEP');
    expect(r.problems.some((p) => p.message.startsWith("Here's an honest survey"))).toBe(false);
  });
  it('still flags a SHORT real status problem as a warning/error', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'The dev server timed out on port 5173 — retrying.', ts: 1 } as AgentEvent);
    const r = d.report();
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe('Fix 37 — failure memory + data-loss forensics live IN the report', () => {
  it('stamps priorFailedBuilds so a repeat failure never looks like a first attempt', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.setPriorFailedBuilds(3);
    expect(d.report().priorFailedBuilds).toBe(3);
    d.setPriorFailedBuilds(-1); // invalid input ignored
    expect(d.report().priorFailedBuilds).toBe(3);
  });
  it('records a data-loss event WITH its observed cause ("data kyu udha")', () => {
    const d = new BuildDiagnostics({ now: () => 42 });
    d.recordDataLoss('sandbox recycled/empty', 'durable store holds 63 file(s); the live sandbox listed 0 — restoring 63 (mode: full).');
    const r = d.report();
    expect(r.dataLossEvents).toHaveLength(1);
    expect(r.dataLossEvents?.[0].cause).toBe('sandbox recycled/empty');
    expect(r.dataLossEvents?.[0].detail).toContain('restoring 63');
    // Also visible on the timeline as a warning, so the problems view carries it too.
    expect(r.issues.some((i) => i.code === 'DATA_LOSS_EVENT' && i.severity === 'warning')).toBe(true);
  });
  it('omits the fields entirely when nothing was recorded (clean builds stay clean)', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    expect(d.report().priorFailedBuilds).toBeUndefined();
    expect(d.report().dataLossEvents).toBeUndefined();
  });
});

// ── Admin 2026-07-11: billing & provider facts INSIDE the report ────────────────────────────────
describe('billing & provider facts in the report (free/paid, builtBy, failures, tokens)', () => {
  it('tallies per-provider FAILURES and reports the dominant builtBy', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.recordProviderTurn('GLM'); d.recordProviderTurn('GLM'); d.recordProviderTurn('CLAUDE');
    d.recordProviderFailure('GLM'); d.recordProviderFailure('GLM'); d.recordProviderFailure('VERTEX');
    const r = d.report();
    expect(r.builtBy).toBe('GLM'); // most delivered turns = "app kisne banaya"
    expect(r.providerFailures).toEqual({ GLM: 2, VERTEX: 1 }); // "kaun fail hua, kitni baar"
    expect(r.providerDelivery).toEqual({ GLM: 2, CLAUDE: 1 });
  });

  it('carries the settled billing facts (tier, charge, wallet debit, why-free, power)', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.setBilling({ userTier: 'free (welcome bonus — cheap engines)', billedUsd: 0, billedInr: 0, zeroBillReason: 'empty build (0 files produced) — never charged', powerMode: false });
    d.setProviderTokens({ GLM: { inputTokens: 800_000, outputTokens: 140_000 }, other: { inputTokens: 20_000, outputTokens: 5_000 } });
    const r = d.report();
    expect(r.billing?.userTier).toMatch(/welcome bonus/);
    expect(r.billing?.zeroBillReason).toMatch(/empty build/);
    expect(r.providerTokens?.GLM.inputTokens).toBe(800_000);
  });

  it('renders per-provider usage (calls·in·out·total) + charge-to-user in the TEXT report', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.recordProviderTurn('GLM'); d.recordProviderTurn('GLM'); d.recordProviderTurn('CLAUDE');
    d.recordProviderFailure('VERTEX');
    d.setBilling({ userTier: 'paid', billedUsd: 1.5, billedInr: 128.25, walletTokensDebited: 12_825, powerMode: false });
    d.setProviderTokens({ GLM: { inputTokens: 500_000, outputTokens: 100_000 }, CLAUDE: { inputTokens: 4_000, outputTokens: 2_000 } });
    d.finish(true, 'built');
    const text = renderDiagnosticsText(d.report());
    expect(text).toContain('Provider usage (per provider — API calls · input · output · total tokens):');
    // GLM: 2 calls, 500k in, 100k out, 600k total
    expect(text).toContain('GLM     : 2 call(s) · 500,000 in · 100,000 out · 600,000 total');
    // CLAUDE: 1 call, 4k in, 2k out, 6k total
    expect(text).toContain('CLAUDE  : 1 call(s) · 4,000 in · 2,000 out · 6,000 total');
    // TOTAL across providers
    expect(text).toContain('TOTAL   : 3 call(s) · 504,000 in · 102,000 out · 606,000 total');
    expect(text).toContain('User tier: paid');
    expect(text).toContain('Charged to user: ₹128.25 ($1.5000) · 12,825 wallet tokens debited');
    expect(text).toContain('Failures : VERTEX ×1');
    expect(text).toContain('Built by : GLM');
  });

  it('omits every new field when nothing was recorded (older reports/clean lanes unchanged)', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    const r = d.report();
    expect(r.builtBy).toBeUndefined();
    expect(r.providerFailures).toBeUndefined();
    expect(r.providerTokens).toBeUndefined();
    expect(r.billing).toBeUndefined();
  });
});
