// The settle's effects, driven with fakes: incomplete hydration, a hold whose restore fails, a base store outage,
// provider-independent decisions, and the bill/summary after a hold.
import { describe, it, expect } from 'vitest';
import { holdReplacementIfAny, billAfterHold, summaryAfterHold, persistedAfterHold, pathsOf } from '../src/server/AgentV3/editPromotion';
import { checkEditBase, checkEditBaseForTurn, editIdFor } from '../src/server/AgentV3/editBase';
import { memoryStopMessage } from '../src/server/AgentV3/projectMemoryTurn';
import { InMemoryRevisionStore, buildRevision } from '../src/server/AgentV3/projectRevisions';
import { cityGame, differentGame } from './fixtures/threeDGame';

const wt = <T,>(p: Promise<T>) => p;
const fx = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  return { calls, args: {
    base: cityGame() as Record<string, string> | null, candidate: differentGame(), userMessage: 'make the camera third-person', protectPaths: [] as string[],
    keepCandidate: async () => { calls.push('keep'); },
    putBaseBack: async (plan: { write: Record<string, string>; remove: string[] }) => { calls.push('restore'); return { removed: plan.remove, wrote: Object.keys(plan.write).length }; },
    treeAfter: (plan: { write: Record<string, string> }) => ({ ...plan.write }),
    wasComplete: () => true,
    ...over,
  } };
};

describe('holdReplacementIfAny', () => {
  it('🔴 keeps the candidate FIRST, then puts the base back, and reports in plain words', async () => {
    const { calls, args } = fx();
    const r = await holdReplacementIfAny(args as never);
    expect(r.held).toBe(true);
    expect(calls).toEqual(['keep', 'restore']);
    expect(r.persisted?.['src/scenes/CityScene.tsx']).toBeDefined(); // the base's files are what is durable
    expect(r.removed).toContain('src/Snake.tsx'); // files the replacement added are removed
    expect(r.summary).toMatch(/exactly as it was/);
    expect(r.finding?.autoResolved).toBe(true);
  });
  it('a real edit is not held and nothing is touched', async () => {
    const { calls, args } = fx({ candidate: { ...cityGame(), 'src/game/collision.ts': 'new' } });
    const r = await holdReplacementIfAny(args as never);
    expect(r.held).toBe(false);
    expect(calls).toEqual([]);
  });
  it('no base (new project, import, fresh start) holds nothing', async () => {
    expect((await holdReplacementIfAny(fx({ base: null }).args as never)).held).toBe(false);
  });
  it('an incomplete restore is reported honestly, never as "exactly as it was"', async () => {
    const r = await holdReplacementIfAny(fx({ wasComplete: () => false }).args as never);
    expect(r.held).toBe(true);
    expect(r.summary).not.toMatch(/exactly as it was/);
    expect(r.summary).toMatch(/version history/);
    expect(r.finding?.autoResolved).toBe(false);
  });
  it('🔴 a restore that THROWS still holds the candidate (it is never promoted) and says so', async () => {
    const r = await holdReplacementIfAny(fx({ putBaseBack: async () => { throw new Error('sandbox gone'); } }).args as never);
    expect(r.held).toBe(true);
    expect(r.persisted).toBeNull();
    expect(r.finding?.detail).toMatch(/restore failed: sandbox gone/);
    expect(r.finding?.autoResolved).toBe(false);
  });
  it('a failing keepCandidate does not stop the restore', async () => {
    const { calls, args } = fx({ keepCandidate: async () => { throw new Error('store down'); } });
    const r = await holdReplacementIfAny(args as never);
    expect(r.held).toBe(true);
    expect(calls).toContain('restore');
  });
});

describe('after a hold', () => {
  it('the bill is zero and the summary is the held message; otherwise untouched', () => {
    expect(billAfterHold(12.5, 'held')).toBe(0);
    expect(billAfterHold(12.5, null)).toBe(12.5);
    expect(summaryAfterHold({ summary: 'Built!', ok: true }, 'held')).toEqual({ summary: 'held', ok: true });
    const same = { summary: 'Built!' };
    expect(summaryAfterHold(same, null)).toBe(same);
    expect(persistedAfterHold({ persisted: null }, { a: '1' })).toEqual({ a: '1' });
    expect(pathsOf(null)).toEqual([]);
  });
});

