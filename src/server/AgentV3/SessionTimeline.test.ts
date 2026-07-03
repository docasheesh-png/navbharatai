import { describe, it, expect } from 'vitest';
import {
  createTimelineRecorder,
  compactMessagesForPersist,
  sessionRecallContextLine,
  type TimelineEvent,
} from './SessionTimeline';

describe('createTimelineRecorder', () => {
  it('records the evidence-layer events compactly and ignores transcript/transient kinds', () => {
    const rec = createTimelineRecorder();
    rec.record({ type: 'workspace', workspaceId: 'ws', ts: 1 });
    rec.record({ type: 'narration', agent: 'architect', text: 'Building…', ts: 2 });
    rec.record({ type: 'stream_delta', agent: 'architect', id: 'n1', kind: 'text', delta: 'B', ts: 2 });
    rec.record({ type: 'thinking', agent: 'architect', text: 'hmm', ts: 2 });
    rec.record({ type: 'todo_updated', todos: [], ts: 2 });
    rec.record({ type: 'checkpoint', checkpoint: { id: 'c', sha: 'abc', message: 'm', ts: 2 }, ts: 2 });
    rec.record({ type: 'tool_call', agent: 'architect', tool: 'bash', input: { command: 'npm install' }, callId: 't1', ts: 3 });
    rec.record({ type: 'tool_result', agent: 'architect', callId: 't1', ok: true, summary: 'ok', ts: 4 });
    rec.record({ type: 'file_changed', agent: 'architect', change: { path: 'src/App.tsx', kind: 'create' }, ts: 5 });
    rec.record({ type: 'agent_spawned', agent: 'frontend', task: 'build the UI', ts: 6 });
    rec.record({ type: 'preview', url: 'https://x.e2b.dev', ts: 7 });
    rec.record({ type: 'diff', agent: 'architect', diff: { path: 'src/App.tsx', patch: '+hello\n-old' }, ts: 8 });
    const events = rec.events();
    expect(events.map((e) => e.t)).toEqual(['tool_call', 'tool_result', 'file', 'agent', 'preview', 'diff']);
    const call = events[0] as Extract<TimelineEvent, { t: 'tool_call' }>;
    expect(call).toMatchObject({ id: 't1', tool: 'bash', ts: 3, input: { command: 'npm install' } });
    expect(events[2]).toMatchObject({ t: 'file', path: 'src/App.tsx', kind: 'create' });
    expect(events[5]).toMatchObject({ t: 'diff', path: 'src/App.tsx', patch: '+hello\n-old' });
  });

  it('captures the done/result terminal facts as finalState', () => {
    const rec = createTimelineRecorder();
    expect(rec.final()).toBeNull();
    rec.record({ type: 'done', ok: true, summary: 's', ts: 1, readiness: { score: 90, ready: true, blockers: [], warnings: [] } });
    rec.record({ type: 'result', ok: true, summary: 's', steps: 5, billedUsd: 0.5, billedInr: 42, tokens: 12345 });
    expect(rec.final()).toMatchObject({
      ok: true,
      billedUsd: 0.5,
      billedInr: 42,
      tokens: 12345,
      buildHealth: { score: 90, ready: true },
    });
  });

  it('truncates oversized diff patches and tool summaries at record time', () => {
    const rec = createTimelineRecorder();
    rec.record({ type: 'diff', agent: 'architect', diff: { path: 'a.ts', patch: 'x'.repeat(50_000) }, ts: 1 });
    rec.record({ type: 'tool_result', agent: 'architect', callId: 't1', ok: false, summary: 'y'.repeat(5_000), ts: 2 });
    const [diff, result] = rec.events() as [Extract<TimelineEvent, { t: 'diff' }>, Extract<TimelineEvent, { t: 'tool_result' }>];
    expect(diff.patch.length).toBeLessThan(17_000);
    expect(diff.patch.endsWith('[diff truncated for storage]')).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(401);
  });

  it('caps the event count and reports drops in finalState', () => {
    const rec = createTimelineRecorder();
    for (let i = 0; i < 620; i++) {
      rec.record({ type: 'file_changed', agent: 'architect', change: { path: `f${i}.ts`, kind: 'create' }, ts: i });
    }
    expect(rec.events()).toHaveLength(500);
    expect(rec.final()).toMatchObject({ timelineDropped: 120 });
  });

  it('enforces the serialized budget by shrinking the largest diffs first', () => {
    const rec = createTimelineRecorder();
    for (let i = 0; i < 30; i++) {
      rec.record({ type: 'diff', agent: 'architect', diff: { path: `f${i}.ts`, patch: 'z'.repeat(15_000) }, ts: i });
    }
    const events = rec.events();
    expect(JSON.stringify(events).length).toBeLessThanOrEqual(310_000);
    // The file identity of every diff survives even when its patch was shrunk.
    expect(events).toHaveLength(30);
    expect(events.every((e) => e.t === 'diff')).toBe(true);
  });

  it('never throws on malformed events', () => {
    const rec = createTimelineRecorder();
    rec.record(null);
    rec.record('nonsense');
    rec.record({ type: 'tool_call' }); // missing callId/tool
    rec.record({ type: 'diff', diff: {} });
    rec.record({ type: 'file_changed', change: null });
    expect(rec.events()).toEqual([]);
  });
});

