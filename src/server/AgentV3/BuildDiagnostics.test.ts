import { describe, it, expect } from 'vitest';
import { BuildDiagnostics, renderDiagnosticsText, renderSessionDiagnosticsText, capSessionReports, formatProviderDelivery, deriveRootCause, capProblems, isExpectedNonzeroExit, isUnconfiguredTscFileProbe, isTestOnlyTypecheckFailure, isClaudeModel, userFacingReport, importTurnObservation, honestModelLabel, type BuildDiagnosticsReport } from './BuildDiagnostics';
import type { AgentEvent } from './types';

describe('isClaudeModel (pure helper)', () => {
  it('matches every Claude id form and rejects cheap-floor models', () => {
    for (const m of ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-3-5-haiku-latest', 'Sonnet', 'OPUS']) {
      expect(isClaudeModel(m)).toBe(true);
    }
    for (const m of ['glm-4.7', 'glm-5.2', 'kimi-k2.6', 'grok-3', 'gemini-2.5-pro', undefined, null, '']) {
      expect(isClaudeModel(m as string)).toBe(false);
    }
  });
});

describe('claudeProviderDelivered (weak-module no-Claude honesty — provider truth, not model label)', () => {
  // THE App #5 false positive: a 100%-GLM build recorded every llmCall with the REQUESTED model id
  // 'claude-sonnet-4-6', while GLM actually delivered every turn. The verdict must read the provider
  // DELIVERY, not the nominal model label, so a clean cheap build is never defamed as a Claude violation.
  it('returns null when GLM delivered every turn despite llmCalls labelled claude-sonnet-4-6 (App #5)', () => {
    const clk = { t: 1000 };
    const d = new BuildDiagnostics({ now: () => (clk.t += 10) });
    for (let i = 0; i < 14; i++) {
      d.recordProviderTurn('GLM'); // the TRUTH: GLM answered
      d.recordLlmCall({ model: 'claude-sonnet-4-6', finishReason: 'end_turn', toolCalls: 1, inputTokens: 100, outputTokens: 20, latencyMs: 100, ok: true }); // nominal label lies
    }
    d.setProviderTokens({ GLM: { inputTokens: 254441, outputTokens: 2088 } });
    expect(d.claudeProviderDelivered()).toBeNull(); // no false positive
  });

  it('returns the Claude provider name when Claude ACTUALLY delivered a turn (a real chain leak)', () => {
    const clk = { t: 1000 };
    const d = new BuildDiagnostics({ now: () => (clk.t += 10) });
    d.recordProviderTurn('GLM');
    d.recordProviderTurn('CLAUDE'); // a real Claude delivery
    expect(d.claudeProviderDelivered()).toBe('CLAUDE');
  });

  it('HAIKU AMENDMENT: a CLAUDE_HAIKU delivery is AUTHORIZED on weak — never a violation', () => {
    // Admin 2026-07-13: "weak module me claude ka haiku ke alawa kuch aur nahi chalna chahiye" — the
    // model-pinned Haiku backstop is the one allowed Claude, so its delivery must not be flagged.
    const clk = { t: 1000 };
    const d = new BuildDiagnostics({ now: () => (clk.t += 10) });
    d.recordProviderTurn('GLM');
    d.recordProviderTurn('CLAUDE_HAIKU'); // the authorized last resort actually delivered a turn
    d.setProviderTokens({ GLM: { inputTokens: 5, outputTokens: 5 }, CLAUDE_HAIKU: { inputTokens: 2, outputTokens: 1 } });
    expect(d.claudeProviderDelivered()).toBeNull(); // no violation

    const d2 = new BuildDiagnostics({ now: () => (clk.t += 10) });
    d2.recordProviderTurn('GLM');
    d2.setProviderTokens({ GLM: { inputTokens: 5, outputTokens: 5 }, CLAUDE: { inputTokens: 10, outputTokens: 3 } });
    expect(d2.claudeProviderDelivered()).toBe('CLAUDE'); // Sonnet/Opus via the token ledger → still a violation
  });

  it('stays null for an all-cheap weak build (GLM + Kimi only)', () => {
    const clk = { t: 1000 };
    const d = new BuildDiagnostics({ now: () => (clk.t += 10) });
    d.recordProviderTurn('GLM');
    d.recordProviderTurn('KIMI');
    d.setProviderTokens({ GLM: { inputTokens: 1, outputTokens: 1 }, KIMI: { inputTokens: 1, outputTokens: 1 } });
    expect(d.claudeProviderDelivered()).toBeNull();
  });
});

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

  it('classifies a dead-sandbox "exit -1 (0s, empty)" as SANDBOX_UNAVAILABLE, not an app-build error (ShopSphere autopsy)', () => {
    const d = fresh();
    // The exact shape of the 81 dead-sandbox commands: the SDK threw, program never ran → exit -1, 0ms, empty.
    d.recordCommand({ command: 'npx --no-install tsc --noEmit 2>&1', exitCode: -1, stdout: '', stderr: '', durationMs: 0 });
    const r = d.report();
    const issue = r.issues.find((i) => i.code === 'SANDBOX_UNAVAILABLE');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toMatch(/sandbox was unavailable/i);
    expect(r.issues.some((i) => i.code === 'SANDBOX_CMD_FAILED')).toBe(false); // NOT blamed on the app
  });

  it('a REAL command failure (nonzero exit WITH output) still records as SANDBOX_CMD_FAILED', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm run build', exitCode: 1, stdout: '', stderr: 'error TS2304: Cannot find name X', durationMs: 4200 });
    const r = d.report();
    expect(r.issues.some((i) => i.code === 'SANDBOX_CMD_FAILED')).toBe(true);
    expect(r.issues.some((i) => i.code === 'SANDBOX_UNAVAILABLE')).toBe(false); // a genuine failure is not excused
  });

  it('classifies a migrate that exits 0 but could not reach the DB as DB_UNREACHABLE (MediConnect autopsy)', () => {
    const d = fresh();
    // The exact MediConnect shape: `prisma migrate dev` exits 0 while its output says the DB is unreachable.
    d.recordCommand({
      command: 'npx prisma migrate dev --name init',
      exitCode: 0,
      stdout: '[health-check] Error: P1001: Can\'t reach database server at `localhost:5432`\n[health-check] dev server did not come up on port 5432 after automatic recovery.',
      durationMs: 71474,
    });
    const r = d.report();
    const issue = r.issues.find((i) => i.code === 'DB_UNREACHABLE');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('error');
    expect(issue?.autoResolved).toBe(false);
    expect(issue?.message).toMatch(/database was NOT reachable/i);
    // The misleading exit-0 must NOT be logged as a benign success line.
    expect(r.issues.some((i) => i.code === 'SANDBOX_CMD' && /migrate/.test(i.message))).toBe(false);
  });

  it('a genuinely healthy migrate (exit 0, DB in sync) is NOT flagged DB_UNREACHABLE', () => {
    const d = fresh();
    d.recordCommand({ command: 'npx prisma migrate dev --name init', exitCode: 0, stdout: 'Your database is now in sync with your schema.', durationMs: 5000 });
    const r = d.report();
    expect(r.issues.some((i) => i.code === 'DB_UNREACHABLE')).toBe(false);
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

  it('finish(ok=true) back-fills recovered SANDBOX_CMD_FAILED as auto-resolved (PaisaTrack: no phantom unresolved)', () => {
    const d = fresh();
    // Two intermediate `tsc → exit 2` failures the agent then fixed; the build ultimately SUCCEEDED.
    d.recordCommand({ command: 'npx tsc --noEmit', exitCode: 2, stdout: '', stderr: 'error TS2532', durationMs: 1000 });
    d.recordCommand({ command: 'npx tsc --noEmit', exitCode: 2, stdout: '', stderr: 'error TS2532', durationMs: 1000 });
    d.finish(true, 'Build complete.');
    const r = d.report();
    expect(r.ok).toBe(true);
    expect(r.counts.unresolved).toBe(0); // recovered → not a phantom "unresolved" on a passing build
    expect(r.issues.filter((i) => i.code === 'SANDBOX_CMD_FAILED').every((i) => i.autoResolved)).toBe(true);
  });

  it('finish(ok=false) keeps SANDBOX_CMD_FAILED unresolved (a genuinely failed build still names it)', () => {
    const d = fresh();
    d.recordCommand({ command: 'npm run build', exitCode: 1, stdout: '', stderr: 'build failed', durationMs: 3000 });
    d.finish(false, 'failed');
    expect(d.report().counts.unresolved).toBeGreaterThanOrEqual(1);
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

describe('hasRuntimeCrashBlocker — the render-rescue veto (real report 8a6e4585)', () => {
  const mk = () => new BuildDiagnostics({ now: (() => { let t = 0; return () => (t += 10); })() });

  it('true for an unresolved Rules-of-Hooks READINESS_BLOCKER ("crash at runtime")', () => {
    const d = mk();
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: '1 React Rules-of-Hooks violation(s) (crash at runtime): useMemo@src/hooks/useChartData.ts:86', autoResolved: false });
    expect(d.hasRuntimeCrashBlocker()).toBe(true);
  });

  it('true for undefined-JSX-component / undefined-hook crash blockers too', () => {
    const d = mk();
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: '2 undefined JSX component(s) — used but never imported/defined (crash at runtime): <Foo>', autoResolved: false });
    expect(d.hasRuntimeCrashBlocker()).toBe(true);
  });

  it('false for a non-crash readiness blocker (unresolved imports, low score)', () => {
    const d = mk();
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: '3 unresolved import(s) — the build will fail: ./x', autoResolved: false });
    expect(d.hasRuntimeCrashBlocker()).toBe(false);
  });

  it('false when there is no readiness blocker at all', () => {
    expect(mk().hasRuntimeCrashBlocker()).toBe(false);
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

  // BENCHMARK #1 game-evolution autopsy 2026-08-12: an admin-confirmed-CORRECT game was headlined
  // rootCause "Critical issue found by review: Missing Required Features" — a working, rendering app
  // reported as FAILING — because the review [CRITICAL] branch never consulted `ok`. Three of the
  // reviewer's own four items were "PARTIAL" (present-but-different), and the app ran.
  it('a reviewer [CRITICAL] is NOT the rootCause of a SUCCESSFUL build — a working app is not "failing"', () => {
    const review = '[CRITICAL] (confidence: high) Missing Required Features\n- No START screen\n[WARNING] timer is frame-based';
    // ok:true + only info/advisory issues → the honest verdict is success, not the offered review finding.
    expect(deriveRootCause({ issues: [], review, ok: true })).toBe('Build completed successfully with no problems recorded.');
  });

  it('the reviewer [CRITICAL] STILL leads the rootCause on a FAILED build (never hide a real failure cause)', () => {
    const review = '[CRITICAL] Login is completely broken.';
    expect(deriveRootCause({ issues: [], review, ok: false })).toBe('Critical issue found by review: Login is completely broken.');
    // ok undefined (still running) is unchanged too.
    expect(deriveRootCause({ issues: [], review })).toBe('Critical issue found by review: Login is completely broken.');
  });

  // BENCHMARK #2 autopsy 2026-08-12: a fully successful build (tsc PASS, prod build PASS, preview
  // rendered) was headlined rootCause "231s of preparation before the build's first model call" — a
  // setup-timing advisory, unresolved-but-not-a-failure, picked as the successful build's cause.
  it('a setup-timing advisory (TIME_TO_FIRST_CALL) is NOT the rootCause of a SUCCESSFUL build', () => {
    const issues = [
      { ts: 1, phase: 'plan' as const, severity: 'warning' as const, code: 'TIME_TO_FIRST_CALL', message: '231s of preparation before the build\'s first model call began.', autoResolved: false },
    ];
    expect(deriveRootCause({ issues, ok: true })).toBe('Build completed successfully with no problems recorded.');
  });

  it('on ok:true a GENUINE unresolved error still outranks a working-app review suggestion', () => {
    // The rootCause suppression is scoped to the review finding — a real error on the timeline still wins.
    const issues = [
      { ts: 1, phase: 'build' as const, severity: 'error' as const, code: 'DB_UNREACHABLE', message: 'prisma migrate → the database was NOT reachable (P1001).', autoResolved: false },
    ];
    const review = '[CRITICAL] Missing Required Features';
    expect(deriveRootCause({ issues, review, ok: true })).toContain('database was NOT reachable');
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

  it('names INFRA honestly when the only failure is a dead sandbox — never blames the app (ShopSphere autopsy)', () => {
    const issues = [
      { ts: 1, phase: 'build' as const, severity: 'warning' as const, code: 'SANDBOX_UNAVAILABLE', message: '$ npx --no-install tsc --noEmit → could not run — the build sandbox was unavailable (reaped/expired/unreachable). Infrastructure condition, not an app error.', autoResolved: false },
    ];
    const rc = deriveRootCause({ issues, ok: false });
    expect(rc).toMatch(/sandbox became unavailable/i);
    expect(rc).toMatch(/infrastructure condition/i);
    expect(rc).not.toMatch(/tsc/); // must NOT surface the raw "tsc → exit -1" as if the app failed to compile
  });

  it('an unresolved ERROR outranks an earlier unresolved WARNING (EstateNest: DB error, not the read_file warning)', () => {
    // Real EstateNest timeline: two benign architect read_file-not-found WARNINGS (reading a file before it
    // was written — build continued fine) appear BEFORE the terminal DB_UNREACHABLE ERROR. The old
    // first-match order blamed "useAuth.ts does not exist"; severity must lead so the real killer wins.
    const issues = [
      { ts: 1, phase: 'tool' as const, severity: 'warning' as const, code: 'TOOL_ERROR', message: "Tool call failed: path 'src/hooks/useAuth.ts' does not exist", autoResolved: false },
      { ts: 2, phase: 'tool' as const, severity: 'warning' as const, code: 'TOOL_ERROR', message: "Tool call failed: path 'src/types/index.ts' does not exist", autoResolved: false },
      { ts: 3, phase: 'build' as const, severity: 'error' as const, code: 'DB_UNREACHABLE', message: 'prisma migrate → the database was NOT reachable (P1001).', autoResolved: false },
    ];
    expect(deriveRootCause({ issues, ok: false })).toContain('database was NOT reachable');
  });

  it('a REAL app error still wins over a co-occurring sandbox-unavailable event', () => {
    const issues = [
      { ts: 1, phase: 'build' as const, severity: 'error' as const, code: 'SANDBOX_CMD_FAILED', message: '$ npm run build → exit 1 (TS2304)', autoResolved: false },
      { ts: 2, phase: 'build' as const, severity: 'warning' as const, code: 'SANDBOX_UNAVAILABLE', message: 'sandbox went away', autoResolved: false },
    ];
    expect(deriveRootCause({ issues, ok: false })).toContain('npm run build');
  });

  it('a fast-lane handoff (SIMPLE_BUILD_OUTCOME) is NOT a terminal outcome — no false "BUILD_FAILED" (CollabDesk autopsy)', () => {
    // The fast lane timed out and handed off to the full builder; the report was captured MID-full-builder.
    // The handoff must NOT read as the build's rootCause — a cut/partial snapshot should say "still running",
    // never "BUILD_FAILED" for a build that was progressing fine.
    const issues = [
      { ts: 1, phase: 'build' as const, severity: 'info' as const, code: 'SIMPLE_BUILD_FALLBACK', message: 'Simple build timed out after generating 8 file(s) — the full builder continues from them.', autoResolved: true },
      { ts: 2, phase: 'build' as const, severity: 'info' as const, code: 'SIMPLE_BUILD_OUTCOME', message: 'Fast-lane outcome (handed off to the full builder): BUILD_FAILED', autoResolved: true },
    ];
    expect(deriveRootCause({ issues })).toBeUndefined(); // ok not yet set → honest "still running", not a failure
  });

  it('the FULL builder\'s real OUTCOME_ still wins once it settles', () => {
    const issues = [
      { ts: 1, phase: 'build' as const, severity: 'info' as const, code: 'SIMPLE_BUILD_OUTCOME', message: 'Fast-lane outcome (handed off to the full builder): BUILD_FAILED', autoResolved: true },
      { ts: 2, phase: 'build' as const, severity: 'info' as const, code: 'OUTCOME_BUILD_SUCCESS', message: 'Build outcome: BUILD_SUCCESS', autoResolved: true },
    ];
    expect(deriveRootCause({ issues, ok: true })).toBe('Build outcome: BUILD_SUCCESS');
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

  // PaisaTrack "fix all error" autopsy 2026-07-21: the build SUCCEEDED (app live, ok:true) yet the report
  // named a recovered transient — "Tool call failed: Unterminated string in JSON" (a truncated large
  // tool-call the agent retried) — as the build's rootCause, and showed the two benign exit-1 tool probes
  // as unresolved. On a successful build a recovered transient is NEVER the root cause.
  it('on ok:true, a recovered TOOL_ERROR is NOT the root cause — the success message wins', () => {
    const issues = [
      { ts: 1, phase: 'tool' as const, severity: 'warning' as const, code: 'TOOL_ERROR', message: 'Tool call failed: Unterminated string in JSON at position 98299', autoResolved: true },
      { ts: 2, phase: 'tool' as const, severity: 'warning' as const, code: 'TOOL_ERROR', message: 'Tool call failed: exit status 1', autoResolved: true },
    ];
    expect(deriveRootCause({ issues, ok: true })).toBe('Build completed successfully with no problems recorded.');
  });

  it('on ok:true, a recovered TOOL_ERROR is skipped even if its autoResolved flag was never back-filled', () => {
    const issues = [
      { ts: 1, phase: 'tool' as const, severity: 'warning' as const, code: 'TOOL_ERROR', message: 'Tool call failed: Unterminated string in JSON', autoResolved: false },
    ];
    expect(deriveRootCause({ issues, ok: true })).toBe('Build completed successfully with no problems recorded.');
  });

  it('on ok:true, a GENUINE unresolved non-recoverable error STILL wins (never hide a real defect)', () => {
    const issues = [
      { ts: 1, phase: 'tool' as const, severity: 'warning' as const, code: 'TOOL_ERROR', message: 'Tool call failed: retried', autoResolved: false },
      { ts: 2, phase: 'build' as const, severity: 'error' as const, code: 'DB_UNREACHABLE', message: 'prisma migrate → the database was NOT reachable (P1001).', autoResolved: false },
    ];
    expect(deriveRootCause({ issues, ok: true })).toContain('database was NOT reachable');
  });

  it('when ok is NOT true, a recovered-code fallback is unchanged (still surfaces something on a failure)', () => {
    const issues = [
      { ts: 1, phase: 'tool' as const, severity: 'warning' as const, code: 'TOOL_ERROR', message: 'npm install failed', autoResolved: false },
    ];
    expect(deriveRootCause({ issues })).toBe('npm install failed'); // ok undefined → today's behaviour
    expect(deriveRootCause({ issues, ok: false })).toBe('npm install failed');
  });
});

// PaisaTrack "fix all error" autopsy 2026-07-21 — the end-to-end honesty of a SUCCESSFUL build's report.
describe('recovered-on-success honesty (PaisaTrack: an ok:true build never shows false "unresolved")', () => {
  const fresh = () => new BuildDiagnostics({ now: () => 1, buildId: 'b', promptHash: 'p', sessionId: 's', workspaceId: 'w', prompt: 'fix the all error', model: 'x', framework: 'react' });

  it('finish(true) resolves recovered TOOL_ERRORs → 0 unresolved, success root cause', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_result', agent: 'frontend', callId: 'c1', ok: false, summary: 'Unterminated string in JSON at position 98299', ts: 1 } as AgentEvent);
    d.ingestEvent({ type: 'tool_result', agent: 'frontend', callId: 'c2', ok: false, summary: 'exit status 1', ts: 2 } as AgentEvent);
    d.finish(true, '✅ All Errors Fixed!');
    const r = d.report();
    expect(r.counts.unresolved).toBe(0);
    expect(r.counts.errors).toBe(0);
    expect(r.rootCause).toBe('Build completed successfully with no problems recorded.');
  });

  it('SERIALIZATION-time normalization: even without finish(), an ok:true report is honest (the bypassed-finalize bug)', () => {
    const d = fresh();
    d.ingestEvent({ type: 'tool_result', agent: 'frontend', callId: 'c1', ok: false, summary: 'Unterminated string in JSON at position 98299', ts: 1 } as AgentEvent);
    // The `done` event flips ok:true but does NOT run finish()'s back-fill — the exact path that produced
    // the dishonest downloaded report. report() must still normalize at serialization time.
    d.ingestEvent({ type: 'done', ok: true, summary: 'live', ts: 2 } as AgentEvent);
    const r = d.report();
    expect(r.counts.unresolved).toBe(0);
    expect(r.rootCause).not.toMatch(/Unterminated string/);
  });
});

// PaisaTrack "fix all error" autopsy 2026-07-21: "Now I'll fix both errors: … Fix the TypeScript type
// error" is the agent DOING remediation work — not a failure. It was recorded severity=error, inflating a
// successful build's count to "1 error" under an "All Errors Fixed!" summary. Remediation intent with no
// real failure verb is a STEP, not a problem.
describe('AGENT_NOTE — remediation narration is progress, not an error', () => {
  const fresh = () => new BuildDiagnostics({ now: () => 1 });
  it('"Now I\'ll fix both errors" is a plain AGENT_STEP, not an AGENT_NOTE error', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'frontend', text: "Now I'll fix both errors: remove the unused Expense import and fix the TypeScript type error.", ts: 1 } as AgentEvent);
    const r = d.report();
    expect(r.issues.filter((i) => i.code === 'AGENT_NOTE')).toHaveLength(0);
    expect(r.issues.filter((i) => i.code === 'AGENT_STEP')).toHaveLength(1);
    expect(r.counts.errors).toBe(0);
  });
  it('"Removed the unused useEffect import" is a step, not a problem', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'frontend', text: 'Removed the unused useEffect import — no more warning.', ts: 1 } as AgentEvent);
    expect(d.report().issues.filter((i) => i.code === 'AGENT_STEP')).toHaveLength(1);
  });
  it('but a GENUINE failure the agent is fixing STAYS a problem (real failure verb present)', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'frontend', text: 'The build failed — fixing the missing import now.', ts: 1 } as AgentEvent);
    const note = d.report().issues.find((i) => i.code === 'AGENT_NOTE');
    expect(note?.severity).toBe('error');
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

  it('#4 a normal (end_turn) call adds NO PER-CALL timeline noise, only the channel record', () => {
    // The invariant this protects is per-call: a clean call must not leave a struggle marker, or a
    // 100-step build buries its real findings under 100 non-findings. It is NOT "recordLlmCall may
    // never touch the timeline" — the first call also stamps TIME_TO_FIRST_CALL, one entry for the
    // whole build, because 227 seconds of setup silence was invisible until something recorded it
    // (admin report 2026-08-12). Asserted below as exactly one, and never again.
    const d = fresh();
    d.recordLlmCall({ model: 'claude-opus-4', finishReason: 'end_turn', toolCalls: 1, inputTokens: 50, outputTokens: 200, latencyMs: 1500, ok: true });
    const r = d.report();
    expect(r.llmCalls).toHaveLength(1);
    expect(r.issues.filter((i) => i.code !== 'TIME_TO_FIRST_CALL')).toHaveLength(0);
  });

  it('#4b a SECOND clean call adds nothing at all — the per-call invariant, sharpened', () => {
    const d = fresh();
    d.recordLlmCall({ model: 'claude-opus-4', finishReason: 'end_turn', toolCalls: 1, inputTokens: 50, outputTokens: 200, latencyMs: 1500, ok: true });
    const after = d.report().issues.length;
    for (let i = 0; i < 20; i += 1) {
      d.recordLlmCall({ model: 'claude-opus-4', finishReason: 'end_turn', toolCalls: 1, inputTokens: 50, outputTokens: 200, latencyMs: 1500, ok: true });
    }
    expect(d.report().issues).toHaveLength(after);
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

  // `npm audit fix` EXITS 1 WHEN VULNERABILITIES REMAIN — npm's documented behaviour, and the only exit
  // it can give on a tree whose remaining advisories all need a breaking major upgrade. We deliberately
  // never pass --force, so that exit is the expected ANSWER to the question we asked, not a failure of
  // ours. Recorded as an error it became the headline root cause of build 5b4f9b63 — a build whose real
  // problem was that it never built anything.
  it('`npm audit fix` exit 1 (vulns remain, need --force) is routine, not a build failure', () => {
    expect(isExpectedNonzeroExit('npm audit fix', 1)).toBe(true);
    expect(isExpectedNonzeroExit('npm audit fix 2>&1', 1)).toBe(true);
  });
  it('but a crash from it (or a plain `npm audit`) still counts', () => {
    expect(isExpectedNonzeroExit('npm audit fix', 2)).toBe(false);
    expect(isExpectedNonzeroExit('npm audit fix', -1)).toBe(false);
    expect(isExpectedNonzeroExit('npm audit', 1)).toBe(false); // a report, not a remediation we ran
  });

  // Deep-test build #3 (2026-07-17): a single-FILE tsc probe ignores tsconfig → spurious TS17004 on a
  // clean app; it must never count as a build failure (or become rootCause). See isUnconfiguredTscFileProbe.
  it('a single-FILE tsc probe (ignores tsconfig → spurious JSX errors) is routine', () => {
    // The EXACT command from the report (exit -1, E2B wrapper "exit status 2").
    expect(isExpectedNonzeroExit('npx --no-install tsc --noEmit src/App.tsx 2>&1', -1)).toBe(true);
    expect(isExpectedNonzeroExit('npx --no-install tsc --noEmit src/App.tsx', 2)).toBe(true);
    expect(isExpectedNonzeroExit('tsc src/main.tsx', 1)).toBe(true);
    expect(isExpectedNonzeroExit('tsc --noEmit src/a.ts src/b.mts', 2)).toBe(true);
  });
  it('the REAL project typecheck (no file operands) is NEVER excused — a type error still counts', () => {
    expect(isExpectedNonzeroExit('npx tsc --noEmit', 2)).toBe(false);           // the pipeline's real gate
    expect(isExpectedNonzeroExit('tsc -p tsconfig.json src/App.tsx', 2)).toBe(false); // project mode honours config
    expect(isExpectedNonzeroExit('tsc --build', 2)).toBe(false);                // build mode honours config
    expect(isExpectedNonzeroExit('tsc --jsx react-jsx src/App.tsx', 2)).toBe(false); // caller supplied jsx → valid
  });
});