describe('the base at turn start (incomplete hydration, outages)', () => {
  const head = buildRevision({ projectId: 'p', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
  const storeWith = async () => { const s = new InMemoryRevisionStore(); await s.promote('p', null, head); return s; };
  it('🔴 a partial hydration is detected and the matching verified copy becomes the base', async () => {
    const hydrated = cityGame(); delete hydrated['src/scenes/HarborScene.tsx'];
    const r = await checkEditBase({ workspaceId: 'p', hydrated, store: await storeWith(), loadVerifiedCopy: async () => cityGame(), withTimeout: wt });
    expect(r.check.state).toBe('partial');
    expect(r.verifiedBase).toEqual(cityGame());
    expect(r.finding).toMatchObject({ code: 'EDIT_BASE_PARTIAL', severity: 'warning', autoResolved: true });
  });
  it('partial hydration with NO verified copy is reported as unresolved, and the base stays what was read', async () => {
    const hydrated = cityGame(); delete hydrated['src/scenes/HarborScene.tsx'];
    const r = await checkEditBase({ workspaceId: 'p', hydrated, store: await storeWith(), loadVerifiedCopy: async () => ({}), withTimeout: wt });
    expect(r.verifiedBase).toBeNull();
    expect(r.finding?.autoResolved).toBe(false);
  });
  it('a verified base says nothing; a legacy project (no head) is noted; a store outage is reported, not thrown', async () => {
    expect((await checkEditBase({ workspaceId: 'p', hydrated: cityGame(), store: await storeWith(), loadVerifiedCopy: async () => ({}), withTimeout: wt })).finding).toBeNull();
    expect((await checkEditBase({ workspaceId: 'legacy', hydrated: cityGame(), store: new InMemoryRevisionStore(), loadVerifiedCopy: async () => ({}), withTimeout: wt })).finding?.code).toBe('EDIT_BASE_LEGACY');
    const broken = { head: async () => { throw new Error('firestore down'); }, get: async () => null, list: async () => [], promote: async () => { throw new Error('x'); } };
    expect((await checkEditBase({ workspaceId: 'p', hydrated: cityGame(), store: broken, loadVerifiedCopy: async () => ({}), withTimeout: wt })).finding?.code).toBe('EDIT_BASE_UNCHECKED');
  });
  it('is skipped for an import turn, an unreadable saved copy, or an empty workspace', async () => {
    const s = await storeWith();
    for (const o of [{ isImportTurn: true }, { hasImportIntent: true }, { durableUnreadable: true }]) {
      const r = await checkEditBaseForTurn({ workspaceId: 'p', hydrated: cityGame(), store: s, loadVerifiedCopy: async () => ({}), withTimeout: wt, isImportTurn: false, hasImportIntent: false, durableUnreadable: false, ...o });
      expect(r.head).toBeNull();
    }
    expect((await checkEditBaseForTurn({ workspaceId: 'p', hydrated: {}, store: s, loadVerifiedCopy: async () => ({}), withTimeout: wt, isImportTurn: false, hasImportIntent: false, durableUnreadable: false })).head).toBeNull();
  });
  it('the edit id comes from the client request id, so a retry or reconnect is the same edit', () => {
    expect(editIdFor('w', ' req-1 ', 'fallback')).toBe('w:req-1');
    expect(editIdFor('w', undefined, 'fallback')).toBe('w:fallback');
  });
});

describe('stopping an edit that has no instructions', () => {
  const t = { status: 'unrecoverable' as const, text: '', ledger: null, note: 'x' };
  it('stops only an EDIT of an existing project', () => {
    expect(memoryStopMessage(t, true, false, false)).toMatch(/did not change anything/);
    expect(memoryStopMessage(t, false, false, false)).toBeNull(); // a brand-new project has nothing to lose
    expect(memoryStopMessage(t, true, true, false)).toBeNull(); // an import brings its own project
    expect(memoryStopMessage(t, true, false, true)).toBeNull();
    expect(memoryStopMessage(t, true, false, false, false)).toBeNull(); // kill switch
    expect(memoryStopMessage({ ...t, status: 'ok' }, true, false, false)).toBeNull();
  });
});
