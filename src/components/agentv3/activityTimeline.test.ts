import { describe, it, expect } from 'vitest';
import { isProgressNoise, parseFileTick, diffStats, summarizeActions, detailEntries, buildChatBlocks } from './activityTimeline';
import type { ActivityEntry } from './agentV3Types';

const tool = (id: string, ts: number, text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry =>
  ({ id, ts, kind: 'tool', text, ...extra });
const file = (id: string, ts: number, text: string): ActivityEntry => ({ id, ts, kind: 'file', text, ok: true });

describe('isProgressNoise — timers/heartbeats/per-file ticks never render as prose', () => {
  it('filters ETA, heartbeat, still-building and per-file ticks', () => {
    expect(isProgressNoise('⏱️ Estimated build time: ~13 min — I\'ll keep you posted as I go.')).toBe(true);
    expect(isProgressNoise('⏱ minute 4 — still working (last: bash)')).toBe(true);
    expect(isProgressNoise('⏱️ Still building… 4 min in · ~9 min to go')).toBe(true);
    expect(isProgressNoise('✓ src/lib/utils.ts (1/33)')).toBe(true);
  });
  it('keeps real agent prose', () => {
    expect(isProgressNoise('Planning the file list…')).toBe(false);
    expect(isProgressNoise('Build verified — the app compiles. ✓')).toBe(false);
    expect(isProgressNoise('')).toBe(false);
  });
});

describe('parseFileTick', () => {
  it('parses the engine per-file tick', () => {
    expect(parseFileTick('✓ src/App.tsx (12/33)')).toEqual({ done: 12, total: 33 });
    expect(parseFileTick('not a tick')).toBeNull();
  });
});

describe('diffStats — real +/- counts from a unified patch', () => {
  it('counts added/removed lines, ignoring file headers', () => {
    const patch = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,2 +1,3 @@', '+added', '+added2', '-removed', ' context'].join('\n');
    expect(diffStats(patch)).toEqual({ plus: 2, minus: 1 });
  });
  it('is safe on empty input', () => {
    expect(diffStats('')).toEqual({ plus: 0, minus: 0 });
  });
});

describe('summarizeActions — Claude-style one-line summaries from REAL entries', () => {
  it('"Created N files" for a batch build, never double-counting the write+file pair', () => {
    const entries = [
      tool('t1', 1, 'writing src/App.tsx', { active: false, ok: true }),
      file('f1', 2, 'created src/App.tsx'),
      tool('t2', 3, 'writing src/main.tsx', { ok: true }),
      file('f2', 4, 'created src/main.tsx'),
    ];
    expect(summarizeActions(entries, {}).summary).toBe('Created 2 files');
  });

  it('single edited file shows its basename + real diff stats', () => {
    const entries = [file('f1', 1, 'edited src/components/agentv3/AgentV3Panel.tsx')];
    const { summary, stats } = summarizeActions(entries, {
      'src/components/agentv3/AgentV3Panel.tsx': '+++ b/x\n+a\n+b\n-c\n',
    });
    expect(summary).toBe('Edited AgentV3Panel.tsx');
    expect(stats).toEqual({ plus: 2, minus: 1 });
  });

  it('"Read 2 files, ran 10 commands" — the exact Claude rhythm', () => {
    const entries = [
      tool('r1', 1, 'reading a.ts', { ok: true }),
      tool('r2', 2, 'reading b.ts', { ok: true }),
      ...Array.from({ length: 10 }, (_, k) => tool(`c${k}`, 3 + k, `running: cmd-${k}`, { ok: true })),
    ];
    expect(summarizeActions(entries, {}).summary).toBe('Read 2 files, ran 10 commands');
  });

  it('a single command shows the real command text (truncated)', () => {
    expect(summarizeActions([tool('c', 1, 'running: npm install')], {}).summary).toBe('Ran `npm install`');
  });

  it('stats stay null when no patch is known — never a fake number', () => {
    expect(summarizeActions([file('f', 1, 'created x.ts')], {}).stats).toBeNull();
  });
});

describe('detailEntries — expansion shows real rows without write/file duplicates', () => {
  it('drops the tool "writing X" line when its file_changed row exists', () => {
    const entries = [
      tool('t1', 1, 'writing src/App.tsx', { ok: true }),
      file('f1', 2, 'created src/App.tsx'),
      tool('c1', 3, 'running: npm install', { ok: true }),
    ];
    const out = detailEntries(entries);
    expect(out.map((e) => e.id)).toEqual(['f1', 'c1']);
  });
});

describe('buildChatBlocks — prose interleaved with collapsed action groups', () => {
  type M = { role: 'user' | 'agent'; text: string; ts: number };
  const u = (ts: number, text: string): M => ({ role: 'user', ts, text });
  const a = (ts: number, text: string): M => ({ role: 'agent', ts, text });

  it('groups consecutive activity between prose into ONE block, in order', () => {
    const msgs = [u(1, 'build a todo app'), a(2, 'Planning the file list…'), a(100, 'Build verified — the app compiles. ✓')];
    const activity = [
      tool('t1', 10, 'writing src/App.tsx', { ok: true }),
      file('f1', 11, 'created src/App.tsx'),
      tool('c1', 12, 'running: npm install', { ok: true }),
    ];
    const blocks = buildChatBlocks(msgs, activity, {});
    expect(blocks.map((b) => b.kind)).toEqual(['msg', 'msg', 'actions', 'msg']);
    const act = blocks[2] as Extract<(typeof blocks)[number], { kind: 'actions' }>;
    expect(act.summary).toBe('Created App.tsx, ran `npm install`');
    expect(act.entries).toHaveLength(3);
  });

  it('noise prose (timers/ticks) never becomes a bubble but ticks feed the active progress note', () => {
    const msgs = [
      u(1, 'go'),
      a(2, '⏱️ Estimated build time: ~13 min — I\'ll keep you posted as I go.'),
      a(20, '✓ src/App.tsx (12/33)'),
    ];
    const activity = [tool('t1', 10, 'writing src/App.tsx', { active: true })];
    const blocks = buildChatBlocks(msgs, activity, {});
    expect(blocks.map((b) => b.kind)).toEqual(['msg', 'actions']);
    const act = blocks[1] as Extract<(typeof blocks)[number], { kind: 'actions' }>;
    expect(act.active).toBe(true);
    expect(act.progress).toBe('12/33 files');
  });

  it('a failed entry marks the group failed', () => {
    const blocks = buildChatBlocks([], [tool('c1', 1, 'running: npm test', { ok: false })], {});
    const act = blocks[0] as Extract<(typeof blocks)[number], { kind: 'actions' }>;
    expect(act.failed).toBe(true);
  });

  it('prose wins timestamp ties so narration precedes the actions it announces', () => {
    const msgs = [a(10, 'Now fix the import:')];
    const activity = [tool('t1', 10, 'editing src/App.tsx', { ok: true })];
    const blocks = buildChatBlocks(msgs, activity, {});
    expect(blocks.map((b) => b.kind)).toEqual(['msg', 'actions']);
  });

  it('user messages always render (even ⏱-looking text)', () => {
    const blocks = buildChatBlocks([u(1, '⏱ mera message')], [], {});
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('msg');
  });
});
