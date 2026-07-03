import { describe, it, expect } from 'vitest';
import { InMemoryConversationStore, deriveTitle, upsertConversationTurn } from './ConversationStore';

const base = (over: Partial<{ id: string; userId: string; workspaceId: string; title: string; createdAt: number }> = {}) => ({
  id: over.id ?? 'build-1',
  userId: over.userId ?? 'user-1',
  workspaceId: over.workspaceId ?? 'ws-1',
  title: over.title ?? 'Make a todo app',
  createdAt: over.createdAt ?? 1000,
});

const patch = (over: Record<string, unknown> = {}) => ({ updatedAt: 2000, ...over });

describe('InMemoryConversationStore', () => {
  it('creates a record with running status and zeroed usage', async () => {
    const store = new InMemoryConversationStore();
    const rec = await store.create({ ...base(), messages: [{ role: 'user', content: 'hi' }] });
    expect(rec.status).toBe('running');
    expect(rec.billedUsd).toBe(0);
    expect(rec.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    expect(rec.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(rec.createdAt).toBe(1000);
    expect(rec.updatedAt).toBe(1000);
  });

  it('rejects a duplicate id', async () => {
    const store = new InMemoryConversationStore();
    await store.create(base());
    await expect(store.create(base())).rejects.toThrow(/already exists/);
  });

  it('returns null for an unknown id and the record for a known one', async () => {
    const store = new InMemoryConversationStore();
    expect(await store.get('nope')).toBeNull();
    await store.create(base());
    expect((await store.get('build-1'))?.id).toBe('build-1');
  });

  it('appends transcript turns and applies usage/status/billing patches', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ ...base(), messages: [{ role: 'user', content: 'hi' }] });
    await store.appendMessages(
      'build-1',
      [{ role: 'assistant', content: 'ok' }, { role: 'user', content: [{ type: 'tool_result' }] }],
      patch({ usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, billedUsd: 0.42 }),
    );
    const rec = await store.get('build-1');
    expect(rec?.messages).toHaveLength(3);
    expect(rec?.usage.inputTokens).toBe(10);
    expect(rec?.billedUsd).toBe(0.42);
    expect(rec?.updatedAt).toBe(2000);
    expect(rec?.status).toBe('running'); // unchanged when not patched
  });

  it('finalizes status via update() without touching messages', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ ...base(), messages: [{ role: 'user', content: 'hi' }] });
    await store.update('build-1', patch({ status: 'complete', billedUsd: 1.5 }));
    const rec = await store.get('build-1');
    expect(rec?.status).toBe('complete');
    expect(rec?.billedUsd).toBe(1.5);
    expect(rec?.messages).toHaveLength(1);
  });

  it('throws when appending/updating an unknown id', async () => {
    const store = new InMemoryConversationStore();
    await expect(store.appendMessages('ghost', [], patch())).rejects.toThrow(/unknown conversation id/);
    await expect(store.update('ghost', patch())).rejects.toThrow(/unknown conversation id/);
  });

  it('lists a user\'s builds most-recently-updated first, scoped by user and capped', async () => {
    const store = new InMemoryConversationStore();
    await store.create(base({ id: 'a', userId: 'u1', createdAt: 100 }));
    await store.create(base({ id: 'b', userId: 'u1', createdAt: 200 }));
    await store.create(base({ id: 'c', userId: 'u2', createdAt: 300 }));
    // bump 'a' so it becomes the most-recent for u1.
    await store.update('a', patch({ updatedAt: 999 }));
    const u1 = await store.listByUser('u1');
    expect(u1.map((r) => r.id)).toEqual(['a', 'b']); // u2's 'c' excluded; 'a' first
    expect((await store.listByUser('u1', 1)).map((r) => r.id)).toEqual(['a']);
    expect(await store.listByUser('nobody')).toEqual([]);
  });

  it('removes a build (and is a no-op for an unknown id)', async () => {
    const store = new InMemoryConversationStore();
    await store.create(base());
    await store.remove('build-1');
    expect(await store.get('build-1')).toBeNull();
    await expect(store.remove('build-1')).resolves.toBeUndefined();
  });

  it('stores clones — a caller cannot mutate persisted state through a returned reference', async () => {
    const store = new InMemoryConversationStore();
    const created = await store.create({ ...base(), messages: [{ role: 'user', content: 'hi' }] });
    (created.messages as unknown[]).push({ role: 'assistant', content: 'leak' });
    created.status = 'error';
    const fresh = await store.get('build-1');
    expect(fresh?.messages).toHaveLength(1);
    expect(fresh?.status).toBe('running');
  });
});

describe('upsertConversationTurn', () => {
  const turnOpts = (over: Record<string, unknown> = {}) => ({
    conversationId: 'agentv3-user1-sess1',
    userId: 'user-1',
    workspaceId: 'agentv3-user1-sess1',
    title: 'hello there',
    turn: [
      { role: 'user', content: 'hello there' },
      { role: 'assistant', content: 'hi! how can I help?' },
    ],
    patch: { status: 'complete' as const, updatedAt: 5000 },
    ...over,
  });

  it('creates the record on the first turn of a session', async () => {
    const store = new InMemoryConversationStore();
    await upsertConversationTurn(store, turnOpts());
    const rec = await store.get('agentv3-user1-sess1');
    expect(rec?.userId).toBe('user-1');
    expect(rec?.workspaceId).toBe('agentv3-user1-sess1');
    expect(rec?.title).toBe('hello there');
    expect(rec?.status).toBe('complete');
    expect(rec?.messages).toHaveLength(2);
  });

  it('appends later turns to the existing record instead of failing on the duplicate id', async () => {
    const store = new InMemoryConversationStore();
    await upsertConversationTurn(store, turnOpts());
    await upsertConversationTurn(store, turnOpts({
      turn: [
        { role: 'user', content: 'and another thing' },
        { role: 'assistant', content: 'sure' },
      ],
      patch: { status: 'complete' as const, updatedAt: 6000 },
    }));
    const rec = await store.get('agentv3-user1-sess1');
    expect(rec?.messages).toHaveLength(4);
    expect(rec?.updatedAt).toBe(6000);
    expect(rec?.title).toBe('hello there'); // first turn's title is kept
  });

  it('recovers from a lost create race by appending the turn', async () => {
    const store = new InMemoryConversationStore();
    // Simulate the race: get() sees nothing, but the record appears before create() runs.
    const racy: typeof store = Object.create(store);
    racy.get = async () => null;
    await store.create({ id: 'agentv3-user1-sess1', userId: 'user-1', workspaceId: 'agentv3-user1-sess1', title: 't', messages: [{ role: 'user', content: 'first' }], createdAt: 1000 });
    await upsertConversationTurn(racy, turnOpts());
    const rec = await store.get('agentv3-user1-sess1');
    expect(rec?.messages).toHaveLength(3); // seed + the raced turn, nothing dropped
  });
});

describe('deriveTitle', () => {
  it('collapses whitespace and truncates long prompts', () => {
    expect(deriveTitle('  Build   me\na todo app  ')).toBe('Build me a todo app');
    expect(deriveTitle('x'.repeat(100)).length).toBe(80);
    expect(deriveTitle('x'.repeat(100)).endsWith('…')).toBe(true);
  });
  it('falls back for an empty prompt', () => {
    expect(deriveTitle('   ')).toBe('Untitled build');
  });
});
