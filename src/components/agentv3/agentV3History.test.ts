import { describe, it, expect } from 'vitest';
import { messageText, conversationToEvents, conversationToUserMessages, cleanRestoredUserPrompt, sessionStatusMeta, sessionDateBucket, groupSessionsByDate, legacyPrependMessages, type PersistedConversation } from './agentV3History';
import { agentV3Reducer } from './agentV3Reducer';
import { initialAgentV3State } from './agentV3Types';

describe('messageText', () => {
  it('returns a plain string content as-is', () => {
    expect(messageText('hello there')).toBe('hello there');
  });
  it('joins the text blocks of a content array and ignores tool_use blocks', () => {
    expect(messageText([
      { type: 'text', text: 'Creating the file.' },
      { type: 'tool_use', id: 'tu1', name: 'write_file', input: {} },
      { type: 'text', text: 'Done.' },
    ])).toBe('Creating the file.\nDone.');
  });
  it('returns empty for non-text content', () => {
    expect(messageText(null)).toBe('');
    expect(messageText(42)).toBe('');
    expect(messageText([{ type: 'tool_use', id: 'x' }])).toBe('');
  });
});

const conv = (over: Partial<PersistedConversation> = {}): PersistedConversation => ({
  id: 'b1',
  workspaceId: 'ws-1',
  title: 'todo app',
  status: 'complete',
  messages: [
    { role: 'user', content: 'build a todo app' },
    { role: 'assistant', content: [{ type: 'text', text: 'Creating the entry file.' }, { type: 'tool_use', id: 't', name: 'write_file', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
    { role: 'assistant', content: 'Done — the app is built.' },
  ],
  ...over,
});

describe('conversationToEvents', () => {
  it('emits a workspace event, one narration per assistant turn, and a done for a finished build', () => {
    const events = conversationToEvents(conv());
    expect(events[0]).toEqual({ type: 'workspace', workspaceId: 'ws-1', ts: 0 });
    const narration = events.filter((e) => e.type === 'narration');
    expect(narration.map((e) => (e as { text: string }).text)).toEqual(['Creating the entry file.', 'Done — the app is built.']);
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', ok: true });
  });

  it('does NOT emit a done event for a still-running build (so it can be resumed)', () => {
    const events = conversationToEvents(conv({ status: 'running' }));
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('marks a stopped/error build as not-ok done', () => {
    expect(conversationToEvents(conv({ status: 'stopped' })).find((e) => e.type === 'done')).toMatchObject({ ok: false });
    expect(conversationToEvents(conv({ status: 'error' })).find((e) => e.type === 'done')).toMatchObject({ ok: false });
  });

  it('replays through the real reducer to rebuild the narration feed + workspaceId', () => {
    let state = initialAgentV3State();
    for (const e of conversationToEvents(conv())) state = agentV3Reducer(state, e);
    expect(state.workspaceId).toBe('ws-1');
    expect(state.narration.map((l) => l.text)).toEqual(['Creating the entry file.', 'Done — the app is built.']);
    expect(state.done).toBe(true);
    expect(state.ok).toBe(true);
  });

  it('handles an empty / malformed transcript without throwing', () => {
    expect(conversationToEvents(conv({ messages: [] })).filter((e) => e.type === 'narration')).toHaveLength(0);
    expect(conversationToEvents(conv({ messages: [null, 1, 'x', { role: 'assistant' }] as unknown[] })).filter((e) => e.type === 'narration')).toHaveLength(0);
  });
});

describe('cleanRestoredUserPrompt (strips server augmentation)', () => {
  it('returns a plain prompt unchanged', () => {
    expect(cleanRestoredUserPrompt('make a todo app')).toBe('make a todo app');
  });
  it('strips a leading "Language: …" instruction paragraph', () => {
    expect(cleanRestoredUserPrompt('Language: generate all user-facing text in Hindi.\n\nmake a todo app')).toBe('make a todo app');
  });
  it('keeps only the real prompt after the last lessons/attachment separator', () => {
    expect(cleanRestoredUserPrompt('Lesson: prefer X\n\n---\n\nmake a todo app')).toBe('make a todo app');
    expect(cleanRestoredUserPrompt('The user attached file(s); here is the extracted content:\n\nblah\n\n---\n\nmake a todo app')).toBe('make a todo app');
  });
  it('strips a trailing "Approved plan: …" block', () => {
    expect(cleanRestoredUserPrompt('make a todo app\n\nApproved plan:\n- step one\n- step two')).toBe('make a todo app');
  });
  it('handles combined augmentation', () => {
    expect(cleanRestoredUserPrompt('Language: use Hindi.\n\nLesson: prefer X\n\n---\n\nmake a todo app')).toBe('make a todo app');
  });
});

describe('conversationToUserMessages (R5 reload fix — user bubbles no longer vanish)', () => {
  it('restores the user prompt(s), skipping tool_result user turns, cleaned of augmentation', () => {
    const c = conv({
      messages: [
        { role: 'user', content: 'Language: use Hindi.\n\nbuild a todo app' },
        { role: 'assistant', content: [{ type: 'text', text: 'Building.' }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] }, // tool result — skipped
        { role: 'assistant', content: 'Done.' },
      ],
    });
    const users = conversationToUserMessages(c);
    expect(users.map((u) => u.text)).toEqual(['build a todo app']);
    expect(users[0].role).toBe('user');
  });

  it('interleaves correctly with agent narration by transcript-position timestamp', () => {
    const c = conv();
    const users = conversationToUserMessages(c); // user at idx 0 → ts 1
    const narration = conversationToEvents(c).filter((e) => e.type === 'narration') as Array<{ ts: number }>;
    // The first user message (ts 1) sorts before the first agent narration (ts 2).
    expect(users[0].ts).toBeLessThan(narration[0].ts);
  });

  it('returns [] for an empty transcript', () => {
    expect(conversationToUserMessages(conv({ messages: [] }))).toEqual([]);
  });
});

describe('sessionStatusMeta (history-menu status dot)', () => {
  it('maps every ConversationStatus to a dot + label', () => {
    expect(sessionStatusMeta('running')).toMatchObject({ dot: 'bg-indigo-400', label: 'Building…', pulse: true });
    expect(sessionStatusMeta('complete')).toMatchObject({ dot: 'bg-emerald-500', label: 'Built' });
    expect(sessionStatusMeta('error')).toMatchObject({ dot: 'bg-red-500', label: 'Failed' });
    expect(sessionStatusMeta('stopped')).toMatchObject({ dot: 'bg-zinc-500', label: 'Stopped' });
  });
  it('falls back to a neutral dot + empty label for unknown/missing status', () => {
    expect(sessionStatusMeta(undefined)).toMatchObject({ dot: 'bg-zinc-600', label: '' });
    expect(sessionStatusMeta('bogus')).toMatchObject({ dot: 'bg-zinc-600', label: '' });
  });
});

describe('sessionDateBucket (history-menu date grouping)', () => {
  const now = new Date('2026-07-01T12:00:00Z').getTime();
  it('buckets same-calendar-day as Today', () => {
    expect(sessionDateBucket(new Date('2026-07-01T00:30:00Z').getTime(), now)).toBe('Today');
  });
  it('buckets the previous calendar day as Yesterday', () => {
    expect(sessionDateBucket(new Date('2026-06-30T23:00:00Z').getTime(), now)).toBe('Yesterday');
  });
  it('buckets 2-7 days ago as Previous 7 days', () => {
    expect(sessionDateBucket(new Date('2026-06-27T12:00:00Z').getTime(), now)).toBe('Previous 7 days');
  });
  it('buckets 8-30 days ago as Previous 30 days', () => {
    expect(sessionDateBucket(new Date('2026-06-10T12:00:00Z').getTime(), now)).toBe('Previous 30 days');
  });
  it('buckets anything older as Older', () => {
    expect(sessionDateBucket(new Date('2026-01-01T12:00:00Z').getTime(), now)).toBe('Older');
  });
});

interface TestSession { id: string; updatedAt?: number }

describe('groupSessionsByDate (history-menu grouping — a real session list, not flat text)', () => {
  const now = new Date('2026-07-01T12:00:00Z').getTime();
  it('groups items into ordered date buckets, preserving each bucket\'s relative order', () => {
    const items: TestSession[] = [
      { id: 'a', updatedAt: new Date('2026-07-01T10:00:00Z').getTime() }, // Today
      { id: 'b', updatedAt: new Date('2026-06-30T10:00:00Z').getTime() }, // Yesterday
      { id: 'c', updatedAt: new Date('2026-07-01T02:00:00Z').getTime() }, // Today (older than a)
      { id: 'd', updatedAt: new Date('2026-01-01T10:00:00Z').getTime() }, // Older
    ];
    const groups = groupSessionsByDate(items, now);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Older']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['b']);
    expect(groups[2].items.map((i) => i.id)).toEqual(['d']);
  });
  it('omits empty buckets entirely (no "Previous 30 days" header when nothing falls in it)', () => {
    const groups = groupSessionsByDate<TestSession>([{ id: 'x', updatedAt: now }], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
  });
  it('returns [] for an empty list', () => {
    expect(groupSessionsByDate<TestSession>([], now)).toEqual([]);
  });
  it('treats a missing updatedAt as "now" (falls into Today)', () => {
    const groups = groupSessionsByDate<TestSession>([{ id: 'no-ts' }], now);
    expect(groups[0].label).toBe('Today');
  });
});

describe('legacyPrependMessages', () => {
  const legacy = [
    { text: 'old question', isUser: true },
    { text: 'old answer', isUser: false },
  ];

  it('prepends a disjoint legacy thread with negative position timestamps', () => {
    const out = legacyPrependMessages(legacy, ['new question after the cutover']);
    expect(out).toEqual([
      { role: 'user', text: 'old question', ts: -2 },
      { role: 'agent', text: 'old answer', ts: -1 },
    ]);
    // Every prepended ts sorts BEFORE the server transcript positions (1..N).
    expect(out.every((m) => m.ts < 1)).toBe(true);
  });

  it('returns [] when the legacy copy overlaps the server transcript (old build sessions)', () => {
    expect(legacyPrependMessages(legacy, ['old question', 'later prompt'])).toEqual([]);
  });

  it('returns [] when the server thread is empty (legacy-fallback path owns that case)', () => {
    expect(legacyPrependMessages(legacy, [])).toEqual([]);
  });

  it('returns [] for an empty or blank legacy copy', () => {
    expect(legacyPrependMessages([], ['q'])).toEqual([]);
    expect(legacyPrependMessages([{ text: '   ', isUser: true }], ['q'])).toEqual([]);
  });

  it('ignores whitespace differences when checking overlap', () => {
    expect(legacyPrependMessages([{ text: '  old question  ', isUser: true }], ['old question'])).toEqual([]);
  });
});
