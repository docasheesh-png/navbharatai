import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Lease, Snapshot, Store, SurplusManagerState, SurplusModelControls } from './types';
import { isSurplusModelId, SURPLUS_MAX_MODELS, SURPLUS_MAX_OFFERS, SURPLUS_MAX_SNAPSHOT_BYTES, SURPLUS_METADATA_FRESH_MS, validSurplusUniverse } from './config';
export const SURPLUS_DOCUMENT = 'live_ai_registry/surplus-metadata';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/** Missing legacy controls are the empty revision, never implicit quality approval. */
export function readSurplusModelControls(raw: unknown): SurplusModelControls | null {
  if (raw === undefined) return { revision: 0, disabledModels: [], updatedAt: null, reason: null };
  if (!record(raw) || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0
      || !Array.isArray(raw.disabledModels) || raw.disabledModels.length > SURPLUS_MAX_MODELS
      || !raw.disabledModels.every(isSurplusModelId) || new Set(raw.disabledModels).size !== raw.disabledModels.length
      || !(raw.updatedAt === null || time(raw.updatedAt))
      || !(raw.reason === null || typeof raw.reason === 'string' && raw.reason.trim().length >= 10 && raw.reason.length <= 500)
      || raw.revision === 0 && raw.disabledModels.length > 0
      || (raw.revision as number) > 0 && (raw.updatedAt === null || raw.reason === null)) return null;
  return { revision: raw.revision as number, disabledModels: [...raw.disabledModels], updatedAt: raw.updatedAt as number | null, reason: raw.reason as string | null };
}
function boundedSnapshot(raw: unknown): raw is Snapshot {
  return record(raw) && typeof raw.version === 'string' && !!raw.version && raw.version.length <= 120
    && validSurplusUniverse(raw.models) && Array.isArray(raw.offers) && raw.offers.length <= SURPLUS_MAX_OFFERS
    && [raw.startedAt, raw.observedAt, raw.expiresAt].every(time)
    && Buffer.byteLength(JSON.stringify(raw)) <= SURPLUS_MAX_SNAPSHOT_BYTES;
}
/** Exactly one fixed document; no credentials, user/build data, history or subcollections. */
export class SurplusStore implements Store {
  constructor(private readonly db: Pick<Firestore, 'doc' | 'runTransaction'>, private readonly clock = Date.now) {}
  private ref() { return this.db.doc(SURPLUS_DOCUMENT); }
  async inspect(): Promise<SurplusManagerState> {
    const state = (await this.ref().get()).data() ?? {};
    const controls = readSurplusModelControls(state.controls);
    return { snapshot: boundedSnapshot(state.snapshot) ? state.snapshot : null, controls,
      lastAttemptAt: time(state.lastAttemptAt) ? state.lastAttemptAt : null,
      lastSuccessAt: time(state.lastSuccessAt) ? state.lastSuccessAt : null,
      nextAllowedAt: time(state.nextAllowedAt) ? state.nextAllowedAt : null,
      lastError: !controls ? 'invalid_control_state' : state.lastError === 'metadata_unavailable' ? 'metadata_unavailable' : null };
  }
  async read(configuredModels?: string[]): Promise<Snapshot | null> {
    const { snapshot, controls } = await this.inspect();
    if (!snapshot || !controls || configuredModels !== undefined && !validSurplusUniverse(configuredModels)) return null;
    const models = configuredModels ? snapshot.models.filter(model => configuredModels.includes(model)) : snapshot.models;
    if (!models.length) return null;
    // Applied on every read, not only after the next poll. Keep the full observed
    // universe visible but never offer a manually disabled model to the selector.
    return { ...snapshot, models, expiresAt: Math.min(snapshot.expiresAt, snapshot.startedAt + SURPLUS_METADATA_FRESH_MS), controlRevision: controls.revision,
      offers: snapshot.offers.filter(offer => record(offer) && models.includes(offer.model) && !controls.disabledModels.includes(offer.model)) };
  }
  async claim(now: number, intervalMs: number): Promise<Lease | null> {
    if (!time(now) || !Number.isSafeInteger(intervalMs) || intervalMs !== SURPLUS_METADATA_FRESH_MS) throw new Error('Invalid Surplus sync configuration');
    return this.db.runTransaction(async tx => {
      const state = (await tx.get(this.ref())).data() ?? {};
      if (state.lease?.expiresAt > now || state.nextAllowedAt > now) return null;
      const lease = { token: randomUUID(), expiresAt: now + 120_000 };
      tx.set(this.ref(), { lease, nextAllowedAt: now + intervalMs, lastAttemptAt: now }, { merge: true });
      return lease;
    });
  }
  async publish(lease: Lease, snapshot: Snapshot): Promise<void> {
    if (!boundedSnapshot(snapshot) || snapshot.expiresAt > snapshot.startedAt + SURPLUS_METADATA_FRESH_MS) throw new Error('Surplus snapshot exceeds bound');
    await this.db.runTransaction(async tx => {
      const state = (await tx.get(this.ref())).data() ?? {}, now = this.clock();
      if (state.lease?.token !== lease.token || state.lease.expiresAt <= now || snapshot.expiresAt <= now
          || snapshot.observedAt > now || snapshot.startedAt > snapshot.observedAt
          || state.snapshot?.startedAt > snapshot.startedAt) throw new Error('Surplus snapshot fence rejected');
      tx.set(this.ref(), { snapshot, lease: null, lastSuccessAt: now, lastError: null }, { merge: true });
    });
  }
  async fail(lease: Lease): Promise<void> {
    await this.db.runTransaction(async tx => {
      if ((await tx.get(this.ref())).data()?.lease?.token !== lease.token) return;
      // Preserve the previous snapshot's original age. Failure never renews freshness.
      tx.set(this.ref(), { lease: null, lastError: 'metadata_unavailable' }, { merge: true });
    });
  }
  async control(modelId: string, action: 'disable' | 'enable', expectedRevision: number, snapshotVersion: string, reason: string): Promise<void> {
    if (!isSurplusModelId(modelId) || !['disable', 'enable'].includes(action)
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER
        || typeof snapshotVersion !== 'string' || !snapshotVersion || snapshotVersion.length > 120
        || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500) throw new Error('INVALID_SURPLUS_CONTROL');
    await this.db.runTransaction(async tx => {
      const state = (await tx.get(this.ref())).data() ?? {}, controls = readSurplusModelControls(state.controls);
      if (!controls || controls.revision !== expectedRevision || state.snapshot?.version !== snapshotVersion) throw new Error('REGISTRY_VERSION_CHANGED');
      if (!boundedSnapshot(state.snapshot) || !state.snapshot.models.includes(modelId)) throw new Error('INVALID_SURPLUS_CONTROL');
      const disabled = new Set(controls.disabledModels);
      if (action === 'disable') disabled.add(modelId); else disabled.delete(modelId);
      if (disabled.size > SURPLUS_MAX_MODELS) throw new Error('INVALID_SURPLUS_CONTROL');
      // Only manual exclusions change. Removing one never grants a review, key or pilot.
      tx.set(this.ref(), { controls: { revision: controls.revision + 1, disabledModels: [...disabled].sort(), updatedAt: this.clock(), reason: reason.trim() } }, { merge: true });
    });
  }
}
