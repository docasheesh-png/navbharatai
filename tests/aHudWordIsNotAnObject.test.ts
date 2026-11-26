/**
 * A GAME'S HUD AND CAMERA WORDS ARE NOT OBJECTS IN ITS WORLD (Q-3468, failedbr #2523, 2026-11-26).
 *
 * "…crosshair, score counter, health system, and restart button" was handed a TABLE spec (the kitchen "counter"), and
 * "first-person view" a HUMAN. The library reader, which kept its own exception list, went further: a human and a
 * MECHANIC character ("shooting mechanics"). The class is two readers of "is this word the object" — the library
 * reader now goes through the hero contract's one list of non-object senses.
 */
import { describe, it, expect } from 'vitest';
import { heroObjectIds } from '../src/server/lib/heroObjectSpec';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';

// The real prompt of failedbr #2523.
const BR2523 = 'Create a simple playable shooting game with first-person view, a gun, enemies, shooting mechanics, crosshair, score counter, health system, and restart button. Add basic mobile touch controls';
const lib = (p: string) => gameAssetRequirements(p, REVIEWED_GAME_ASSETS).map((r) => r.subject);

describe('the report, replayed', () => {
  it('the hero contract names the gun — no table, no human', () => {
    expect(heroObjectIds(BR2523)).toEqual(['gun']);
  });
  it('the library is asked for the gun — no human, no mechanic', () => {
    expect(lib(BR2523)).toEqual(['gun']);
  });
});

describe('the siblings', () => {
  it('HUD counters, camera views, buttons and screens name nothing', () => {
    for (const p of ['a kill counter', 'a lap counter', 'a life counter', 'counter attack moves', 'a third person camera', 'a first person shooter', 'a fire button', 'a home screen', 'core mechanics'])
      expect(heroObjectIds(`a 3d action game with ${p}`).filter((i) => i !== 'gun'), p).toEqual([]);
  });
  it('the real objects still match: a kitchen counter, coins beside their counter, a camp fire, a house, a car mechanic', () => {
    expect(heroObjectIds('a kitchen with a counter and a fridge')).toContain('table');
    expect(heroObjectIds('a coin counter and coins')).toEqual(['coin']);
    expect(heroObjectIds('a camp fire')).toContain('fire');
    expect(heroObjectIds('a man walking home')).toEqual(['human', 'house']);
    expect(lib('a car mechanic in a garage')).toContain('mechanic');
  });
});