describe('isUnconfiguredTscFileProbe — the malformed single-file typecheck detector', () => {
  it('flags a bare/npx tsc run with source-file operands and no project config', () => {
    expect(isUnconfiguredTscFileProbe('npx --no-install tsc --noEmit src/App.tsx 2>&1')).toBe(true);
    expect(isUnconfiguredTscFileProbe('tsc src/App.tsx')).toBe(true);
    expect(isUnconfiguredTscFileProbe('pnpm tsc --noEmit components/x.jsx')).toBe(true);
  });
  it('does NOT flag the config-driven project typecheck or a valid explicit-jsx run', () => {
    expect(isUnconfiguredTscFileProbe('npx tsc --noEmit')).toBe(false);        // no file operand = real gate
    expect(isUnconfiguredTscFileProbe('tsc -p tsconfig.json')).toBe(false);
    expect(isUnconfiguredTscFileProbe('tsc --build')).toBe(false);
    expect(isUnconfiguredTscFileProbe('tsc --jsx react-jsx src/App.tsx')).toBe(false);
    expect(isUnconfiguredTscFileProbe('vite build')).toBe(false);              // not tsc at all
  });
});

describe('isTestOnlyTypecheckFailure — a tsc gate failing ONLY on test files is not an app-build failure', () => {
  it('excuses a project tsc whose sole error is a test file missing vitest types (the build #4 rootCause)', () => {
    const out = "src/App.test.tsx(1,38): error TS2307: Cannot find module 'vitest' or its corresponding type declarations.\n";
    expect(isTestOnlyTypecheckFailure('npx --no-install tsc --noEmit 2>&1', out, 'exit status 2')).toBe(true);
  });
  it('excuses multiple errors when ALL are in test/spec files', () => {
    const out = [
      "src/App.test.tsx(1,38): error TS2307: Cannot find module 'vitest'.",
      "src/components/x.spec.ts(4,2): error TS2614: Module has no exported member 'App'.",
      "src/__tests__/util.ts(9,1): error TS2304: Cannot find name 'describe'.",
    ].join('\n');
    expect(isTestOnlyTypecheckFailure('tsc --noEmit', out)).toBe(true);
  });
  it('does NOT excuse when even ONE error is in shipped app source', () => {
    const out = [
      "src/App.test.tsx(1,38): error TS2307: Cannot find module 'vitest'.",
      "src/App.tsx(307,19): error TS2322: Type 'string' is not assignable to type 'number'.", // real app error
    ].join('\n');
    expect(isTestOnlyTypecheckFailure('npx tsc --noEmit', out)).toBe(false);
  });
  it('does NOT excuse a non-tsc command, or a tsc failure with no parseable diagnostics', () => {
    expect(isTestOnlyTypecheckFailure('npm run build', 'src/App.test.tsx(1,1): error TS1: x')).toBe(false); // not tsc
    expect(isTestOnlyTypecheckFailure('tsc --noEmit', 'some opaque crash, no TS#### lines')).toBe(false); // unparseable
    expect(isTestOnlyTypecheckFailure('tsc --noEmit', '')).toBe(false);
  });
});

