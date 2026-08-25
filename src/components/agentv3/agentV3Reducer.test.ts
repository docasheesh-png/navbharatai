import { describe, it, expect } from 'vitest';
import { agentV3Reducer, reduceAll, appendTerminal } from './agentV3Reducer';
import { initialAgentV3State } from './agentV3Types';
import type { AgentV3WireEvent } from './agentV3Types';

describe('agentV3Reducer — folds wire events into surface state', () => {
  it('records own-repo storage from an own_repo event (drives the Ship/Revert controls)', () => {
    let s = initialAgentV3State();
    expect(s.ownRepo).toBeUndefined();
    s = agentV3Reducer(s, { type: 'own_repo', owner: 'aashish', repo: 'mitrify', workBranch: 'navbharatai/work', baseBranch: 'main', ts: 1 });
    expect(s.ownRepo).toEqual({ owner: 'aashish', repo: 'mitrify', workBranch: 'navbharatai/work', baseBranch: 'main' });
  });

  it('records a role chat\'s proposed steps (approved into the queue by the USER, never auto)', () => {
    let s = initialAgentV3State();
    expect(s.proposedSteps).toBeUndefined();
    s = agentV3Reducer(s, { type: 'proposed_steps', role: 'planner', steps: ['Build login', 'Add API'], ts: 1 });
    expect(s.proposedSteps).toEqual({ role: 'planner', steps: ['Build login', 'Add API'] });
  });

  it('records a non-blocking clarify (ask-user) card without touching build progress', () => {
    let s = initialAgentV3State();
    expect(s.pendingClarify).toBeUndefined();
    s = agentV3Reducer(s, { type: 'clarify', domain: 'healthcare', questions: ['Does it need offline entry?', 'Who are the roles?'], ts: 1 });
    expect(s.pendingClarify).toEqual({ domain: 'healthcare', questions: ['Does it need offline entry?', 'Who are the roles?'] });
    expect(s.done).toBe(false); // clarify never ends or blocks the build
  });

  it('tracks the live AI-team card from a tool_call then clears active on result', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, {
      type: 'tool_call',
      agent: 'frontend',
      tool: 'write_file',
      input: { path: 'src/App.tsx' },
      callId: 'c1',
      ts: 1,
    });
    expect(s.agents.frontend.active).toBe(true);
    expect(s.agents.frontend.lastAction).toBe('writing src/App.tsx');

    s = agentV3Reducer(s, { type: 'tool_result', agent: 'frontend', callId: 'c1', ok: true, summary: 'done', ts: 2 });
    expect(s.agents.frontend.active).toBe(false);
    // The action label is retained for context.
    expect(s.agents.frontend.lastAction).toBe('writing src/App.tsx');
  });

  it('builds the live activity feed: tool_call (in-flight) → tool_result (completed)', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, { type: 'tool_call', agent: 'frontend', tool: 'bash', input: { command: 'npm install' }, callId: 'c1', ts: 1 });
    expect(s.activity).toHaveLength(1);
    expect(s.activity[0]).toMatchObject({ id: 'c1', kind: 'tool', text: 'running: npm install', active: true });

    s = agentV3Reducer(s, { type: 'tool_result', agent: 'frontend', callId: 'c1', ok: true, summary: 'ok', ts: 2 });
    expect(s.activity[0].active).toBe(false);
    expect(s.activity[0].ok).toBe(true);
  });

  it('a failed tool_result marks its activity entry ok:false', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, { type: 'tool_call', agent: 'frontend', tool: 'bash', input: { command: 'tsc' }, callId: 'c9', ts: 1 });
    s = agentV3Reducer(s, { type: 'tool_result', agent: 'frontend', callId: 'c9', ok: false, summary: 'error', ts: 2 });
    expect(s.activity[0]).toMatchObject({ active: false, ok: false });
  });

  it('records file writes, agent spawns and preview in the activity feed', () => {
    const events: AgentV3WireEvent[] = [
      { type: 'agent_spawned', agent: 'tester', task: 'write tests', ts: 1 },
      { type: 'file_changed', agent: 'frontend', change: { path: 'src/App.tsx', kind: 'create' }, ts: 2 },
      { type: 'preview', url: 'https://x.example.dev', ts: 3 },
    ];
    const s = reduceAll(initialAgentV3State(), events);
    expect(s.activity.map((a) => a.kind)).toEqual(['agent', 'file', 'preview']);
    expect(s.activity[1].text).toBe('created src/App.tsx');
    expect(s.activity[2].text).toBe('preview published');
  });

  it('updates the file explorer surface (create / modify / delete)', () => {
    const events: AgentV3WireEvent[] = [
      { type: 'file_changed', agent: 'frontend', change: { path: 'a.ts', kind: 'create' }, ts: 1 },
      { type: 'file_changed', agent: 'frontend', change: { path: 'b.ts', kind: 'create' }, ts: 2 },
      { type: 'file_changed', agent: 'frontend', change: { path: 'a.ts', kind: 'modify' }, ts: 3 },
      { type: 'file_changed', agent: 'frontend', change: { path: 'b.ts', kind: 'delete' }, ts: 4 },
    ];
    const s = reduceAll(initialAgentV3State(), events);
    expect(s.files.map((f) => f.path)).toEqual(['a.ts']);
    expect(s.files[0].kind).toBe('modify');
  });

  it('records the latest diff per file (Code Studio surface)', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, { type: 'diff', agent: 'frontend', diff: { path: 'a.ts', patch: '- old\n+ new' }, ts: 1 });
    s = agentV3Reducer(s, { type: 'diff', agent: 'frontend', diff: { path: 'a.ts', patch: '- new\n+ newer' }, ts: 2 });
    expect(s.diffs['a.ts']).toBe('- new\n+ newer');
  });

  it('captures todos, plan, narration and git checkpoints', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, { type: 'plan_updated', plan: 'build a shop', ts: 1 });
    s = agentV3Reducer(s, {
      type: 'todo_updated',
      todos: [{ id: '1', title: 'scaffold', status: 'in_progress' }],
      ts: 2,
    });
    s = agentV3Reducer(s, { type: 'narration', agent: 'architect', text: 'Planning the build.', ts: 3 });
    s = agentV3Reducer(s, {
      type: 'checkpoint',
      checkpoint: { id: 'cp1', sha: 'abc123', message: 'init', ts: 4 },
      ts: 4,
    });
    expect(s.plan).toBe('build a shop');
    expect(s.todos).toHaveLength(1);
    expect(s.narration).toHaveLength(1);
    expect(s.checkpoints[0].sha).toBe('abc123');
  });

  it('sets a pending permission gate and clears it on completion', () => {
    let s = agentV3Reducer(initialAgentV3State(), {
      type: 'permission_request',
      agent: 'architect',
      action: 'Approve this plan to start building',
      callId: 'req-1',
      ts: 1,
    });
    expect(s.pendingPermission).toEqual({ callId: 'req-1', action: 'Approve this plan to start building' });
    s = agentV3Reducer(s, { type: 'done', ok: true, summary: 'built', ts: 2 });
    expect(s.pendingPermission).toBeUndefined();
  });

  it('stores the workspace id for restore', () => {
    const s = agentV3Reducer(initialAgentV3State(), { type: 'workspace', workspaceId: 'ws-42', ts: 1 });
    expect(s.workspaceId).toBe('ws-42');
  });

  it('replaces the whole file list on files_restored (Restore all files)', () => {
    let s = agentV3Reducer(initialAgentV3State(), { type: 'file_changed', agent: 'frontend', change: { path: 'old.ts', kind: 'create' }, ts: 1 });
    expect(s.files.map((f) => f.path)).toEqual(['old.ts']);
    s = agentV3Reducer(s, { type: 'files_restored', files: [{ path: 'src/App.tsx', kind: 'create' }, { path: 'index.html', kind: 'create' }], ts: 2 });
    expect(s.files.map((f) => f.path)).toEqual(['src/App.tsx', 'index.html']);
  });

  it('captures the build-health readiness from a done event (R2 §4.6)', () => {
    const health = { score: 70, ready: false, blockers: ['1 unresolved import(s)'], warnings: ['2 medium-severity'] };
    const s = agentV3Reducer(initialAgentV3State(), { type: 'done', ok: false, summary: 'not ready', ts: 1, readiness: health });
    expect(s.buildHealth).toEqual(health);
  });

  it('leaves buildHealth undefined when a done event carries no readiness', () => {
    const s = agentV3Reducer(initialAgentV3State(), { type: 'done', ok: true, summary: 'built', ts: 1 });
    expect(s.buildHealth).toBeUndefined();
  });

  it('captures build-health readiness from a result event too (T1-health-card — success terminates with result)', () => {
    const health = { score: 88, ready: true, blockers: [], warnings: ['no error boundary'] };
    const s = agentV3Reducer(initialAgentV3State(), { type: 'result', ok: true, summary: 'built', steps: 4, billedUsd: 0.2, readiness: health });
    expect(s.done).toBe(true);
    expect(s.buildHealth).toEqual(health);
  });

  it('leaves buildHealth undefined when a result event carries no readiness (backward compat)', () => {
    const s = agentV3Reducer(initialAgentV3State(), { type: 'result', ok: true, summary: 'built', steps: 1, billedUsd: 0 });
    expect(s.buildHealth).toBeUndefined();
  });

  it('stores the live preview URL', () => {
    const s = agentV3Reducer(initialAgentV3State(), { type: 'preview', url: 'https://app.sandbox.dev', ts: 1 });
    expect(s.previewUrl).toBe('https://app.sandbox.dev');
  });

  it('marks done/ok/billed on result and error on error', () => {
    const done = agentV3Reducer(initialAgentV3State(), {
      type: 'result',
      ok: true,
      summary: 'built',
      steps: 4,
      billedUsd: 1.23,
      billedInr: 104.55,
    });
    expect(done.done).toBe(true);
    expect(done.ok).toBe(true);
    expect(done.billedUsd).toBe(1.23);
    expect(done.billedInr).toBe(104.55);

    const errored = agentV3Reducer(initialAgentV3State(), { type: 'error', message: 'boom', ts: 1 });
    expect(errored.done).toBe(true);
    expect(errored.ok).toBe(false);
    expect(errored.error).toBe('boom');

    // A crashed build's error event now carries the diagnostics report so the failure card renders
    // ("fail par report bhi milni chahiye"). The reducer must keep it in state.
    const report = { issues: [{ code: 'BUILD_EXCEPTION', message: 'boom' }] };
    const erroredWithReport = agentV3Reducer(initialAgentV3State(), { type: 'error', message: 'boom', ts: 1, diagnostics: report });
    expect(erroredWithReport.ok).toBe(false);
    expect(erroredWithReport.done).toBe(true);
    expect(erroredWithReport.diagnostics).toEqual(report);
    // Absent diagnostics must NOT clobber a report already in state.
    const prior = { ...initialAgentV3State(), diagnostics: report };
    const noReport = agentV3Reducer(prior, { type: 'error', message: 'boom2', ts: 2 });
    expect(noReport.diagnostics).toEqual(report);
  });

  it('carries the token count from a result (P-UX.7 usage badge)', () => {
    const withTokens = agentV3Reducer(initialAgentV3State(), {
      type: 'result', ok: true, summary: 'built', steps: 3, billedUsd: 0.2, tokens: 12345,
    });
    expect(withTokens.tokens).toBe(12345);
    const noTokens = agentV3Reducer(initialAgentV3State(), { type: 'result', ok: true, summary: 'built', steps: 1, billedUsd: 0 });
    expect(noTokens.tokens).toBeUndefined();
  });

  it('carries the resumable flag from a time-limit pause (Layer 3 auto-continue)', () => {
    const paused = agentV3Reducer(initialAgentV3State(), {
      type: 'result', ok: false, summary: 'Build paused at the time limit', steps: 0, billedUsd: 0, resumable: true,
    });
    expect(paused.done).toBe(true);
    expect(paused.resumable).toBe(true);
    // A normal success result is NOT resumable (so it never auto-continues).
    const ok = agentV3Reducer(initialAgentV3State(), { type: 'result', ok: true, summary: 'built', steps: 3, billedUsd: 0.2 });
    expect(ok.resumable).toBe(false);
  });

  it('carries planRemaining from a project-mode module result (SPM-3 auto-continue guard)', () => {
    const moduleTurn = agentV3Reducer(initialAgentV3State(), {
      type: 'result', ok: true, summary: 'module done', steps: 12, billedUsd: 0.4, resumable: true, planRemaining: 7,
    });
    expect(moduleTurn.resumable).toBe(true);
    expect(moduleTurn.planRemaining).toBe(7);
    // A non-project result carries no plan signal (classic pause budget applies).
    const classic = agentV3Reducer(initialAgentV3State(), { type: 'result', ok: false, summary: 'paused', steps: 0, billedUsd: 0, resumable: true });
    expect(classic.planRemaining).toBeUndefined();
  });

  it('keeps the diagnostics report delivered with the result event (for the "Build report" button)', () => {
    const report = { schema: 'navbharatai.v3.build-diagnostics/1', issues: [{ code: 'TOOL_CALL' }] };
    const withDiag = agentV3Reducer(initialAgentV3State(), {
      type: 'result', ok: true, summary: 'built', steps: 2, billedUsd: 0.5, diagnostics: report,
    });
    expect(withDiag.diagnostics).toEqual(report);

    // A result without diagnostics must not blow away an existing report.
    const prior = { ...initialAgentV3State(), diagnostics: report };
    const next = agentV3Reducer(prior, { type: 'result', ok: true, summary: 'again', steps: 1, billedUsd: 0.1 });
    expect(next.diagnostics).toEqual(report);
  });

  it('routes bash command + result to the terminal surface', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, {
      type: 'tool_call',
      agent: 'backend',
      tool: 'bash',
      input: { command: 'npm install' },
      callId: 'b1',
      ts: 1,
    });
    expect(s.terminal).toEqual(['$ npm install']);
    s = agentV3Reducer(s, { type: 'tool_result', agent: 'backend', callId: 'b1', ok: true, summary: 'exit=0 added 12 packages', ts: 2 });
    expect(s.terminal).toEqual(['$ npm install', 'exit=0 added 12 packages']);
    expect(s.pendingBash).toEqual({});
  });

  it('does not route non-bash tool results to the terminal', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, {
      type: 'tool_call',
      agent: 'frontend',
      tool: 'write_file',
      input: { path: 'a.ts' },
      callId: 'w1',
      ts: 1,
    });
    s = agentV3Reducer(s, { type: 'tool_result', agent: 'frontend', callId: 'w1', ok: true, summary: 'Created a.ts', ts: 2 });
    expect(s.terminal).toEqual([]);
  });

  it('appendTerminal accumulates and bounds terminal output', () => {
    let s = initialAgentV3State();
    s = appendTerminal(s, 'exit=0');
    s = appendTerminal(s, 'hello');
    expect(s.terminal).toEqual(['exit=0', 'hello']);
  });

  it('accumulates stream_delta text then finalizes (not duplicates) on narration', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, { type: 'stream_delta', agent: 'architect', id: 't1', kind: 'text', delta: 'Hello', ts: 1 });
    s = agentV3Reducer(s, { type: 'stream_delta', agent: 'architect', id: 't1', kind: 'text', delta: ' world', ts: 2 });
    expect(s.narration).toHaveLength(1);
    expect(s.narration[0].text).toBe('Hello world');
    expect(s.narration[0].streaming).toBe(true);

    // Final narration with the same id finalizes the existing line in place.
    s = agentV3Reducer(s, { type: 'narration', agent: 'architect', text: 'Hello world', ts: 3, id: 't1' });
    expect(s.narration).toHaveLength(1);
    expect(s.narration[0].text).toBe('Hello world');
    expect(s.narration[0].streaming).toBe(false);
  });

  it('keeps thinking deltas as a separate line from text deltas with the same id', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, { type: 'stream_delta', agent: 'architect', id: 't1', kind: 'thinking', delta: 'Let me', ts: 1 });
    s = agentV3Reducer(s, { type: 'stream_delta', agent: 'architect', id: 't1', kind: 'thinking', delta: ' think', ts: 2 });
    s = agentV3Reducer(s, { type: 'stream_delta', agent: 'architect', id: 't1', kind: 'text', delta: 'Done', ts: 3 });
    expect(s.narration).toHaveLength(2);
    expect(s.narration[0].kind).toBe('thinking');
    expect(s.narration[0].text).toBe('Let me think');
    expect(s.narration[1].kind).toBe('text');
    expect(s.narration[1].text).toBe('Done');

    // Finalizing the text turn leaves the thinking line untouched and does not dupe.
    s = agentV3Reducer(s, { type: 'narration', agent: 'architect', text: 'Done', ts: 4, id: 't1' });
    expect(s.narration).toHaveLength(2);
    expect(s.narration[1].text).toBe('Done');
    expect(s.narration[1].streaming).toBe(false);
    expect(s.narration[0].text).toBe('Let me think');
  });

  it('backward compatible: a narration with no id pushes a new line as before', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, { type: 'narration', agent: 'architect', text: 'first', ts: 1 });
    s = agentV3Reducer(s, { type: 'narration', agent: 'architect', text: 'second', ts: 2 });
    expect(s.narration.map((n) => n.text)).toEqual(['first', 'second']);
  });

  it('is immutable — does not mutate the input state', () => {
    const s0 = initialAgentV3State();
    const s1 = agentV3Reducer(s0, { type: 'plan_updated', plan: 'x', ts: 1 });
    expect(s0.plan).toBe('');
    expect(s1.plan).toBe('x');
    expect(s1).not.toBe(s0);
  });
});

