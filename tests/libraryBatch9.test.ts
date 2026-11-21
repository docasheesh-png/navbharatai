/**
 * Library batch 9 (2026-11-20): Quaternius Farm Animal Pack (CC0), the admin's own download — the library's farm animals
 * stood still; these move. FBX-only pack, converted offline (scripts/library/fbxToGlb.mjs) and PACKAGED. Two conversion
 * defects were found and are locked here: every material came out fully transparent (invisible animals), and a cow came
 * out as 106 primitives (over the validator's 64).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REVIEWED_LIBRARY_BATCH_9 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch9';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { candidateMatches, validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';

type Proof = { id: string; verdict: string; sha256: string; bytes: number; proofs: { animation: string | null; animated: boolean }[] };
const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-9-admission.json', 'utf8')) as { results: Proof[] }).results.map(r => [r.id, r]));
const glbJson = (b: Buffer) => JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as { materials: { alphaMode?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[]; meshes: { primitives: unknown[] }[] };

describe('library batch 9 — animated farm animals, packaged', () => {
  it('7 animals: CC0 Quaternius, exact file, admitted live, every moving role animated', () => {
    validateCatalogue(REVIEWED_LIBRARY_BATCH_9);
    expect(REVIEWED_LIBRARY_BATCH_9.map(a => a.id)).toEqual(['q9-cow', 'q9-horse', 'q9-zebra', 'q9-llama', 'q9-pig', 'q9-sheep', 'q9-pug']);
    for (const a of REVIEWED_LIBRARY_BATCH_9) {
      expect(a).toMatchObject({ provider: 'quaternius', packaged: true, libraryCategory: 'animal', license: { spdx: 'CC0-1.0', evidenceUrl: 'https://quaternius.com/packs/farmanimal.html' } });
      const bytes = readFileSync(`assets/game-models/${a.sha256}.glb`);
      expect([bytes.length, createHash('sha256').update(bytes).digest('hex')], a.id).toEqual([a.bytes, a.sha256]);
      expect(validateGlb(bytes).animations.sort()).toEqual([...a.animations].sort());
      const proof = admitted.get(a.id)!;
      expect([proof.verdict, proof.sha256], a.id).toEqual(['admitted', a.sha256]);
      for (const [role, clip] of Object.entries(a.animationRoles ?? {})) if (role !== 'idle') expect(proof.proofs.some(p => p.animation === clip && p.animated), `${a.id} ${clip}`).toBe(true);
    }
  });

  it('the two conversion defects stay fixed: no material is see-through, and each mesh is a few primitives', () => {
    for (const a of REVIEWED_LIBRARY_BATCH_9) {
      const doc = glbJson(readFileSync(`assets/game-models/${a.sha256}.glb`));
      for (const m of doc.materials) {
        expect(m.alphaMode ?? 'OPAQUE', a.id).toBe('OPAQUE');
        expect(m.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1, a.id).toBe(1);
      }
      for (const mesh of doc.meshes) expect(mesh.primitives.length, a.id).toBeLessThanOrEqual(4);
    }
  });

  it('a cow or horse that walks or runs gets an animal that moves; prompts in English and Hindi', () => {
    expect(REVIEWED_GAME_ASSETS.filter(c => candidateMatches(c, { subject: 'cow', animation: 'walk' })).map(c => c.id)).toEqual(['q9-cow']);
    expect(REVIEWED_GAME_ASSETS.some(c => c.id === 'q9-horse' && candidateMatches(c, { subject: 'horse', animation: 'run' }))).toBe(true);
    expect(gameAssetRequirements('farm game with a cow walking, pigs and sheep', REVIEWED_GAME_ASSETS)).toEqual([{ subject: 'cow', animation: 'walk' }, { subject: 'pig' }, { subject: 'sheep' }]);
    expect(gameAssetRequirements('गाय और भेड़ वाला खेत', REVIEWED_GAME_ASSETS).map(r => r.subject)).toEqual(['cow', 'sheep']);
    expect(['gaay', 'bhed', 'suar'].map(w => gameAssetRequirements(w, REVIEWED_GAME_ASSETS)[0]?.subject)).toEqual(['cow', 'sheep', 'pig']);
    expect(gameAssetRequirements('a zebra running in the jungle', REVIEWED_GAME_ASSETS)).toEqual([{ subject: 'zebra', animation: 'run' }]);
  });

  it('a named kind is not the farm animal too', () => {
    expect(gameAssetRequirements('guinea pig pet game', REVIEWED_GAME_ASSETS)).toEqual([]);
    expect(gameAssetRequirements('wild pig hunt', REVIEWED_GAME_ASSETS).map(r => r.subject)).toEqual(['wild pig']);
    expect(gameAssetRequirements('sea horse aquarium', REVIEWED_GAME_ASSETS).map(r => r.subject)).toEqual(['seahorse']);
    expect(gameAssetRequirements('a farm cow and a farm horse', REVIEWED_GAME_ASSETS).map(r => r.subject)).toEqual(['farm cow', 'farm horse']);
  });
});
