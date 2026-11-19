import type { ObjectCategory } from '../../lib/objectCatalogTypes';
import { ASSET_LIMITS, candidateMatches, type AssetCandidate, type AssetRequirement } from './assetPolicy';
import type { AssetProvider } from './assetEngine';
import { assetDownloadUrl } from './assetDownload';
import { safeGltfResourcePath } from './gltfBundle';
import { reviewedCatalogue } from './reviewedCatalogue';
import { REVIEWED_LIBRARY_EXPANSION } from './reviewedExpansion';
import { REVIEWED_LIBRARY_BATCH_2 } from './reviewedLibraryBatch2';

export const GAME_ASSET_PROVIDERS = ['polyhaven', 'kenney', 'quaternius', 'kaykit', 'github', 'sketchfab'] as const;
export type GameAssetProviderId = typeof GAME_ASSET_PROVIDERS[number];
export interface ReviewedAsset extends AssetCandidate {
  /** Curated library classification; no gameplay or device certification. */
  libraryCategory?: ObjectCategory;
  provider: GameAssetProviderId;
  /** Exact origins approved with the pack, never derived from a user prompt or provider response. */
  downloadOrigins: readonly string[];
  /** Review includes in-game AND source/export redistribution; no paid/EXTRA pack entries. */
  review: { reviewer: string; evidenceRevision: string; freeDownload: true };
  /** A live service obligation, independent of the asset's copyright licence. */
  serviceCredit?: string;
  /** Licensed derivative shipped privately with the server image; read only on demand. */
  packaged?: true;
  format?: 'glb' | 'gltf' | 'glb-resources';
  /** Reviewed source AND derived output hashes are pinned; no automatic unreviewed rewrite. */
  optimization?: 'compact-v1' | 'animation-selection-v1';
  retainedAnimations?: readonly string[];
  /** Node names the runtime removes on load (weapons a boxer does not hold). Reviewed per entry; bytes unchanged. */
  hiddenNodes?: readonly string[];
  sourceSha256?: string;
  /** Exact reviewed byte length of the served GLB (the bytes `sha256` pins). Undeclared entries count as the 5 MiB worst case. */
  bytes?: number;
  resources?: readonly { path: string; url: string; sha256: string }[];
}

/** Exact asset revisions verified locally; feature activation remains independently default OFF. */
export const REVIEWED_GAME_ASSETS: readonly ReviewedAsset[] = [...reviewedCatalogue, ...REVIEWED_LIBRARY_EXPANSION, ...REVIEWED_LIBRARY_BATCH_2];

/**
 * Admin decision 2026-11-19: the library is bounded by STORAGE, not by a model count. The old 64-entry cap was
 * this same 320 MiB expressed as 64 × the 5 MiB per-model ceiling; small low-poly models (~200 KB) made it a
 * count limit that left the budget 90% unused. An entry without a reviewed size still costs the full 5 MiB.
 */
export const CATALOGUE_STORAGE_BUDGET_BYTES = 320 * 1024 * 1024;
/** Bounds per-request linear scans; far above what the storage budget admits for real assets. */
export const CATALOGUE_MAX_ENTRIES = 2048;
export function catalogueStorageBytes(assets: readonly ReviewedAsset[]): number {
  return assets.reduce((sum, c) => sum + (c.bytes ?? ASSET_LIMITS.bytes), 0);
}

