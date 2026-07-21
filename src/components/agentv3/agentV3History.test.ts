import { describe, it, expect } from 'vitest';
import { messageText, conversationToEvents, conversationToUserMessages, cleanRestoredUserPrompt, sessionStatusMeta, sessionDateBucket, groupSessionsByDate, legacyPrependMessages, isEngineInjectedUserText, filterSessionsByQuery, partitionPinnedSessions, isUnfinishedBuild, type PersistedConversation } from './agentV3History';
import { agentV3Reducer } from './agentV3Reducer';
import { initialAgentV3State } from './agentV3Types';

describe('isUnfinishedBuild (AP-3 cross-restart resume detection)', () => {
  const conv = (status: PersistedConversation['status'], msgs: unknown[]): Pick<PersistedConversation, 'status' | 'messages'> => ({ status, messages: msgs });
  it('flags a build still marked running WITH content (cut off before it could settle)', () => {
    expect(isUnfinishedBuild(conv('running', [{ role: 'user', content: 'build a todo app' }]))).toBe(true);
  });
  it('does NOT flag a cleanly-finished build (terminal status)', () => {
    expect(isUnfinishedBuild(conv('complete', [{ role: 'user', content: 'x' }]))).toBe(false);
    expect(isUnfinishedBuild(conv('error', [{ role: 'user', content: 'x' }]))).toBe(false);
    expect(isUnfinishedBuild(conv('stopped', [{ role: 'user', content: 'x' }]))).toBe(false);
  });
  it('does NOT flag an empty running record (nothing to continue)', () => {
    expect(isUnfinishedBuild(conv('running', []))).toBe(false);
  });
});

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

  it('replays durable timeline events into live wire events (eternal sessions)', () => {
    const c = conv({
      status: 'complete',
      timeline: [
        { t: 'tool_call', id: 'x1', tool: 'bash', agent: 'architect', ts: 100, input: { command: 'npm install' } },
        { t: 'tool_result', id: 'x1', ok: true, summary: 'installed', agent: 'architect', ts: 200 },
        { t: 'file', path: 'src/App.tsx', kind: 'create', agent: 'frontend', ts: 300 },
        { t: 'diff', path: 'src/App.tsx', patch: '+hello', ts: 400 },
        { t: 'preview', url: 'https://x.e2b.dev', ts: 500 },
        { t: 'agent', agent: 'frontend', task: 'build UI', ts: 50 },
      ],
    });
    const events = conversationToEvents(c);
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('file_changed');
    expect(types).toContain('diff');
    expect(types).toContain('preview');
    expect(types).toContain('agent_spawned');
    // Replayed through the reducer, the restored session rebuilds activity + diffs (the evidence
    // layer that used to vanish on reopen).
    let state = initialAgentV3State();
    for (const e of events) state = agentV3Reducer(state, e);
    expect(state.activity.length).toBeGreaterThan(0);
    expect(state.diffs['src/App.tsx']).toBe('+hello');
    expect(state.previewUrl).toBe('https://x.e2b.dev');
    expect(state.terminal.join('\n')).toContain('npm install');
  });

  it('closes orphaned tool_calls so a finished session never restores with a live spinner', () => {
    const c = conv({
      status: 'complete',
      timeline: [
        { t: 'tool_call', id: 'orphan', tool: 'bash', agent: 'architect', ts: 100, input: { command: 'npm run build' } },
        // its tool_result fell past the recorder's cap — never persisted
      ],
    });
    let state = initialAgentV3State();
    for (const e of conversationToEvents(c)) state = agentV3Reducer(state, e);
    expect(state.activity.some((a) => a.active)).toBe(false); // no permanent spinner
    // A still-running build is left open on purpose (it is genuinely in flight).
    const running = conv({ status: 'running', timeline: c.timeline });
    let s2 = initialAgentV3State();
    for (const e of conversationToEvents(running)) s2 = agentV3Reducer(s2, e);
    expect(s2.activity.some((a) => a.active)).toBe(true);
  });

  it('synthesizes a result event from durable finalState (restores the ₹/token footer)', () => {
    const c = conv({ status: 'complete', finalState: { ok: true, billedUsd: 0.5, billedInr: 42, tokens: 12345 } });
    let state = initialAgentV3State();
    for (const e of conversationToEvents(c)) state = agentV3Reducer(state, e);
    expect(state.billedInr).toBe(42);
    expect(state.tokens).toBe(12345);
  });

  it('falls back to top-level billedUsd/usage when finalState is absent (legacy records)', () => {
    const c = conv({ status: 'complete', billedUsd: 0.3, usage: { inputTokens: 100, outputTokens: 50 } });
    let state = initialAgentV3State();
    for (const e of conversationToEvents(c)) state = agentV3Reducer(state, e);
    expect(state.billedUsd).toBe(0.3);
    expect(state.tokens).toBe(150);
  });

  it('emits no result event when there are no billing/token facts at all', () => {
    const c = conv({ status: 'complete', billedUsd: 0 });
    expect(conversationToEvents(c).some((e) => e.type === 'result')).toBe(false);
  });

  it('rehydrates the build report from finalState.report into state.diagnostics on reopen (the "report saved WITH the chat" fix)', () => {
    // The compact report the server now embeds in the conversation record. On reopen the download/copy
    // must work offline (no separate fetch that can 404 after a long build).
    const report = { schema: 'navbharatai.v3.build-diagnostics/1', startedAt: 1, counts: { total: 1, errors: 1, warnings: 0, autoResolved: 0, unresolved: 1 }, issues: [], problems: [], rootCause: 'unresolved import ./Missing' };
    const c = conv({ status: 'complete', finalState: { ok: false, report } });
    let state = initialAgentV3State();
    for (const e of conversationToEvents(c)) state = agentV3Reducer(state, e);
    expect(state.diagnostics).toEqual(report);
  });

  it('fires the synthetic result (so the report rehydrates) even for a ZERO-billing turn that has a report', () => {
    const report = { schema: 'navbharatai.v3.build-diagnostics/1', startedAt: 1, counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 }, issues: [], problems: [] };
    const c = conv({ status: 'complete', billedUsd: 0, finalState: { report } });
    const result = conversationToEvents(c).find((e) => e.type === 'result') as { diagnostics?: unknown } | undefined;
    expect(result).toBeTruthy();
    expect(result?.diagnostics).toEqual(report);
  });

  it('restores real wall-clock timestamps when the server stamped them', () => {
    const c = conv({
      messages: [
        { role: 'user', content: 'build a todo app', ts: 1_700_000_000_000 },
        { role: 'assistant', content: 'Done.', ts: 1_700_000_001_000 },
      ],
    });
    const narration = conversationToEvents(c).find((e) => e.type === 'narration') as { ts: number };
    expect(narration.ts).toBe(1_700_000_001_000);
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

  it('drops engine-injected steering prompts so they never render as user bubbles', () => {
    const nudge = 'You described a plan but have not created any files yet. Do NOT just describe or delegate in prose — ACT NOW.';
    const c = conv({
      messages: [
        { role: 'user', content: 'build a todo app' },
        { role: 'assistant', content: 'Planning.' },
        { role: 'user', content: nudge }, // engine-injected — NOT typed by the human
        { role: 'assistant', content: 'Done.' },
      ],
    });
    expect(conversationToUserMessages(c).map((u) => u.text)).toEqual(['build a todo app']);
    expect(isEngineInjectedUserText(nudge)).toBe(true);
    expect(isEngineInjectedUserText('build a todo app')).toBe(false);
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
  it('upgrades a deployed session to the green "Live" dot (built / stopped / unknown status)', () => {
    expect(sessionStatusMeta('complete', true)).toMatchObject({ dot: 'bg-green-400', label: 'Live', live: true });
    expect(sessionStatusMeta('stopped', true)).toMatchObject({ dot: 'bg-green-400', label: 'Live', live: true });
    expect(sessionStatusMeta(undefined, true)).toMatchObject({ dot: 'bg-green-400', label: 'Live', live: true });
  });
  it('Live never paints over a running build or a failure (activity + safety win)', () => {
    expect(sessionStatusMeta('running', true)).toMatchObject({ dot: 'bg-indigo-400', label: 'Building…', pulse: true });
    expect(sessionStatusMeta('error', true)).toMatchObject({ dot: 'bg-red-500', label: 'Failed' });
  });
  it('no deployment → the plain status dot, exactly as before', () => {
    expect(sessionStatusMeta('complete', false)).toMatchObject({ dot: 'bg-emerald-500', label: 'Built' });
    expect(sessionStatusMeta('complete')).toMatchObject({ dot: 'bg-emerald-500', label: 'Built' });
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

describe('filterSessionsByQuery (history search box)', () => {
  const items = [
    { id: 'a', title: 'Watch store landing page' },
    { id: 'b', title: 'Hospital CRM dashboard' },
    { id: 'c', title: 'Kanban board' },
    { id: 'd' }, // no title
  ];
  it('returns the list unchanged for an empty/whitespace query', () => {
    expect(filterSessionsByQuery(items, '')).toBe(items);
    expect(filterSessionsByQuery(items, '   ')).toBe(items);
  });
  it('matches the title case-insensitively as a substring', () => {
    expect(filterSessionsByQuery(items, 'watch').map((i) => i.id)).toEqual(['a']);
    expect(filterSessionsByQuery(items, 'crm').map((i) => i.id)).toEqual(['b']);
    expect(filterSessionsByQuery(items, 'kanban').map((i) => i.id)).toEqual(['c']);
    // Substring, not word — "dashboard" contains "board", so 'board' matches both b and c.
    expect(filterSessionsByQuery(items, 'board').map((i) => i.id)).toEqual(['b', 'c']);
  });
  it('returns [] when nothing matches, and never throws on a title-less item', () => {
    expect(filterSessionsByQuery(items, 'zzz')).toEqual([]);
    expect(filterSessionsByQuery(items, 'a').some((i) => i.id === 'd')).toBe(false);
  });
});

describe('partitionPinnedSessions (Pinned section vs the rest)', () => {
  it('splits pinned from the rest, preserving incoming (newest-first) order within each', () => {
    const items: Array<{ id: string; pinned?: boolean }> = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: true },
      { id: 'c' },
      { id: 'd', pinned: true },
    ];
    const { pinned, rest } = partitionPinnedSessions(items);
    expect(pinned.map((i) => i.id)).toEqual(['b', 'd']);
    expect(rest.map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('handles an all-unpinned list (empty pinned) and an all-pinned list (empty rest)', () => {
    const unpinned: Array<{ id: string; pinned?: boolean }> = [{ id: 'x' }];
    const allPinned: Array<{ id: string; pinned?: boolean }> = [{ id: 'x', pinned: true }];
    expect(partitionPinnedSessions(unpinned).pinned).toEqual([]);
    expect(partitionPinnedSessions(allPinned).rest).toEqual([]);
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