describe('deep-test build #4 — a test-file-only tsc failure must NOT be the rootCause of a SUCCESSFUL build', () => {
  it('records the test-only tsc gate as info (not SANDBOX_CMD_FAILED) and keeps the rootCause honest', () => {
    const d = new BuildDiagnostics({ now: (() => { let t = 1000; return () => (t += 1000); })() });
    // The EXACT report command: project gate fails only on App.test.tsx (missing vitest types), app is clean.
    d.recordCommand({ command: 'npx --no-install tsc --noEmit 2>&1', exitCode: -1, stdout: "src/App.test.tsx(1,38): error TS2307: Cannot find module 'vitest'.\n", stderr: 'exit status 2' });
    d.finish(true, 'done');
    const r = d.report();
    expect(r.issues.find((i) => i.code === 'SANDBOX_CMD_FAILED')).toBeUndefined();
    expect(r.counts.errors).toBe(0);
    expect(r.rootCause).toBe('Build completed successfully with no problems recorded.');
  });
  it('a REAL app type error in the same gate still fails the build (guard is not a blanket tsc excuse)', () => {
    const d = new BuildDiagnostics({ now: (() => { let t = 1000; return () => (t += 1000); })() });
    d.recordCommand({ command: 'npx --no-install tsc --noEmit 2>&1', exitCode: -1, stdout: "src/App.tsx(307,19): error TS2322: Type 'string' is not assignable to type 'number'.\n", stderr: 'exit status 2' });
    d.finish(false);
    const r = d.report();
    expect(r.issues.find((i) => i.code === 'SANDBOX_CMD_FAILED')).toBeDefined();
    expect(r.counts.errors).toBeGreaterThanOrEqual(1);
  });
});

