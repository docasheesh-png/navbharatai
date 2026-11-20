// 🔴 A GAME WORD IS A PART OF THE GAME, NOT A SERVICE TO CONNECT TO (failedbr #2279, 2026-11-20).
//
// A 3D racing game's spec ("GO CAR") said "HUD", and UNKNOWN_NAME_IN_REQUEST told the builder HUD named no
// service it knew — so it must not build a client for it and must explain how it read the word. HUD was later
// added to the vehicle list, one word at a time, while NPC, PVP, SFX, VFX, MMO, DLC and the rest of a game spec's
// ordinary vocabulary were all still flagged. The class is the missing FAMILY, so the test is a census of it.
// Reversion: drop the GAME_TERMS loop in unknownName.ts and every census row fails except HUD.

import { describe, it, expect } from 'vitest';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';

const GAME_WORDS = ['HUD', 'NPC', 'NPCS', 'MMO', 'MMORPG', 'PVP', 'PVE', 'MOBA', 'RTS', 'TPS', 'DLC', 'AFK', 'AOE',
  'DPS', 'RNG', 'LOD', 'IAP', 'PBR', 'SFX', 'VFX', 'BGM', 'OST', 'AABB', 'GLSL', 'WASD', 'CTF', 'TDM', 'POV', 'FOV', 'UGC', 'ELO'];

describe('game vocabulary is never an unknown service name', () => {
  it.each(GAME_WORDS)('%s in a game spec is not flagged', (w) => {
    expect(unknownNamesInRequest(`Make a 3D racing game with ${w} support, a leaderboard and touch controls.`)).toEqual([]);
  });
  it("the report's own line: HUD, NPC rivals, PVP races, SFX and VFX together", () => {
    expect(unknownNamesInRequest('Show a HUD with speed and lap. Add NPC rivals, PVP races, punchy SFX and VFX on every crash.')).toEqual([]);
  });
  it('an unknown all-caps word beside them is still caught (the rule still works)', () => {
    expect(unknownNamesInRequest('Make a racing game with a HUD and NPC cars and a ZORBIX mode.')).toEqual(['ZORBIX']);
  });
});
