/**
 * Colour packs admitted 2026-11-23. Kenney Retro Urban Kit (every GLB), the Quaternius nature kit
 * under the existing caps, a curated medieval subset, and recolours of models already in the library.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { REVIEWED_LIBRARY_BATCH_14 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch14';
import { validateCatalogue, catalogueStorageBytes, CATALOGUE_STORAGE_BUDGET_BYTES, REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { GROUND_CONTACT_SOURCE } from '../src/server/lib/groundContact';

const ids = REVIEWED_LIBRARY_BATCH_14.map((asset) => asset.id);

describe('colour packs and recolours', () => {
  it('admits every Kenney urban model, the nature kit that fits, and a medieval subset', () => {
    validateCatalogue(REVIEWED_GAME_ASSETS);
    expect(catalogueStorageBytes(REVIEWED_GAME_ASSETS)).toBeLessThanOrEqual(CATALOGUE_STORAGE_BUDGET_BYTES);
    // The admin's storage budget (400 MiB since 2026-11-26, line above) is the limit. A 300 MiB snapshot of the day this batch landed stood
    // here with no recorded reason and stopped the next batch at 307.6 MiB, inside the budget (batch 16, 2026-11-25).
    expect(ids.filter((id) => id.startsWith('urban-'))).toHaveLength(124);
    expect(ids.filter((id) => id.startsWith('nature-'))).toHaveLength(68);
    expect(ids.filter((id) => id.startsWith('village-')).length).toBeGreaterThan(10);
    expect(ids.filter((id) => id.startsWith('dye-')).length).toBeGreaterThanOrEqual(300);
    const dyeBytes = REVIEWED_LIBRARY_BATCH_14.filter((asset) => asset.id.startsWith('dye-')).reduce((sum, asset) => sum + (asset.bytes ?? 0), 0);
    expect(dyeBytes).toBeGreaterThan(80 * 1024 * 1024);
    expect(dyeBytes).toBeLessThanOrEqual(100 * 1024 * 1024);
    for (const asset of REVIEWED_LIBRARY_BATCH_14) {
      expect(asset.license.spdx).toBe('CC0-1.0');
      expect(asset.packaged).toBe(true);
      const bytes = readFileSync(`assets/game-models/${asset.sha256}.glb`);
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      const stats = validateGlb(bytes);
      expect(stats.triangles).toBeLessThanOrEqual(60_000);
      expect(stats.bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    }
  });

  it('a red kurta and a blue house are chosen from the words, in English and Hindi', () => {
    expect(gameAssetRequirements('a red kurta-style hero', REVIEWED_GAME_ASSETS).map((item) => item.subject)).toContain('red kurta');
    expect(gameAssetRequirements('केसरिया कुर्ता', REVIEWED_GAME_ASSETS).map((item) => item.subject)).toContain('saffron kurta');
    expect(gameAssetRequirements('a blue house by the road', REVIEWED_GAME_ASSETS).map((item) => item.subject)).toContain('blue house');
    expect(gameAssetRequirements('नीला घर', REVIEWED_GAME_ASSETS).map((item) => item.subject)).toContain('blue house');
  });

  it('characters, houses and recoloured cars stay on flat ground and on a slope', () => {
    const js = ts.transpileModule(GROUND_CONTACT_SOURCE, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const api: { dropOnto: Function; meshLowestY: Function; GROUND_EPSILON: number } = { dropOnto() {}, meshLowestY() { return 0; }, GROUND_EPSILON: 0 };
    new Function('exports', 'require', js)(api, () => { throw new Error('no'); });
    const samples = REVIEWED_LIBRARY_BATCH_14.filter((asset) => asset.id === 'dye-maroon-k13-ranger' || asset.id === 'dye-indigo-lib12-small-house' || asset.id === 'dye-saffron-psx-car-01');
    expect(samples.map((asset) => asset.id).sort()).toEqual(['dye-indigo-lib12-small-house', 'dye-maroon-k13-ranger', 'dye-saffron-psx-car-01']);
    for (const asset of samples) {
      const buf = readFileSync(`assets/game-models/${asset.sha256}.glb`);
      const jsonLen = buf.readUInt32LE(12);
      const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
      let meshBottom = 0;
      for (const mesh of doc.meshes ?? []) for (const prim of mesh.primitives ?? []) {
        const acc = doc.accessors?.[prim.attributes?.POSITION];
        if (acc?.min) meshBottom = Math.min(meshBottom, acc.min[1]);
      }
      const body = { x: 4, y: 6, z: 0, pitch: 0, roll: 0, vy: 0, meshBottom, wheels: [], compression: [] };
      const flat = api.dropOnto(body, () => 0, 180);
      const slope = api.dropOnto({ ...body, y: 8 }, (x: number) => 0.25 * x, 180);
      expect(api.meshLowestY(flat) - 0).toBeGreaterThanOrEqual(-api.GROUND_EPSILON);
      expect(api.meshLowestY(slope) - 0.25 * slope.x).toBeGreaterThanOrEqual(-api.GROUND_EPSILON);
    }
  });
});
