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

it('matches Hindi subjects and motions without broadening a species', () => {
  expect(gameAssetRequirements('चलता इंसान और दौड़ती लोमड़ी', [])).toEqual([{ subject: 'human', animation: 'walk' }, { subject: 'fox', animation: 'run' }]);
  expect(gameAssetRequirements('उड़ता तोता और ट्रेन स्टेशन', [])).toEqual([{ subject: 'railway station' }, { subject: 'parrot', animation: 'fly' }]);
  expect(gameAssetRequirements('ट्रेन और रेलवे स्टेशन', [])).toEqual([{ subject: 'train' }, { subject: 'railway station' }]);
});
it('matches bounded Spanish vocabulary and rejects negated clauses conservatively', () => {
  expect(gameAssetRequirements('persona caminando y zorro corriendo', [])).toEqual([{ subject: 'human', animation: 'walk' }, { subject: 'fox', animation: 'run' }]);
  expect(gameAssetRequirements('car and no dog and बिना गाय और पेड़', [])).toEqual([{ subject: 'car' }, { subject: 'tree' }]);
  expect(gameAssetRequirements('sin pájaro y barco', [])).toEqual([{ subject: 'ship' }]);
  expect(gameAssetRequirements('horse racing character', [])).toEqual([{ subject: 'horse' }]);
});
it('keeps separate generic bird requirements and bounds work/output', () => {
  expect(gameAssetRequirements('flying bird and parrot', [])).toEqual([{ subject: 'bird', animation: 'fly' }, { subject: 'parrot' }]);
  expect(gameAssetRequirements('car '.repeat(10000)+'fox', [])).toEqual([{ subject: 'car' }]);
  expect(gameAssetRequirements('car train bird ship human dog cow horse', [])).toHaveLength(6);
});

it('falls back for unsupported specialized objects and non-object senses rather than broadening them', () => {
  for (const prompt of ['table tennis', 'a coffee table', 'office chair', 'rock music', 'decision tree', 'formula 1 car']) expect(gameAssetRequirements(prompt, [])).toEqual([]);
});

it('does not download objects negated by common contractions or Hindi न', () => {
  for (const prompt of ["don't add a table", 'don’t add a chair', 'never add a tree', 'मेज न बनाओ', 'कार नहीं चाहिए']) expect(gameAssetRequirements(prompt, [])).toEqual([]);
});

it('recognizes additional requested furniture without medical or political substitutions', () => {
  expect(gameAssetRequirements('सोफा और स्टूल; lámpara; cabinet', []).map(r => r.subject)).toEqual(['stool', 'sofa', 'cabinet', 'lamp']);
  expect(gameAssetRequirements('stool sample and cabinet minister and street lamp', [])).toEqual([]);
});