describe('deep-test build #3 — a single-file tsc probe must NOT become the rootCause of a SUCCESSFUL build', () => {
  it('the spurious tsc probe is recorded as info (not SANDBOX_CMD_FAILED) and never the rootCause', () => {
    const d = new BuildDiagnostics({ now: (() => { let t = 1000; return () => (t += 1000); })() });
    // The agent's malformed single-file probe (fails), then the correct project-wide typecheck (passes).
    d.recordCommand({ command: 'npx --no-install tsc --noEmit src/App.tsx 2>&1', exitCode: -1, stdout: '', stderr: "error TS17004: Cannot use JSX unless the '--jsx' flag is provided." });
    d.recordCommand({ command: 'npx --no-install tsc --noEmit', exitCode: 0, stdout: '', stderr: '' });
    d.finish(true, 'done');
    const r = d.report();
    expect(r.issues.find((i) => i.code === 'SANDBOX_CMD_FAILED')).toBeUndefined(); // not a failure
    expect(r.counts.errors).toBe(0);
    // rootCause must reflect the truth (a clean, successful build), never the malformed probe.
    expect(r.rootCause).not.toMatch(/tsc --noEmit src\/App\.tsx/);
    expect(r.rootCause).toBe('Build completed successfully with no problems recorded.');
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

// ShopKhata autopsy 2026-07-17: "Now let me create the App component with routing and error boundary:"
// was recorded severity=error — \berror\b matched inside "error boundary". Building error-UX is normal
// work; only a genuine failure phrase may classify a narration as a problem.
describe('AGENT_NOTE — benign compounds are never problems', () => {
  it('the exact ShopKhata narration is a plain AGENT_STEP, not an error', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'Now let me create the App component with routing and error boundary:', ts: 1 } as AgentEvent);
    const r = d.report();
    expect(r.issues.filter((i) => i.code === 'AGENT_NOTE')).toHaveLength(0);
    expect(r.issues.filter((i) => i.code === 'AGENT_STEP')).toHaveLength(1);
    expect(r.counts.errors).toBe(0);
  });

  it('error handling / error messages / warning banner narrations stay info too', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'Adding error handling and error messages to the form.', ts: 1 } as AgentEvent);
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'Now the low-stock warning badge on Products.', ts: 2 } as AgentEvent);
    expect(d.report().issues.filter((i) => i.code === 'AGENT_NOTE')).toHaveLength(0);
  });

  it('a GENUINE failure line still classifies as a problem (no over-correction)', () => {
    const d = fresh();
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'The dev server failed to start — port 5173 error.', ts: 1 } as AgentEvent);
    const notes = d.report().issues.filter((i) => i.code === 'AGENT_NOTE');
    expect(notes).toHaveLength(1);
    expect(notes[0].severity).toBe('error');
  });
});

