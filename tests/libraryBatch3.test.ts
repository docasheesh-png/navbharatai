/** Library batch 3 (admin request 2026-11-19): 50 pinned CC0/MIT models — food, kitchen, horror, sci-fi base, town, medieval. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REVIEWED_LIBRARY_BATCH_3 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch3';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { searchGameLibrary } from '../src/server/AgentV3/gameAssets/gameLibrary';

const admission = JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-3-admission.json', 'utf8')) as { results: { id: string; verdict: string; sha256: string; bytes: number }[] };
const subjects = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map(r => r.subject).sort();

describe('library batch 3', () => {
  it('every entry is pinned, sized, licensed and was admitted live', () => {
    validateCatalogue(REVIEWED_LIBRARY_BATCH_3);
    expect(REVIEWED_LIBRARY_BATCH_3.length).toBe(50);
    const admitted = new Map(admission.results.map(r => [r.id, r]));
    for (const a of REVIEWED_LIBRARY_BATCH_3) {
      expect(a.downloadUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/(KayKit-Game-Assets|KenneyNL)\/[^/]+\/[0-9a-f]{40}\//);
      expect(a.subjects).toHaveLength(1);
      expect(a.provider === 'kenney' ? a.license.spdx === 'MIT' : a.license.spdx === 'CC0-1.0').toBe(true);
      const proof = admitted.get(a.id);
      expect(proof?.verdict, a.id).toBe('admitted');
      expect(proof!.sha256).toBe(a.sha256); expect(proof!.bytes).toBe(a.bytes);
    }
  });
  it('ids are unique across the whole catalogue', () => {
    expect(new Set(REVIEWED_GAME_ASSETS.map(a => a.id)).size).toBe(REVIEWED_GAME_ASSETS.length);
  });
  it('real game prompts get the new models', () => {
    expect(subjects('a cooking game with burgers, tomatoes and a stove')).toEqual(['burger', 'stove', 'tomato']);
    expect(subjects('horror game in a graveyard with pumpkins and a coffin')).toEqual(['coffin', 'grave', 'pumpkin']);
    expect(subjects('mars rover exploring a moon base with solar panels')).toEqual(['solar panel', 'space base', 'space rover']);
    expect(subjects('town square with a fountain')).toEqual(['fountain']);
    expect(subjects('कब्रिस्तान में कद्दू')).toEqual(['grave', 'pumpkin']);
  });
  it('common phrases do not pull a model', () => {
    expect(subjects('the hero is in grave danger')).toEqual([]);
    expect(subjects('door to door delivery game')).toEqual([]);
    expect(subjects('follow the next steps to forge your path')).toEqual([]);
  });
  it('the food category is no longer empty in the librarian', () => {
    expect(searchGameLibrary({ category: 'food', limit: 20 }).entries.filter(e => e.kind === 'reviewed-model').length).toBeGreaterThanOrEqual(8);
  });
});
