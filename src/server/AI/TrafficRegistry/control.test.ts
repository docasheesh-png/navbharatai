/**
 * Traffic Manager V2, P2 (owner-approved 2026-11-17): the control store, its decisions and its sync.
 * Each block names the owner requirement it locks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ControlInputError, parseControlBody, parseControlDoc, type ControlDoc } from './controlTypes';
import { admissionGaps, candidateVerdict, controlAllowsGateway, familyOfGatewayProvider, trafficBucket } from './controlDecision';
import { ControlConflictError, describeChanges, revisionDocId, TrafficControlStore, TRAFFIC_CONTROL_AUDIT_COLLECTION, TRAFFIC_CONTROL_REVISIONS_COLLECTION } from './controlStore';
import { __resetTrafficControlSyncForTests, adoptTrafficControl, currentTrafficControl, jittered, nextInterval, SYNC_BASE_MS, SYNC_MAX_MS, syncTrafficControlOnce, trafficControlSyncStatus } from './controlSync';
import { PROVIDER_UPSTREAM } from './upstreamFamilies';
import { MemoryFirestore } from '../../../../tests/helpers/memoryFirestore';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const doc = (over: Partial<ControlDoc> = {}): ControlDoc => ({ global: { gateway: 'on' }, surfaces: {}, providers: {}, models: {},
  revision: 1, updatedAtMs: NOW, actor: 'admin', reason: 'test', ...over });

describe('validation is strict: a half-understood control is never applied (req 1, 2)', () => {
  it('accepts a full body and fills defaults', () => {
    expect(parseControlBody({ global: { gateway: 'off' }, surfaces: { chat: 'legacy' }, providers: { glm: { state: 'draining' } },
      models: { 'glm/glm-4.7-flashx': { state: 'enabled', trafficCapPct: 25 } } }))
      .toEqual({ global: { gateway: 'off' }, surfaces: { chat: 'legacy' }, providers: { glm: { state: 'draining', trafficCapPct: 100 } },
        models: { 'glm/glm-4.7-flashx': { state: 'enabled', trafficCapPct: 25 } } });
  });
  it.each([
    [{ extra: 1 }, /unknown field/],
    [{ global: { gateway: 'maybe' } }, /on or off/],
    [{ surfaces: { builder: 'legacy' } }, /Unknown surface/],
    [{ surfaces: { chat: 'all' } }, /env or legacy/],
    [{ providers: { 'made-up': { state: 'disabled' } } }, /Unknown provider/],
    [{ providers: { glm: { state: 'off' } } }, /enabled, draining or disabled/],
    [{ providers: { glm: { state: 'enabled', trafficCapPct: 101 } } }, /0–100/],
    [{ providers: { glm: { state: 'enabled', trafficCapPct: 12.5 } } }, /0–100/],
    [{ providers: { glm: { state: 'enabled', weight: 5 } } }, /unknown field/],
    [{ models: { 'glm-only': { state: 'disabled' } } }, /<provider>\/<model id>/],
    [{ models: { 'nope/model': { state: 'disabled' } } }, /<provider>\/<model id>/],
    [{ models: { 'glm/m': { state: 'enabled', admission: { required: 'yes' } } } }, /true or false/],
  ])('refuses %j', (body, msg) => { expect(() => parseControlBody(body)).toThrow(msg); });
  it('P2 can only narrow: no surface mode can widen what the env enabled', () => {
    // The only modes are "env" (follow the deployment) and "legacy" (send it back); there is no "on".
    expect(() => parseControlBody({ surfaces: { chat: 'on' } })).toThrow(ControlInputError);
    expect(() => parseControlBody({ surfaces: { chat: 'canary' } })).toThrow(ControlInputError);
  });
  it('a stored document with a bad revision is rejected whole', () => {
    expect(() => parseControlDoc({ ...doc(), revision: 0 })).toThrow(/revision/);
  });
});

describe('decisions (req 2, 3, 4, 7, 9)', () => {
  it('no document means today\'s behaviour: everything allowed (req 9)', () => {
    expect(controlAllowsGateway(null)).toBe(true);
    expect(controlAllowsGateway(null, 'chat')).toBe(true);
    expect(candidateVerdict(null, 'GLM', 'glm-4.5-flash', 'r1', NOW)).toEqual({ allowed: true, admissionGaps: [] });
  });
  it('the global emergency OFF sends every surface to legacy; a surface switch sends only that one (req 3)', () => {
    expect(controlAllowsGateway(doc({ global: { gateway: 'off' } }), 'chat')).toBe(false);
    expect(controlAllowsGateway(doc({ global: { gateway: 'off' } }))).toBe(false);
    const one = doc({ surfaces: { professional: 'legacy' } });
    expect(controlAllowsGateway(one, 'professional')).toBe(false);
    expect(controlAllowsGateway(one, 'chat')).toBe(true);
  });
  it('disabled and draining stop NEW attempts on a provider or a model (req 2)', () => {
    for (const state of ['disabled', 'draining'] as const) {
      expect(candidateVerdict(doc({ providers: { glm: { state, trafficCapPct: 100 } } }), 'GLM', 'x', 'r', NOW)).toEqual({ allowed: false, reason: 'control' });
      expect(candidateVerdict(doc({ models: { 'glm/x': { state, trafficCapPct: 100 } } }), 'GLM', 'x', 'r', NOW)).toEqual({ allowed: false, reason: 'control' });
      expect(candidateVerdict(doc({ models: { 'glm/x': { state, trafficCapPct: 100 } } }), 'GLM', 'other', 'r', NOW).allowed).toBe(true);
    }
  });
  it('a traffic cap admits about that share, and the same logical request always gets the same answer', () => {
    const d = doc({ providers: { groq: { state: 'enabled', trafficCapPct: 30 } } });
    let admitted = 0;
    for (let i = 0; i < 2000; i++) if (candidateVerdict(d, 'GROQ', 'm', `req-${i}`, NOW).allowed) admitted++;
    expect(admitted / 2000).toBeGreaterThan(0.25);
    expect(admitted / 2000).toBeLessThan(0.35);
    expect(trafficBucket('same', 'groq')).toBe(trafficBucket('same', 'groq'));
    expect(candidateVerdict(doc({ providers: { groq: { state: 'enabled', trafficCapPct: 0 } } }), 'GROQ', 'm', 'r', NOW).allowed).toBe(false);
    expect(candidateVerdict(doc({ providers: { groq: { state: 'enabled', trafficCapPct: 100 } } }), 'GROQ', 'm', 'r', NOW).allowed).toBe(true);
  });
  it('admission is observed (never blocking) unless required; required blocks until all four checks are present and unexpired (req 7)', () => {
    const complete = { required: true, capabilityTestAtMs: NOW - 1, priceVerifiedAtMs: NOW - 1, priceSource: 'provider page',
      securityReviewAtMs: NOW - 1, opsTestAtMs: NOW - 1, reviewer: 'owner', expiresAtMs: NOW + 86_400_000 };
    expect(admissionGaps(complete, NOW)).toEqual([]);
    const observed = doc({ models: { 'glm/x': { state: 'enabled', trafficCapPct: 100, admission: { required: false } } } });
    const v = candidateVerdict(observed, 'GLM', 'x', 'r', NOW);
    expect(v.allowed).toBe(true);
    expect(v.allowed && v.admissionGaps).toEqual(expect.arrayContaining(['capability test', 'price verification', 'security review', 'operational test']));
    for (const missing of ['capabilityTestAtMs', 'priceSource', 'securityReviewAtMs', 'opsTestAtMs', 'reviewer'] as const) {
      const partial = { ...complete }; delete (partial as Record<string, unknown>)[missing];
      expect(candidateVerdict(doc({ models: { 'glm/x': { state: 'enabled', trafficCapPct: 100, admission: partial } } }), 'GLM', 'x', 'r', NOW))
        .toEqual({ allowed: false, reason: 'admission' });
    }
    const expired = { ...complete, expiresAtMs: NOW - 1 };
    expect(candidateVerdict(doc({ models: { 'glm/x': { state: 'enabled', trafficCapPct: 100, admission: expired } } }), 'GLM', 'x', 'r', NOW))
      .toEqual({ allowed: false, reason: 'admission' });
    const future = { ...complete, opsTestAtMs: NOW + 1 };
    expect(admissionGaps(future, NOW)).toContain('operational test');
    expect(candidateVerdict(doc({ models: { 'glm/x': { state: 'enabled', trafficCapPct: 100, admission: complete } } }), 'GLM', 'x', 'r', NOW).allowed).toBe(true);
  });
  it('every gateway text provider label maps to a kill-switch family, so it can be controlled (census)', () => {
    const labels = ['GLM', 'GEMINI', 'GROQ', 'CLOUDFLARE', 'DEEPSEEK', 'OPENAI', 'DEEPINFRA', 'CHEAPERINFERENCE', 'MITRIFY', 'QUBAX', 'OPENROUTER'];
    for (const l of labels) expect(Object.hasOwn(PROVIDER_UPSTREAM, familyOfGatewayProvider(l)), l).toBe(true);
  });
});

describe('the store: atomic, versioned, audited, rollback as a new revision (req 1, 6)', () => {
  const setup = () => { const db = new MemoryFirestore(); let t = NOW; return { db, store: new TrafficControlStore(db as never, () => ++t) }; };
  it('a change writes current + an immutable revision + one audit row, together', async () => {
    const { db, store } = setup();
    expect(await store.read()).toBeNull();
    const d = await store.apply({ expectedRevision: 0, body: { global: { gateway: 'off' } }, actor: 'owner', reason: 'provider outage' });
    expect(d.revision).toBe(1);
    expect(await store.read()).toMatchObject({ revision: 1, global: { gateway: 'off' }, actor: 'owner', reason: 'provider outage' });
    expect(db.data.get(TRAFFIC_CONTROL_REVISIONS_COLLECTION)?.get(revisionDocId(1))).toMatchObject({ revision: 1 });
    const audit = [...(db.data.get(TRAFFIC_CONTROL_AUDIT_COLLECTION)?.values() ?? [])];
    expect(audit).toEqual([expect.objectContaining({ actor: 'owner', fromRevision: 0, toRevision: 1, kind: 'change', changes: ['global.gateway: on → off'] })]);
  });
  it('refuses a stale revision: two admins never overwrite each other', async () => {
    const { store } = setup();
    await store.apply({ expectedRevision: 0, body: { global: { gateway: 'off' } }, actor: 'a', reason: 'first change' });
    await expect(store.apply({ expectedRevision: 0, body: { surfaces: { chat: 'legacy' } }, actor: 'b', reason: 'second change' })).rejects.toBeInstanceOf(ControlConflictError);
  });
  it('a revision copy can never be rewritten', async () => {
    const { db, store } = setup();
    db.data.set(TRAFFIC_CONTROL_REVISIONS_COLLECTION, new Map([[revisionDocId(1), { revision: 1, forged: true }]]));
    await expect(store.apply({ expectedRevision: 0, body: { global: { gateway: 'off' } }, actor: 'a', reason: 'would collide' })).rejects.toThrow(/ALREADY_EXISTS/);
    expect(await store.read()).toBeNull(); // nothing landed: all or none
  });
  it('needs a reason and a real change', async () => {
    const { store } = setup();
    await expect(store.apply({ expectedRevision: 0, body: { global: { gateway: 'off' } }, actor: 'a', reason: 'no' })).rejects.toThrow(/reason/);
    await expect(store.apply({ expectedRevision: 0, body: { global: { gateway: 'on' } }, actor: 'a', reason: 'nothing at all' })).rejects.toThrow(/Nothing changed/);
  });
  it('rollback makes an older body current as a NEW revision, audited as a rollback', async () => {
    const { db, store } = setup();
    await store.apply({ expectedRevision: 0, body: { providers: { glm: { state: 'draining' } } }, actor: 'a', reason: 'drain glm first' });
    await store.apply({ expectedRevision: 1, body: { global: { gateway: 'off' }, providers: { glm: { state: 'draining' } } }, actor: 'a', reason: 'then go legacy' });
    const back = await store.rollback({ expectedRevision: 2, targetRevision: 1, actor: 'a', reason: 'outage over' });
    expect(back).toMatchObject({ revision: 3, global: { gateway: 'on' }, providers: { glm: { state: 'draining', trafficCapPct: 100 } } });
    expect(back.reason).toMatch(/^rollback to r1: outage over/);
    const kinds = [...(db.data.get(TRAFFIC_CONTROL_AUDIT_COLLECTION)?.values() ?? [])].map(r => r.kind);
    expect(kinds).toEqual(['change', 'change', 'rollback']);
    await expect(store.rollback({ expectedRevision: 3, targetRevision: 3, actor: 'a', reason: 'not earlier' })).rejects.toThrow(/EARLIER/);
    const h = await store.history(5);
    expect(h.revisions.map(r => r.revision)).toEqual([3, 2, 1]);
    db.data.get(TRAFFIC_CONTROL_REVISIONS_COLLECTION)!.delete(revisionDocId(2));
    await expect(store.rollback({ expectedRevision: 3, targetRevision: 2, actor: 'a', reason: 'missing one' })).rejects.toThrow(/does not exist/);
  });
  it('the audit summary names each change and never more than 40 lines', () => {
    const before = { global: { gateway: 'on' as const }, surfaces: {}, providers: {}, models: {} };
    expect(describeChanges(before, { ...before, surfaces: { chat: 'legacy' }, providers: { glm: { state: 'enabled', trafficCapPct: 20 } } }))
      .toEqual(['surface chat: env → legacy', 'provider glm: default → enabled (20%)']);
  });
});

describe('sync: last-known-good, monotonic, adaptive with jitter, safe startup (req 5)', () => {
  afterEach(() => __resetTrafficControlSyncForTests());
  it('starts with no document, which is today\'s behaviour', () => {
    expect(currentTrafficControl()).toBeNull();
    expect(controlAllowsGateway(currentTrafficControl(), 'chat')).toBe(true);
  });
  it('a failed read keeps the last-known-good document', async () => {
    await syncTrafficControlOnce(async () => doc({ revision: 4, global: { gateway: 'off' } }));
    await syncTrafficControlOnce(async () => { throw new Error('storage blip'); });
    expect(currentTrafficControl()?.revision).toBe(4);
    expect(currentTrafficControl()?.global.gateway).toBe('off');
    expect(trafficControlSyncStatus().lastReadOk).toBe(false);
  });
  it('an older revision never replaces a newer one (a slow poll cannot undo an admin change)', async () => {
    expect(adoptTrafficControl(doc({ revision: 7 }))).toBe(true);
    await syncTrafficControlOnce(async () => doc({ revision: 6, global: { gateway: 'off' } }));
    expect(currentTrafficControl()?.revision).toBe(7);
    expect(currentTrafficControl()?.global.gateway).toBe('on');
  });
  it('polls every 15 s, backs off to 60 s while nothing changes, and snaps back on a change', async () => {
    expect(nextInterval(SYNC_BASE_MS, false)).toBe(22_500);
    let ms = SYNC_BASE_MS; for (let i = 0; i < 10; i++) ms = nextInterval(ms, false);
    expect(ms).toBe(SYNC_MAX_MS);
    expect(nextInterval(SYNC_MAX_MS, true)).toBe(SYNC_BASE_MS);
    for (const r of [0, 0.5, 0.999]) { const j = jittered(SYNC_BASE_MS, () => r); expect(j).toBeGreaterThanOrEqual(12_000); expect(j).toBeLessThanOrEqual(18_000); }
    await syncTrafficControlOnce(async () => null);
    await syncTrafficControlOnce(async () => null);
    expect(trafficControlSyncStatus().intervalMs).toBeGreaterThan(SYNC_BASE_MS);
    await syncTrafficControlOnce(async () => doc({ revision: 1 }));
    expect(trafficControlSyncStatus().intervalMs).toBe(SYNC_BASE_MS);
  });
});
