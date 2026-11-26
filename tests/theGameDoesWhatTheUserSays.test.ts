/**
 * Admin 2026-11-26, game-maker list (PR A):
 *   #3  a Game Library pick replaced everything typed in the box with a long description;
 *   #6  no game had an edge: the player walked on until the ground ran out or it fell into the sea;
 *   #16 the hero swam by default; it should drown (health falls, it dies) unless the user asked for swimming.
 * (#5 the held gun and #12 restart are played on the real Game in theGameFeelsRightOnAPhone.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { insertAtCursor } from '../src/components/agentv3/composerDraft';
import { expandLibraryMentions, libraryMentionToken } from '../src/server/AgentV3/gameAssets/libraryMention';
import { gameWorldFileSource, wantsSwimming, GAME_OPEN_WORLD_BRIDGE } from '../src/server/lib/GameOpenWorldGenerator';
import { gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';
import { GAME_ENTITIES } from '../src/server/lib/GameEntitiesGenerator';

const ROWS: Record<string, { id: string; name: string }> = {
  'adventurers-knight-boxer': { id: 'adventurers-knight-boxer', name: 'Knight Boxer' },
  'kenney-car-sedan': { id: 'kenney-car-sedan', name: 'Sedan' },
};
const lookup = (id: string) => ROWS[id] ?? null;

describe('#3 a library pick is inserted at the cursor and read by the build', () => {
  it('goes where the caret is, keeps every word typed, and spaces itself', () => {
    expect(insertAtCursor('mera hero  banao', '@character:x', 11, 11)).toEqual({ text: 'mera hero  @character:x banao', caret: 24 });
    expect(insertAtCursor('add', '@model:y', 3, 3)).toEqual({ text: 'add @model:y ', caret: 13 });
    expect(insertAtCursor('', '@model:y', 0, 0)).toEqual({ text: '@model:y ', caret: 9 });
    expect(insertAtCursor('replace THIS word', '@model:y', 8, 12)).toEqual({ text: 'replace @model:y word', caret: 16 });
    expect(insertAtCursor('no caret known', '@car:z', null, null).text).toBe('no caret known @car:z ');
  });

  it('a request that is only the pick becomes the instruction it always meant', () => {
    expect(expandLibraryMentions('@character:adventurers-knight-boxer', lookup)).toMatch(/Make the Knight Boxer from the NavBharatAI library my game's player character \(library id: "adventurers-knight-boxer"\)/);
    expect(expandLibraryMentions('@model:kenney-car-sedan ', lookup)).toMatch(/^Add the Sedan model from the NavBharatAI library to my game \(library id: "kenney-car-sedan"\)/);
  });

  it('with the user\'s own words, WHAT is the exact model and WHERE stays the user\'s', () => {
    const out = expandLibraryMentions('@model:kenney-car-sedan ko gaon ke kuen ke paas khada karo', lookup);
    expect(out).toBe('the Sedan from the NavBharatAI library (library id: "kenney-car-sedan") ko gaon ke kuen ke paas khada karo');
    expect(expandLibraryMentions('mera hero @character:adventurers-knight-boxer ho aur uske haath me gun ho', lookup))
      .toBe('mera hero the Knight Boxer from the NavBharatAI library (library id: "adventurers-knight-boxer") (as my player character) ho aur uske haath me gun ho');
  });

  it('an id the library does not hold is left as written; text without a mention is untouched', () => {
    expect(expandLibraryMentions('@model:no-such-thing yahan rakho', lookup)).toBe('@model:no-such-thing yahan rakho');
    expect(expandLibraryMentions('email me at a@b.com', lookup)).toBe('email me at a@b.com');
    expect(libraryMentionToken('car', 'kenney-car-sedan')).toBe('@car:kenney-car-sedan');
  });
});

describe('#16 water drowns unless the user asked for swimming', () => {
  it('reads swimming in any words, and a refusal', () => {
    for (const p of ['hero pani me tair sake', 'add swimming in the lake', 'tairna wala game', 'नदी में तैरना']) expect(wantsSwimming(p), p).toBe(true);
    for (const p of ['ek gaon ka game', 'tairna nahi chahiye', 'no swimming', 'a race game']) expect(wantsSwimming(p), p).toBe(false);
  });

  it('world.ts says drown by default and swim when asked; the seed passes it', () => {
    expect(gameWorldFileSource({})).toContain("water: 'drown',");
    expect(gameWorldFileSource({ swim: true })).toContain("water: 'swim',");
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'ek bada open world jahan hero tair sake')).toMatchObject({ swim: true });
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'ek bada open world')).not.toHaveProperty('swim');
  });

  it('the open world hurts a player in water unless WORLD.water is swim', () => {
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/water: waterMode = 'drown'/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/if \(waterMode !== 'swim' && !ctx\.vehicles\.seated && \(ctx\.player\.swimming \|\| ctx\.player\.underwater\)\) damagePlayer\(DROWN_PER_SECOND \* delta\)/);
  });
});

describe('#6 every open world has an edge that holds and moves out with the map', () => {
  it('world.ts starts with a boundary; the world builds a wall around every place and holds the player and the car', () => {
    expect(gameWorldFileSource({})).toContain('boundary: { margin: 800 },');
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/for \(const p of planned\) cover\(p\.centre\.x, p\.centre\.z, p\.reach\)/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/for \(const l of landList\) cover\(l\.centre\.x, l\.centre\.z, l\.radius\)/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/const car = ctx\.vehicles\.seated;/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/wall\.name = 'World edge'/);
    // The wall's own group moves with the floating origin, like the highways (and is not a highway).
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/edgeGroup\.add\(wall\)/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/edgeGroup\.position\.x -= shift\.dx/);
  });

  it('restart in the open world stands the player at its own start (ctx.setRespawn)', () => {
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/ctx\.setRespawn\?\.\(\(\) => ctx\.player\.reset\(spawn\.x - chunks\.origin\.x/);
  });
});

describe('#5 a shot from the held gun hurts the character it hits', () => {
  it('Entities listen for SHOT_HIT and hurt the character whose body was hit, and stop listening on dispose', () => {
    expect(GAME_ENTITIES).toMatch(/this\.offShot = events\.on\('SHOT_HIT'/);
    expect(GAME_ENTITIES).toMatch(/if \(o === e\.object\) \{ this\.hurt\(e, Number\(p!\.damage\)/);
    expect(GAME_ENTITIES).toMatch(/this\.offShot\(\);/);
  });
});