describe('compactMessagesForPersist', () => {
  it('replaces base64 image blocks with an honest placeholder', () => {
    const msgs = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(400_000) } }] },
        ],
      },
    ];
    const out = compactMessagesForPersist(msgs) as Array<{ content: Array<{ content: Array<{ type: string; text?: string }> }> }>;
    expect(out[0].content[0].content[0]).toEqual({ type: 'text', text: '[screenshot omitted from the saved transcript]' });
    expect(JSON.stringify(out).length).toBeLessThan(1_000);
  });

  it('truncates giant tool_use inputs (whole-file writes) and tool_result strings', () => {
    const msgs = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'write_file', input: { path: 'a.ts', content: 'c'.repeat(100_000) } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r'.repeat(100_000) }] },
    ];
    const out = compactMessagesForPersist(msgs);
    const s = JSON.stringify(out);
    expect(s.length).toBeLessThan(40_000);
    expect(s).toContain('truncated for storage');
  });

  it('is far smaller in aggressive mode', () => {
    const msgs = [{ role: 'assistant', content: [{ type: 'text', text: 't'.repeat(30_000) }] }];
    const normal = JSON.stringify(compactMessagesForPersist(msgs)).length;
    const aggressive = JSON.stringify(compactMessagesForPersist(msgs, { aggressive: true })).length;
    expect(normal).toBeGreaterThan(aggressive);
    expect(aggressive).toBeLessThan(5_000);
  });

  it('never mutates the input messages (they are the live model conversation)', () => {
    const input = { path: 'a.ts', content: 'c'.repeat(100_000) };
    const msgs = [{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'write_file', input }] }];
    compactMessagesForPersist(msgs);
    expect(input.content.length).toBe(100_000);
    expect((msgs[0].content[0] as { input: { content: string } }).input.content.length).toBe(100_000);
  });

  it('passes small messages through structurally unchanged', () => {
    const msgs = [
      { role: 'user', content: 'build a todo app' },
      { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    ];
    expect(compactMessagesForPersist(msgs)).toEqual(msgs);
  });
});

describe('sessionRecallContextLine', () => {
  it('returns empty for no episodes (keeps fresh sessions cacheable)', () => {
    expect(sessionRecallContextLine([])).toBe('');
    expect(sessionRecallContextLine([{ ts: 1, kind: 'error', text: 'x' }])).toBe('');
  });

  it('summarizes the last requests and notes, excluding PLAN_STATE', () => {
    const line = sessionRecallContextLine([
      { ts: 1, kind: 'request', text: 'build a todo app' },
      { ts: 2, kind: 'note', text: 'PLAN_STATE {"todos":[]}' },
      { ts: 3, kind: 'note', text: 'Uses Supabase for auth' },
      { ts: 4, kind: 'request', text: 'make the header blue' },
    ]);
    expect(line).toContain('build a todo app');
    expect(line).toContain('make the header blue');
    expect(line).toContain('Uses Supabase for auth');
    expect(line).not.toContain('PLAN_STATE');
    expect(line).toContain('SESSION MEMORY');
  });

  it('keeps only the most recent 4 requests and stays bounded', () => {
    const eps = Array.from({ length: 20 }, (_, i) => ({ ts: i, kind: 'request', text: `request number ${i} ` + 'x'.repeat(300) }));
    const line = sessionRecallContextLine(eps);
    expect(line).not.toContain('request number 15 ');
    expect(line).toContain('request number 16 ');
    expect(line).toContain('request number 19 ');
    expect(line.length).toBeLessThanOrEqual(1_201);
  });
});
