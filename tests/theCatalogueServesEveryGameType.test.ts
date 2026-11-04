/**
 * L3 step 2 (admin 2026-11-04): the reviewed catalogue grows from 7 to 35 CC0 models (KayKit City / Medieval
 * Hexagon / Prototype Bits), admitted with scripts/gameAssetAdmitGltf.mjs — which reproduced the existing reviewed
 * building_A entry byte for byte (same source and derived sha256, 70,720 bytes, 828 triangles).
 */
import { describe, expect, it } from 'vitest';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';

const subjects = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map((r) => r.subject).sort();

describe('the expanded catalogue', () => {
  it('is valid, within its 64-model bound, and every new entry is pinned CC0 KayKit with its own pack licence', () => {
    validateCatalogue(REVIEWED_GAME_ASSETS);
    expect(REVIEWED_GAME_ASSETS.length).toBeGreaterThanOrEqual(35);
    expect(REVIEWED_GAME_ASSETS.length).toBeLessThanOrEqual(64);
    const added = REVIEWED_GAME_ASSETS.filter((a) => a.license.reviewedAt === '2026-11-04');
    expect(added.length).toBe(28);
    for (const a of added) {
      expect(a.provider).toBe('kaykit');
      expect(a.license.spdx).toBe('CC0-1.0');
      expect(a.downloadUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/KayKit-Game-Assets\/[^/]+\/[0-9a-f]{40}\//);
      expect(a.license.evidenceUrl).toContain(a.revision);
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.resources!.length).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
    }
    expect(new Set(REVIEWED_GAME_ASSETS.map((a) => a.id)).size).toBe(REVIEWED_GAME_ASSETS.length);
  });
  it('each game type finds its models from the words a user types (English, Hindi, Spanish)', () => {
    expect(subjects('a shooting game with targets, barrels and walls')).toEqual(['barrel', 'target', 'wall']);
    expect(subjects('गाँव का खेल: घर, पेड़, कुआँ और पवनचक्की')).toEqual(['house', 'tree', 'well', 'windmill']);
    expect(subjects('city racing with buildings, traffic lights and a taxi')).toEqual(['building', 'taxi', 'traffic light']);
    expect(subjects('carrera en las montañas con árboles')).toEqual(expect.arrayContaining(['mountain']));
  });
  it('🔒 ordinary words never pull in a model nobody asked for', () => {
    expect(subjects('make a puzzle that runs well on phones')).not.toContain('well');
    expect(subjects('a clean home screen with a score')).not.toContain('house');
  });
});
