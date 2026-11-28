// A ROAD NETWORK IS NEVER SHARED BETWEEN TWO DIFFERENT GROUNDS (found 2026-11-28 while slicing the town plan, Q-3763). The road network is
// cached by a key so worlds on the same ground share it; the key left out the natural edge (mountains, a canyon, a wall reshape the land
// the roads are laid on) and the sea floor, so a second world of the same seed with another edge drove on the first world's roads. Its
// sibling: the river network's key left out the edge too, and the island's mask the rivers are traced on follows the edge.
import { describe, it, expect } from 'vitest';
import { loadAthree } from './helpers/loadAthree';

describe('a road network is laid on its own ground', () => {
  it('a world with a mountain edge after a sea-edge world of the same seed gets the roads a fresh kit lays for it', () => {
    const A = loadAthree();
    const base = { seed: 31, profile: 'battle-royale', sizeMeters: 3000 };
    const sea = A.createAthreeWorld({ ...base, boundary: 'sea' });
    sea.roadNetwork().graph();
    const shared = A.createAthreeWorld({ ...base, boundary: 'mountains' });
    const fresh = loadAthree().createAthreeWorld({ ...base, boundary: 'mountains' });
    expect(JSON.stringify(shared.roadNetwork().graph())).toBe(JSON.stringify(fresh.roadNetwork().graph()));
    expect(JSON.stringify(shared.roadNetwork().graph())).not.toBe(JSON.stringify(sea.roadNetwork().graph()));
    expect(JSON.stringify(shared.waterBodies())).toBe(JSON.stringify(fresh.waterBodies()));
    expect(shared.heightAt(410, -220)).toBe(fresh.heightAt(410, -220));
  });
});
