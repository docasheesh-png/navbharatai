import { describe, it, expect } from 'vitest';
import { agentV3Reducer, reduceAll, appendTerminal } from './agentV3Reducer';
import { initialAgentV3State } from './agentV3Types';
import type { AgentV3WireEvent } from './agentV3Types';

describe('agentV3Reducer — folds wire events into surface state', () => {
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
    });
    expect(done.done).toBe(true);
    expect(done.ok).toBe(true);
    expect(done.billedUsd).toBe(1.23);

    const errored = agentV3Reducer(initialAgentV3State(), { type: 'error', message: 'boom', ts: 1 });
    expect(errored.done).toBe(true);
    expect(errored.ok).toBe(false);
    expect(errored.error).toBe('boom');
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

  it('is immutable — does not mutate the input state', () => {
    const s0 = initialAgentV3State();
    const s1 = agentV3Reducer(s0, { type: 'plan_updated', plan: 'x', ts: 1 });
    expect(s0.plan).toBe('');
    expect(s1.plan).toBe('x');
    expect(s1).not.toBe(s0);
  });
});
