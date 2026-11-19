/**
 * L3 step 2 (admin 2026-11-04): the reviewed catalogue grows from 7 to 35 CC0 models (KayKit City / Medieval
 * Hexagon / Prototype Bits), admitted with scripts/gameAssetAdmitGltf.mjs — which reproduced the existing reviewed
 * building_A entry byte for byte (same source and derived sha256, 70,720 bytes, 828 triangles).
 */
import { describe, expect, it } from 'vitest';
import { REVIEWED_GAME_ASSETS, validateCatalogue, catalogueStorageBytes, CATALOGUE_STORAGE_BUDGET_BYTES } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';

const subjects = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map((r) => r.subject).sort();

describe('the expanded catalogue', () => {
  it('is valid, within its storage budget (was a 64-model bound until 2026-11-19), and every new entry is pinned CC0 KayKit with its own pack licence', () => {
    validateCatalogue(REVIEWED_GAME_ASSETS);
    expect(REVIEWED_GAME_ASSETS.length).toBeGreaterThanOrEqual(35);
    expect(catalogueStorageBytes(REVIEWED_GAME_ASSETS)).toBeLessThanOrEqual(CATALOGUE_STORAGE_BUDGET_BYTES);
    const added = REVIEWED_GAME_ASSETS.filter((a) => a.license.reviewedAt === '2026-11-04' && a.format === 'gltf');
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

describe('🔴 the boxer: the reviewed Knight, unarmed, with fighting clips', () => {
  const boxer = REVIEWED_GAME_ASSETS.find((a) => a.id === 'adventurers-knight-boxer')!;
  const knight = REVIEWED_GAME_ASSETS.find((a) => a.id === 'adventurers-knight')!;
  it('is the SAME reviewed source revision and licence, with its own pinned derived hash', () => {
    expect(boxer.sourceSha256).toBe(knight.sourceSha256);
    expect(boxer.revision).toBe(knight.revision);
    expect(boxer.license.spdx).toBe('CC0-1.0');
    expect(boxer.sha256).toBe('6ff3a06ff489023e09246cf9cf21c97592943a63b34c5cec39ed8d7a6b7a6ac8');
    expect(boxer.optimization).toBe('animation-selection-v1');
  });
  it('carries the fighting roles and hides every weapon, shield, cape and helmet', () => {
    expect(boxer.animationRoles).toMatchObject({ idle: 'Unarmed_Idle', punch: 'Unarmed_Melee_Attack_Punch_A', block: 'Block', hit: 'Hit_A' });
    expect([...(boxer.hiddenNodes ?? [])].sort()).toEqual(['1H_Sword', '1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Knight_Cape', 'Knight_Helmet', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield']);
  });
  it('a boxing prompt (English / Hindi) asks for it', () => {
    expect(subjects('3D boxing game with two boxers')).toEqual(['boxer']);
    expect(subjects('मुक्केबाज़ी नहीं, बॉक्सर वाला गेम')).toContain('boxer');
  });
  it('🔒 hidden-node names are validated like everything else in a review', () => {
    expect(() => validateCatalogue([{ ...boxer, hiddenNodes: ['../evil'] }])).toThrow();
    expect(() => validateCatalogue([{ ...boxer, hiddenNodes: Array(33).fill('X') }])).toThrow();
  });
});