// B8 — the context meter. It is a CURRENT reading, not a log: a second event replaces the first.
describe('context_usage', () => {
  it('starts null — nothing has been measured yet, and a meter must never guess', () => {
    expect(initialAgentV3State().contextUsage).toBeNull();
  });

  it('stores the reading', () => {
    const s = agentV3Reducer(initialAgentV3State(), { type: 'context_usage', pct: 74, level: 'high', note: 'getting long', ts: 1 });
    expect(s.contextUsage).toEqual({ pct: 74, level: 'high', note: 'getting long' });
  });

  it('REPLACES rather than accumulating (this is a gauge, not a history)', () => {
    let s = agentV3Reducer(initialAgentV3State(), { type: 'context_usage', pct: 74, level: 'high', note: 'a', ts: 1 });
    s = agentV3Reducer(s, { type: 'context_usage', pct: 91, level: 'critical', note: 'b', ts: 2 });
    expect(s.contextUsage).toEqual({ pct: 91, level: 'critical', note: 'b' });
  });

  it('does not disturb the rest of the state', () => {
    const before = initialAgentV3State();
    const after = agentV3Reducer(before, { type: 'context_usage', pct: 10, level: 'ok', note: '', ts: 1 });
    expect(after.files).toEqual(before.files);
    expect(after.checkpoints).toEqual(before.checkpoints);
  });
});

describe('repo ownership decides whether we may offer a deploy from it', () => {
  const base = () => initialAgentV3State();

  it('a repo in the user own account is marked as theirs', () => {
    const s = agentV3Reducer(base(), { type: 'repo', url: 'https://github.com/asheesh/app', fullName: 'asheesh/app', ownedByUser: true, ts: 2 });
    expect(s.repoFullName).toBe('asheesh/app');
    expect(s.repoOwnedByUser).toBe(true);
  });

  it('the invisible platform-org repo is NOT theirs — their own host cannot see it', () => {
    const s = agentV3Reducer(base(), { type: 'repo', url: 'https://github.com/navbharatai/proj', fullName: 'navbharatai/proj', ownedByUser: false, ts: 2 });
    expect(s.repoOwnedByUser).toBe(false);
  });

  it('an older server that sends no flag is treated as NOT theirs — the safe answer', () => {
    const s = agentV3Reducer(base(), { type: 'repo', url: 'https://github.com/x/y', fullName: 'x/y', ts: 2 });
    expect(s.repoOwnedByUser).toBe(false);
  });
});
