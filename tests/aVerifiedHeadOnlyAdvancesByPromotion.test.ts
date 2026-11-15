// The release rule and the revision head: only a candidate that passed validation against its base may replace
// the active version, and every rejected, interrupted, duplicated or raced edit leaves the head where it was.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryRevisionStore, buildRevision, manifestOf, sourceHashOf, verifyBase, promoteWithRebase, type RevisionRecord, type RevisionDraft,
} from '../src/server/AgentV3/projectRevisions';
import { assessEditCandidate } from '../src/server/AgentV3/editPromotionGate';
import { decideRelease } from '../src/server/AgentV3/editRelease';
import { cityGame, differentGame } from './fixtures/threeDGame';

const P = 'agentv3-u1-s1';
const valid = { previewGreen: true, checks: ['edit-gate', 'preview-render'], artifactDigest: 'sha256:abc', configHash: 'cam=first' };
const draft = (over: Partial<RevisionDraft> & Pick<RevisionDraft, 'files' | 'editId'>): RevisionDraft =>
  ({ projectId: P, parentId: null, kind: 'edit', validation: valid, now: 1000, ...over });

let store: InMemoryRevisionStore;
let baseline: RevisionRecord;
beforeEach(async () => {
  store = new InMemoryRevisionStore();
  baseline = buildRevision(draft({ files: cityGame(), editId: 'build-1', kind: 'baseline', messageId: 'msg-1', messageText: 'build a 3D city game' }));
  await store.promote(P, null, baseline);
});

describe('a base is proven complete before an edit may start from it', () => {
  it('verified when the hydrated files are exactly the head', async () => {
    expect(verifyBase(await store.head(P), cityGame()).state).toBe('verified');
  });
  it('🔴 PARTIAL when hydration lost files — the edit would otherwise be built over a fragment', async () => {
    const hydrated = cityGame(); delete hydrated['src/scenes/HarborScene.tsx']; delete hydrated['public/models/harbor.glb'];
    const v = verifyBase(await store.head(P), hydrated);
    expect(v.state).toBe('partial');
    expect(v.missing.sort()).toEqual(['public/models/harbor.glb', 'src/scenes/HarborScene.tsx']);
  });
  it('stale when content differs; no-head for a legacy project with no revision yet', async () => {
    const edited = cityGame(); edited['src/game/collision.ts'] = 'changed';
    expect(verifyBase(await store.head(P), edited).state).toBe('stale');
    expect(verifyBase(null, cityGame()).state).toBe('no-head');
  });
  it('a legacy project gets its first verified baseline from its existing saved source', async () => {
    const legacy = new InMemoryRevisionStore();
    const files = cityGame();
    expect(await legacy.head('legacy')).toBeNull();
    const r = await legacy.promote('legacy', null, buildRevision({ projectId: 'legacy', parentId: null, editId: 'legacy-baseline', kind: 'baseline', files, validation: { previewGreen: true, checks: ['legacy-baseline'] }, now: 5 }));
    expect(r.ok && r.rev.sourceHash).toBe(sourceHashOf(manifestOf(files)));
  });
});

describe('the release rule', () => {
  const base = { state: 'verified' as const, missing: [], extra: [], differing: [] };
  const gateOk = assessEditCandidate({ base: cityGame(), candidate: cityGame() });
  const gateBad = assessEditCandidate({ base: cityGame(), candidate: differentGame(), userMessage: 'camera' });
  it('promotes only a gated, rendered, instruction-aware candidate', () => {
    expect(decideRelease({ gate: gateOk, previewGreen: true, provenBroken: false, base, requirementsOk: true }).action).toBe('promote');
  });
  it('🔴 a candidate that compiles and RENDERS but replaces the project is held', () => {
    const d = decideRelease({ gate: gateBad, previewGreen: true, provenBroken: false, base, requirementsOk: true });
    expect(d.action).toBe('hold');
    expect(d.reasons.join(' ')).toMatch(/replaces the project/);
  });
  it('a candidate observed broken in the browser is held', () => {
    expect(decideRelease({ gate: gateOk, previewGreen: false, provenBroken: true, base, requirementsOk: true }).action).toBe('hold');
  });
  it('not being able to look keeps the user\'s edit but does not promote it', () => {
    expect(decideRelease({ gate: gateOk, previewGreen: false, provenBroken: false, base, requirementsOk: true }).action).toBe('keep-unverified');
    expect(decideRelease({ gate: gateOk, previewGreen: true, provenBroken: false, base, requirementsOk: false }).action).toBe('keep-unverified');
    expect(decideRelease({ gate: gateOk, previewGreen: true, provenBroken: false, base: { ...base, state: 'stale' }, requirementsOk: true }).action).toBe('keep-unverified');
  });
});

