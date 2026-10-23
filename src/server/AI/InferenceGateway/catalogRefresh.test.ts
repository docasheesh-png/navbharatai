import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { gatewayTextCredentialBinding } from './textTransport';
import { refreshGatewayCatalog } from './catalogRefresh';
import { normalizeModel } from '../LiveRegistry/eligibility';
import { registryCredentialBinding } from '../LiveRegistry/sync';
import type { RegistryState } from '../LiveRegistry/types';
const CATALOG = 'free_chat_chain/gateway_catalog'; const REGISTRY = 'live_ai_registry/openrouter';
function fixture() {
  let now = 100000; const id = 'example/reviewed:free'; const credential = 'synthetic-test-only';
  const model = normalizeModel({ id, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, context_length: 8192 },
    { data: { id, endpoints: [{ model_id: id, tag: 'reviewed/endpoint', pricing: { prompt: '0', completion: '0' }, context_length: 8192, max_completion_tokens: 1024, supported_parameters: ['max_tokens'] }] } }, true, now, 600000, 'live-v2');
  const control = { disabled: false, termsReviewedUntil: now + 600000, endpointTag: 'reviewed/endpoint', updatedAt: now, actor: 'reviewer', reason: 'reviewed' };
  const observed: RegistryState = { manifest: { version: 'live-v2', count: 1, fetchedAt: now, expiresAt: now + 600000, accountVerified: true, accountCredentialBinding: registryCredentialBinding(credential), transitions: {}, chunks: ['a'.repeat(64)] }, models: [model], controls: { [id]: control }, health: {}, lastSyncAttemptAt: now, lastSyncError: null };
  const catalog = { kind: 'gateway_catalog', version: 1, enabled: true, revision: 'review-v1', issuedAtMs: now, expiresAtMs: now + 500000,
    policies: { untouched: 'policy' }, profiles: [{ profile: { id: 'reviewed', modelId: id, charging: 'verified-free-no-overage', capabilities: [{ kind: 'text', maxContextTokens: 4096, maxInputTokens: 3072, maxOutputTokens: 1024 }] },
      transport: { provider: 'OPENROUTER', model: id, endpointTag: 'reviewed/endpoint', registryVersion: 'live-v1', credentialBinding: gatewayTextCredentialBinding(credential) }, reviewedAtMs: now, expiresAtMs: now + 400000,
      review: { terms: 'review-ref', quality: 'benchmark-ref' }, canonicalModelId: 'approved-lineage' }] };
  const controlPath = `${REGISTRY}/controls/${createHash('sha256').update(id).digest('hex')}`;
  const docs = new Map<string, any>([[CATALOG, catalog], [REGISTRY, { manifest: observed.manifest }], [controlPath, control], [`${REGISTRY}/chunks/${'a'.repeat(64)}`, { models: observed.models }]]);
  const writes: string[] = []; let afterRead: (() => void) | undefined;
  const db = { doc: (path: string) => ({ path }), runTransaction: async (fn: any) => { const startingWrites = writes.length; return fn({
    get: async (ref: { path: string }) => { if (writes.length > startingWrites) throw new Error('Read after write'); const value = structuredClone(docs.get(ref.path)); afterRead?.(); return { data: () => value }; },
    set: (ref: { path: string }, value: unknown) => { writes.push(ref.path); docs.set(ref.path, structuredClone(value)); },
  }); } } as unknown as Pick<Firestore, 'doc' | 'runTransaction'>;
  return { db, docs, writes, observed, catalog, credential, controlPath, clock: () => now, advance: (n: number) => { now += n; }, onRead: (fn: () => void) => { afterRead = fn; } };
}
describe('review-preserving registry refresh', () => {
  it('updates only existing registry version and catalog revision, without extending review', async () => {
    const f = fixture(); const before = structuredClone(f.catalog);
    expect(await refreshGatewayCatalog(f.db, f.observed, f.credential, f.clock)).toEqual({ status: 'updated', updatedProfiles: 1 });
    const after = f.docs.get(CATALOG); expect(after.revision).not.toBe(before.revision);
    after.revision = before.revision; after.profiles[0].transport.registryVersion = 'live-v1'; expect(after).toEqual(before);
    expect(f.writes).toEqual([CATALOG]);
  });
  it.each(['price', 'endpoint', 'disabled', 'terms', 'credential', 'manifest', 'expired', 'context', 'missing'] as const)('never promotes %s evidence', async reason => {
    const f = fixture(); let key = f.credential;
    if (reason === 'price') f.observed.models[0].eligibilityStatus = 'PAID';
    if (reason === 'endpoint') f.observed.models[0].endpointTag = 'changed/endpoint';
    if (reason === 'disabled') f.docs.get(f.controlPath).disabled = true;
    if (reason === 'terms') f.docs.get(f.controlPath).termsReviewedUntil = 0;
    if (reason === 'credential') key = 'different-credential';
    if (reason === 'manifest') f.docs.set(REGISTRY, { manifest: { ...f.observed.manifest, version: 'newer-generation' } });
    if (reason === 'expired') f.advance(500001);
    if (reason === 'context') f.observed.models[0].contextWindow = 512;
    if (reason === 'missing') f.docs.set(`${REGISTRY}/chunks/${'a'.repeat(64)}`, { models: [] });
    await refreshGatewayCatalog(f.db, f.observed, key, f.clock); expect(f.writes).toEqual([]);
  });
  it('rechecks expiry after the final asynchronous read', async () => {
    const f = fixture(); f.onRead(() => f.advance(150000));
    await refreshGatewayCatalog(f.db, f.observed, f.credential, f.clock); expect(f.writes).toEqual([]);
  });
  it('is idempotent and never enrolls newly discovered models', async () => {
    const f = fixture(); f.observed.models.push({ ...f.observed.models[0], exactModelId: 'new/model:free' }); f.observed.manifest!.count = 2;
    await refreshGatewayCatalog(f.db, f.observed, f.credential, f.clock);
    expect((await refreshGatewayCatalog(f.db, f.observed, f.credential, f.clock)).status).toBe('unchanged');
    expect(f.docs.get(CATALOG).profiles).toHaveLength(1); expect(f.writes).toHaveLength(1);
  });
});

it('does not renew old account review after a credential rotation and fresh sync', async () => {
 const f = fixture(); const key = 'rotated-test-credential';
 f.observed.manifest!.accountCredentialBinding = registryCredentialBinding(key);
 await refreshGatewayCatalog(f.db, f.observed, key, f.clock); expect(f.writes).toEqual([]);
});
