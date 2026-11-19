import { describe, it, expect, vi } from 'vitest';
import { ASSET_LIMITS, licenseAccepted, type AssetLicense } from './assetPolicy';
import { CATALOGUE_STORAGE_BUDGET_BYTES, catalogueStorageBytes, validateCatalogue, REVIEWED_GAME_ASSETS, type ReviewedAsset } from './providers';
import { createDurableAssetCache } from './assetCache';
import { acquireGameAsset } from './assetEngine';
import { syntheticGlb, syntheticCandidate } from '../../../../tests/fixtures/gameAssetFixtures';

const many = (n: number, bytes?: number): ReviewedAsset[] => {
  const base = syntheticCandidate(syntheticGlb());
  return Array.from({ length: n }, (_, i) => ({ ...base, id: `fixture-${i}`, sha256: i.toString(16).padStart(64, '0'), ...(bytes !== undefined ? { bytes } : {}) }));
};

describe('game library storage budget (admin decision 2026-11-19: bytes, not a 64-model count)', () => {
  it('admits far more than 64 small reviewed models — the old count cap is gone', () => {
    expect(() => validateCatalogue(many(65, 200_000))).not.toThrow();
    expect(() => validateCatalogue(many(600, 200_000))).not.toThrow();
  });
  it('still holds the 320 MiB ceiling, counting an undeclared size as the 5 MiB worst case', () => {
    expect(CATALOGUE_STORAGE_BUDGET_BYTES / ASSET_LIMITS.bytes).toBe(64);
    expect(() => validateCatalogue(many(64))).not.toThrow();
    expect(() => validateCatalogue(many(65))).toThrow('storage budget');
    expect(() => validateCatalogue(many(1700, 200_000))).toThrow('storage budget');
  });
  it('refuses a declared size outside the per-model limits', () => {
    for (const bytes of [0, 27, 1.5, ASSET_LIMITS.bytes + 1]) expect(() => validateCatalogue(many(1, bytes))).toThrow('size');
  });
  it('the shipped catalogue fits the budget', () => {
    expect(catalogueStorageBytes(REVIEWED_GAME_ASSETS)).toBeLessThanOrEqual(CATALOGUE_STORAGE_BUDGET_BYTES);
  });
  it('bytes that disagree with the reviewed size are rejected by the cache and the engine', async () => {
    const bytes = syntheticGlb();
    const lying = { ...syntheticCandidate(bytes), bytes: bytes.byteLength + 1 };
    const store = new Map<string, Uint8Array>();
    const cache = createDurableAssetCache({ read: async k => store.get(k) ?? null, write: async (k, b) => { store.set(k, b); } }, [lying]);
    await expect(cache.put({ schema: 1, candidate: lying, sha256: lying.sha256, path: 'x', model: { bytes: 0, triangles: 0, animations: [] } }, bytes)).rejects.toThrow('Unapproved');
    const persist = vi.fn();
    const out = await acquireGameAsset({ subject: 'car' }, {
      cache: { find: async () => [], read: async () => null, put: async () => {} },
      providers: [{ id: lying.provider, search: async () => [lying] }],
      download: async () => bytes, parse: async () => {}, persist,
    }, new AbortController().signal);
    expect(out.kind).toBe('procedural');
    expect(persist).not.toHaveBeenCalled();
    const honest = { ...lying, bytes: bytes.byteLength };
    const ok = await acquireGameAsset({ subject: 'car' }, {
      cache: { find: async () => [], read: async () => null, put: async () => {} },
      providers: [{ id: honest.provider, search: async () => [honest] }],
      download: async () => bytes, parse: async () => {}, persist,
    }, new AbortController().signal);
    expect(ok.kind).toBe('model');
  });
});

describe('asset licences (admin decision 2026-11-19: CC0 + CC-BY-4.0 + MIT)', () => {
  const lic = (spdx: string, attribution: string): AssetLicense => ({ spdx: spdx as AssetLicense['spdx'], evidenceUrl: 'https://x.example/LICENSE', reviewedAt: '2026-11-19', author: 'Kenney', attribution, commercial: true, redistributeInGame: true, redistributeSource: true });
  it('accepts MIT only with its copyright notice, like CC-BY', () => {
    expect(licenseAccepted(lic('MIT', 'Copyright (c) 2023 Kenney'))).toBe(true);
    expect(licenseAccepted(lic('MIT', ''))).toBe(false);
    expect(licenseAccepted(lic('CC0-1.0', ''))).toBe(true);
  });
  it('still refuses unlicensed, non-commercial and share-alike sources', () => {
    for (const spdx of ['', 'NOASSERTION', 'CC-BY-NC-4.0', 'CC-BY-SA-4.0', 'GPL-3.0', 'proprietary']) expect(licenseAccepted(lic(spdx, 'x'))).toBe(false);
  });
});
