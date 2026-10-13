/**
 * Audit 2026-10-11, D1: every build turn listed up to 200 conversation documents — twice — to find its own.
 *
 * `listByUser(uid, 10)` reads `where userId == uid limit 200` (no index-safe ordering), then sorts in memory;
 * both the recap ("what were we building?") and the end-of-build fallback persist called it, and both missed
 * the workspace whenever it was not among the 10 most recent. The record is directly addressable, so it is
 * now found with one to three point reads of its possible ids.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { InMemoryConversationStore, type ConversationStore } from '../src/server/AgentV3/ConversationStore';
import { conversationIdCandidatesForWorkspace, findWorkspaceConversation } from '../src/server/routes/agentv3';
import { workspaceIdFor } from '../src/server/lib/workspaceIdentity';

const UID = 'user123';
const WS = workspaceIdFor(UID, 'sess-abc') as string;

describe('the ids a workspace conversation can have', () => {
  it('its workspace id, the bare session id (a duplicated app), and the legacy v3_ id', () => {
    expect(conversationIdCandidatesForWorkspace(WS, UID)).toEqual([WS, 'sess-abc', 'v3_sess-abc']);
  });
});

describe('findWorkspaceConversation', () => {
  function counting(store: InMemoryConversationStore) {
    const calls = { list: 0, meta: 0 };
    const wrapped: ConversationStore = Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
      listByUser: async (...a: Parameters<ConversationStore['listByUser']>) => { calls.list++; return store.listByUser(...a); },
      getMeta: async (id: string) => { calls.meta++; return store.getMeta(id); },
    });
    return { wrapped, calls };
  }

  it('finds the record by a point read, never by listing the history — even past the 10 most recent', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: WS, userId: UID, workspaceId: WS, title: 'mine', messages: [], createdAt: 1 });
    for (let i = 0; i < 30; i++) {
      const ws = workspaceIdFor(UID, `newer-${i}`) as string;
      await store.create({ id: ws, userId: UID, workspaceId: ws, title: `n${i}`, messages: [], createdAt: 100 + i });
    }
    const { wrapped, calls } = counting(store);
    const rec = await findWorkspaceConversation(wrapped, UID, WS);
    expect(rec?.id).toBe(WS);
    expect(calls.list).toBe(0);
    expect(calls.meta).toBe(1);
  });

  it('finds a duplicated app whose record is keyed by its session id', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'sess-abc', userId: UID, workspaceId: WS, title: 'copy', messages: [], createdAt: 1 });
    expect((await findWorkspaceConversation(store, UID, WS))?.id).toBe('sess-abc');
  });

  it('never returns another account\'s record, or a record of another workspace', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: WS, userId: 'someone-else', workspaceId: WS, title: 'x', messages: [], createdAt: 1 });
    expect(await findWorkspaceConversation(store, UID, WS)).toBeNull();
    const other = new InMemoryConversationStore();
    await other.create({ id: WS, userId: UID, workspaceId: 'agentv3-other', title: 'x', messages: [], createdAt: 1 });
    expect(await findWorkspaceConversation(other, UID, WS)).toBeNull();
  });

  it('getMeta carries no transcript', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: WS, userId: UID, workspaceId: WS, title: 't', messages: [{ role: 'user', content: 'hi' }], createdAt: 1 });
    expect((await store.getMeta(WS))?.messages).toEqual([]);
  });

  it('the build path calls it, not listByUser', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).not.toMatch(/store\.listByUser\(userId \?\? 'anon', 10\)/);
    // One of the two is timed as a setup step since 303e8a6f (`promptSteps.step(…, () => findWorkspaceConversation(…))`).
    expect((src.match(/findWorkspaceConversation\(store, userId, workspaceId\)/g) ?? []).length).toBe(2);
  });
});
