import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REVIEWED_LIBRARY_BATCH_15 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch15';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { searchGameLibrary } from '../src/server/AgentV3/gameAssets/gameLibrary';

describe('Indian Modern House H01 — owner-authorized Game Library model', () => {
  const entry = REVIEWED_LIBRARY_BATCH_15[0];
  const built = JSON.parse(execFileSync(process.execPath, ['scripts/library/buildIndianModernHouse.mjs'], { encoding: 'utf8' }));
  const bytes = readFileSync(built.path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const parts = gltf.meshes.flatMap((mesh: { extras?: { parts?: string[] } }) => mesh.extras?.parts ?? []);

  it('rebuilds the exact pinned, self-contained GLB and passes the production asset validator', () => {
    expect(built.sha256).toBe(entry.sha256);
    expect(hash).toBe(entry.sha256);
    expect(bytes.byteLength).toBe(entry.bytes);
    expect(validateGlb(bytes)).toMatchObject({ bytes: entry.bytes, triangles: 1032, animations: [] });
    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.buffers).toHaveLength(1);
    expect(JSON.stringify(gltf)).not.toContain('"uri"');
    expect(gltf.extras.units).toBe('metres');
  });

  it('keeps an open entrance and internal room passages in the geometry', () => {
    expect(parts).toContain('Front_Door_Left_Pier');
    expect(parts).toContain('Front_Door_Right_Pier');
    expect(parts).toContain('Front_Door_Lintel');
    expect(parts).toContain('Partition_X_Left_Front');
    expect(parts).toContain('Partition_Y_Left_A');
    expect(parts).toContain('Kitchen_Counter');
    expect(parts).toContain('Bedroom_Bed_1');
    expect(parts).not.toContain('Front_Door_Leaf');
    expect(gltf.extras.walkthrough.frontDoorOpeningMetres).toBe(1.5);
    expect(gltf.extras.walkthrough.roomDoorwaysOpen).toBe(true);
  });

  it('is searchable for every user under Building and carries the approved CC BY 4.0 terms', () => {
    expect(() => validateCatalogue(REVIEWED_GAME_ASSETS)).not.toThrow();
    expect(gameAssetRequirements('modern house', REVIEWED_GAME_ASSETS)).toEqual([{ subject: 'house' }]);
    const result = searchGameLibrary({ query: 'modern house', category: 'building' });
    expect(result.entries.some(e => e.id === `model:github:${entry.id}:${entry.revision}`)).toBe(true);
    expect(entry.license.spdx).toBe('CC-BY-4.0');
    expect(entry.license.commercial).toBe(true);
    expect(entry.license.redistributeInGame).toBe(true);
    expect(entry.license.redistributeSource).toBe(true);
    expect(entry.license.attribution).toContain('CC BY 4.0');
  });
});