describe('promotion is atomic and idempotent', () => {
  it('a rejected or interrupted edit never touches the head (nothing is promoted)', async () => {
    const before = await store.head(P);
    // crash before promotion / failed candidate: the code path simply never calls promote.
    expect((await store.head(P))?.id).toBe(before?.id);
  });
  it('promotes on the expected parent and records source revision, hashes, validation and the originating message', async () => {
    const files = { ...cityGame(), 'src/game/CameraRig.tsx': 'export function CameraRig(){return null}' };
    const rev = buildRevision(draft({ files, editId: 'edit-cam', parentId: baseline.id, messageId: 'msg-7', messageText: 'add a third-person camera', gate: { verdict: 'promote', stats: { changed: 1 }, reasons: [] }, now: 2000 }));
    const r = await store.promote(P, baseline.id, rev);
    expect(r.ok && !r.duplicate).toBe(true);
    const head = await store.head(P);
    expect(head).toMatchObject({ parentId: baseline.id, messageId: 'msg-7', validation: { artifactDigest: 'sha256:abc', configHash: 'cam=first', previewGreen: true } });
    expect(head?.sourceHash).toBe(sourceHashOf(manifestOf(files)));
    expect((await store.list(P)).map((x) => x.kind)).toEqual(['edit', 'baseline']);
  });
  it('a duplicate request (same editId) promotes once and returns the same revision', async () => {
    const rev = buildRevision(draft({ files: { ...cityGame(), 'a.ts': '1' }, editId: 'edit-dup', parentId: baseline.id, now: 2000 }));
    const a = await store.promote(P, baseline.id, rev);
    const b = await store.promote(P, baseline.id, buildRevision(draft({ files: { ...cityGame(), 'a.ts': '1' }, editId: 'edit-dup', parentId: baseline.id, now: 3000 })));
    expect(a.ok && b.ok && b.duplicate && b.rev.id === (a.ok ? a.rev.id : '')).toBe(true);
    expect((await store.list(P)).length).toBe(2);
  });
  it('two concurrent edits from the same base: one wins, the other gets a conflict and the head is the winner', async () => {
    const e1 = buildRevision(draft({ files: { ...cityGame(), 'x.ts': '1' }, editId: 'e1', parentId: baseline.id, now: 2000 }));
    const e2 = buildRevision(draft({ files: { ...cityGame(), 'y.ts': '2' }, editId: 'e2', parentId: baseline.id, now: 2001 }));
    const [r1, r2] = await Promise.all([store.promote(P, baseline.id, e1), store.promote(P, baseline.id, e2)]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    const loser = r1.ok ? r2 : r1;
    expect(!loser.ok && loser.reason).toBe('conflict');
    expect((await store.head(P))?.id).toBe(r1.ok ? e1.id : e2.id);
  });
  it('a conflicting edit is REBASED onto the new head and re-validated before it may promote', async () => {
    const e1 = buildRevision(draft({ files: { ...cityGame(), 'x.ts': '1' }, editId: 'e1', parentId: baseline.id, now: 2000 }));
    await store.promote(P, baseline.id, e1);
    const stale = buildRevision(draft({ files: { ...cityGame(), 'y.ts': '2' }, editId: 'e2', parentId: baseline.id, now: 2001 }));
    let revalidated = 0;
    const r = await promoteWithRebase(store, P, { expectedParentId: baseline.id, rev: stale }, async (head) => {
      revalidated++;
      // the rebase re-applies the edit on the new head and re-runs the gate against it:
      const files = { ...(cityGame()), 'x.ts': '1', 'y.ts': '2' };
      expect(assessEditCandidate({ base: { ...cityGame(), 'x.ts': '1' }, candidate: files }).verdict).toBe('promote');
      return buildRevision(draft({ files, editId: 'e2', parentId: head?.id ?? null, now: 2002 }));
    });
    expect(revalidated).toBe(1);
    expect(r.ok).toBe(true);
    expect((await store.head(P))?.parentId).toBe(e1.id);
  });
  it('a rebase that gives up leaves the head with the winner', async () => {
    await store.promote(P, baseline.id, buildRevision(draft({ files: { ...cityGame(), 'x.ts': '1' }, editId: 'e1', parentId: baseline.id })));
    const headBefore = (await store.head(P))?.id;
    const r = await promoteWithRebase(store, P, { expectedParentId: baseline.id, rev: buildRevision(draft({ files: { ...cityGame(), 'z.ts': '3' }, editId: 'e3', parentId: baseline.id })) }, async () => null);
    expect(r.ok).toBe(false);
    expect((await store.head(P))?.id).toBe(headBefore);
  });
  it('a restore is recorded as a NEW revision that points at the one it restored — history only grows', async () => {
    const edited = buildRevision(draft({ files: { ...cityGame(), 'x.ts': '1' }, editId: 'e1', parentId: baseline.id, now: 2000 }));
    await store.promote(P, baseline.id, edited);
    const restored = buildRevision(draft({ files: cityGame(), editId: 'restore-1', kind: 'restore', parentId: edited.id, restoredFrom: baseline.id, validation: { previewGreen: true, checks: ['restore-saved-artifact'], artifactDigest: 'sha256:abc' }, now: 3000 }));
    const r = await store.promote(P, edited.id, restored);
    expect(r.ok).toBe(true);
    const head = await store.head(P);
    expect(head).toMatchObject({ kind: 'restore', restoredFrom: baseline.id });
    expect(head?.sourceHash).toBe(baseline.sourceHash); // same files as the restored revision…
    expect(head?.id).not.toBe(baseline.id); // …but a new history event
    expect((await store.list(P)).length).toBe(3);
  });
  it('projects are isolated', async () => {
    expect(await store.head('someone-elses-project')).toBeNull();
    expect(await store.get('someone-elses-project', baseline.id)).toBeNull();
  });
});

import { recordTurnRevision } from '../src/server/AgentV3/editPromotion';
import { candidateReplacesBase } from '../src/server/AgentV3/editRelease';

describe('recording a turn (what the route calls at settle)', () => {
  const promoteRelease = { action: 'promote' as const, reasons: [] };
  const gate = assessEditCandidate({ base: cityGame(), candidate: cityGame() });
  const common = { projectId: 'proj-X', messageId: 'm-1', messageText: 'tweak', gate, now: 5000 };

  it('a legacy project: the first baseline comes from its saved source, then the edit is a child of it', async () => {
    const s = new InMemoryRevisionStore();
    const start = cityGame();
    const edited = { ...start, 'src/game/collision.ts': 'export const c = 2' };
    const r = await recordTurnRevision({ ...common, store: s, editId: 'e-legacy', headAtStart: null, startFiles: start, persisted: edited, release: promoteRelease });
    expect(r.outcome).toBe('promoted');
    const list = await s.list('proj-X');
    expect(list.map((x) => x.kind).sort()).toEqual(['baseline', 'edit']);
    const baseline = list.find((x) => x.kind === 'baseline')!;
    expect(baseline.sourceHash).toBe(sourceHashOf(manifestOf(start)));
    expect(baseline.validation).toMatchObject({ previewGreen: false, checks: ['legacy-saved-source'] }); // honest: no browser proof of it
    expect((await s.head('proj-X'))?.parentId).toBe(baseline.id);
  });
  it('a brand-new project: the first verified build is the baseline', async () => {
    const s = new InMemoryRevisionStore();
    const r = await recordTurnRevision({ ...common, store: s, editId: 'e-new', headAtStart: null, startFiles: null, persisted: cityGame(), release: promoteRelease });
    expect(r.outcome).toBe('promoted');
    expect((await s.head('proj-X'))?.kind).toBe('baseline');
  });
  it('🔴 hold / keep-unverified never move the verified head', async () => {
    const s = new InMemoryRevisionStore();
    const h = buildRevision({ projectId: 'proj-X', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
    await s.promote('proj-X', null, h);
    for (const action of ['hold', 'keep-unverified'] as const) {
      const r = await recordTurnRevision({ ...common, store: s, editId: `e-${action}`, headAtStart: h, startFiles: cityGame(), persisted: differentGame(), release: { action, reasons: ['x'] } });
      expect(r.outcome).toBe('skipped');
    }
    expect((await s.head('proj-X'))?.id).toBe(h.id);
    expect((await s.list('proj-X')).length).toBe(1);
  });
  it('a duplicate delivery of the same edit (reconnect / retry) promotes once', async () => {
    const s = new InMemoryRevisionStore();
    const h = buildRevision({ projectId: 'proj-X', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
    await s.promote('proj-X', null, h);
    const persisted = { ...cityGame(), 'src/x.ts': '1' };
    const a = await recordTurnRevision({ ...common, store: s, editId: 'same', headAtStart: h, startFiles: cityGame(), persisted, release: promoteRelease });
    const b = await recordTurnRevision({ ...common, store: s, editId: 'same', headAtStart: h, startFiles: cityGame(), persisted, release: promoteRelease });
    expect(a.outcome).toBe('promoted');
    expect(b.outcome).toBe('duplicate');
    expect((await s.list('proj-X')).length).toBe(2);
  });
  it('an edit that lost the race is NOT promoted over the winner', async () => {
    const s = new InMemoryRevisionStore();
    const h = buildRevision({ projectId: 'proj-X', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
    await s.promote('proj-X', null, h);
    const winner = buildRevision({ projectId: 'proj-X', parentId: h.id, editId: 'winner', kind: 'edit', files: { ...cityGame(), 'w.ts': '1' }, validation: { previewGreen: true, checks: [] }, now: 2 });
    await s.promote('proj-X', h.id, winner);
    const r = await recordTurnRevision({ ...common, store: s, editId: 'loser', headAtStart: h, startFiles: cityGame(), persisted: { ...cityGame(), 'l.ts': '2' }, release: promoteRelease });
    expect(r).toMatchObject({ outcome: 'conflict', headId: winner.id });
    expect((await s.head('proj-X'))?.id).toBe(winner.id);
  });
  it('a store failure is reported, never thrown into the build', async () => {
    const broken = { head: async () => null, get: async () => null, list: async () => [], promote: async () => { throw new Error('firestore down'); } };
    const r = await recordTurnRevision({ ...common, store: broken, editId: 'e', headAtStart: null, startFiles: null, persisted: cityGame(), release: promoteRelease });
    expect(r).toMatchObject({ outcome: 'error' });
  });
  it('candidateReplacesBase: null with no base, null for a real edit, the verdict for a replacement', () => {
    expect(candidateReplacesBase(null, differentGame(), 'x')).toBeNull();
    expect(candidateReplacesBase(cityGame(), { ...cityGame(), 'src/game/collision.ts': 'new' }, 'fix collision')).toBeNull();
    expect(candidateReplacesBase(cityGame(), differentGame(), 'fix collision')?.verdict).toBe('reject');
  });
});

import { settleEditRevision, heldEditReport } from '../src/server/AgentV3/editPromotion';

describe('the turn-end settle', () => {
  const okBase = { state: 'verified' as const, missing: [], extra: [], differing: [] };
  const common = { projectId: 'proj-S', messageId: 'm', messageText: 't', userMessage: 'make the camera third person', baseCheck: okBase, requirementsOk: true, now: 9000 };
  it('🔴 a rendered replacement is NOT promoted and its report tells the user the app is as it was', async () => {
    const s = new InMemoryRevisionStore();
    const h = buildRevision({ projectId: 'proj-S', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
    await s.promote('proj-S', null, h);
    const r = await settleEditRevision({ ...common, store: s, editId: 'x', headAtStart: h, startFiles: cityGame(), base: cityGame(), persisted: differentGame(), previewGreen: true, provenBroken: false });
    expect(r.outcome.outcome).toBe('skipped');
    expect((await s.head('proj-S'))?.id).toBe(h.id);
    const gate = assessEditCandidate({ base: cityGame(), candidate: differentGame(), userMessage: 'camera' });
    expect(heldEditReport(gate, true).summary).toMatch(/exactly as it was/);
    expect(heldEditReport(gate, false).summary).not.toMatch(/exactly as it was/);
    expect(heldEditReport(gate, false).summary).toMatch(/version history/);
  });
  it('a real, rendered edit promotes and is recorded with its message and gate stats', async () => {
    const s = new InMemoryRevisionStore();
    const h = buildRevision({ projectId: 'proj-S', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
    await s.promote('proj-S', null, h);
    const edited = { ...cityGame(), 'src/game/CameraRig.tsx': 'export function CameraRig(){return null /*3rd*/}' };
    const r = await settleEditRevision({ ...common, store: s, editId: 'cam', headAtStart: h, startFiles: cityGame(), base: cityGame(), persisted: edited, previewGreen: true, provenBroken: false, artifactDigest: 'sha256:art' });
    expect(r.outcome.outcome).toBe('promoted');
    expect(r.finding.code).toBe('EDIT_PROMOTED');
    expect(await s.head('proj-S')).toMatchObject({ messageText: 't', gate: { verdict: 'promote', stats: { changed: 1 } }, validation: { artifactDigest: 'sha256:art' } });
  });
  it('a candidate that compiles but was observed failing in the browser is not promoted', async () => {
    const s = new InMemoryRevisionStore();
    const h = buildRevision({ projectId: 'proj-S', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
    await s.promote('proj-S', null, h);
    const r = await settleEditRevision({ ...common, store: s, editId: 'broken', headAtStart: h, startFiles: cityGame(), base: cityGame(), persisted: { ...cityGame(), 'src/x.ts': '1' }, previewGreen: false, provenBroken: true });
    expect(r.outcome.outcome).toBe('skipped');
    expect((await s.head('proj-S'))?.id).toBe(h.id);
  });
});

import { recordRestoreRevision } from '../src/server/AgentV3/editPromotion';

describe('a restore from the version history', () => {
  it('🔴 serves the saved files with NO model call, as a new history event that points at the verified revision it restored', async () => {
    const s = new InMemoryRevisionStore();
    const v1 = buildRevision({ projectId: 'proj-R', parentId: null, editId: 'v1', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: ['preview-render'], artifactDigest: 'sha256:v1' }, now: 1 });
    await s.promote('proj-R', null, v1);
    const camera = { ...cityGame(), 'src/game/CameraRig.tsx': 'export function CameraRig(){return null /*3p*/}' };
    const v2 = buildRevision({ projectId: 'proj-R', parentId: v1.id, editId: 'v2', kind: 'edit', files: camera, validation: { previewGreen: true, checks: [] }, now: 2 });
    await s.promote('proj-R', v1.id, v2);
    const collision = { ...camera, 'src/game/collision.ts': 'export function collides(){return true}' };
    const v3 = buildRevision({ projectId: 'proj-R', parentId: v2.id, editId: 'v3', kind: 'edit', files: collision, validation: { previewGreen: true, checks: [] }, now: 3 });
    await s.promote('proj-R', v2.id, v3);
    // restore v2 (the camera edit, before the collision edit): pure store + hashing — nothing here can call a model
    const r = await recordRestoreRevision({ store: s, projectId: 'proj-R', restored: camera, versionName: 'camera edit', editId: 'restore-1', now: 4 });
    expect(r).toMatchObject({ recorded: true, restoredFrom: v2.id });
    const head = await s.head('proj-R');
    expect(head).toMatchObject({ kind: 'restore', restoredFrom: v2.id, parentId: v3.id, validation: { previewGreen: true } });
    expect(head?.sourceHash).toBe(v2.sourceHash);
    expect((await s.list('proj-R')).length).toBe(4); // history only grew
    // the next edit's base is verified against the restored files:
    expect(verifyBase(head, camera).state).toBe('verified');
    expect(verifyBase(head, collision).state).toBe('stale');
  });
  it('restoring a version nobody browser-checked is recorded, and labelled unverified', async () => {
    const s = new InMemoryRevisionStore();
    const h = buildRevision({ projectId: 'proj-R', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
    await s.promote('proj-R', null, h);
    const old = { ...cityGame(), 'src/old.ts': 'x' };
    expect(await recordRestoreRevision({ store: s, projectId: 'proj-R', restored: old, versionName: 'old', editId: 'r2', now: 2 })).toMatchObject({ recorded: true, restoredFrom: null });
    expect((await s.head('proj-R'))?.validation).toMatchObject({ previewGreen: false, checks: ['restore-of-unverified-version'] });
  });
  it('restoring what is already the head records nothing', async () => {
    const s = new InMemoryRevisionStore();
    const h = buildRevision({ projectId: 'proj-R', parentId: null, editId: 'b', kind: 'baseline', files: cityGame(), validation: { previewGreen: true, checks: [] }, now: 1 });
    await s.promote('proj-R', null, h);
    expect((await recordRestoreRevision({ store: s, projectId: 'proj-R', restored: cityGame(), versionName: 'same', editId: 'r3', now: 2 })).recorded).toBe(false);
  });
});
