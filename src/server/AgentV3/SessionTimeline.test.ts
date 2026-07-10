import { describe, it, expect } from 'vitest';
import {
  createTimelineRecorder,
  compactMessagesForPersist,
  compactTranscriptForModel,
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
    rec.record({ type: 'result', ok: true, summary: 's', steps: 5, billedUsd: 0.5, billedInr: 42, tokens: 12345, walletTokensDebited: 4200 });
    expect(rec.final()).toMatchObject({
      ok: true,
      billedUsd: 0.5,
      billedInr: 42,
      tokens: 12345,
      walletTokensDebited: 4200,
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

  it('caps the event count by dropping the OLDEST (the tail must survive) and reports drops', () => {
    const rec = createTimelineRecorder();
    for (let i = 0; i < 620; i++) {
      rec.record({ type: 'file_changed', agent: 'architect', change: { path: `f${i}.ts`, kind: 'create' }, ts: i });
    }
    const events = rec.events();
    expect(events).toHaveLength(500);
    // The newest events survive — a long build's closing preview/diffs/results matter most.
    expect(events[events.length - 1]).toMatchObject({ t: 'file', path: 'f619.ts' });
    expect(events[0]).toMatchObject({ t: 'file', path: 'f120.ts' });
    expect(rec.final()).toMatchObject({ timelineDropped: 120 });
  });

  it('final() is ALWAYS fully populated so Firestore merge behaves like replace (no stale leak)', () => {
    const rec = createTimelineRecorder();
    rec.record({ type: 'done', ok: false, summary: 's', ts: 1 }); // failed turn — no billing facts
    expect(rec.final()).toEqual({
      ok: false,
      billedUsd: 0,
      billedInr: 0,
      tokens: 0,
      walletTokensDebited: 0,
      buildHealth: null,
      timelineDropped: 0,
    });
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

// A1 — model-side transcript compaction (the "233KB prompt → cheap-floor timeout" root cause).
describe('compactTranscriptForModel', () => {
  const bigRead = 'X'.repeat(80_000); // a 2500-line routes.ts-sized read_file result
  // Build a realistic alternating transcript: user prompt, then N (assistant tool_use / user tool_result) turns.
  function transcript(turns: number, resultText: string): unknown[] {
    const msgs: unknown[] = [{ role: 'user', content: 'survey my app' }];
    for (let i = 0; i < turns; i++) {
      msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'read_file', input: { path: `f${i}.ts` } }] });
      msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: resultText, is_error: false }] });
    }
    return msgs;
  }

  it('truncates OLD large tool_result payloads but keeps the recent window verbatim', () => {
    const msgs = transcript(6, bigRead); // 13 messages
    // High maxAny so the recent window stays verbatim — this test guards the OLD-trim mechanic; the
    // V4-2 recent-cap has its own describe block below.
    const out = compactTranscriptForModel(msgs, { keepRecentMessages: 4, maxOldToolResultChars: 2000, maxAnyToolResultChars: 200_000 }) as any[];
    // The whole payload dropped a lot (the recent window legitimately keeps its ~2 big reads verbatim).
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(msgs).length / 2);
    // The LAST 4 messages are the SAME object references (verbatim, untouched).
    for (let i = out.length - 4; i < out.length; i++) expect(out[i]).toBe(msgs[i]);
    // An OLD tool_result was trimmed and carries the honest re-read note.
    const oldResult = out[2] as { content: Array<{ content: string }> };
    // ~maxChars of real content + the short gap note — a tiny fraction of the original 80 000.
    expect(oldResult.content[0].content.length).toBeLessThan(2300);
    expect(oldResult.content[0].content).toContain('call read_file');
  });

  it('NEVER drops a block — every tool_use keeps its matching tool_result (no orphaned ids)', () => {
    const msgs = transcript(6, bigRead);
    const out = compactTranscriptForModel(msgs, { keepRecentMessages: 4 }) as any[];
    const useIds = new Set<string>();
    const resultIds = new Set<string>();
    for (const m of out) {
      if (Array.isArray((m as any).content)) for (const b of (m as any).content) {
        if (b.type === 'tool_use') useIds.add(b.id);
        if (b.type === 'tool_result') resultIds.add(b.tool_use_id);
      }
    }
    expect([...useIds].sort()).toEqual([...resultIds].sort()); // perfect pairing preserved
  });

  it('is a NO-OP for a small build (nothing old is large) and never mutates the input', () => {
    const msgs = transcript(2, 'ok, small result');
    const snapshot = JSON.stringify(msgs);
    const out = compactTranscriptForModel(msgs, { keepRecentMessages: 6 });
    expect(out).toBe(msgs); // cutoff 0 → same array returned
    expect(JSON.stringify(msgs)).toBe(snapshot); // input untouched
  });

  it('does not truncate a SHORT old tool_result (only oversized ones shrink)', () => {
    const msgs = transcript(6, 'a short result under the cap');
    const out = compactTranscriptForModel(msgs, { keepRecentMessages: 4, maxOldToolResultChars: 2000 }) as any[];
    const oldResult = out[2] as { content: Array<{ content: string }> };
    expect(oldResult.content[0].content).toBe('a short result under the cap');
  });

  it('drops an OLD screenshot image block to a short note (base64 is the biggest payload)', () => {
    const msgs: unknown[] = [
      { role: 'user', content: 'test' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'browser', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: [
        { type: 'text', text: 'page loaded' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(200_000) } },
      ] }] },
      { role: 'assistant', content: [{ type: 'text', text: 'looks good' }] },
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      { role: 'user', content: 'ok' },
    ];
    const out = compactTranscriptForModel(msgs, { keepRecentMessages: 3 }) as any[];
    // message 2 = { content: [ tool_result ] }; the image lives inside the tool_result's own content.
    const toolResult = (out[2] as { content: Array<{ content: Array<{ type: string; text?: string }> }> }).content[0];
    const img = toolResult.content.find((c) => c.text?.includes('screenshot'));
    expect(img?.type).toBe('text'); // image → text note
    expect(JSON.stringify(out).length).toBeLessThan(1000); // 200KB base64 gone
  });

  it('never truncates the original user request (message 0, plain string)', () => {
    const msgs = transcript(8, bigRead);
    const out = compactTranscriptForModel(msgs, { keepRecentMessages: 4 }) as any[];
    expect(out[0]).toEqual({ role: 'user', content: 'survey my app' });
  });

  describe('VAJRA V4-2 — hard ceiling on RECENT tool_result dumps (the 2.2M-token reviewer blowup)', () => {
    const huge = 'Y'.repeat(500_000); // a minified bundle / giant glob dump — the real blowup shape

    it('caps a huge tool_result even in the RECENT window (no single dump can blow the context)', () => {
      const msgs = transcript(2, huge); // 5 messages, all "recent"
      const out = compactTranscriptForModel(msgs, { keepRecentMessages: 10, maxAnyToolResultChars: 40_000 }) as any[];
      // Every tool_result now fits the ceiling (+ the short gap note) — the 500KB dumps are gone.
      const result = out[2] as { content: Array<{ content: string }> };
      expect(result.content[0].content.length).toBeLessThan(41_000);
      expect(result.content[0].content).toContain('hidden from this VIEW');
      // The whole prompt is bounded regardless of how big the raw reads were.
      expect(JSON.stringify(out).length).toBeLessThan(200_000);
    });

    it('leaves a recent tool_result UNDER the ceiling untouched (verbatim, same reference)', () => {
      const msgs = transcript(1, 'a small file body'); // 3 messages
      const out = compactTranscriptForModel(msgs, { keepRecentMessages: 10, maxAnyToolResultChars: 40_000 });
      expect(out).toBe(msgs); // nothing shrank → identity preserved
    });

    it('preserves recent assistant reasoning and the latest screenshot (only tool dumps are capped)', () => {
      const msgs: unknown[] = [
        { role: 'user', content: 'test' },
        { role: 'assistant', content: [{ type: 'text', text: 'my detailed plan '.repeat(5000) }] }, // long reasoning
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: [
          { type: 'text', text: 'ok' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'Z'.repeat(300_000) } },
        ] }] },
      ];
      const out = compactTranscriptForModel(msgs, { keepRecentMessages: 10, maxAnyToolResultChars: 40_000 }) as any[];
      expect(out[1]).toBe(msgs[1]); // assistant reasoning verbatim — never capped
      const tr = (out[2] as { content: Array<{ content: Array<{ type: string }> }> }).content[0];
      expect(tr.content.find((c) => c.type === 'image')).toBeTruthy(); // latest screenshot kept
    });
  });
});
