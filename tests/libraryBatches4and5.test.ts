/** Library batches 4 and 5 (admin request 2026-11-19): people, vehicles, boats, animals, buildings, nature, farm, street. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REVIEWED_LIBRARY_BATCH_4 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch4';
import { REVIEWED_LIBRARY_BATCH_5 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch5';
import { REVIEWED_GAME_ASSETS, validateCatalogue, catalogueStorageBytes, CATALOGUE_STORAGE_BUDGET_BYTES } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { searchGameLibrary } from '../src/server/AgentV3/gameAssets/gameLibrary';

type Proof = { id: string; verdict: string; sha256: string; bytes: number; proofs: { animated: boolean; animation: string | null }[] };
const admitted = (batch: number) => new Map((JSON.parse(readFileSync(`docs/game-engine/asset-candidates/library-batch-${batch}-admission.json`, 'utf8')) as { results: Proof[] }).results.map(r => [r.id, r]));
const req = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS);
const subjects = (prompt: string) => req(prompt).map(r => r.subject).sort();

describe('library batches 4 and 5', () => {
  it.each([[4, REVIEWED_LIBRARY_BATCH_4], [5, REVIEWED_LIBRARY_BATCH_5]] as const)('batch %i: every entry pinned, CC0 by the kit authors, admitted live', (batch, entries) => {
    validateCatalogue(entries);
    const proofs = admitted(batch);
    for (const a of entries) {
      expect(a.downloadUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/kayquer\/[^/]+\/[0-9a-f]{40}\//);
      expect(a.license.spdx).toBe('CC0-1.0');
      expect(a.license.evidenceUrl).toContain(a.revision);
      expect(a.subjects).toHaveLength(1);
      const proof = proofs.get(a.id);
      expect(proof?.verdict, a.id).toBe('admitted');
      expect(proof!.sha256).toBe(a.sha256); expect(proof!.bytes).toBe(a.bytes);
      if (a.animationRoles) expect(proof!.proofs.filter(p => p.animation).every(p => p.animated)).toBe(true);
    }
  });
  it('people walk and run', () => {
    const people = REVIEWED_LIBRARY_BATCH_4.filter(a => a.libraryCategory === 'character');
    expect(people.length).toBe(13);
    for (const a of people) expect(a.animationRoles).toEqual({ walk: 'andar', run: 'correr', idle: 'parado' });
    expect(req('running man in a city')).toEqual([{ subject: 'man', animation: 'run' }]);
    expect(req('a walking farmer')).toEqual([{ subject: 'farmer', animation: 'walk' }]);
  });
  it('the whole catalogue stays inside the storage budget with unique ids', () => {
    validateCatalogue(REVIEWED_GAME_ASSETS);
    expect(catalogueStorageBytes(REVIEWED_GAME_ASSETS)).toBeLessThanOrEqual(CATALOGUE_STORAGE_BUDGET_BYTES);
    expect(new Set(REVIEWED_GAME_ASSETS.map(a => a.id)).size).toBe(REVIEWED_GAME_ASSETS.length);
  });
  it('real prompts, English and Hindi, get the new models', () => {
    expect(subjects('village with a farmer, cows and a dog')).toEqual(['cow', 'dog', 'farmer']);
    expect(subjects('नाव और मछली वाला गेम')).toEqual(['boat', 'fish']);
    expect(subjects('ocean game with sharks, dolphins and a whale')).toEqual(['dolphin', 'shark', 'whale']);
    expect(subjects('city with a school, a hospital and a bus stop')).toEqual(['bus stop', 'hospital', 'school']);
    expect(subjects('jungle with monkeys and a snake')).toEqual(['monkey', 'snake']);
  });
  it('everyday phrases do not pull an unrelated model', () => {
    for (const prompt of ['a pac man game', 'cricket bat and ball game', 'racing game with a day night cycle', 'ice cream cone shop',
      'log in screen for my game', 'game mechanics tutorial', 'service worker caching', 'walk along the river bank']) expect(subjects(prompt), prompt).toEqual([]);
    expect(subjects('school bus game')).toEqual(['bus']);
    expect(subjects('an old man waits')).toEqual(['old man']);
  });
  it('the librarian lists the new categories', () => {
    expect(searchGameLibrary({ category: 'animal', limit: 20 }).total).toBeGreaterThanOrEqual(30);
    expect(searchGameLibrary({ category: 'vehicle-water', limit: 20 }).entries.some(e => e.kind === 'reviewed-model')).toBe(true);
  });
});
