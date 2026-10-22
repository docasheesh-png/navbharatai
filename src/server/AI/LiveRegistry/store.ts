import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { eligibility } from './eligibility';
import type { CatalogManifest, LiveModelRecord, ModelControl, ModelHealth, RegistryState, RegistryStore, RoutingAudit, SyncLease } from './types';
const key = (id: string) => createHash('sha256').update(id).digest('hex');
const ROOT = 'live_ai_registry';
/** Compact immutable chunks avoid one-write-per-model every five minutes and Firestore's 1MiB limit. */
export class FirestoreRegistryStore implements RegistryStore {
  private routingCache: { state: RegistryState; expires: number } | null = null;
  constructor(private readonly db: Firestore) {}
  private state() { return this.db.collection(ROOT).doc('openrouter'); }
  async read(): Promise<RegistryState> {
    const state = (await this.state().get()).data() ?? {};
    const manifest = (state.manifest ?? null) as CatalogManifest | null;
    const [chunks, controls, health] = await Promise.all([
      manifest ? Promise.all((manifest.chunks ?? []).map(id => this.state().collection('chunks').doc(id).get())) : [],
      this.state().collection('controls').limit(10001).get(),
      this.state().collection('health').limit(10001).get(),
    ]);
    const models = chunks.flatMap(doc => {
      if (!doc.exists || !Array.isArray(doc.data()?.models)) throw new Error('Registry chunk unavailable');
      return doc.data()!.models as LiveModelRecord[];
    }).map(model => ({ ...model, registryVersion: manifest!.version, catalogFetchedAt: manifest!.fetchedAt,
      pricingVerifiedAt: model.eligibilityStatus === 'VERIFIED_FREE' ? manifest!.fetchedAt : 0, metadataExpiresAt: manifest!.expiresAt }));
    if (manifest && (models.length !== manifest.count || models.length > 10000)) throw new Error('Registry generation incomplete');
    if (controls.size > 10000 || health.size > 10000) throw new Error('Registry metadata exceeds limit');
    return { manifest, models,
      controls: Object.fromEntries(controls.docs.map(d => [d.data().modelId, d.data() as ModelControl])),
      health: Object.fromEntries(health.docs.map(d => [d.data().modelId, d.data() as ModelHealth])),
      lastSyncAttemptAt: typeof state.lastSyncAttemptAt === 'number' ? state.lastSyncAttemptAt : null,
      nextSyncAllowedAt: Number(state.nextSyncAllowedAt) || 0, accountCooldownUntil: Number(state.accountCooldownUntil) || 0, accountErrorCode: state.accountErrorCode ?? null,
      lastSyncError: typeof state.lastSyncError === 'string' ? state.lastSyncError : null };
  }
  async routingState(): Promise<RegistryState> {
    const manifest = (await this.state().get()).data()?.manifest as CatalogManifest | undefined;
    if (this.routingCache && this.routingCache.expires > Date.now() && this.routingCache.state.manifest?.version === manifest?.version) return this.routingCache.state;
    const state = await this.read(); this.routingCache = { state, expires: Date.now() + 30000 }; return state;
  }
  async recheck(model: LiveModelRecord, now: number): Promise<boolean> {
    // Transactionally consistent point reads, including independent disable controls: no full scans per dispatch.
    return this.db.runTransaction(async tx => {
      const [state, control, health] = await Promise.all([tx.get(this.state()), tx.get(this.state().collection('controls').doc(key(model.exactModelId))), tx.get(this.state().collection('health').doc(key(model.exactModelId)))]);
      const manifest = state.data()?.manifest as CatalogManifest | undefined;
      const freshNow = Math.max(now, Date.now());
      return manifest?.version === model.registryVersion && manifest.expiresAt > freshNow
        && !(Number(state.data()?.accountCooldownUntil) > freshNow)
        && eligibility(model, control.data() as ModelControl | undefined, health.data() as ModelHealth | undefined, freshNow).status === 'VERIFIED_FREE';
    });
  }
  async claim(now: number, ttlMs: number): Promise<SyncLease | null> {
    const token = randomUUID();
    return this.db.runTransaction(async tx => {
      const current = (await tx.get(this.state())).data() ?? {};
      if (current.lease?.expiresAt > now || current.nextSyncAllowedAt > now) return null;
      const lease = { token, expiresAt: now + ttlMs }; tx.set(this.state(), { lease, lastSyncAttemptAt: now }, { merge: true }); return lease;
    });
  }
  async publish(lease: SyncLease, models: LiveModelRecord[], manifest: CatalogManifest): Promise<void> {
    const chunks: string[] = []; let group: Record<string, unknown>[] = []; let bytes = 0;
    const flush = async () => {
      if (!group.length) return;
      const id = key(JSON.stringify(group)); chunks.push(id);
      // Same content reuses the same document identity. Only new chunks are written.
      const ref = this.state().collection('chunks').doc(id);
      if (!(await ref.get()).exists) await ref.set({ models: group, createdAt: Date.now() });
      group = []; bytes = 0;
    };
    for (const model of [...models].sort((a, b) => a.exactModelId.localeCompare(b.exactModelId))) {
      const { registryVersion: _v, catalogFetchedAt: _f, pricingVerifiedAt: _p, metadataExpiresAt: _e, ...stable } = model;
      const size = Buffer.byteLength(JSON.stringify(stable));
      if (size > 100000) throw new Error('Oversized model record');
      if (bytes + size > 350000) await flush(); group.push(stable); bytes += size;
    }
    await flush(); const published = { ...manifest, chunks };
    await this.db.runTransaction(async tx => {
      const current = (await tx.get(this.state())).data() ?? {};
      if (current.lease?.token !== lease.token || current.lease.expiresAt <= Date.now()) throw new Error('Sync lease expired or replaced');
      if (current.manifest?.fetchedAt > manifest.fetchedAt) throw new Error('Newer catalog already published');
      // Bounded 288-slot audit ring; no infinite version document per polling cycle.
      const slot = String(Math.floor(manifest.fetchedAt / 300000) % 288);
      tx.set(this.state().collection('history').doc(slot), published);
      tx.set(this.state(), { manifest: published, lease: null, lastSyncError: null }, { merge: true });
    });
    this.routingCache = null;
  }
  async fail(lease: SyncLease, at: number, reason: string, retryAt = 0): Promise<void> {
    await this.db.runTransaction(async tx => {
      const current = (await tx.get(this.state())).data() ?? {};
      if (current.lease?.token !== lease.token) return;
      tx.set(this.state(), { lease: null, nextSyncAllowedAt: retryAt, lastSyncAttemptAt: at, lastSyncError: reason.slice(0, 200) }, { merge: true });
    });
  }
  async control(modelId: string, action: 'disable' | 'enable' | 'approve-terms', actor: string, now: number, registryVersion: string, reason: string): Promise<void> {
    const snapshot = await this.read(); const model = snapshot.models.find(m => m.exactModelId === modelId);
    if (!model) throw new Error('MODEL_NOT_FOUND');
    const ref = this.state().collection('controls').doc(key(modelId));
    await this.db.runTransaction(async tx => {
      const [state, previous] = await Promise.all([tx.get(this.state()), tx.get(ref)]);
      if (state.data()?.manifest?.version !== registryVersion) throw new Error('REGISTRY_VERSION_CHANGED');
      const old = previous.data() ?? {};
      const record: ModelControl = { ...(old.codingEvidence ? { codingEvidence: old.codingEvidence } : {}), disabled: action === 'disable' ? true : action === 'enable' ? false : old.disabled === true,
        termsReviewedUntil: action === 'approve-terms' ? now + 7 * 86400000 : Number(old.termsReviewedUntil) || 0,
        endpointTag: action === 'approve-terms' ? model.endpointTag : old.endpointTag ?? null, updatedAt: now, actor, reason };
      tx.set(ref, { ...record, modelId });
      tx.set(this.state().collection('actions').doc(randomUUID()), { ...record, modelId, action, registryVersion });
    });
    this.routingCache = null;
  }
  async quarantine(modelId: string, reason: string, now: number): Promise<void> {
    // Safety quarantine must survive a catalog update occurring during inference.
    await this.state().collection('controls').doc(key(modelId)).set({ modelId, disabled: true, updatedAt: now, actor: 'billing-safety', reason }, { merge: true });
    this.routingCache = null;
  }
  async blockAccount(until: number, code: string): Promise<void> {
    await this.state().set({ accountCooldownUntil: until, accountErrorCode: code }, { merge: true }); this.routingCache = null;
  }
  async record(event: RoutingAudit): Promise<void> {
    console.log(JSON.stringify({ severity: event.outcome === 'failed' ? 'WARNING' : 'INFO', component: 'live-free-router', event: 'FREE_ROUTING_DECISION', ...event }));
    // Bounded sampled audit cache: full structured logs remain the deployment logging system's retention concern.
    const slot = String(parseInt(key(`${event.requestId}-${event.attempt}-${event.outcome}`).slice(0, 8), 16) % 4096);
    await this.state().collection('routing').doc(slot).set(event);
  }
  async imageState(): Promise<{ snapshot: import('./imageDiscovery').ImageDiscoverySnapshot | null; lastError: string | null }> {
    const value = (await this.db.collection(ROOT).doc('openrouter-images').get()).data() ?? {};
    return { snapshot: value.snapshot ?? null, lastError: value.lastError ?? null };
  }
  async claimImages(now: number): Promise<SyncLease | null> {
    const ref = this.db.collection(ROOT).doc('openrouter-images');
    return this.db.runTransaction(async tx => {
      const value = (await tx.get(ref)).data() ?? {};
      if ((value.lease?.expiresAt ?? 0) > now || (value.nextAllowedAt ?? 0) > now) return null;
      const lease = { token: randomUUID(), expiresAt: now + 120000 }; tx.set(ref, { lease }, { merge: true }); return lease;
    });
  }
  async publishImages(lease: SyncLease, snapshot: unknown, now: number): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 700000) throw new Error('Image snapshot too large');
    const ref = this.db.collection(ROOT).doc('openrouter-images');
    await this.db.runTransaction(async tx => {
      const value = (await tx.get(ref)).data() ?? {};
      if (value.lease?.token !== lease.token || value.lease.expiresAt <= Date.now()) throw new Error('Image lease expired');
      tx.set(ref, { snapshot, lastError: null, lastSuccessfulSyncAt: now, nextAllowedAt: now + 3600000, lease: null }, { merge: true });
    });
  }
  async failImages(lease: SyncLease, now: number, retryAt = now + 300000): Promise<void> {
    const ref = this.db.collection(ROOT).doc('openrouter-images');
    await this.db.runTransaction(async tx => {
      const value = (await tx.get(ref)).data() ?? {};
      if (value.lease?.token === lease.token) tx.set(ref, { lastError: 'Image catalog discovery failed; previous snapshot retained.', nextAllowedAt: Math.max(now + 300000, retryAt), lease: null }, { merge: true });
    });
  }
  async adminHistory(): Promise<{ history: CatalogManifest[]; recentRouting: RoutingAudit[] }> {
    const [history, routing] = await Promise.all([
      this.state().collection('history').orderBy('fetchedAt', 'desc').limit(30).get(),
      this.state().collection('routing').orderBy('at', 'desc').limit(30).get(),
    ]);
    return { history: history.docs.map(d => d.data() as CatalogManifest), recentRouting: routing.docs.map(d => d.data() as RoutingAudit) };
  }
  async updateHealth(modelId: string, update: ModelHealth): Promise<void> {
    await this.state().collection('health').doc(key(modelId)).set({ ...update, modelId });
    if (this.routingCache) this.routingCache.state.health[modelId] = update;
  }
}
