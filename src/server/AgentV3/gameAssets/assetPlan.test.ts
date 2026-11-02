import { describe, expect, it } from 'vitest';
import { gameAssetRequirements } from './assetPlan';
import { REVIEWED_GAME_ASSETS, createAssetProviders } from './providers';
describe('conservative semantic requirements', () => {
  it('does not infer a locomotive from a station or a car from horse racing', () => {
    expect(gameAssetRequirements('train station', [])).toEqual([{ subject: 'railway station' }]);
    expect(gameAssetRequirements('horse racing', [])).toEqual([{ subject: 'horse' }]);
    expect(gameAssetRequirements('train and railway station', [])).toEqual([{ subject: 'train' }, { subject: 'railway station' }]);
  });
  it('keeps motion local to independent subject clauses', () => {
    expect(gameAssetRequirements('walking human and running fox', [])).toEqual([{ subject: 'human', animation: 'walk' }, { subject: 'fox', animation: 'run' }]);
  });
  it('never substitutes an eagle for a parrot or treats a bird character as human', async () => {
    const requirements = gameAssetRequirements('flying parrot character', REVIEWED_GAME_ASSETS);
    expect(requirements).toEqual([{ subject: 'parrot', animation: 'fly' }]);
    const providers = createAssetProviders(REVIEWED_GAME_ASSETS);
    for (const provider of providers) expect(await provider.search(requirements[0], new AbortController().signal)).toEqual([]);
    expect(gameAssetRequirements('flying eagle bird', REVIEWED_GAME_ASSETS)).toEqual([{ subject: 'eagle', animation: 'fly' }]);
  });
});
