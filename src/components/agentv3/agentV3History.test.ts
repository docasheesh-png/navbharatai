import { describe, it, expect } from 'vitest';
import { messageText, conversationToEvents, conversationToUserMessages, cleanRestoredUserPrompt, type PersistedConversation } from './agentV3History';
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
