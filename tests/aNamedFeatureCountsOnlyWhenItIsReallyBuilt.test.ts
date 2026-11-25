/**
 * 🧾 A NAMED FEATURE COUNTS ONLY WHEN IT IS REALLY BUILT (master audit 2026-11-25, Part J — "user instructions are
 * acknowledged but not implemented": "add a swimming system", "make the house walkable", "destructible doors", "a vehicle
 * that follows roads", "add villagers").
 *
 * Root cause: the contract knew ~15 features and its presence check was a WORD search — a variable named `swim` or a
 * comment-free string "house" satisfied it — and these five were not features at all, so a build was never checked for
 * them. Now each is a required feature (English, Hinglish, Hindi), the builder is told the kit call that really does it,
 * and in a kit game it is PRESENT only when that call is in the game's code. A game without the kit (2D, hand-written)
 * keeps the word check, so the checker never calls a real hand-made feature "missing".
 */
import { describe, expect, it } from 'vitest';
import { buildGameContract, gameContractBlock, scopeMatch } from '../src/server/AgentV3/gameIntent';

const KIT = { 'src/game/three/surfaces.ts': '// kit' };
// A real project: an entry that loads the game file (since Q-3360 a kit call counts only in code the game reaches).
const game = (code: string, kit = true) => ({ ...(kit ? KIT : {}), 'src/main.ts': "import './game/MyGame';", 'src/game/MyGame.ts': code });

const CASES: Array<[string, string[], string, string]> = [
  // feature, requests that name it, fake code (word only), real code (the kit call)
  ['swimming', ['add a swimming system to my 3D game', 'player paani me tairna chahiye', 'खिलाड़ी पानी में तैरे'], 'const swim = true; // water', 'ctx.player.setWater(0);'],
  ['enterableHouses', ['make the house walkable — the player can go inside the house', 'ghar ke andar ja sake', 'player can enter the buildings'], "const house = new THREE.Mesh(box); house.name = 'inside';", 'const h = createEnterableHouse({ width: 8, depth: 8 });'],
  ['destructible', ['add destructible doors', 'the player can smash the crates', 'darwaza tod sake'], 'door.visible = false; // broken', 'makeBreakable(door);'],
  ['traffic', ['a city with traffic', 'cars that follow the roads', 'sadak par gaadi chalni chahiye'], 'const cars = [car1, car2]; // traffic', 'const traffic = createCityTraffic(city);'],
  ['npcs', ['add villagers', 'a town with pedestrians and civilians', 'people walking on the streets'], "hud.text = '20 villagers';", 'const npcs = new Entities(ctx); npcs.spawn({ x: 0, z: 5, kind: "villager" });'],
];

describe('🔴 each feature: named, told how, and counted only when the kit system is really called', () => {
  for (const [feature, asks, fake, real] of CASES) {
    describe(feature, () => {
      it('is a required feature in every language it is asked in', () => {
        for (const ask of asks) expect(buildGameContract('3D game: ' + ask).requiredFeatures, ask).toContain(feature);
      });
      it('the builder is told the kit call that really does it', () => {
        expect(gameContractBlock(buildGameContract('3D game: ' + asks[0]))).toMatch(/REALLY|ENTERABLE/);
      });
      it('a kit game that only MENTIONS it is reported missing (the reported bug)', () => {
        expect(scopeMatch(buildGameContract('3D game: ' + asks[0]), game(fake)).missing).toContain(feature);
      });
      it('a kit game that calls the kit system has it', () => {
        expect(scopeMatch(buildGameContract('3D game: ' + asks[0]), game(real)).present).toContain(feature);
      });
    });
  }
});

describe('the checker never lies the other way', () => {
  it('a 2D / hand-written game (no kit): a real hand-made feature is not called missing — and a word is not called present', () => {
    const c = buildGameContract('a 2D platformer where the player can swim and there are villagers');
    const m = scopeMatch(c, game('function swim(p) { p.vy -= 1; } const villagers = [];', false));
    expect(m.missing).toEqual([]);
    // Q-3360 (external Game Maker audit): a word is NOT VERIFIED, never present — only playing can prove it here.
    expect(m.present).toEqual([]);
    expect(m.notVerified).toEqual(expect.arrayContaining(['swimming', 'npcs']));
  });
  it('requests that do not name them do not get them', () => {
    const c = buildGameContract('a racing game with 3 laps, a timer and a house in the background');
    for (const f of ['swimming', 'enterableHouses', 'destructible', 'traffic', 'npcs']) expect(c.requiredFeatures).not.toContain(f);
  });
  it('the platform\'s own city line ("streets, buildings and traffic") is not a request', () => {
    expect(buildGameContract('The map has a city on it: streets, buildings and traffic.').requiredFeatures).not.toContain('traffic');
  });
  it('a declined feature is not required ("no traffic")', () => {
    expect(buildGameContract('a quiet 3D village game. No traffic.').requiredFeatures).not.toContain('traffic');
  });
});
