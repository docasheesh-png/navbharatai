import { describe, it, expect } from 'vitest';
import { InMemoryConversationStore, deriveTitle, upsertConversationTurn, isEnumerableUserId } from './ConversationStore';

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
    // Messages are stamped with the wall-clock time of the write that persisted them (eternal
    // sessions: reopen interleaves prose with the timeline by real timestamps).
    expect(rec.messages).toEqual([{ role: 'user', content: 'hi', ts: 1000 }]);
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

  it('truncateMessages drops the tail (UNSEND) so the provider never replays it', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ ...base(), messages: [{ role: 'user', content: 'first' }] });
    await store.appendMessages('build-1', [{ role: 'assistant', content: 'reply-1' }], patch());
    await store.appendMessages('build-1', [{ role: 'user', content: 'OOPS mistaken msg' }], patch());
    await store.appendMessages('build-1', [{ role: 'assistant', content: 'reply to the mistake' }], patch());
    expect((await store.get('build-1'))?.messages).toHaveLength(4);
    // Unsend the last user message + everything after it → keep the first 2 (user 'first' + its reply).
    await store.truncateMessages('build-1', 2, patch({ status: 'complete' }));
    const rec = await store.get('build-1');
    expect(rec?.messages).toHaveLength(2);
    expect(JSON.stringify(rec?.messages)).not.toContain('OOPS mistaken msg');
    expect(rec?.status).toBe('complete');
  });

  it('truncateMessages clamps out-of-range keepCount and throws on unknown id', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ ...base(), messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] });
    await store.truncateMessages('build-1', 99, patch()); // clamp high → no-op
    expect((await store.get('build-1'))?.messages).toHaveLength(2);
    await store.truncateMessages('build-1', -5, patch()); // clamp low → empty
    expect((await store.get('build-1'))?.messages).toHaveLength(0);
    await expect(store.truncateMessages('ghost', 0, patch())).rejects.toThrow(/unknown conversation id/);
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

  it('sorts PINNED builds to the front (surviving the cap), then most-recent within each group', async () => {
    const store = new InMemoryConversationStore();
    await store.create(base({ id: 'a', userId: 'u1', createdAt: 100 }));
    await store.create(base({ id: 'b', userId: 'u1', createdAt: 200 }));
    await store.create(base({ id: 'c', userId: 'u1', createdAt: 300 })); // newest by recency
    // Pin the OLDEST ('a', updatedAt 100). It must jump to the front despite being least-recent.
    await store.update('a', patch({ pinned: true, updatedAt: 100 }));
    const list = await store.listByUser('u1');
    expect(list.map((r) => r.id)).toEqual(['a', 'c', 'b']); // pinned first, then recency
    expect(list[0].pinned).toBe(true);
    // The pinned build survives even a cap that would otherwise exclude it by recency.
    expect((await store.listByUser('u1', 1)).map((r) => r.id)).toEqual(['a']);
    // Unpinning drops it back to its recency slot.
    await store.update('a', patch({ pinned: false, updatedAt: 100 }));
    expect((await store.listByUser('u1')).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  // SECURITY Phase 3.1 — the shared-anon bucket must NEVER be enumerable (it holds every user's
  // identity-degraded sessions; listing it leaks their workspaceIds/sessionIds — the key to the
  // diagnostics/decision IDORs). Anon records stay reachable only by their exact unguessable id.
  it('THE LEAK: never enumerates the shared-anon bucket (nor an empty user), but get(id) still works', async () => {
    const store = new InMemoryConversationStore();
    await store.create(base({ id: 'anon-a', userId: 'anon' }));
    await store.create(base({ id: 'anon-b', userId: 'anon' }));
    expect(await store.listByUser('anon')).toEqual([]); // no cross-anon enumeration
    expect(await store.listByUser('')).toEqual([]);
    expect(await store.listByUser('   ')).toEqual([]);
    // a real user still lists normally
    await store.create(base({ id: 'r1', userId: 'real-uid' }));
    expect((await store.listByUser('real-uid')).map((r) => r.id)).toEqual(['r1']);
    // Fix-26 restore is by-id — an anon record is STILL fetchable by its exact (unguessable) id.
    expect((await store.get('anon-a'))?.id).toBe('anon-a');
  });

  it('isEnumerableUserId — pure rule: real ids yes, anon/empty/blank no', () => {
    expect(isEnumerableUserId('real-uid')).toBe(true);
    expect(isEnumerableUserId('anon')).toBe(false);
    expect(isEnumerableUserId(null)).toBe(false);
    expect(isEnumerableUserId(undefined)).toBe(false);
    expect(isEnumerableUserId('  ')).toBe(false);
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

  it('stamps appended messages with the patch time, never overwriting an explicit ts', async () => {
    const store = new InMemoryConversationStore();
    await store.create(base());
    await store.appendMessages('build-1', [
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'b', ts: 42 },
    ], patch({ updatedAt: 7000 }));
    const rec = await store.get('build-1');
    expect(rec?.messages).toEqual([
      { role: 'assistant', content: 'a', ts: 7000 },
      { role: 'user', content: 'b', ts: 42 },
    ]);
  });

  it('appends timeline events and sets finalState/framework via patches (eternal sessions)', async () => {
    const store = new InMemoryConversationStore();
    await store.create(base());
    await store.appendMessages('build-1', [{ role: 'assistant', content: 'turn 1' }], patch({
      timelineAppend: [{ t: 'file', path: 'a.ts', kind: 'create', agent: 'architect', ts: 1 }],
    }));
    await store.update('build-1', patch({
      updatedAt: 3000,
      timelineAppend: [{ t: 'preview', url: 'https://x', ts: 2 }],
      finalState: { billedInr: 42, tokens: 999 },
      framework: 'nextjs',
    }));
    const rec = await store.get('build-1', { includeTimeline: true });
    expect(rec?.timeline).toEqual([
      { t: 'file', path: 'a.ts', kind: 'create', agent: 'architect', ts: 1 },
      { t: 'preview', url: 'https://x', ts: 2 },
    ]);
    expect(rec?.finalState).toEqual({ billedInr: 42, tokens: 999 });
    expect(rec?.framework).toBe('nextjs');
    // A later patch without these fields leaves them untouched.
    await store.update('build-1', patch({ updatedAt: 4000, status: 'complete' }));
    const later = await store.get('build-1', { includeTimeline: true });
    expect(later?.timeline).toHaveLength(2);
    expect(later?.framework).toBe('nextjs');
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

describe('appName + repoName round-trip (admin 2026-09-04)', () => {
  const base = { id: 'c1', userId: 'u1', workspaceId: 'w1', title: 'build me a shop', createdAt: 1_000 };

  it('both are absent until set — an un-renamed build is byte-identical to before', async () => {
    const s = new InMemoryConversationStore();
    const rec = await s.create(base);
    expect(rec.appName).toBeUndefined();
    expect(rec.repoName).toBeUndefined();
  });

  it('a patch persists each one, and reads back through get()', async () => {
    const s = new InMemoryConversationStore();
    await s.create(base);
    await s.update('c1', { appName: 'My Shop', updatedAt: 2_000 });
    await s.update('c1', { repoName: 'my-shop', updatedAt: 3_000 });
    const got = await s.get('c1');
    expect(got?.appName).toBe('My Shop');
    expect(got?.repoName).toBe('my-shop');
  });

  it('🔒 a patch that omits them leaves them ALONE — the repo name must survive every build turn', async () => {
    // A build turn patches status/usage constantly. If any of those writes cleared repoName, the next
    // turn would re-derive a name, ensureRepo would not find it, and the app would be orphaned in a
    // brand-new empty repo — the exact failure persisting the name exists to prevent.
    const s = new InMemoryConversationStore();
    await s.create(base);
    await s.update('c1', { appName: 'My Shop', repoName: 'my-shop', updatedAt: 2_000 });
    await s.appendMessages('c1', [{ role: 'assistant', content: 'built it' }], { status: 'complete', updatedAt: 4_000 });
    const got = await s.get('c1');
    expect(got?.repoName).toBe('my-shop');
    expect(got?.appName).toBe('My Shop');
  });

  it('the chosen name reaches the LIST view — that is what "har jagah" depends on', async () => {
    const s = new InMemoryConversationStore();
    await s.create(base);
    await s.update('c1', { appName: 'My Shop', updatedAt: 2_000 });
    const list = await s.listByUser('u1');
    expect(list[0].appName).toBe('My Shop');
  });
});