describe('userFacingReport (Fix 68) — a non-admin user sees NO provider/model name anywhere', () => {
  const FORBIDDEN = /\b(glm|kimi|claude|anthropic|sonnet|opus|haiku|gemini|vertex|grok|xai|openai|gpt|deepseek|moonshot|z\.?ai|bedrock)\b|(glm|kimi|claude|gemini|grok|gpt)[-/][\w.:-]+|\bE2B\b/i;

  // A report with a real provider/model name planted in EVERY provider-bearing field.
  const raw = {
    schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt: 1000,
    endedAt: 2000,
    ok: true,
    prompt: 'build me a Claude-style chat app', // the USER's own words — must survive verbatim
    framework: 'react',
    model: 'claude-opus-4-8',
    summary: 'Built by GLM with 2 Claude (Sonnet) fallbacks; Gemini vision used.',
    rootCause: 'Provider GLM failed (429 from Z.ai), fell back to claude-opus-4-8.',
    review: 'Kimi (Moonshot) flagged a bug; Vertex confirmed.',
    counts: { total: 3, errors: 1, warnings: 1, autoResolved: 1, unresolved: 0 },
    builtBy: 'GLM',
    providerDelivery: { GLM: 18, CLAUDE: 2 },
    providerFailures: { GLM: 3, VERTEX: 1 },
    providerTokens: { GLM: { inputTokens: 100, outputTokens: 50 }, CLAUDE: { inputTokens: 10, outputTokens: 5 } },
    cacheReadInputTokens: 42,
    issues: [
      { ts: 1, phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed — falling back to claude-sonnet-4-6', autoResolved: true, detail: 'xai grok timed out' },
    ],
    problems: [
      { ts: 1, phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'kimi-k2.7-code unavailable, Vertex fallback', autoResolved: true },
    ],
    errors: [{ ts: 1, phase: 'build', message: 'openai gpt-4o quota exceeded', stack: 'at anthropic.sdk (claude.ts)' }],
    previewErrors: [{ ts: 1, source: 'in-browser', message: 'gemini-2.5-pro rate limited' }],
    dataLossEvents: [{ ts: 1, cause: 'GLM sandbox recycled', detail: 'bedrock region reset' }],
    generatedFiles: [{ path: 'src/App.tsx', content: 'export const App = () => null;' }],
    llmCalls: [{ ts: 1, provider: 'GLM', model: 'glm-5.2', ok: true }],
    commands: [{ ts: 1, command: 'npm i @anthropic-ai/sdk', output: 'ok' }],
    billing: { billedUsd: 1, realCostUsd: 0.04, provider: 'GLM' },
    manifest: { routing: { model: 'claude-opus-4-8', provider: 'CLAUDE' } },
  } as unknown as BuildDiagnosticsReport;

  it('THE INVARIANT: the entire user-facing report JSON contains no provider/model/infra name', () => {
    const view = userFacingReport(raw);
    // Scan every string in the serialized user view — but exclude the user's own prompt (their words are theirs).
    const scrubbed = { ...view, prompt: undefined };
    expect(JSON.stringify(scrubbed)).not.toMatch(FORBIDDEN);
  });

  it('OMITS the admin-only provider/forensic sections entirely', () => {
    const view = userFacingReport(raw) as Record<string, unknown>;
    for (const k of ['model', 'providerDelivery', 'builtBy', 'providerFailures', 'providerTokens', 'cacheReadInputTokens', 'llmCalls', 'commands', 'billing', 'manifest']) {
      expect(view[k], `leaked admin-only field ${k}`).toBeUndefined();
    }
  });

  it('KEEPS the user-relevant, provider-free content (their prompt + their generated files + counts + ok)', () => {
    const view = userFacingReport(raw);
    expect(view.prompt).toBe('build me a Claude-style chat app'); // verbatim — not corrupted
    expect(view.generatedFiles?.[0].path).toBe('src/App.tsx');
    expect(view.counts.errors).toBe(1);
    expect(view.ok).toBe(true);
    expect(view.framework).toBe('react');
    // scrubbed prose still conveys the problem, just without the vendor name
    expect(view.rootCause).toMatch(/failed|fell back|NavBharatAI|the model/i);
  });

  it('is idempotent and safe on a minimal report', () => {
    const minimal = { schema: 'navbharatai.v3.build-diagnostics/1', startedAt: 1, counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 }, issues: [], problems: [] } as BuildDiagnosticsReport;
    const once = userFacingReport(minimal);
    expect(JSON.stringify(userFacingReport(once))).toBe(JSON.stringify(once));
  });
});

