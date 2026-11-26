/**
 * "USER JO BOLE WAHI BANE — VILLAGE BOLE TO CITY NAHI" (admin 2026-11-26).
 *
 * The class: a new open-world game's places were one yes/no (openWorldWantsCity), and that yes was also given by houses or
 * roads, so "ek gaon banao jisme ghar aur sadak ho" became a CITY; and a named village was never put on the map at all
 * (src/game/world.ts started with a city or with nothing). worldSetting.ts now reads the places the user named — order,
 * counts, refusals, any language — and the first build writes exactly those regions.
 */
import { describe, expect, it } from 'vitest';
import { worldSettingFrom, worldRegionsFor, placesLine, worldSettingRule, PLACES_LINE_PREFIX } from '../src/server/AgentV3/worldSetting';
import { gameKitRecipeInput, gameIdentityLines, openWorldWantsCity } from '../src/server/AgentV3/gameKitSeed';
import { gameWorldFileSource, seedRegions } from '../src/server/lib/GameOpenWorldGenerator';

const kinds = (p: string) => worldSettingFrom(p).places.map((x) => (x.count > 1 ? `${x.kind}x${x.count}` : x.kind));

describe('the places are the ones the user named', () => {
  it('failedbr #2520 — "ek gav(village) game banao" is a village, not a city and not empty country', () => {
    expect(kinds('ek gav(village) game banao')).toEqual(['village']);
    expect(openWorldWantsCity('ek gav(village) game banao')).toBe(false);
  });

  it('houses and roads in a village never make it a city (the defect)', () => {
    for (const p of [
      'ek gaon banao jisme ghar aur sadak ho',
      'make a village game with houses, roads and a well',
      'गाँव का game बनाओ जिसमें घर और सड़क हो',
      'ek 3d gaanv banao jahan galiyan aur imarat ho',
    ]) {
      expect(kinds(p), p).toEqual(['village']);
      expect(openWorldWantsCity(p), p).toBe(false);
    }
  });

  it('a city is a city, in any language', () => {
    for (const p of ['ek shehar wala game banao', 'make an open world city game', 'शहर में घूमने वाला गेम']) expect(kinds(p), p).toEqual(['city']);
  });

  it('a refused place is never on the map', () => {
    expect(kinds('city nahi, sirf gaon chahiye')).toEqual(['village']);
    expect(kinds('no city, just a village by the river')).toEqual(['village']);
    expect(kinds('bina shehar ke ek jungle wala game')).toEqual(['jungle']);
    expect(worldSettingFrom('city nahi chahiye, gaon banao').refused).toEqual(['city']);
  });

  it('counts and order: the first place named is where the player starts', () => {
    expect(kinds('4 village aur 1 city banao')).toEqual(['villagex4', 'city']);
    expect(kinds('do gaon aur ek registan')).toEqual(['villagex2', 'desert']);
    expect(kinds('a desert, a jungle and a snow mountain map')).toEqual(['desert', 'jungle', 'snow', 'mountain']);
    expect(worldRegionsFor(worldSettingFrom('2 village aur ek shehar'))).toEqual([
      { id: 'main-village', kind: 'village' }, { id: 'village-2', kind: 'village' }, { id: 'main-city', kind: 'city' },
    ]);
  });

  it('a delivery van is not a forest (ambiguous edit words are not read on a first build)', () => {
    expect(kinds('a delivery van driving game in a village')).toEqual(['village']);
  });

  it('with no place named, the old reading stands: GTA or streets imply a city; otherwise open country', () => {
    expect(kinds('gta jaisa game banao')).toEqual(['city']);
    expect(worldSettingFrom('open world with buildings and roads').basis).toBe('implied-city');
    expect(kinds('a horse riding open world game')).toEqual([]);
  });
});

describe('the first build writes exactly those places', () => {
  it('the open-world recipe input carries the regions; a village game asks for no city', () => {
    const input = gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'ek gaon banao jisme ghar aur sadak ho') as Record<string, unknown>;
    expect(input.city).toBe(false);
    expect(input.regions).toEqual([{ id: 'main-village', kind: 'village' }]);
  });

  it('world.ts lists the named places in order, and only those', () => {
    const src = gameWorldFileSource({ regions: worldRegionsFor(worldSettingFrom('do gaon aur ek registan')) });
    expect(src).toContain("{ id: 'main-village', kind: 'village' },");
    expect(src).toContain("{ id: 'village-2', kind: 'village' },");
    expect(src).toContain("{ id: 'main-desert', kind: 'desert' },");
    const regionsBlock = src.slice(src.indexOf('regions: ['), src.indexOf('],', src.indexOf('regions: [')));
    expect(regionsBlock).not.toMatch(/kind: 'city'/);
    expect(src.indexOf('main-village')).toBeLessThan(src.indexOf('main-desert'));
  });

  it('a city request is unchanged (main-city), and malformed regions are dropped, never written', () => {
    expect(gameWorldFileSource({ city: true })).toContain("{ id: 'main-city', kind: 'city' },");
    expect(seedRegions([{ id: "x'; evil()", kind: 'village' }, { id: 'ok', kind: 'spaceship' }, { id: 'v', kind: 'village' }, { id: 'v', kind: 'town' }])).toEqual([{ id: 'v', kind: 'village' }]);
    expect(seedRegions('not a list')).toEqual([]);
  });

  it('the places travel into a milestone turn and are read back exactly', () => {
    const lines = gameIdentityLines('do gaon aur ek registan wala game');
    const line = lines.find((l) => l.startsWith(PLACES_LINE_PREFIX));
    expect(line).toBe(placesLine(worldSettingFrom('do gaon aur ek registan wala game')));
    const milestone = `Create a basic 3D scene with a ground plane\n${lines.join('\n')}`;
    expect(kinds(milestone)).toEqual(['villagex2', 'desert']);
  });

  it('the builder is told the places are the user\'s own words', () => {
    const rule = worldSettingRule(worldSettingFrom('city nahi, sirf gaon'));
    expect(rule).toMatch(/a village/);
    expect(rule).toMatch(/NO city/);
    expect(rule).toMatch(/village game gets no city/);
    expect(worldSettingRule(worldSettingFrom('a horse riding game'))).toBe('');
  });
});
