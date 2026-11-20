/**
 * Library batch 6 (2026-11-20): the admin's own Quaternius downloads — Ultimate Gun Pack (the library's first firearms)
 * and Realistic Car Pack. Converted offline (OBJ+MTL → GLB) and PACKAGED in the server image, so each entry must name a
 * real file whose size and hash are exactly the reviewed ones, and must have passed the live admission (browser render).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REVIEWED_LIBRARY_BATCH_6 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch6';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { downloadReviewedAsset } from '../src/server/AgentV3/gameAssets/assetTransport';

type Proof = { id: string; verdict: string; sha256: string; bytes: number };
const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-6-admission.json', 'utf8')) as { results: Proof[] }).results.map(r => [r.id, r]));
const subjects = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map(r => r.subject).sort();

describe('library batch 6 — Quaternius guns and cars, packaged', () => {
  it('19 entries: CC0 Quaternius, evidence on the pack page, admitted live', () => {
    validateCatalogue(REVIEWED_LIBRARY_BATCH_6);
    expect(REVIEWED_LIBRARY_BATCH_6).toHaveLength(19);
    for (const a of REVIEWED_LIBRARY_BATCH_6) {
      expect(a.provider).toBe('quaternius');
      expect(a.packaged).toBe(true);
      expect(a.license).toMatchObject({ spdx: 'CC0-1.0', author: 'Quaternius', commercial: true, redistributeInGame: true, redistributeSource: true });
      expect(a.license.evidenceUrl).toMatch(/^https:\/\/quaternius\.com\/packs\/(cars|ultimategun)\.html$/);
      expect(a.review.evidenceRevision).toMatch(/^[0-9a-f]{64}$/);
      const proof = admitted.get(a.id);
      expect(proof?.verdict, a.id).toBe('admitted');
      expect(proof!.sha256).toBe(a.sha256);
      expect(proof!.bytes).toBe(a.bytes);
    }
  });

  it('every packaged file exists with exactly the reviewed size and hash', () => {
    for (const a of REVIEWED_GAME_ASSETS.filter(c => c.packaged)) {
      const path = `assets/game-models/${a.sha256}.glb`;
      expect(statSync(path).size, a.id).toBe(a.bytes);
      expect(createHash('sha256').update(readFileSync(path)).digest('hex'), a.id).toBe(a.sha256);
    }
  });

  it('the transport serves a packaged model from the image and refuses an altered entry', async () => {
    const pistol = REVIEWED_LIBRARY_BATCH_6.find(a => a.id === 'q6-gun-pistol')!;
    const bytes = await downloadReviewedAsset(pistol, new AbortController().signal);
    expect(bytes.length).toBe(pistol.bytes);
    await expect(downloadReviewedAsset({ ...pistol, sha256: 'f'.repeat(64) }, new AbortController().signal)).rejects.toThrow('Unreviewed packaged');
    await expect(downloadReviewedAsset({ ...pistol, id: 'not-in-catalogue' }, new AbortController().signal)).rejects.toThrow('Unreviewed packaged');
    await expect(downloadReviewedAsset({ ...pistol, bytes: (pistol.bytes ?? 0) + 1 }, new AbortController().signal)).rejects.toThrow('Unreviewed packaged');
  });

  it('a packaged entry from any other provider or licence is refused', () => {
    const pistol = REVIEWED_LIBRARY_BATCH_6.find(a => a.id === 'q6-gun-pistol')!;
    expect(() => validateCatalogue([{ ...pistol, provider: 'github' } as never])).toThrow('Unreviewed packaged');
    expect(() => validateCatalogue([{ ...pistol, license: { ...pistol.license, spdx: 'CC-BY-4.0', attribution: 'x' } } as never])).toThrow('Unreviewed packaged');
  });

  it('real prompts, English and Hindi, get the new models — and a named car is not also "a car"', () => {
    expect(subjects('bgmi jaisa game with pistol, sniper and a jeep')).toEqual(['pistol', 'sniper rifle', 'suv']);
    expect(subjects('शूटर गेम जिसमें बंदूक और पुलिस कार हो')).toEqual(['gun', 'police car']);
    expect(subjects('racing game with sports cars and a taxi')).toEqual(['sports car', 'taxi']);
    expect(subjects('a shooter with an AK47, shotgun and smg')).toEqual(['assault rifle', 'shotgun', 'smg']);
    expect(subjects('a space game with a laser gun')).not.toContain('gun');
  });
});
