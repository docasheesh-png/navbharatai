/**
 * Drive packs admitted 2026-11-23. Vuena CC0 from the archive licence, KayKit Adventurers extras that
 * batch 8 did not already have, and the eight GGBot PSX cars. N1 characters were over the GLB limits.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { REVIEWED_LIBRARY_BATCH_13 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch13';
import { validateCatalogue, catalogueStorageBytes, CATALOGUE_STORAGE_BUDGET_BYTES, REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';
import { GROUND_CONTACT_SOURCE } from '../src/server/lib/groundContact';

describe('drive pack models', () => {
  it('are CC0, packaged, inside the limits, and the catalogue still fits', () => {
    validateCatalogue(REVIEWED_GAME_ASSETS);
    expect(catalogueStorageBytes(REVIEWED_GAME_ASSETS)).toBeLessThanOrEqual(CATALOGUE_STORAGE_BUDGET_BYTES);
    const ids = REVIEWED_LIBRARY_BATCH_13.map(a => a.id);
    expect(ids.filter(id => id.startsWith('vuena-'))).toHaveLength(54);
    expect(ids.filter(id => id.startsWith('market-'))).toHaveLength(8);
    expect(ids).toContain('k13-ranger');
    expect(ids.filter(id => id.startsWith('psx-car-'))).toHaveLength(8);
    expect(ids.some(id => id.startsWith('n1-'))).toBe(false);
    for (const a of REVIEWED_LIBRARY_BATCH_13) {
      expect(a.license.spdx).toBe('CC0-1.0');
      expect(a.packaged).toBe(true);
      const bytes = readFileSync(`assets/game-models/${a.sha256}.glb`);
      expect(bytes.length).toBe(a.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256);
      const stats = validateGlb(bytes);
      expect(stats.triangles).toBeLessThanOrEqual(60_000);
      expect(stats.bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    }
  });

  it('the eight PSX cars stay on flat ground and on a slope', () => {
    const js = ts.transpileModule(GROUND_CONTACT_SOURCE, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const api: { dropOnto: Function; meshLowestY: Function; GROUND_EPSILON: number } = { dropOnto() {}, meshLowestY() { return 0; }, GROUND_EPSILON: 0 };
    new Function('exports', 'require', js)(api, () => { throw new Error('no'); });
    for (const car of REVIEWED_LIBRARY_BATCH_13.filter(a => a.id.startsWith('psx-car-'))) {
      const buf = readFileSync(`assets/game-models/${car.sha256}.glb`);
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
