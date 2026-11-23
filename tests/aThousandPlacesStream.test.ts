// A THOUSAND PLACES, THE NEAREST FEW LIVE (map expansion plan, item 4; owner decision: up to 1,000 places, live cities at once —
// phone 2, mid 5, desktop 8). Planning a map of a thousand places took seconds: the highway tree tried every joined stop against
// every other stop at each step (n³), and every candidate spot was checked against every place already on the map. Both now
// look only where they need to, with exactly the same answers, so the same list gives the same map.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-thousand-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** The old way, kept here as the reference: every joined stop against every other stop, each time. */
function everyPairEachTime(stops: Array<{ x: number; z: number }>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  if (stops.length < 2) return out;
  const joined = new Set<number>([0]);
  while (joined.size < stops.length) {
    let best: [number, number, number] | null = null;
    for (const a of joined) for (let b = 0; b < stops.length; b++) {
      if (joined.has(b)) continue;
      const d = Math.hypot(stops[a].x - stops[b].x, stops[a].z - stops[b].z);
      if (!best || d < best[2]) best = [a, b, d];
    }
    if (!best) break;
    joined.add(best[1]); out.push(best);
  }
  return out;
}

describe('🛣️ the highway tree of a thousand places', () => {
  it('the same pairs in the same order as the old way — scattered places', () => {
    let s = 12345; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
    for (const n of [0, 1, 2, 3, 17, 300]) {
      const stops = Array.from({ length: n }, () => ({ x: (rnd() - 0.5) * 40000, z: (rnd() - 0.5) * 40000 }));
      expect(OW.spanningPairs(stops)).toEqual(everyPairEachTime(stops));
    }
  });
  it('the same pairs where distances tie (a grown city\'s tiles on a grid, the same spot twice)', () => {
    const grid = [] as Array<{ x: number; z: number }>;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) grid.push({ x: (i - 6) * 380, z: (j - 6) * 380 });
    expect(OW.spanningPairs(grid)).toEqual(everyPairEachTime(grid));
    const ring = Array.from({ length: 16 }, (_, k) => ({ x: Math.round(Math.sin(k * Math.PI / 8) * 1000), z: Math.round(Math.cos(k * Math.PI / 8) * 1000) }));
    const twice = [{ x: 0, z: 0 }, ...ring, { x: 0, z: 0 }, ...ring.slice(0, 5)];
    expect(OW.spanningPairs(twice)).toEqual(everyPairEachTime(twice));
  });
  it('the bridge lays its highways from that tree', () => {
    const bridge = recipeFilePool().get(OPEN_WORLD_BRIDGE_PATH)!.content;
    expect(bridge).toMatch(/for \(const best of spanningPairs\(stops\)\)/);
    expect(bridge).not.toMatch(/for \(const a of joined\) for \(let b = 0; b < stops\.length; b\+\+\)/);
  });
});
