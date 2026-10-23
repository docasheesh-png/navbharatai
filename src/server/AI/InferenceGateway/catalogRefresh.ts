/** Refreshes machine observations, never human review or account/budget authority. */
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { GatewayCatalog } from './authorityStore';
import type { RegistryState, ModelControl, ModelHealth } from '../LiveRegistry/types';
import { eligibility } from '../LiveRegistry/eligibility';
import { registryCredentialBinding } from '../LiveRegistry/sync';
import { gatewayTextCredentialBinding } from './textTransport';
import { evidenceBinding } from './profiles';
const CATALOG = 'free_chat_chain/gateway_catalog';
const REGISTRY = 'live_ai_registry/openrouter';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown) => evidenceBinding(a) === evidenceBinding(b);
export async function refreshGatewayCatalog(
  db: Pick<Firestore, 'doc' | 'runTransaction'>,
  observed: RegistryState,
  credential: string,
  now: () => number = Date.now,
): Promise<{ status: 'updated' | 'unchanged' | 'unavailable'; updatedProfiles: number }> {
  if (!credential || !observed.manifest || observed.models.length > 10000) return { status: 'unavailable', updatedProfiles: 0 };
  return db.runTransaction(async tx => {
    const [catalogDoc, registryDoc] = await Promise.all([tx.get(db.doc(CATALOG)), tx.get(db.doc(REGISTRY))]);
    const catalog = catalogDoc.data() as GatewayCatalog | undefined;
    const registry = registryDoc.data(); const manifest = registry?.manifest;
    const at = now();
    if (!catalog || catalog.kind !== 'gateway_catalog' || catalog.version !== 1 || catalog.enabled !== true
      || !Array.isArray(catalog.profiles) || catalog.profiles.length > 32 || !catalog.profiles.length
      || catalog.issuedAtMs > at || catalog.expiresAtMs <= at
      || !manifest || !same(manifest, observed.manifest) || manifest.expiresAt <= at
      || !Array.isArray(manifest.chunks) || !manifest.chunks.length || manifest.chunks.length > 128
      || manifest.chunks.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
      || manifest.accountVerified !== true || manifest.accountCredentialBinding !== registryCredentialBinding(credential)) {
      return { status: 'unavailable' as const, updatedProfiles: 0 };
    }
    // Bind model rows to the immutable published chunks, not merely a caller's version string.
    const chunks = await Promise.all(manifest.chunks.map((id: string) => tx.get(db.doc(`${REGISTRY}/chunks/${id}`))));
    const rows = chunks.flatMap(chunk => Array.isArray(chunk.data()?.models) ? chunk.data()!.models : []);
    if (rows.length !== manifest.count || rows.length > 10000) return { status: 'unavailable' as const, updatedProfiles: 0 };
    const models = rows.map(row => ({ ...row, registryVersion: manifest.version, catalogFetchedAt: manifest.fetchedAt,
      pricingVerifiedAt: row.eligibilityStatus === 'VERIFIED_FREE' ? manifest.fetchedAt : 0, metadataExpiresAt: manifest.expiresAt }));
    const selected = catalog.profiles.filter(entry => entry.transport.provider === 'OPENROUTER');
    const live = await Promise.all(selected.map(async entry => {
      const id = entry.transport.model;
      const [control, health] = await Promise.all([
        tx.get(db.doc(`${REGISTRY}/controls/${hash(id)}`)), tx.get(db.doc(`${REGISTRY}/health/${hash(id)}`)),
      ]);
      return { entry, control: control.data() as ModelControl | undefined, health: health.data() as ModelHealth | undefined };
    }));
    // A slow final read cannot renew an expired approval or stale registry generation.
    const fresh = now();
    if (catalog.expiresAtMs <= fresh || manifest.expiresAt <= fresh) return { status: 'unavailable' as const, updatedProfiles: 0 };
    const updates = new Map<string, GatewayCatalog['profiles'][number]>();
    for (const { entry, control, health } of live) {
      if (entry.transport.provider !== 'OPENROUTER' || entry.transport.credentialBinding !== gatewayTextCredentialBinding(credential) || entry.reviewedAtMs > fresh || entry.expiresAtMs <= fresh) continue;
      const model = models.find(row => row.exactModelId === entry.transport.model);
      if (!model || model.registryVersion !== manifest.version || model.endpointTag !== entry.transport.endpointTag
        || model.metadataExpiresAt <= fresh || eligibility(model, control, health, fresh).status !== 'VERIFIED_FREE'
        || entry.profile.modelId !== model.exactModelId || entry.profile.charging !== 'verified-free-no-overage'
        || (registry.accountCooldownUntil ?? 0) > fresh) continue;
      // No changed endpoint, new model, capability expansion, credential, or review renewal.
      if (!entry.profile.capabilities.every(cap => cap.kind === 'text' && cap.maxContextTokens <= model.contextWindow
        && (model.maximumOutputTokens === null || cap.maxOutputTokens <= model.maximumOutputTokens)
        && model.supportedCapabilities.includes('max_tokens'))) continue;
      if (entry.transport.registryVersion !== manifest.version) {
        updates.set(entry.profile.id, { ...entry, transport: { ...entry.transport, registryVersion: manifest.version } });
      }
    }
    if (!updates.size) return { status: 'unchanged' as const, updatedProfiles: 0 };
    tx.set(db.doc(CATALOG), { ...catalog, revision: randomUUID(), profiles: catalog.profiles.map(entry => updates.get(entry.profile.id) ?? entry) });
    return { status: 'updated' as const, updatedProfiles: updates.size };
  });
}