// ── importTurnObservation — a survey turn's findings are OBSERVATIONS, not our unresolved defects ──
// ROOT CAUSE (mitrify import autopsy 2026-07-27, buildId 321f4f6c): a successful survey-only turn
// ("Import this app … Do not change any files yet") reported 14 UNRESOLVED problems and named an
// unused-dependency hint about the USER'S OWN repo as the build's rootCause — while the scan itself
// ran on a knowingly partial file map (165 of the repo's 316 files landed).
describe('importTurnObservation (mitrify autopsy 2026-07-27)', () => {
  const MSG = '"date-fns" is declared in package.json dependencies but no project file imports it.';

  it('leaves a real build/edit turn completely unchanged', () => {
    expect(importTurnObservation(false, MSG)).toEqual({ autoResolved: false, message: MSG });
  });

  it('marks an import-turn finding advisory so it can never count as unresolved', () => {
    expect(importTurnObservation(true, MSG).autoResolved).toBe(true);
  });

  it('states BOTH honesty caveats: we changed nothing, and the scan may be incomplete', () => {
    const out = importTurnObservation(true, MSG).message;
    expect(out).toContain('nothing was changed');
    expect(out).toContain('may not be accurate');
    expect(out).toContain(MSG); // never hides the original finding
  });

  it('an advisory import-turn finding is never chosen as the build rootCause', () => {
    const adv = importTurnObservation(true, MSG);
    const issues = [{ ts: 1, phase: 'build' as const, severity: 'warning' as const, code: 'INTEGRITY_UNUSED_DEP', ...adv }];
    // ok:true + all findings autoResolved → the report says the build succeeded, not "unused dep".
    expect(deriveRootCause({ issues, ok: true })).toBe('Build completed successfully with no problems recorded.');
  });

  /**
   * SUPERSEDED BY EVIDENCE (Shiv Medical Store report, 2026-08-10). This case previously asserted the
   * opposite — that on a REAL build turn the same finding SHOULD become the rootCause — on the
   * reasoning that the file map is the app we just wrote, so "no project file imports it" is provable
   * there even though it is not on a partial import map.
   *
   * A real build disproved it. That turn WAS a normal build turn with a complete map, it succeeded, its
   * app was verified rendering, and its reported rootCause was
   * `"@capacitor/android" is declared … but no project file imports it` — which is also FALSE:
   * Capacitor's packages are consumed by its CLI and native config, exactly the caveat the message
   * itself spells out.
   *
   * The deeper error was never provability, it was relevance: a dependency-hygiene hint explains
   * nothing about why a build did or did not work. It is still recorded and still visible — it simply
   * cannot be promoted to the explanation of a build. See NEVER_ROOT_CAUSE.
   */
  it('an unused-dep hint is not the rootCause on a real build turn either', () => {
    const real = importTurnObservation(false, MSG);
    const issues = [{ ts: 1, phase: 'build' as const, severity: 'warning' as const, code: 'INTEGRITY_UNUSED_DEP', ...real }];
    expect(deriveRootCause({ issues, ok: true })).toBe('Build completed successfully with no problems recorded.');
    // The finding itself is NOT suppressed — only its promotion to rootCause.
    expect(real.message).toBe(MSG);
    expect(real.autoResolved).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AN ADVISORY THAT *RECOMMENDS* A COMMAND IS NOT EVIDENCE THAT THE COMMAND'S FAILURE SURVIVED
// (admin report 2026-08-16, build 5b4f9b63).
//
// `npm audit fix` exited 1 — its documented "some vulnerabilities need a breaking upgrade" answer. The
// DEPENDENCY_VULNERABILITIES advisory in the same run contains the sentence "Running `npm audit fix`
// applies the compatible fixes", so `failureHasSurvivingConsequence` matched the command's own name
// inside the RECOMMENDATION, declined to forgive the failure, and made
//   "$ npm audit fix → exit 1 (14s)"
// the headline root cause of a thirty-minute build whose real problem was that it never built anything.
// A CVE count is a finding about the user's dependencies; it is a consequence of nothing.
describe('a CVE advisory can never explain a build (build 5b4f9b63)', () => {
  const auditFailure = {
    ts: 1, phase: 'build' as const, severity: 'error' as const, code: 'SANDBOX_CMD_FAILED',
    message: '$ npm audit fix → exit 1 (14s)', autoResolved: false,
  };
  const cveAdvisory = {
    ts: 2, phase: 'build' as const, severity: 'warning' as const, code: 'DEPENDENCY_VULNERABILITIES',
    message: '8 known vulnerabilities in this app\'s dependencies (3 high, 5 moderate). Running `npm audit fix` applies the compatible fixes; it does not upgrade across a major version.',
    autoResolved: false,
  };

  it('does not headline the very command the advisory told the build to run', () => {
    const rootCause = deriveRootCause({ issues: [auditFailure, cveAdvisory], ok: true, commands: [] });
    expect(rootCause).not.toContain('npm audit fix');
  });

  it('and the CVE count itself is never promoted to the cause either', () => {
    const rootCause = deriveRootCause({ issues: [cveAdvisory], ok: true, commands: [] });
    expect(rootCause).toBe('Build completed successfully with no problems recorded.');
  });

  it('a REAL surviving consequence still blocks forgiveness — the Mitrify db:push case stands', () => {
    // `npm run db:push` failed and a still-unresolved, NON-advisory problem names it: the tables were
    // never created. Forgiving that stamped a permanent failure as the build's one "self-heal".
    const dbFailure = {
      ts: 1, phase: 'build' as const, severity: 'error' as const, code: 'SANDBOX_CMD_FAILED',
      message: '$ npm run db:push → exit 1 (3s)', autoResolved: false,
    };
    const consequence = {
      ts: 2, phase: 'build' as const, severity: 'error' as const, code: 'DB_UNREACHABLE',
      message: 'npm run db:push never created the tables — the app has no schema.', autoResolved: false,
    };
    expect(deriveRootCause({ issues: [dbFailure, consequence], ok: true, commands: [] })).toContain('db:push');
  });
});

// A STATEMENT ABOUT THE SUMMARY IS NOT A CAUSE OF THE BUILD (build 4b744bef). CLAIM_UNSUPPORTED reads
// the reply the model wrote; whatever it finds there, it cannot be why anything happened — and on that
// run it was FALSE (a correct survey judged against two config files). Same shape as RELEASE_GATE.
describe('a claim-about-the-summary can never be the build root cause (build 4b744bef)', () => {
  const claimUnsupported = {
    ts: 1, phase: 'build' as const, severity: 'warning' as const, code: 'CLAIM_UNSUPPORTED',
    message: '17 of the 19 things it described appear nowhere in this app\'s source.', autoResolved: false,
  };

  it('is never promoted to the root cause of a successful build', () => {
    const rootCause = deriveRootCause({ issues: [claimUnsupported], ok: true, commands: [] });
    expect(rootCause).not.toContain('described');
    expect(rootCause).toBe('Build completed successfully with no problems recorded.');
  });
});

// honestModelLabel — the report must name the model that ACTUALLY ran (autopsy 2026-07-27).
// The reported build showed `model: "claude-sonnet-4-6"` while noClaude:true, builtBy:"KIMI" and
// all 8 delivered turns were kimi-k2.5. Naming a model that never executed misdirects the one
// person who reads this field: whoever is debugging routing.
describe('honestModelLabel (autopsy 2026-07-27)', () => {
  it('reports what actually delivered, not the router intent', () => {
    expect(honestModelLabel('claude-sonnet-4-6', [
      { model: 'kimi-k2.5', ok: true }, { model: 'kimi-k2.5', ok: true },
    ])).toBe('kimi-k2.5');
  });

  it('uses the LAST successful call (the one that produced the delivered result)', () => {
    expect(honestModelLabel('planned', [
      { model: 'glm-4.7', ok: true }, { model: 'kimi-k2.5', ok: true },
    ])).toBe('kimi-k2.5');
  });

  it('skips failed calls — a provider that errored did not deliver anything', () => {
    expect(honestModelLabel('planned', [
      { model: 'glm-5.2', ok: true }, { model: 'kimi-k2.5', ok: false },
    ])).toBe('glm-5.2');
  });

  it('falls back to the planned label when nothing ran (never blank)', () => {
    expect(honestModelLabel('claude-sonnet-4-6', [])).toBe('claude-sonnet-4-6');
    expect(honestModelLabel(undefined, [])).toBeUndefined();
  });
});

describe('counts — an OBSERVATION is neither a self-heal nor an unresolved defect (mitrify 2026-08-04)', () => {
  it('importTurnObservation marks the entry as an observation on an import turn', () => {
    const o = importTurnObservation(true, 'x is unused');
    expect(o.autoResolved).toBe(true);
    expect(o.observation).toBe(true);
    expect(o.message).toContain('nothing was changed');
  });

  it('leaves a real build turn untouched — no observation flag, not auto-resolved', () => {
    const o = importTurnObservation(false, 'x is unused');
    expect(o.autoResolved).toBe(false);
    expect(o.observation).toBeUndefined();
    expect(o.message).toBe('x is unused');
  });

  it('does not inflate the auto-resolved tally — the reported build claimed 32 self-heals for ~0 fixes', () => {
    const d = new BuildDiagnostics({ buildId: 'b', promptHash: 'p', sessionId: 's', workspaceId: 'w', prompt: 'import my repo' });
    // one genuine self-heal …
    d.record({ phase: 'build', severity: 'warning', code: 'REAL_HEAL', message: 'fixed it', autoResolved: true });
    // … and three advisory notes about the user's pre-existing code
    for (const dep of ['stripe', 'ws', 'date-fns']) {
      d.record({ phase: 'build', severity: 'warning', code: 'INTEGRITY_UNUSED_DEP', ...importTurnObservation(true, `"${dep}" is declared but unused`) });
    }
    // … and one thing genuinely still owed
    d.record({ phase: 'build', severity: 'warning', code: 'COMPLIANCE_LOG_LEAK_FOUND', message: 'credential in a console log', autoResolved: false });

    const c = d.report().counts;
    expect(c.total).toBe(5);
    expect(c.autoResolved).toBe(1);   // NOT 4 — the notes are not fixes
    expect(c.unresolved).toBe(1);     // NOT 4 — the notes are not our defects either
    expect(c.observations).toBe(3);
  });

  it('omits the observations key entirely when there are none (no change to a normal build report)', () => {
    const d = new BuildDiagnostics({ buildId: 'b', promptHash: 'p', sessionId: 's', workspaceId: 'w', prompt: 'build me an app' });
    d.record({ phase: 'build', severity: 'warning', code: 'X', message: 'y', autoResolved: true });
    expect(d.report().counts.observations).toBeUndefined();
  });

  // Mitrify autopsy #2 (2026-08-04): a read-only import+survey turn with ZERO real heals reported
  // healCount 32 — heartbeats, tool calls and narration lines are all `severity:'info',
  // autoResolved:true`, and every one of them was counted as a "self-heal". Narration is not a fix.
  it('info-severity timeline events (heartbeats, tool calls, narration) never count as self-heals', () => {
    const d = new BuildDiagnostics({ buildId: 'b', promptHash: 'p', sessionId: 's', workspaceId: 'w', prompt: 'import my repo' });
    d.heartbeat();                                                     // info, autoResolved:true
    d.ingestEvent({ type: 'tool_call', tool: 'read_file', callId: 'c1', ts: 1 } as unknown as AgentEvent);
    d.ingestEvent({ type: 'tool_result', agent: 'architect', callId: 'c1', ok: true, summary: 'ok', ts: 2 } as AgentEvent);
    d.ingestEvent({ type: 'narration', agent: 'architect', text: 'Reading your files…', ts: 3 } as AgentEvent);
    // … one GENUINE heal: a real warning v5 resolved.
    d.record({ phase: 'build', severity: 'warning', code: 'REAL_HEAL', message: 'fixed a broken import', autoResolved: true });

    const c = d.report().counts;
    expect(c.autoResolved).toBe(1); // NOT 5 — the timeline is activity, not fixes
    expect(c.unresolved).toBe(0);   // and excluding info from heals must not turn it into "unresolved"
  });
});

describe('HUGE_PROMPT_DISCARDED — the buried headline', () => {
  it('flags a prompt built at MB scale that the model never received', () => {
    // Autopsy debc468c: the report carried promptChars 76,543,256 beside inputTokens 24,853. Both
    // true, measuring different things (pre- vs post-compaction), and side by side with no
    // explanation the pair reads as broken telemetry — which is what stopped the first pass at it.
    const d = new BuildDiagnostics();
    d.recordLlmCall({
      model: 'kimi-k2.5', promptChars: 76_543_256, responseChars: 0, finishReason: 'tool_use',
      toolCalls: 2, inputTokens: 24_853, outputTokens: 98, latencyMs: 3787, ok: true,
    });
    const found = d.report().issues.filter((i) => i.code === 'HUGE_PROMPT_DISCARDED');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
    expect(found[0].message).toContain('73 MB');
    expect(found[0].detail).toContain('inputTokens=24853');
  });

  it('stays silent for an ordinary large prompt', () => {
    // A few hundred KB is a normal big build. Firing here would train the reader to ignore the code.
    const d = new BuildDiagnostics();
    d.recordLlmCall({
      model: 'kimi-k2.5', promptChars: 400_000, responseChars: 10, finishReason: 'tool_use',
      toolCalls: 1, inputTokens: 90_000, outputTokens: 50, latencyMs: 100, ok: true,
    });
    expect(d.report().issues.some((i) => i.code === 'HUGE_PROMPT_DISCARDED')).toBe(false);
  });
});

describe('the preview line must not claim more than was established', () => {
  /**
   * ADMIN REPORT 2026-08-24, a Next.js racing game. The timeline, from the report itself:
   *   14:18:52  PREVIEW_PUBLISHED  "Preview published at https://3000-….e2b.app"
   *   14:19:23  PREVIEW_NOT_RENDERED  "the server returned 404 / Cannot GET"
   * The url was handed over as a finished thing and found not to work 31 seconds later. The user's
   * next message was "Preview chal ke band ho gaya".
   *
   * The readiness test is NOT the defect: a listening port is the right thing to publish on, and for an
   * API-only app a 404 on `/` is a healthy dev server. Next.js dev simply binds its port immediately
   * and compiles a route on the FIRST REQUEST, so "the port is up" and "your app answers" are up to a
   * minute apart — and only the second is what "published" sounds like.
   */
  it('says the ADDRESS is live and that rendering is still to be checked', () => {
    const d = new BuildDiagnostics({});
    d.ingestEvent({ type: 'preview', url: 'https://3000-abc.e2b.app', ts: Date.now() } as never);
    const rec = d.report().issues.find((i) => i.code === 'PREVIEW_PUBLISHED')!;
    expect(rec.message).toContain('https://3000-abc.e2b.app');
    expect(rec.message).toContain('listening');
    expect(rec.message).toContain('checked next');
  });

  it('no longer states the flat claim that was contradicted 31 seconds later', () => {
    const d = new BuildDiagnostics({});
    d.ingestEvent({ type: 'preview', url: 'https://x.e2b.app', ts: Date.now() } as never);
    const rec = d.report().issues.find((i) => i.code === 'PREVIEW_PUBLISHED')!;
    expect(rec.message).not.toMatch(/^Preview published at/);
  });

  it('the code is unchanged, so nothing that reads the timeline by code breaks', () => {
    // Only the WORDS were overstating. Renaming the code would break every reader for no gain.
    const d = new BuildDiagnostics({});
    d.ingestEvent({ type: 'preview', url: 'https://y.e2b.app', ts: Date.now() } as never);
    expect(d.report().issues.some((i) => i.code === 'PREVIEW_PUBLISHED')).toBe(true);
  });
});

describe('a repaired blocker must stop being a blocker (Fight 3D, buildId 5e2de8c4)', () => {
  // The report condemned a working 3D fighting game and named as its root cause a duplicate import
  // that had been deterministically removed 1.3 seconds earlier. The finding outlived the defect.
  const withBlocker = (): BuildDiagnostics => {
    const d = new BuildDiagnostics({ workspaceId: 'w', sessionId: 's', prompt: 'p', model: 'kimi-k2.5' });
    d.record({
      phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER',
      message: 'the live preview will not compile — src/main.tsx: Duplicate declaration "ErrorBoundary"',
      autoResolved: false,
    });
    return d;
  };

  it('the blocker counts against shipping until the gate re-runs', () => {
    expect(withBlocker().shippingIssueCount('error')).toBe(1);
  });

  it('re-judging READY clears it, so the release gate stops counting it', () => {
    const d = withBlocker();
    expect(d.resolveReadinessBlockersOnRejudge()).toBe(1);
    expect(d.shippingIssueCount('error')).toBe(0);
  });

  it('is idempotent and does not touch other findings', () => {
    const d = withBlocker();
    d.record({ phase: 'build', severity: 'error', code: 'BUILD_ERROR', message: 'something else broke', autoResolved: false });
    d.resolveReadinessBlockersOnRejudge();
    expect(d.resolveReadinessBlockersOnRejudge()).toBe(0);
    // A real, unrelated error must survive — this clears the re-judged question, not the report.
    expect(d.shippingIssueCount('error')).toBe(1);
  });

  it('is only ever called after the SAME gate has re-run and passed', () => {
    // The method trusts its caller, so the call site is the honesty guarantee and is pinned here.
    const routes = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8',
    ) as string;
    const call = routes.indexOf('buildDiag.resolveReadinessBlockersOnRejudge()');
    expect(call).toBeGreaterThan(-1);
    // The nearest preceding lines must be the re-judge and its ready check.
    const before = routes.slice(Math.max(0, call - 400), call);
    expect(before).toContain('await dispatcher.assessBuildReadiness()');
    expect(before).toContain('verdict.ready');
  });
});
