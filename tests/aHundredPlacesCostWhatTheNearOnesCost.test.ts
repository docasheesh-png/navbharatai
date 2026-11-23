// A HUNDRED PLACES COST WHAT THE NEAR ONES COST (map expansion plan, item 1). The Athree world's heightAt — read for every terrain
// vertex, collider sample and plant — visited every levelled pad and every land on the map at every point, so a map of hundreds
// of places paid for all of them everywhere. The place index lists each pad and land only in the cells it can reach. Its answers
// must be the old answers to the last bit: every test here compares the indexed world with the same code and PLACE_INDEX = false
// (the old full scan), with Object.is, over pads that overlap, touch cell borders, are not finite, or are wider than the index.
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { generateAthreeMap } from '../src/server/lib/athreeMap/AthreeMapGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const VISIT = 'const d = Math.max(Math.abs(x - p.x) - p.hx, Math.abs(z - p.z) - p.hz);';
function load(index: boolean): { api: any; visits: () => number } {
  const files = { ...generateAthreeMap().files };
  const path = 'src/game/athree/world.ts';
  let source = files[path];
  if (!source.includes(VISIT)) throw new Error('heightAt pad loop changed');
  source = source.replace(VISIT, '__visit(); ' + VISIT);
  if (!index) {
    if (!source.includes('const PLACE_INDEX = true;')) throw new Error('no PLACE_INDEX switch');
    source = source.replace('const PLACE_INDEX = true;', 'const PLACE_INDEX = false;');
  }
  files[path] = source;
  let visits = 0;
  const cache = new Map<string, any>();
  function module(name: string): any {
    if (cache.has(name)) return cache.get(name);
    const code = files['src/game/athree/' + name + '.ts'];
    if (!code) throw new Error('Missing ' + name);
    const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const out = {}; cache.set(name, out);
    new Function('exports', 'require', '__visit', js)(out, (id: string) => {
      if (!id.startsWith('./')) throw new Error('Unexpected import ' + id);
      return module(id.slice(2));
    }, () => { visits++; });
    return out;
  }
  return { api: module('index'), visits: () => visits };
}

/** The same synthetic places laid on a world: a grid of cities, overlapping and touching pads, odd values, lands and roads. */
function lay(world: any, seed: number): void {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 120; i++) world.levelGround((rnd() - 0.5) * 30000, (rnd() - 0.5) * 30000, 40 + rnd() * 400, 40 + rnd() * 400, rnd() < 0.2 ? 0.5 : 20 + rnd() * 80, rnd() < 0.3 ? 5 + rnd() * 40 : undefined);
  world.levelGround(256, 512, 128, 128, 0);                       // edges exactly on cell borders
  world.levelGround(300, 520, 200, 50, 60, 12);                   // overlaps the one above (order matters)
  world.levelGround(-1000, 1000, 9000, 20000, 40);                // wider than the index: checked everywhere
  world.levelGround(4000, -4000, Number.POSITIVE_INFINITY, 10, 40);
  for (let i = 0; i < 12; i++) world.setLand((rnd() - 0.5) * 20000, (rnd() - 0.5) * 20000, 100 + rnd() * 1500, ['desert', 'forest', 'mountain', 'snow', 'beach'][i % 5]);
  world.setLand(0, 0, Number.NaN, 'desert');
  world.addRoad([{ x: -3000, z: -2000 }, { x: 2500, z: 1800 }], 9);
}
function points(seed: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 6000; i++) out.push([(rnd() - 0.5) * 32000, (rnd() - 0.5) * 32000]);
  for (const v of [-512, -256, -0.5, 0, 0.5, 128, 256, 383, 384, 385, 512, 640, 641, 642]) for (const w of [-256, 0, 256, 312, 512, 570, 571, 572]) out.push([v, w]);
  out.push([Number.NaN, 0], [0, Number.POSITIVE_INFINITY], [-0, -0]);
  return out;
}

describe('🗂️ the place index answers exactly what the full scan answered', () => {
  it.each([['open-world', 7], ['battle-royale', 3], ['explore', 11]])('%s seed %i: heightAt, clearAt, surfaceAt, biomeAt and normalAt are identical', (profile, seed) => {
    const a = load(true).api.createAthreeWorld({ seed, profile }); const b = load(false).api.createAthreeWorld({ seed, profile });
    lay(a, seed); lay(b, seed);
    let finite = 0, padded = 0;
    for (const [x, z] of points(seed)) {
      if (Number.isFinite(a.heightAt(x, z))) finite++;
      if (a.clearAt(x, z)) padded++;
      expect(Object.is(a.heightAt(x, z), b.heightAt(x, z))).toBe(true);
      expect(a.clearAt(x, z)).toBe(b.clearAt(x, z));
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      expect(a.surfaceAt(x, z)).toBe(b.surfaceAt(x, z));
      expect(a.biomeAt(x, z)).toBe(b.biomeAt(x, z));
      expect(a.normalAt(x, z)).toEqual(b.normalAt(x, z));
    }
    expect(finite).toBeGreaterThan(6000);                          // real heights were compared, not NaN against NaN
    expect(padded).toBeGreaterThan(300);                           // and many points stood on or beside a pad
  }, 120_000);
  it('a pad that is not finite poisons heights exactly as the full scan did (never silently different)', () => {
    const a = load(true).api.createAthreeWorld({ seed: 2 }); const b = load(false).api.createAthreeWorld({ seed: 2 });
    for (const w of [a, b]) { w.levelGround(500, 500, 100, 100, 40); w.levelGround(Number.NaN, 0, 10, 10, 40); w.levelGround(800, 800, Number.NaN, 10, 40); }
    for (const [x, z] of points(2).slice(0, 500)) {
      expect(Object.is(a.heightAt(x, z), b.heightAt(x, z))).toBe(true);
      expect(a.clearAt(x, z)).toBe(b.clearAt(x, z));
    }
  });
  it('a world with no pads and no lands is unchanged', () => {
    const a = load(true).api.createAthreeWorld({ seed: 5 }); const b = load(false).api.createAthreeWorld({ seed: 5 });
    for (const [x, z] of points(5)) expect(Object.is(a.heightAt(x, z), b.heightAt(x, z))).toBe(true);
  });
  it('pads laid after heights were read (late) are still seen at once', () => {
    const a = load(true).api.createAthreeWorld({ seed: 9 }); const b = load(false).api.createAthreeWorld({ seed: 9 });
    expect(a.heightAt(100, 100)).toBe(b.heightAt(100, 100));
    a.levelGround(100, 100, 50, 50, 30, 42); b.levelGround(100, 100, 50, 50, 30, 42);
    expect(a.heightAt(100, 100)).toBe(42);
    expect(a.heightAt(100, 100)).toBe(b.heightAt(100, 100));
    expect(a.clearAt(100, 100)).toBe(true);
  });
});

describe('🗂️ a point visits only the places near it', () => {
  it('a thousand pads: a height reads a handful of them, not all of them (the old scan read every one)', () => {
    const { api, visits } = load(true);
    const w = api.createAthreeWorld({ seed: 7, roads: false, rivers: false });
    for (let i = 0; i < 1000; i++) w.levelGround((i % 40) * 900 - 18000, Math.floor(i / 40) * 900 - 11000, 150, 150, 60);
    const before = visits();
    for (const [x, z] of points(7).slice(0, 2000)) w.heightAt(x + 0.25, z + 0.25);
    expect((visits() - before) / 2000).toBeLessThan(5);
  });
});
