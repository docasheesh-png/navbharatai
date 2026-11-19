/** Library batch 2 (admin request 2026-11-19): 50 pinned CC0/MIT models; evidence in docs/game-engine/library-batch-2026-11-19.md. */
import { describe, it, expect } from 'vitest';
import { REVIEWED_LIBRARY_BATCH_2 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch2';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { searchGameLibrary } from '../src/server/AgentV3/gameAssets/gameLibrary';
import { readFileSync } from 'node:fs';

const admission = JSON.parse(readFileSync('docs/game-engine/asset-candidates/2026-11-19-admission.json', 'utf8')) as { results: { id: string }[] };

const subjects = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map(r => r.subject).sort();

describe('library batch 2', () => {
  it('every entry is pinned, sized, licensed and was admitted live', () => {
    validateCatalogue(REVIEWED_LIBRARY_BATCH_2);
    expect(REVIEWED_LIBRARY_BATCH_2.length).toBe(50);
    const admitted = new Map(admission.results.map(r => [r.id, r]));
    for (const a of REVIEWED_LIBRARY_BATCH_2) {
      expect(a.downloadUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/(KayKit-Game-Assets|KenneyNL)\/[^/]+\/[0-9a-f]{40}\//);
      expect(a.bytes).toBeGreaterThan(0);
      expect(a.libraryCategory).toBeTruthy();
      expect(a.subjects).toHaveLength(1);
      expect(a.provider === 'kenney' ? a.license.spdx === 'MIT' && /^Copyright \(c\) \d{4} Kenney$/.test(a.license.attribution) : a.license.spdx === 'CC0-1.0').toBe(true);
      const proof = admitted.get(a.id) as { verdict: string; sha256: string; bytes: number; proofs: { animated: boolean }[] } | undefined;
      expect(proof?.verdict, a.id).toBe('admitted');
      expect(proof!.sha256).toBe(a.sha256); expect(proof!.bytes).toBe(a.bytes);
      if (a.animationRoles) expect(proof!.proofs.every(p => p.animated)).toBe(true);
    }
  });
  it('real game prompts now get the new models, plurals and Hindi included', () => {
    expect(subjects('endless runner where the player collects coins')).toEqual(['coin']);
    expect(subjects('ek bike racing game, मोटरसाइकिल chalao')).toEqual(['motorcycle']);
    expect(subjects('medieval village with a castle, a church and a bridge')).toEqual(['bridge', 'castle', 'church']);
    expect(subjects('tower defense game with skeletons')).toEqual(['skeleton', 'tower']);
    expect(gameAssetRequirements('running skeletons', REVIEWED_GAME_ASSETS)).toEqual([{ subject: 'skeleton', animation: 'run' }]);
    expect(subjects('a bedroom with a bed, a sofa and a lamp')).toEqual(['bed', 'lamp', 'sofa']);
  });
  it('generic words do not pull a model nobody asked for', () => {
    expect(subjects('a stock market dashboard game')).toEqual([]);
    expect(subjects('an app with a feature flag')).toEqual([]);
    expect(subjects('collect the shield powerup')).toEqual([]);
    expect(subjects('3D game with a river and a road')).toEqual([]);
  });
  it('the librarian lists them by category', () => {
    expect(searchGameLibrary({ query: 'motorcycle' }).entries.some(e => e.id.includes('lib2-motorcycle'))).toBe(true);
    expect(searchGameLibrary({ category: 'interior', limit: 20 }).total).toBeGreaterThanOrEqual(9);
  });
});
