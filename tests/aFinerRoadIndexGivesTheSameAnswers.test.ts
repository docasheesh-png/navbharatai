// ⚡ A FINER ROAD INDEX GIVES THE SAME ANSWERS (2026-11-27). A planned town indexes its road segments into 32 m cells instead of 125 m
// ones, because every height and road lookup walked a whole cell's segments (the colony planner spent most of its time there, and a
// battle-royale island's build-time robot check ran out of its 8 s budget). The index is only a shortcut: these tests build the emitted
// roads.ts twice — as shipped, and with the planned cell put back to 125 m — and require the very same heights, road hits and drivable
// heights at thousands of points, bit for bit.
import { describe, it, expect, vi } from 'vitest';
import { generateAthreeMap } from '../src/server/lib/athreeMap/AthreeMapGenerator';
import { loadEmittedAthree } from '../src/server/lib/athreeMap/mapRobotRun';
import { mapOptionsFor, type Archetype } from '../src/server/lib/athreeMap/athreeMapKinds';

vi.setConfig({ testTimeout: 600000 });

const files = generateAthreeMap().files;
const roads = files['src/game/athree/roads.ts'];
const OLD = 'const INDEX_CELL = planned ? 32 : GRID;';

describe('the planned network\'s 32 m road index answers exactly as the 125 m one did', () => {
  it('the shipped roads.ts carries the finer index', () => {
    expect(roads).toContain(OLD);
  });
  const fine = loadEmittedAthree(files) as Record<string, any>;
  const coarse = loadEmittedAthree({ ...files, 'src/game/athree/roads.ts': roads.replace(OLD, 'const INDEX_CELL = GRID;') }) as Record<string, any>;
  const cases: Array<[Archetype, number, string, number]> = [['island', 2.2, 'grid', 5], ['plains', 5, 'organic', 3], ['island', 8, 'grid', 1], ['hills', 2.2, 'hill', 7]];
  for (const [archetype, km, style, seed] of cases) {
    it(`${archetype} ${km} km ${style}: heightAt, roadAt and drivableHeightAt are identical`, () => {
      const opts = { seed, ...mapOptionsFor({ archetype, sizeKm: km }), roadStyle: style };
      const a = fine.createAthreeWorld(opts), b = coarse.createAthreeWorld(opts);
      expect(a.roadNetwork().style()).not.toBeNull();
      const half = (km * 1000) / 2;
      let hits = 0;
      for (let i = 0; i < 3000; i++) {
        // Halton-like spread over the map, plus points on the roads themselves.
        const x = (((i * 0.6180339887) % 1) - 0.5) * 2 * half, z = (((i * 0.7548776662) % 1) - 0.5) * 2 * half;
        expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
        expect(a.drivableHeightAt(x, z)).toBe(b.drivableHeightAt(x, z));
        expect(JSON.stringify(a.roadAt(x, z))).toBe(JSON.stringify(b.roadAt(x, z)));
      }
      for (const r of a.homeRoads().roads.slice(0, 60)) for (const p of r.points.filter((_: unknown, k: number) => k % 3 === 0)) {
        for (const off of [0, r.points[0].width / 2 - 0.1, r.points[0].width / 2 + 6, 18]) {
          const x = p.x + off, z = p.z - off / 2;
          expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
          const ha = a.roadAt(x, z);
          expect(JSON.stringify(ha)).toBe(JSON.stringify(b.roadAt(x, z)));
          if (ha) hits++;
        }
      }
      expect(hits).toBeGreaterThan(50);
    });
  }
});
