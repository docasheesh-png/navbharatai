// CHANGE ENGINE slice 5 (2026-10-04) — a feature the user deliberately removes is DROPPED, never defended.
// Without this, "remove the delete button" was graded as a missing Delete control (the word "remove" is
// itself the delete probe's keyword) and the feature heal — and, since slice 2, the regression heal —
// could put it straight back: the engine overruling the user.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { removalObjects, removedProbeFeatures, requestedRemovals } from '../src/server/AgentV3/changeEngine/requestConsistency';
import { foldRequestedFeatures, foldProbeResults, foldRequestedLabels } from '../src/server/AgentV3/changeEngine/appSpec';
import { beginChange, foldSettle } from '../src/server/AgentV3/changeEngine/changeSession';
import { emptyMemory } from '../src/server/AgentV3/changeEngine/changeLog';
import { updateEngineeringMemory, __resetEngineeringMemoryCache } from '../src/server/AgentV3/changeEngine/engineeringMemoryStore';
import { checkFeaturePresence } from '../src/server/AgentV3/FeaturePresence';

const verifiedSpec = (() => {
  let s = foldRequestedFeatures({ items: [], nextReq: 1 }, [
    { feature: 'add', label: 'Add / create' }, { feature: 'delete', label: 'Delete / remove' }, { feature: 'search', label: 'Search' },
    { feature: 'list', label: 'List / items' },
  ], 'C1');
  s = foldProbeResults(s, ['add', 'delete', 'search', 'list'].map((f) => ({ feature: f, present: true, via: 'control' as const })), 'C1', 1).spec;
  return foldRequestedLabels(s, ['Coupon codes'], 'C1');
})();

describe('reading a removal', () => {
  const cases: Array<[string, string[]]> = [
    ['remove the delete button', ['delete']],
    ['search bar hata do', ['search']],
    ['get rid of the login page', ['auth']],
    ['hide the filter tabs and make the header blue', ['filter']],
    ['remove the delete button and add a search box', ['delete']],
  ];
  for (const [req, want] of cases) {
    it(`"${req}" removes ${want.join(', ')}`, () => expect([...removedProbeFeatures(req)].sort()).toEqual(want));
  }

  it('an action on DATA is not the removal of a feature', () => {
    expect([...removedProbeFeatures('remove completed tasks from the list automatically')]).toEqual([]);
    expect([...removedProbeFeatures('delete old notes after 30 days')]).toEqual([]);
    expect([...removedProbeFeatures('make the delete button red')]).toEqual([]);
  });

  it('the object stops at the clause boundary', () => {
    expect(removalObjects('remove the delete button, and keep search')).toEqual(['the delete button']);
  });

  it('matches ledger items, label items included, and never a dropped one', () => {
    expect(requestedRemovals('remove the delete button', verifiedSpec).map((i) => i.feature)).toEqual(['delete']);
    expect(requestedRemovals('remove the coupon codes section', verifiedSpec).map((i) => i.feature)).toEqual(['label:coupon-codes']);
  });
});

describe('the engine stands down for a removal', () => {
  it('the coverage probe no longer grades a removal as a missing feature (with the route\'s declined set)', () => {
    const html = '<form><input aria-label="New task"/><button>Add</button></form><ul><li>Milk</li></ul>';
    const req = 'remove the delete button so people can only add tasks';
    expect(checkFeaturePresence(req, html).missing).toContain('Delete / remove'); // the old defect
    expect(checkFeaturePresence(req, html, removedProbeFeatures(req)).missing).toEqual([]);
  });

  it('begin: not re-probed, told to remove cleanly, reported', async () => {
    __resetEngineeringMemoryCache();
    await updateEngineeringMemory('rm1', (m) => ({ ...m, spec: verifiedSpec }));
    const b = await beginChange({ workspaceId: 'rm1', prompt: 'remove the delete button', isEdit: true, requested: [] });
    expect(b.session.regressionTargets).not.toContain('delete');
    expect(b.session.regressionTargets).toEqual(expect.arrayContaining(['add', 'search']));
    expect(b.builderBlock).toMatch(/removes REQ-002 Delete \/ remove on purpose/);
    expect(b.reportLine).toMatch(/removes REQ-002 on request/);
  });

  it('settle: the removed requirement is dropped, keeps its id, and is not a regression', async () => {
    __resetEngineeringMemoryCache();
    const mem = { ...emptyMemory(), spec: verifiedSpec };
    await updateEngineeringMemory('rm2', () => mem);
    const b = await beginChange({ workspaceId: 'rm2', prompt: 'remove the delete button', isEdit: true, requested: [] });
    b.session.probes.set('delete', { feature: 'delete', present: false });
    const { mem: after, result } = foldSettle(mem, b.session, { ok: true, stopped: false, files: [], gate: 'green', issues: [] }, 1);
    expect(after.spec.items.find((i) => i.id === 'REQ-002')?.status).toBe('dropped');
    expect(result.record.regressed).toEqual([]);
  });

  it('the route passes removals as declined to every coverage probe and to the ledger', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(src).toMatch(/\.\.\.removedProbeFeatures\(milestoneRequest \?\? prompt\)\]\)/);
    expect(src).not.toMatch(/checkFeaturePresence\([^;]*declinedPresenceFeatures\(featureConfirmation\)\)/);
    expect(src.match(/checkFeaturePresence\(milestoneRequest \?\? prompt, [^;]*presenceDeclined\)/g)).toHaveLength(4);
    expect(src).toMatch(/\.\.\.removedProbeFeatures\(prompt\)\]\)\]/);
  });
});
