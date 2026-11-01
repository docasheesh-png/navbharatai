import { createHash } from 'node:crypto';
import { candidateMatches, validateGlb, type AssetCandidate, type AssetRequirement, type ValidatedModel } from './assetPolicy.ts';

export interface AssetProvider {
  id: string;
  /** A bounded, authorized API or reviewed catalogue; never a general web scraper. */
  search(requirement: AssetRequirement, signal: AbortSignal): Promise<readonly AssetCandidate[]>;
}
export interface AssetManifestEntry {
  schema: 1;
  candidate: AssetCandidate;
  model: ValidatedModel;
  path: string;
  sha256: string;
}
export interface AssetCache {
  /** Metadata only; callers revalidate licenses and content hashes on every hit. */
  find(requirement: AssetRequirement): Promise<readonly AssetManifestEntry[]>;
  read(sha256: string): Promise<Uint8Array | null>;
  put(entry: AssetManifestEntry, bytes: Uint8Array): Promise<void>;
}
export interface AssetEngineDependencies {
  providers: readonly AssetProvider[];
  cache: AssetCache;
  download(candidate: AssetCandidate, signal: AbortSignal): Promise<Uint8Array>;
  /** Must load the model using the supported runtime and reject invalid scenes/animations. */
  parse(bytes: Uint8Array, requirement: AssetRequirement): Promise<void>;
  /** Must acknowledge durable project storage AND sandbox materialization before returning. */
  persist(entry: AssetManifestEntry, bytes: Uint8Array): Promise<void>;
}
export type AssetOutcome =
  | { kind: 'model'; entry: AssetManifestEntry; cacheHit: boolean; downloadedBytes: number }
  | { kind: 'procedural'; reason: string };

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

/**
 * Cache-first build-time acquisition. No provider failure can deliver a broken model. Storage and
 * parse acknowledgements are prerequisites for handing a local URL to the builder. The caller keeps
 * its existing real/lite procedural path on every fallback. No AI or paid service is used here.
 */
export async function acquireGameAsset(
  requirement: AssetRequirement,
  deps: AssetEngineDependencies,
  signal: AbortSignal,
): Promise<AssetOutcome> {
  const inspect = async (candidate: AssetCandidate, bytes: Uint8Array): Promise<AssetManifestEntry> => {
    signal.throwIfAborted();
    if (!candidateMatches(candidate, requirement) || hash(bytes) !== candidate.sha256) throw new Error('Unverified asset');
    const model = validateGlb(bytes);
    if (requirement.animation && !model.animations.includes(candidate.animationRoles?.[requirement.animation] ?? requirement.animation)) throw new Error('Missing animation');
    await deps.parse(bytes, { ...requirement, ...(requirement.animation ? { animation: candidate.animationRoles?.[requirement.animation] ?? requirement.animation } : {}) });
    signal.throwIfAborted();
    return { schema: 1, candidate, model, sha256: candidate.sha256, path: `public/game-assets/${candidate.sha256}.glb` };
  };
  try {
    const cached = await deps.cache.find(requirement);
    for (const entry of cached.slice(0, 8)) {
      if (signal.aborted) return { kind: 'procedural', reason: 'cancelled' };
      if (!candidateMatches(entry.candidate, requirement)) continue;
      try {
        if (entry.sha256 !== entry.candidate.sha256) continue;
        const bytes = await deps.cache.read(entry.sha256);
        if (!bytes) continue;
        const verified = await inspect(entry.candidate, bytes);
        await deps.persist(verified, bytes);
        return { kind: 'model', entry: verified, cacheHit: true, downloadedBytes: 0 };
      } catch { /* A corrupt cache entry is not proof of a usable model. */ }
    }
  } catch { /* Cache outage leaves live acquisition available. */ }
  let attempts = 0;
  for (const provider of deps.providers.slice(0, 8)) {
    if (signal.aborted) break;
    try {
      const candidates = await provider.search(requirement, signal);
      for (const candidate of candidates.slice(0, 8)) {
        if (signal.aborted) break;
        if (candidate.provider !== provider.id || !candidateMatches(candidate, requirement)) continue;
        if (++attempts > 3) return { kind: 'procedural', reason: 'download budget exhausted' };
        try {
          const bytes = await deps.download(candidate, signal);
          const entry = await inspect(candidate, bytes);
          await deps.persist(entry, bytes);
          try { await deps.cache.put(entry, bytes); } catch { /* Project is durable; reusable caching is optional. */ }
          return { kind: 'model', entry, cacheHit: false, downloadedBytes: bytes.byteLength };
        } catch { /* Next exact subject candidate, never an unrelated substitute. */ }
      }
    } catch { /* Provider isolation: a failed source does not break the game. */ }
  }
  return { kind: 'procedural', reason: signal.aborted ? 'cancelled' : 'no verified compatible model' };
}
