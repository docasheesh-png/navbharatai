import { describe, it, expect } from 'vitest';
import { InMemoryConversationStore, deriveTitle } from './ConversationStore';

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
