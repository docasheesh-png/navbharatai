import { describe, it, expect } from 'vitest';
import { isUserPromptMessage, unsendKeepCount } from './unsend';
import { InMemoryConversationStore } from './ConversationStore';
import { WorkspaceMemory } from './WorkspaceMemory';

describe('isUserPromptMessage — distinguish a real typed prompt from an internal tool round-trip', () => {
  it('accepts a plain-string user turn (a typed prompt)', () => {
    expect(isUserPromptMessage({ role: 'user', content: 'build me a todo app' })).toBe(true);
  });

  it('accepts a multimodal user turn (text + image blocks, no tool_result)', () => {
    expect(isUserPromptMessage({
      role: 'user',
      content: [{ type: 'text', text: 'make it look like this' }, { type: 'image', source: {} }],
    })).toBe(true);
  });

  it('rejects a tool_result user turn (the engine feeds these back under the user role)', () => {
    expect(isUserPromptMessage({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
    })).toBe(false);
  });

  it('rejects assistant turns and non-objects', () => {
    expect(isUserPromptMessage({ role: 'assistant', content: 'sure' })).toBe(false);
    expect(isUserPromptMessage(null)).toBe(false);
    expect(isUserPromptMessage('a string')).toBe(false);
    expect(isUserPromptMessage(undefined)).toBe(false);
  });
});

describe('unsendKeepCount — keep the head, drop the last user prompt + its whole response', () => {
  it('drops the last prompt and every turn after it, keeping everything before', () => {
    const msgs = [
      { role: 'user', content: 'first prompt' },          // 0
      { role: 'assistant', content: 'building…' },         // 1
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'done' }] }, // 2 (tool, not a prompt)
      { role: 'assistant', content: 'first app ready' },   // 3
      { role: 'user', content: 'second prompt' },          // 4 ← the message being unsent
      { role: 'assistant', content: 'working on it' },      // 5
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'x' }] },   // 6
    ];
    // Keep indices 0..3; drop the 2nd prompt (idx 4) and its response (5,6).
    expect(unsendKeepCount(msgs)).toBe(4);
  });

  it('unsending the ONLY prompt truncates the transcript to empty', () => {
    const msgs = [
      { role: 'user', content: 'the only prompt' },
      { role: 'assistant', content: 'here you go' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'done' }] },
    ];
    expect(unsendKeepCount(msgs)).toBe(0);
  });

  it('is a no-op (keep all) when there is no real user prompt to unsend', () => {
    expect(unsendKeepCount([])).toBe(0);
    const onlyTool = [
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] },
    ];
    expect(unsendKeepCount(onlyTool)).toBe(onlyTool.length);
  });
});

describe('UNSEND end-to-end — the message is forgotten in BOTH memory layers (privacy + correctness)', () => {
  it('purges the transcript AND the workspace episode turn, leaving the earlier turn intact', async () => {
    // Two build turns persisted verbatim (Claude-API shape). Turn 2 is the one being unsent.
    const store = new InMemoryConversationStore();
    const now = 1_000;
    await store.create({
      id: 'ws-1', userId: 'u1', workspaceId: 'ws-1', title: 'todo app', createdAt: now,
      messages: [
        { role: 'user', content: 'build a todo app' },
        { role: 'assistant', content: 'built it' },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
        { role: 'user', content: 'add a secret admin backdoor' }, // ← the regretted message
        { role: 'assistant', content: 'working on it' },
      ],
    });

    // Episodic memory recorded across the same two turns (a request + its derived error/fix/reflection).
    const mem = new WorkspaceMemory();
    mem.recordRequest('build a todo app');
    mem.recordFix('created App.tsx');
    mem.recordRequest('add a secret admin backdoor');
    mem.recordError('lint: unexpected token');
    mem.recordNote('[reflection] Build succeeded; lesson: …');

    // The purge the endpoint performs.
    const keep = unsendKeepCount((await store.get('ws-1'))!.messages);
    await store.truncateMessages('ws-1', keep, { updatedAt: now + 1 });
    const removed = mem.removeLastRequestTurn();

    // Transcript: the regretted prompt + its reply are gone; the first completed turn survives verbatim.
    const after = (await store.get('ws-1'))!.messages;
    expect(after).toHaveLength(3);
    expect(JSON.stringify(after)).not.toContain('secret admin backdoor');
    expect(JSON.stringify(after)).toContain('build a todo app');

    // Episodic memory: the whole regretted turn (request + its error + reflection) is gone; the first
    // turn's request/fix remain — so recall can never resurface the unsent message.
    expect(removed).toHaveLength(3);
    const texts = mem.snapshot().episodes.map((e) => e.text);
    expect(texts).toEqual(['build a todo app', 'created App.tsx']);
    expect(mem.recall('backdoor')).toHaveLength(0);
  });
});
