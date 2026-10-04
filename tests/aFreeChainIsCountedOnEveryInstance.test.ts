/**
 * Q-130: a free build's unattended chain was counted in one Cloud Run instance's memory, so an auto-continue
 * that landed on another instance started a fresh allowance — a free request could hold sandboxes far past
 * its allowance, at NavBharatAI's cost. The chain is now shared through a durable store, and every way that
 * store can fail leaves the old, more generous behaviour — never a build stopped early.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import {
  noteFreeBuildStartShared, decideFreePauseShared, resetFreeBuildChainsForTests, FREE_CHAIN_STORE_TIMEOUT_MS,
  type FreeChain, type FreeChainStore,
} from '../src/server/AgentV3/freeBuildTimeCap';

const ENV = { AGENTV3_FREE_BUILD_AUTO_SECONDS: '3000' }; // 50 minutes unattended
const WINDOW = 25 * 60 * 1000;

function memoryStore(): FreeChainStore & { docs: Map<string, FreeChain> } {
  const docs = new Map<string, FreeChain>();
  return {
    docs,
    load: async (ws) => docs.get(ws) ?? null,
    save: async (ws, c) => { docs.set(ws, { ...c }); },
    clear: async (ws) => { docs.delete(ws); },
  };
}

describe('the unattended chain is counted across instances', () => {
  beforeEach(() => resetFreeBuildChainsForTests());

  it('a continuation on a second instance continues the same chain', async () => {
    const store = memoryStore();
    const t0 = 1_000_000;
    await noteFreeBuildStartShared('ws', 'build me a school app', store, t0);
    expect((await decideFreePauseShared('ws', WINDOW, store, ENV, t0 + WINDOW)).resumable).toBe(true);
    resetFreeBuildChainsForTests(); // ← the auto-continue lands on another instance: its memory is empty
    await noteFreeBuildStartShared('ws', 'continue', store, t0 + WINDOW + 5_000);
    const second = await decideFreePauseShared('ws', WINDOW, store, ENV, t0 + 2 * WINDOW);
    expect(second.spentSeconds).toBe(50 * 60);
    expect(second.resumable).toBe(false);
  });

  it('a real request starts a new chain everywhere', async () => {
    const store = memoryStore();
    await decideFreePauseShared('ws', WINDOW, store, ENV, 10);
    await noteFreeBuildStartShared('ws', 'now make a todo app', store, 20);
    expect(store.docs.has('ws')).toBe(false);
    expect((await decideFreePauseShared('ws', WINDOW, store, ENV, 30)).spentSeconds).toBe(25 * 60);
  });
});

describe('a store that fails can only be as generous as before', () => {
  beforeEach(() => resetFreeBuildChainsForTests());

  it('a failing store leaves this instance\'s count', async () => {
    const broken: FreeChainStore = { load: async () => { throw new Error('down'); }, save: async () => { throw new Error('down'); }, clear: async () => { throw new Error('down'); } };
    const d = await decideFreePauseShared('ws', WINDOW, broken, ENV, 100);
    expect(d).toMatchObject({ resumable: true, spentSeconds: 25 * 60 });
  });

  it('a store that never answers is cut off, and the window is counted exactly once', async () => {
    vi.useFakeTimers();
    try {
      const hung: FreeChainStore = { load: () => new Promise(() => {}), save: () => new Promise(() => {}), clear: () => new Promise(() => {}) };
      const pending = decideFreePauseShared('ws', WINDOW, hung, ENV, 100);
      await vi.advanceTimersByTimeAsync(FREE_CHAIN_STORE_TIMEOUT_MS * 2 + 10);
      expect((await pending).spentSeconds).toBe(25 * 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the route uses the shared versions', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('await noteFreeBuildStartShared(workspaceId, prompt, freeChainStore);');
    expect(route).toContain('await decideFreePauseShared(workspaceId, deadlineMs, freeChainStore)');
    expect(route).not.toMatch(/\bdecideFreePause\(workspaceId/);
  });
});
