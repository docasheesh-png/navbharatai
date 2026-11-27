// 🔁 ROADS FIRST, PONDS AFTER (found 2026-11-27 while building the colonies). After #4624 (ponds) and #4626 (roads on every map size)
// both landed, a map with ponds on a planned road network — every map under 20 km (an island under 6 km) — overflowed the stack on its
// very first heightAt: the roads read waterBodies() (which lists the ponds), the ponds are placed away from the roads (they read the
// road-carved ground), and that ground reads the roads again. In a build it showed only as "the check could not run: Maximum call stack
// size exceeded" in the robot verdict. The class: a world layer that reads a layer which is placed against it. These tests hold the
// order on the emitted world: the map builds, the roads never enter a pond, and no pond sits on a road.
import { describe, it, expect, vi } from 'vitest';
import { loadAthree } from './helpers/loadAthree';
import { mapOptionsFor, type Archetype } from '../src/server/lib/athreeMap/athreeMapKinds';

vi.setConfig({ testTimeout: 600000 });
const A = loadAthree();

describe('a map with ponds on a planned road network builds', () => {
  const cases: Array<[Archetype, number, string | undefined]> = [['desert', 5, 'grid'], ['island', 2.2, undefined], ['plains', 1, 'organic'], ['island', 2.2, 'hill']];
  for (const [archetype, km, style] of cases) {
    it(`${archetype}, ${km} km, ${style ?? 'default'} roads, 3 ponds: heightAt answers, the roads keep out of the ponds and the ponds off the roads`, () => {
      const w = A.createAthreeWorld({ seed: 1, ...mapOptionsFor({ archetype, sizeKm: km }), ...(style ? { roadStyle: style } : {}), water: { ponds: 3 } });
      expect(() => w.heightAt(10, 10)).not.toThrow();
      expect(Number.isFinite(w.heightAt(10, 10))).toBe(true);
      expect(w.roadNetwork().style()).not.toBeNull();
      const ponds = w.ponds();
      // Ponds are still found (away from the town's roads), not quietly dropped by the stricter road test.
      expect(ponds.length).toBeGreaterThan(0);
      for (const p of ponds) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          for (const f of [0, 0.5, 1]) expect(w.roadAt(p.x + Math.cos(a) * p.radius * f, p.z + Math.sin(a) * p.radius * f), `pond ${p.id}`).toBeNull();
        }
      }
      // The pond is in the water data the game reads, and still answers waterAt.
      for (const p of ponds) expect(w.waterAt(p.x, p.z)?.kind).toBe('lake');
      expect(() => w.spawnPoints('player', 4)).not.toThrow();
    });
  }
});