export function validateCatalogue(assets: readonly ReviewedAsset[]): void {
  if (assets.length > CATALOGUE_MAX_ENTRIES) throw new Error('Catalogue exceeds the entry ceiling');
  for (const c of assets) if (c.bytes !== undefined && (!Number.isSafeInteger(c.bytes) || c.bytes < 28 || c.bytes > ASSET_LIMITS.bytes)) throw new Error('Unreviewed asset size');
  if (catalogueStorageBytes(assets) > CATALOGUE_STORAGE_BUDGET_BYTES) throw new Error('Catalogue exceeds the 320 MiB cache/storage budget');
  const ids = new Set<string>();
  for (const c of assets) {
    if (!GAME_ASSET_PROVIDERS.includes(c.provider) || !c.review?.reviewer || !c.review.evidenceRevision || c.review.freeDownload !== true
      || !c.subjects.length || c.subjects.length > 16 || !c.subjects.every(s => /^[a-z][a-z -]{0,63}$/.test(s))
      || !candidateMatches(c, { subject: c.subjects[0] }) || c.downloadOrigins.length > 4) throw new Error('Unreviewed catalogue entry');
    if (c.packaged && (c.id !== 'eagle-flying' || c.provider !== 'quaternius' || c.sha256 !== '4e8915ef238773ca0b11576fd71dddb49449ce0aa6b575f0fce9e65e79e03f75')) throw new Error('Unreviewed packaged model');
    assetDownloadUrl(c.downloadUrl, new Set(c.downloadOrigins));
    for (const origin of c.downloadOrigins) if (new URL(origin).origin !== origin) throw new Error('Invalid reviewed origin');
    if (c.optimization !== undefined && (!['compact-v1', 'animation-selection-v1'].includes(c.optimization) || !/^[a-f0-9]{64}$/.test(c.sourceSha256 ?? ''))) throw new Error('Unreviewed optimization source/version');
    if (c.optimization === 'animation-selection-v1' && ((c.format !== undefined && c.format !== 'glb') || !c.retainedAnimations?.length
      || c.retainedAnimations.length > 16 || new Set(c.retainedAnimations).size !== c.retainedAnimations.length
      || c.retainedAnimations.some(n => !n || n.length > 128)
      || c.animations.some(n => !c.retainedAnimations!.includes(n)))) throw new Error('Unreviewed animation selection');
    if (['gltf', 'glb-resources'].includes(c.format ?? '') && (!/^[a-f0-9]{64}$/.test(c.sourceSha256 ?? '') || !c.resources?.length)) throw new Error('Unreviewed glTF sources');
    if ((c.resources?.length ?? 0) > 16 || new Set(c.resources?.map(r => r.path)).size !== (c.resources?.length ?? 0)) throw new Error('Resource budget or duplicates');
    for (const r of c.resources ?? []) {
      if (!safeGltfResourcePath(r.path) || !/^[a-f0-9]{64}$/.test(r.sha256)) throw new Error('Unreviewed resource');
      assetDownloadUrl(r.url, new Set(c.downloadOrigins));
    }
    for (const raw of [c.downloadUrl, c.sourceUrl, c.license.evidenceUrl, ...(c.resources ?? []).map(r => r.url)]) {
      const u = new URL(raw);
      if (u.username || u.password || u.search || u.hash || u.protocol !== 'https:') throw new Error('Private or expiring URL in public provenance');
    }
    if (c.hiddenNodes !== undefined && (c.hiddenNodes.length > 32 || !c.hiddenNodes.every(n => /^[A-Za-z0-9_.-]{1,64}$/.test(n)))) throw new Error('Unreviewed hidden nodes');
    if (c.provider === 'sketchfab') throw new Error('Sketchfab requires a separately authorized download adapter; signed URLs cannot be a catalogue source');
    const key = `${c.provider}:${c.id}:${c.revision}`;
    if (ids.has(key)) throw new Error('Duplicate asset revision'); ids.add(key);
  }
}

export interface ProviderJsonTransport { get(url: string, signal: AbortSignal): Promise<unknown> }
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
/** Walk only bounded JSON metadata. A matching URL must be a documented file leaf with positive size. */
export function polyHavenContainsFile(tree: unknown, downloadUrl: string): boolean {
  const pending: unknown[] = [tree]; let visited = 0;
  while (pending.length) {
    if (++visited > 10_000) return false;
    const node = object(pending.pop()); if (!node) continue;
    if (node.url === downloadUrl && typeof node.size === 'number' && node.size > 0 && node.size <= 5 * 1024 * 1024) return true;
    pending.push(...Object.values(node));
  }
  return false;
}

/**
 * Registrations use reviewed immutable catalogue entries. Poly Haven rechecks the authorized API on
 * a cache miss; pack providers use their curated direct downloads, never scrape gated pack pages.
 * Sketchfab has no active entries until an authorized interface and token scope are reviewed.
 */
export function createAssetProviders(catalogue: readonly ReviewedAsset[], polyHaven?: ProviderJsonTransport): AssetProvider[] {
  validateCatalogue(catalogue);
  return GAME_ASSET_PROVIDERS.map(id => ({
    id,
    async search(requirement: AssetRequirement, signal: AbortSignal) {
      signal.throwIfAborted();
      const matches = catalogue.filter(c => c.provider === id && candidateMatches(c, requirement)).slice(0, 8);
      if (id !== 'polyhaven') return matches;
      if (!polyHaven) return [];
      const available: ReviewedAsset[] = [];
      for (const c of matches.slice(0, 3)) {
        if (!/^[a-z0-9_]+$/.test(c.id) || !c.serviceCredit) continue;
        const info = object(await polyHaven.get(`https://api.polyhaven.com/info/${c.id}`, signal));
        if (info?.type !== 2 || info.files_hash !== c.revision) continue;
        if (polyHavenContainsFile(await polyHaven.get(`https://api.polyhaven.com/files/${c.id}`, signal), c.downloadUrl)) available.push(c);
      }
      return available;
    },
  }));
}
