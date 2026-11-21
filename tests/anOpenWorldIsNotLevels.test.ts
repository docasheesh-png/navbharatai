// AN OPEN WORLD IS NOT "LEVELS" (failedbr #2487). The GTA open-world request's contract said requiredFeatures: ["levels"]
// and the scope check verified "levels" — because the word "world" in "open world" matched the levels reader.
// 🧬 Class: a setting word read as a feature. "Worlds" are levels only when counted.
import { describe, it, expect } from 'vitest';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';

describe('the levels reader', () => {
  it('the #2487 request asks for no levels', () => {
    const c = buildGameContract('ek bada open-world 3D game banao, GTA jaisa — ek shehar ho jisme sadak, traffic aur log hon, mera character paidal ghoom sake aur gaadi me baith sake');
    expect(c.requiredFeatures).not.toContain('levels');
    expect(c.vehicle).toBe('car');
  });
  it('setting words are not levels', () => {
    for (const p of ['an open world game', 'a big world to explore', 'make a 3D world with trees', 'open world racing']) expect(buildGameContract(p).requiredFeatures, p).not.toContain('levels');
  });
  it('levels, stages and counted worlds still are', () => {
    for (const p of ['a platformer with 10 levels', 'add more stages', 'a game with 5 worlds', 'unlock world 2 after world 1']) expect(buildGameContract(p).requiredFeatures, p).toContain('levels');
  });
});

describe('a name is not a land (failedbr #2488: three towns called "Desert", "Jungle" and "Mountain")', () => {
  it('the map rule says regions are only city / town / village, and tells the builder to say so and ask', async () => {
    const { GAME_WORLD_RULE } = await import('../src/server/AgentV3/gameKitSeed');
    expect(GAME_WORLD_RULE).toMatch(/A region is ONLY a city, a town or a village/);
    expect(GAME_WORLD_RULE).toMatch(/do NOT add a town and call it "Desert"/);
    expect(GAME_WORLD_RULE).toMatch(/then ask whether they want that/);
  });
});
