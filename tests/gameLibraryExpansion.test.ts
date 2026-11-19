import { describe,it,expect } from 'vitest';
import { REVIEWED_LIBRARY_EXPANSION } from '../src/server/AgentV3/gameAssets/reviewedExpansion';
import { REVIEWED_LIBRARY_BATCH_2 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch2';
import { REVIEWED_LIBRARY_BATCH_3 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch3';
import { REVIEWED_GAME_ASSETS,validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements,externalGameAssetsEnabled } from '../src/server/AgentV3/gameAssets/assetPlan';
import { searchGameLibrary } from '../src/server/AgentV3/gameAssets/gameLibrary';
describe('licensed library expansion admission',()=>{
 it('adds eleven pinned models without changing default rollout',()=>{
  expect(REVIEWED_LIBRARY_EXPANSION).toHaveLength(11);expect(REVIEWED_GAME_ASSETS).toHaveLength(47 + REVIEWED_LIBRARY_BATCH_2.length + REVIEWED_LIBRARY_BATCH_3.length);
  expect(()=>validateCatalogue(REVIEWED_GAME_ASSETS)).not.toThrow();expect(externalGameAssetsEnabled({})).toBe(false);
 });
 it('selects exact characters and locomotion, not a neighbouring substitute',()=>{
  expect(gameAssetRequirements('running hooded rogue',REVIEWED_GAME_ASSETS)).toEqual([{subject:'hooded rogue',animation:'run'}]);
  expect(gameAssetRequirements('walking mage',REVIEWED_GAME_ASSETS)).toEqual([{subject:'mage',animation:'walk'}]);
  expect(gameAssetRequirements('hatchback car',REVIEWED_GAME_ASSETS)).toEqual([{subject:'hatchback'}]);
 });
 it('indexes by real categories and makes no invented clips or ready-made maps',()=>{
  expect(searchGameLibrary({query:'mage',category:'character',animation:'run'}).entries.length).toBeGreaterThan(0);
  expect(searchGameLibrary({query:'mage',animation:'fly'}).entries).toEqual([]);
  expect(searchGameLibrary({query:'straight road tile',category:'terrain'}).entries.length).toBeGreaterThan(0);
  expect(searchGameLibrary({category:'maps'}).entries).toEqual([]);
 });
});
