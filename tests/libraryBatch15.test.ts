import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REVIEWED_LIBRARY_BATCH_15 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch15';
import { REVIEWED_GAME_ASSETS, validateCatalogue, catalogueStorageBytes, CATALOGUE_STORAGE_BUDGET_BYTES } from '../src/server/AgentV3/gameAssets/providers';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';

describe('public Indian modern duplex walkthrough asset', () => {
  const asset = REVIEWED_LIBRARY_BATCH_15[0];

  it('is admitted to the public catalogue with an explicit commercial redistribution license', () => {
    expect(REVIEWED_LIBRARY_BATCH_15).toHaveLength(1);
    expect(() => validateCatalogue(REVIEWED_GAME_ASSETS)).not.toThrow();
    expect(catalogueStorageBytes(REVIEWED_GAME_ASSETS)).toBeLessThanOrEqual(CATALOGUE_STORAGE_BUDGET_BYTES);
    expect(asset.libraryCategory).toBe('building');
    expect(asset.subjects).toContain('walkable house');
    expect(asset.packaged).toBe(true);
    expect(asset.packagedCompression).toBe('gzip');
    expect(asset.license.spdx).toBe('CC-BY-4.0');
    expect(asset.license.commercial).toBe(true);
    expect(asset.license.redistributeInGame).toBe(true);
    expect(asset.license.redistributeSource).toBe(true);
    expect(asset.license.attribution).toContain('CC BY 4.0');
  });

  it('decompresses to the exact pinned GLB and validates its interior walkthrough geometry', () => {
    const packed = readFileSync(`assets/game-models/${asset.sha256}.glb.gz`);
    const bytes = gunzipSync(packed, { maxOutputLength: 5 * 1024 * 1024 });
    expect(bytes.length).toBe(asset.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    const stats = validateGlb(bytes);
    expect(stats.bytes).toBe(asset.bytes);
    expect(stats.triangles).toBeGreaterThan(1_000);
    expect(stats.triangles).toBeLessThanOrEqual(60_000);
    expect(stats.animations).toEqual([]);
    const jsonLength = bytes.readUInt32LE(12);
    const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
    expect(doc.nodes.length).toBeGreaterThan(100);
    expect(doc.meshes.length).toBeGreaterThan(100);
    expect(doc.images ?? []).toHaveLength(0);
    const names = new Set(doc.nodes.map((node: { name?: string }) => node.name));
    for (const name of ['GroundFloor_Walkable', 'FrontWall_Ground_L', 'Bedroom_BedBase', 'Kitchen_Counter', 'Stair_Tread_14', 'UpperFloor_StairwellFront']) {
      expect(names.has(name), `missing walkthrough geometry node: ${name}`).toBe(true);
    }
  });

  it('keeps the public attribution notice alongside the asset', () => {
    const notice = readFileSync('assets/game-models/indian-modern-house-LICENSE.txt', 'utf8');
    expect(notice).toContain('CC BY 4.0');
    expect(notice).toContain('Required attribution');
    expect(notice).toContain('commercially');
    expect(notice).toContain('NavMesh');
  });
});
