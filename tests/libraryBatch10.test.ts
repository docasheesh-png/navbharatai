/**
 * Library batch 10 (2026-11-20): Quaternius Downtown City MegaKit (Standard, CC0), the admin's own download — the whole
 * buildings, city street tiles, sidewalks and street props a game can place (the kit's modular wall pieces are left out).
 * The kit's vertex colours are a wear mask for its own engine shader; three.js painted them as red streaks, so the
 * conversion removes them — locked here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REVIEWED_LIBRARY_BATCH_10 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch10';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';

const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-10-admission.json', 'utf8')) as { results: { id: string; verdict: string; sha256: string }[] }).results.map(r => [r.id, r]));
const subjects = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map(r => r.subject).sort();

describe('library batch 10 — Downtown City MegaKit, packaged', () => {
  it('16 entries: CC0 Quaternius, exact file, admitted live, real metres', () => {
    validateCatalogue(REVIEWED_LIBRARY_BATCH_10);
    expect(REVIEWED_LIBRARY_BATCH_10).toHaveLength(16);
    for (const a of REVIEWED_LIBRARY_BATCH_10) {
      expect(a).toMatchObject({ provider: 'quaternius', packaged: true, license: { spdx: 'CC0-1.0', evidenceUrl: 'https://quaternius.com/packs/downtowncitymegakit.html' } });
      const bytes = readFileSync(`assets/game-models/${a.sha256}.glb`);
      expect([bytes.length, createHash('sha256').update(bytes).digest('hex')], a.id).toEqual([a.bytes, a.sha256]);
      validateGlb(bytes);
      expect([admitted.get(a.id)?.verdict, admitted.get(a.id)?.sha256], a.id).toEqual(['admitted', a.sha256]);
    }
    expect(REVIEWED_LIBRARY_BATCH_10.find(a => a.id === 'q10-city-building')!.height).toBe(28);
  });

  it('the kit\'s wear mask (vertex colours) is gone from every model — it rendered as red streaks', () => {
    for (const a of REVIEWED_LIBRARY_BATCH_10) {
      const b = readFileSync(`assets/game-models/${a.sha256}.glb`);
      const doc = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as { meshes: { primitives: { attributes: Record<string, number> }[] }[] };
      for (const m of doc.meshes) for (const p of m.primitives) expect(Object.keys(p.attributes), a.id).not.toContain('COLOR_0');
    }
  });

  it('real prompts, English and Hindi, get the city pieces; a named kind is not the generic one too', () => {
    expect(subjects('city game with office buildings, a crossroads and a footpath')).toEqual(['city building', 'city crossroads', 'sidewalk']);
    expect(subjects('चौराहा और फुटपाथ')).toEqual(['city crossroads', 'sidewalk']);
    expect(subjects('a building with a planter and an air conditioner')).toEqual(['ac unit', 'building', 'planter']);
    expect(subjects('city street curve')).toEqual(['city street curve']);
    expect(subjects('old building')).toEqual(['heritage building']);
    expect(subjects('a footpath corner')).toEqual(['sidewalk corner']);
    expect(subjects('building a city')).toEqual([]);
  });
});
