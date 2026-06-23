import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentEventStream } from './AgentEventStream';
import { WorkspaceState } from './WorkspaceState';
import { agentV3Status } from './index';
import { isAgentV3Enabled, isAgentV3GloballyEnabled, agentV3Allowlist } from './featureFlag';
import type { AgentEvent } from './types';

describe('AgentV3 feature flag (strangler-fig, default OFF)', () => {
  const prevEnabled = process.env.AGENTV3_ENABLED;
  const prevAllow = process.env.AGENTV3_ALLOWLIST;

  beforeEach(() => {
    delete process.env.AGENTV3_ENABLED;
    delete process.env.AGENTV3_ALLOWLIST;
  });
  afterEach(() => {
    if (prevEnabled === undefined) delete process.env.AGENTV3_ENABLED;
    else process.env.AGENTV3_ENABLED = prevEnabled;
    if (prevAllow === undefined) delete process.env.AGENTV3_ALLOWLIST;
    else process.env.AGENTV3_ALLOWLIST = prevAllow;
  });

  it('is OFF by default — live app unaffected', () => {
    expect(isAgentV3GloballyEnabled()).toBe(false);
    expect(isAgentV3Enabled('user-1')).toBe(false);
  });

  it('enables all users when flag on and allowlist empty', () => {
    process.env.AGENTV3_ENABLED = 'true';
    expect(isAgentV3Enabled('anyone')).toBe(true);
    expect(isAgentV3Enabled(null)).toBe(true);
  });

  it('restricts to the allowlist when one is set', () => {
    process.env.AGENTV3_ENABLED = 'true';
    process.env.AGENTV3_ALLOWLIST = 'alice, bob';
    expect(agentV3Allowlist()).toEqual(['alice', 'bob']);
    expect(isAgentV3Enabled('alice')).toBe(true);
    expect(isAgentV3Enabled('carol')).toBe(false);
    expect(isAgentV3Enabled(null)).toBe(false);
  });

  it('matches an allowlist entry by email (case-insensitive) too', () => {
    process.env.AGENTV3_ENABLED = 'true';
    process.env.AGENTV3_ALLOWLIST = 'admin@example.com';
    expect(isAgentV3Enabled('some-uid', 'admin@example.com')).toBe(true);
    expect(isAgentV3Enabled('some-uid', 'ADMIN@example.com')).toBe(true);
    expect(isAgentV3Enabled('some-uid', 'other@example.com')).toBe(false);
    expect(isAgentV3Enabled('admin@example.com')).toBe(true); // uid field also matches
  });
});

describe('AgentV3 status is honest (not ready until P1)', () => {
  it('reports ready:false and the five merged surfaces', () => {
    const s = agentV3Status();
    expect(s.ready).toBe(false);
    expect(s.phase).toBe('P0');
    expect(s.surfaces).toEqual(['preview', 'ide', 'files', 'git', 'history']);
  });
});

describe('AgentEventStream', () => {
  it('broadcasts events to subscribers', () => {
    const stream = new AgentEventStream();
    const received: AgentEvent[] = [];
    stream.subscribe((e) => received.push(e));
    stream.emit({ type: 'done', ok: true, summary: 'x', ts: 1 });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('done');
  });

  it('replays buffered events to a late subscriber', () => {
    const stream = new AgentEventStream();
    stream.emit({ type: 'plan_updated', plan: 'p', ts: 1 });
    const received: AgentEvent[] = [];
    stream.subscribe((e) => received.push(e)); // replay defaults to true
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('plan_updated');
  });

  it('isolates a throwing listener so the agent loop is never broken', () => {
    const stream = new AgentEventStream();
    const ok: AgentEvent[] = [];
    stream.subscribe(() => {
      throw new Error('surface crashed');
    });
    stream.subscribe((e) => ok.push(e));
    expect(() => stream.emit({ type: 'error', message: 'm', ts: 1 })).not.toThrow();
    expect(ok).toHaveLength(1);
  });

  it('unsubscribe stops delivery', () => {
    const stream = new AgentEventStream();
    const received: AgentEvent[] = [];
    const off = stream.subscribe((e) => received.push(e), false);
    off();
    stream.emit({ type: 'done', ok: true, summary: '', ts: 1 });
    expect(received).toHaveLength(0);
  });
});

describe('WorkspaceState (single source of truth)', () => {
  it('tracks file changes and emits them on the stream', () => {
    const stream = new AgentEventStream();
    const events: AgentEvent[] = [];
    stream.subscribe((e) => events.push(e), false);
    const ws = new WorkspaceState(stream);

    ws.recordFileChange({ path: 'src/App.tsx', kind: 'create' }, 'frontend');
    ws.recordFileChange({ path: 'src/api.ts', kind: 'create' }, 'backend');

    const snap = ws.snapshot();
    expect(snap.files.map((f) => f.path).sort()).toEqual(['src/App.tsx', 'src/api.ts']);
    expect(events.filter((e) => e.type === 'file_changed')).toHaveLength(2);
  });

  it('drops a file on delete', () => {
    const ws = new WorkspaceState();
    ws.recordFileChange({ path: 'a.ts', kind: 'create' });
    ws.recordFileChange({ path: 'a.ts', kind: 'delete' });
    expect(ws.snapshot().files).toHaveLength(0);
  });

  it('works without a stream (stream is optional)', () => {
    const ws = new WorkspaceState();
    ws.setPlan('build a todo app');
    ws.setTodos([{ id: '1', title: 'scaffold', status: 'pending' }]);
    const snap = ws.snapshot();
    expect(snap.plan).toBe('build a todo app');
    expect(snap.todos).toHaveLength(1);
  });
});
