import { describe, it, expect } from 'vitest';
import { messageText, conversationToEvents, type PersistedConversation } from './agentV3History';
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
