/**
 * AN OPENAI KEY MUST NOT START A BILL NOBODY ASKED FOR (admin 2026-09-15).
 *
 * The admin set `OPENAI_API_KEY` in Cloud Run to try GPT as a build engine. No tier ladder names an
 * OPENAI rung, so no build changed — but `EmbeddingSearch` reads the same env var, and
 * `ToolDispatcher` calls `getEmbeddingStore(ws).addFile(...)` on every file write. Every file of every
 * build would have gone to `text-embedding-ada-002` and into Firestore.
 *
 * 🔴 AND NOTHING READS THE RESULT. `search()` has no production call site; all three call sites are
 * writes. The spend also sits outside `captureTurnUsage`, so it would never have appeared in a build's
 * cost, the user's wallet, or the admin's dashboard — a cost no panel could show.
 *
 * These tests pin the flag's default and, more importantly, that the gate sits at the ONE place every
 * cost flows through, so a fourth call site cannot reopen it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { embeddingsEnabled } from '../src/server/AgentV3/embeddingsFlag';
import { EmbeddingStore } from '../src/server/AgentV3/EmbeddingSearch';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the flag is OFF unless someone deliberately turned it on', () => {
  it('is off when unset — the default that costs nothing', () => {
    expect(embeddingsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('accepts the words an operator actually types', () => {
    for (const v of ['on', 'true', '1', 'yes', 'enabled', ' ON ', 'True']) {
      expect(embeddingsEnabled({ AGENTV3_EMBEDDINGS: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  /**
   * ⚠️ OPPOSITE to most flags in this codebase, and deliberately so. A default-ON kill switch is right
   * for a feature that helps; this one has no reader, so a value nobody can parse must not mean "start
   * calling a paid API on every file write".
   */
  it('treats blank, whitespace and anything unreadable as OFF — never as on', () => {
    for (const v of ['', '   ', 'off', 'no', '0', 'maybe', 'ON!', 'onn']) {
      expect(embeddingsEnabled({ AGENTV3_EMBEDDINGS: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });
});

describe('with the flag off, a present OpenAI key buys nothing and costs nothing', () => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevFlag = process.env.AGENTV3_EMBEDDINGS;
  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevKey;
    if (prevFlag === undefined) delete process.env.AGENTV3_EMBEDDINGS; else process.env.AGENTV3_EMBEDDINGS = prevFlag;
  });

  /**
   * ⚠️ `resolves.toBeNull()` ALONE WOULD PROVE NOTHING, and the first version of this test made exactly
   * that mistake: a fake key also yields null, by failing the request — which is the cost we are trying
   * not to pay. Verified by deleting the gate and re-running: this assertion still passed. So the real
   * check is that no CLIENT was ever constructed — `getClient` caches into `this.client`, and the
   * OpenAI constructor accepts any string, so a non-null client means the gate was not reached.
   */
  it('embed() answers null without ever constructing a client', async () => {
    process.env.OPENAI_API_KEY = 'sk-not-a-real-key';
    delete process.env.AGENTV3_EMBEDDINGS;
    const store = new EmbeddingStore('sk-not-a-real-key');
    await expect(store.embed('anything at all')).resolves.toBeNull();
    expect((store as unknown as { client: unknown }).client).toBeNull();
  });

  /** addFile returns on a null embedding, so the Firestore write never happens either. */
  it('addFile indexes nothing, so a later search has nothing to find', async () => {
    process.env.OPENAI_API_KEY = 'sk-not-a-real-key';
    delete process.env.AGENTV3_EMBEDDINGS;
    const store = new EmbeddingStore('sk-not-a-real-key');
    await store.addFile('src/app.ts', 'export const a = 1;');
    await expect(store.search('app')).resolves.toEqual([]);
  });
});

describe('the gate is at the chokepoint, not at the call sites', () => {
  const src = read('../src/server/AgentV3/EmbeddingSearch.ts');
  const dispatcher = read('../src/server/AgentV3/ToolDispatcher.ts');

  /**
   * Every cost — the OpenAI request AND the Firestore write that follows it — flows through `embed`.
   * Checking at the three ToolDispatcher call sites instead is how the fourth one gets forgotten.
   */
  it('embed() checks the flag BEFORE it asks for a client', () => {
    const body = src.slice(src.indexOf('async embed('), src.indexOf('async addFile('));
    const gate = body.indexOf('embeddingsEnabled()');
    const client = body.indexOf('this.getClient()');
    expect(gate).toBeGreaterThan(-1);
    expect(client).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(client);
  });

  it('addFile still returns before persisting when no embedding came back', () => {
    const body = src.slice(src.indexOf('async addFile('), src.indexOf('removeFile('));
    expect(body).toContain('if (!embedding) return;');
    expect(body.indexOf('if (!embedding) return;')).toBeLessThan(body.indexOf('saveEmbedding('));
  });

  /**
   * The write call sites are left exactly as they were — the point of a chokepoint is that they need
   * no knowledge of the flag. If this count ever changes, the gate still holds; the test is here so a
   * reader can see the shape the fix relies on.
   */
  it('ToolDispatcher still writes through the same helper, unaware of the flag', () => {
    const writes = dispatcher.match(/getEmbeddingStore\([^)]*\)\.addFile\(/g) || [];
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(dispatcher).not.toContain('embeddingsEnabled');
  });
});
