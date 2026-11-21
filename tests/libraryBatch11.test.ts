/**
 * Library batch 11 (2026-11-21): Quaternius Medieval Village MegaKit (Standard, CC0), the admin's own download. The kit has
 * no whole house — only 2 m modular pieces — so two whole village houses were ASSEMBLED from them offline (walls with a door
 * and windows, floor, roof with CLOSED gables; the first assembly left the gables open and the inside showed), plus props.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REVIEWED_LIBRARY_BATCH_11 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch11';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';

const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-11-admission.json', 'utf8')) as { results: { id: string; verdict: string; sha256: string }[] }).results.map(r => [r.id, r]));
const subjects = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map(r => r.subject).sort();
const glbJson = (b: Buffer) => JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as { meshes: { primitives: { attributes: Record<string, number> }[] }[] };

describe('library batch 11 — Medieval Village: whole houses assembled from the kit, and props', () => {
  it('7 entries: CC0 Quaternius, exact file, admitted live', () => {
    validateCatalogue(REVIEWED_LIBRARY_BATCH_11);
    expect(REVIEWED_LIBRARY_BATCH_11.map(a => a.id)).toEqual(['q11-village-house', 'q11-cottage', 'q11-wagon', 'q11-wooden-fence', 'q11-stone-stairs', 'q11-chimney', 'q11-vine']);
    for (const a of REVIEWED_LIBRARY_BATCH_11) {
      expect(a).toMatchObject({ provider: 'quaternius', packaged: true, license: { spdx: 'CC0-1.0', evidenceUrl: 'https://quaternius.com/packs/medievalvillagemegakit.html' } });
      const bytes = readFileSync(`assets/game-models/${a.sha256}.glb`);
      expect([bytes.length, createHash('sha256').update(bytes).digest('hex')], a.id).toEqual([a.bytes, a.sha256]);
      validateGlb(bytes);
      for (const m of glbJson(bytes).meshes) for (const p of m.primitives) expect(Object.keys(p.attributes), a.id).not.toContain('COLOR_0');
      expect([admitted.get(a.id)?.verdict, admitted.get(a.id)?.sha256], a.id).toEqual(['admitted', a.sha256]);
    }
  });

  it('the houses are whole buildings (about 5.5 m square with the roof overhang, 7 m tall), not a single kit piece', () => {
    for (const id of ['q11-village-house', 'q11-cottage']) {
      const a = REVIEWED_LIBRARY_BATCH_11.find(x => x.id === id)!;
      expect(a.height).toBeGreaterThan(6.5);
      expect(validateGlb(readFileSync(`assets/game-models/${a.sha256}.glb`)).triangles).toBeGreaterThan(2500);
      expect(a.license.attribution).toMatch(/assembled offline/);
    }
  });

  it('real prompts, English and Hindi; a named kind is not the generic one, and a shopping cart is not a wagon', () => {
    expect(subjects('a village with village houses, a wagon and a wooden fence')).toEqual(['village house', 'wagon', 'wooden fence']);
    expect(subjects('गाँव का घर और बेल')).toEqual(['village house', 'vine']);
    expect(subjects('a cottage with a chimney')).toEqual(['chimney', 'cottage']);
    expect(subjects('shopping cart checkout game')).toEqual([]);
    expect(subjects('a food cart in the market')).toEqual(['food cart', 'market']);
    expect(subjects('a house and a fence')).toEqual(['fence', 'house']);
    expect(subjects('मेरा घर')).toEqual(['house']);
  });
});
