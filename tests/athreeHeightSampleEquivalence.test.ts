/** The one-sample terrain optimization must preserve exact outputs, not merely approximate height. */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { generateAthreeMap } from '../src/server/lib/athreeMap/AthreeMapGenerator';

function load(uncached = false): { api: any; count: () => number } {
  const files = generateAthreeMap().files;
  const path = 'src/game/athree/world.ts';
  let source = files[path];
  const reuse = 'if (Object.is(x, lastHeightX) && Object.is(z, lastHeightZ) && Number.isFinite(x) && Number.isFinite(z)) return;';
  if (!source.includes(reuse)) throw new Error('Missing exact sample reuse guard');
  if (uncached) source = source.replace(reuse, '/* reference: always calculate the unchanged formula */');
  source = source.replace('lastBase = baseHeight(x, z);', '__count(); lastBase = baseHeight(x, z);');
  files[path] = source;
  let count = 0;
  const cache = new Map<string, any>();
  function module(name: string): any {
    if (cache.has(name)) return cache.get(name);
    const code = files['src/game/athree/' + name + '.ts'];
    if (!code) throw new Error('Missing ' + name);
    const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const out = {}; cache.set(name, out);
    new Function('exports', 'require', '__count', js)(out, (id: string) => {
      if (!id.startsWith('./')) throw new Error('Unexpected import ' + id);
      return module(id.slice(2));
    }, () => { count++; });
    return out;
  }
  return { api: module('index'), count: () => count };
}

describe('world-local exact height sample reuse', () => {
  it.each([['open-world', 3], ['battle-royale', 1], ['battle-royale', 14]])('preserves heights, dunes, biomes and normals for %s seed %i', (profile, seed) => {
    const a = load(); const b = load(true);
    const wa = a.api.createAthreeWorld({ seed, profile }); const wb = b.api.createAthreeWorld({ seed, profile });
    for (let i = 0; i < 100; i++) {
      const x = (i * 7919) % 9000 - 4500; const z = (i * 104729) % 9000 - 4500;
      for (let repeat = 0; repeat < 2; repeat++) expect(wa.heightAt(x, z)).toBe(wb.heightAt(x, z));
      expect(wa.biomeAt(x, z)).toBe(wb.biomeAt(x, z));
      expect(wa.normalAt(x, z)).toEqual(wb.normalAt(x, z));
      expect(wa.dunesAt(x, z)).toBe(wb.dunesAt(x, z));
    }
  });
  it('observes public lake mutations even at the cached coordinate', () => {
    const a = load(); const b = load(true);
    const wa = a.api.createAthreeWorld({ seed: 3 }); const wb = b.api.createAthreeWorld({ seed: 3 });
    const la = wa.waterBodies().lakes; const lb = wb.waterBodies().lakes;
    expect(la.length).toBeGreaterThan(0);
    const { x, z } = la[0];
    const before = wa.heightAt(x, z);
    expect(before).toBe(wb.heightAt(x, z));
    la[0].level -= 100; lb[0].level -= 100;
    const after = wa.heightAt(x, z);
    expect(after).not.toBe(before);
    expect(after).toBe(wb.heightAt(x, z));
    expect(wa.biomeAt(x, z)).toBe(wb.biomeAt(x, z));
  });
  it('reuses only one exact coordinate within one world, without cross-world contamination or rounding', () => {
    const { api, count } = load();
    const a = api.createAthreeWorld({ seed: 1, rivers: false, roads: false }); const b = api.createAthreeWorld({ seed: 2, rivers: false, roads: false });
    const start = count(); a.heightAt(1, 2); a.heightAt(1, 2); a.biomeAt(1, 2);
    expect(count() - start).toBe(1);
    b.heightAt(1, 2); expect(count() - start).toBe(2);
    a.heightAt(1 + Number.EPSILON, 2); expect(count() - start).toBe(3);
    a.heightAt(1, 2); expect(count() - start).toBe(4);
    a.heightAt(-0, 0); a.heightAt(+0, 0); expect(count() - start).toBe(6);
  });
});
