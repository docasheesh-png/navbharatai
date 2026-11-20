// 🔴 2026-11-20 (admin: an old game would not open — "server refused the transcript (HTTP 404: Conversation
// not found.) for id v3_95865209-…"). A session's transcript can live under four ids: its workspace id (a
// normal build), its bare session id (a DUPLICATED app), the legacy `v3_` id, or the anon workspace id. Two
// helpers carried that knowledge and had drifted: the build path knew the bare-session-id case, the reopen
// path (`candidateConversationIds`) did not, so a duplicated app opened from its `v3_` history row tried
// three ids that do not exist and answered 404.
//
// The CLASS this locks: every form a client can send for ONE session must resolve to a candidate set that
// contains every id the server can have stored that session's record under — whatever helper wrote it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidateConversationIds, conversationIdCandidatesForWorkspace, conversationLookupIds } from '../src/server/routes/agentv3';
import { InMemoryConversationStore } from '../src/server/AgentV3/ConversationStore';

const UID = 'GiYNmFcDMVYSWW48Nrurm7j41gv1';
const SID = '95865209-91b3-4b0a-b8e7-0ef3142c378c'; // the session id from the admin's report
const WS = `agentv3-${UID}-${SID}`;

describe('a chat opens from history whatever id its record was saved under', () => {
  it("a duplicated app (record keyed by its bare session id) is found from its v3_ history row — the report's exact id", async () => {
    const store = new InMemoryConversationStore();
    // Exactly what POST /conversations/:id/duplicate writes.
    await store.create({ id: SID, userId: UID, workspaceId: WS, title: 'Copy of my game', messages: [{ role: 'user', content: 'build a game' }], createdAt: 1 });
    let found = null;
    for (const cid of candidateConversationIds(`v3_${SID}`, UID)) {
      found = await store.get(cid);
      if (found) break;
    }
    expect(found?.id).toBe(SID);
    expect(found?.workspaceId).toBe(WS);
  });

  it('every form of the same session resolves to a set that holds every id the build path can store it under', () => {
    const stored = conversationIdCandidatesForWorkspace(WS, UID); // the build path's own list
    for (const form of [`v3_${SID}`, WS]) {
      const tried = candidateConversationIds(form, UID);
      for (const id of stored) expect(tried, `${form} must try ${id}`).toContain(id);
      expect(tried).toContain(`agentv3-anon-${SID}`); // an identity-degraded build's record
    }
  });

  it("another user's workspace id never expands into this user's session ids", () => {
    expect(candidateConversationIds(`agentv3-someoneElse-${SID}`, UID)).toEqual([`agentv3-someoneElse-${SID}`]);
  });

  it('an OLD record saved under a random id (before conversationId = workspaceId) is found by its workspace, for its owner only', async () => {
    const store = new InMemoryConversationStore();
    await store.create({ id: 'legacy-random-7f3a', userId: UID, workspaceId: WS, title: 'old game', messages: [], createdAt: 1 });
    await store.create({ id: 'not-mine', userId: 'someone-else', workspaceId: WS, title: 'x', messages: [], createdAt: 1 });
    const ids = await conversationLookupIds(store, `v3_${SID}`, UID);
    expect(ids.slice(0, candidateConversationIds(`v3_${SID}`, UID).length)).toEqual(candidateConversationIds(`v3_${SID}`, UID)); // point reads first
    expect(ids).toContain('legacy-random-7f3a');
    expect(ids).not.toContain('not-mine');
    expect(await conversationLookupIds(store, `v3_${SID}`, null)).toEqual(candidateConversationIds(`v3_${SID}`, null)); // no uid → no query
  });

  it('census: every route that resolves a chat by its id uses the ONE lookup, never its own list', () => {
    const src = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(src.match(/for \(const cid of candidateConversationIds\(/g) ?? []).toHaveLength(0);
    expect((src.match(/for \(const cid of await conversationLookupIds\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
