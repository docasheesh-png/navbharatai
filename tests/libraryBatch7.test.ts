/**
 * Library batch 7 (2026-11-20): the library's first clothed, fully animated characters, assembled offline from three of
 * the admin's own CC0 Quaternius packs on one shared rig and PACKAGED in the server image. Each must name a real file of
 * exactly the reviewed size and hash, must have passed the live admission with EVERY moving role proven to animate in a
 * browser, and must only answer its own new subjects — an existing "man"/"woman" request keeps the model it had.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REVIEWED_LIBRARY_BATCH_7 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch7';
import { REVIEWED_LIBRARY_BATCH_4 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch4';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { candidateMatches, validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';

type Proof = { id: string; verdict: string; sha256: string; bytes: number; proofs: { animation: string | null; animated: boolean }[] };
const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-7-admission.json', 'utf8')) as { results: Proof[] }).results.map(r => [r.id, r]));
const reqs = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS);

describe('library batch 7 — clothed, animated Quaternius characters, packaged', () => {
  it('4 characters: CC0 Quaternius, packaged, every role a real clip in the file', () => {
    validateCatalogue(REVIEWED_LIBRARY_BATCH_7);
    expect(REVIEWED_LIBRARY_BATCH_7.map(a => a.id)).toEqual(['q7-villager-man', 'q7-villager-woman', 'q7-ranger-man', 'q7-ranger-woman']);
    for (const a of REVIEWED_LIBRARY_BATCH_7) {
      expect(a).toMatchObject({ provider: 'quaternius', packaged: true, libraryCategory: 'character' });
      expect(a.license).toMatchObject({ spdx: 'CC0-1.0', author: 'Quaternius', commercial: true, redistributeInGame: true, redistributeSource: true });
      // All three source packs are named, with the archive each part came from.
      for (const pack of ['Universal Base Characters', 'Modular Character Outfits - Fantasy', 'Universal Animation Library']) expect(a.license.attribution).toContain(pack);
      const bytes = readFileSync(`assets/game-models/${a.sha256}.glb`);
      const model = validateGlb(bytes);
      expect(model.animations.sort()).toEqual([...a.animations].sort());
      for (const [role, clip] of Object.entries(a.animationRoles ?? {})) expect(a.animations, role).toContain(clip);
    }
  });

  it('every packaged file has exactly the reviewed size and hash, and passed admission with each moving role animated', () => {
    for (const a of REVIEWED_LIBRARY_BATCH_7) {
      const path = `assets/game-models/${a.sha256}.glb`;
      expect(statSync(path).size, a.id).toBe(a.bytes);
      expect(createHash('sha256').update(readFileSync(path)).digest('hex'), a.id).toBe(a.sha256);
      const proof = admitted.get(a.id)!;
      expect(proof.verdict, a.id).toBe('admitted');
      expect([proof.sha256, proof.bytes]).toEqual([a.sha256, a.bytes]);
      const moving = Object.entries(a.animationRoles ?? {}).filter(([role]) => role !== 'idle').map(([, clip]) => clip);
      for (const clip of moving) expect(proof.proofs.some(p => p.animation === clip && p.animated), `${a.id} ${clip}`).toBe(true);
    }
  });

  it('every part is changeable by a plain name: materials Skin/Hair/Eyes/Clothes, nodes Head/Body/Arms/Legs…', () => {
    // assetCustomizations.ts matches `colors` by material name and `hide` by node name. Pack names such as
    // "MI_Superhero_Male" or "Sphere.005_Retopology.004" would make "make the hair red" / "hide the hood" unreachable.
    const gltfJson = (bytes: Buffer) => JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as { materials: { name: string }[]; nodes: { name?: string; mesh?: number }[] };
    for (const a of REVIEWED_LIBRARY_BATCH_7) {
      const json = gltfJson(readFileSync(`assets/game-models/${a.sha256}.glb`));
      expect(new Set(json.materials.map(m => m.name)), a.id).toEqual(new Set(['Skin', 'Hair', 'Eyes', 'Clothes']));
      const parts = json.nodes.filter(n => n.mesh !== undefined).map(n => n.name ?? '');
      for (const part of ['Head', 'Eyes', 'Eyebrows', 'Body', 'Arms', 'Legs']) expect(parts, a.id).toContain(part);
      expect(parts.every(n => /^[A-Z][A-Za-z]*(_[A-Za-z0-9]+)*$/.test(n)), `${a.id}: ${parts.join(',')}`).toBe(true);
      if (a.id.startsWith('q7-ranger')) expect(parts).toContain('Hood');
    }
  });

  it('real prompts, English and Hindi, get the characters with the asked motion', () => {
    expect(reqs('गाँव वाला दौड़ता है')).toEqual([{ subject: 'villager', animation: 'run' }]);
    expect(reqs('a village game with villagers walking')).toEqual([{ subject: 'villager', animation: 'walk' }]);
    expect(reqs('jungle game with a shikari and a तीरंदाज')).toEqual([{ subject: 'archer' }, { subject: 'hunter' }]);
    expect(reqs('a village woman fetching water')).toEqual([{ subject: 'village woman' }]);
    expect(REVIEWED_LIBRARY_BATCH_7.filter(a => candidateMatches(a, { subject: 'village woman', animation: 'run' })).map(a => a.id)).toEqual(['q7-villager-woman']);
  });

  it('a named thing that is not this character matches nothing, and a named kind is not also the generic subject', () => {
    expect(reqs('power rangers fighting game')).toEqual([]);
    expect(reqs('treasure hunter adventure')).toEqual([]);
    expect(reqs('old man and village man').map(r => r.subject)).toEqual(['old man', 'village man']);
    expect(reqs('a village woman').map(r => r.subject)).not.toContain('woman');
  });

  it('"man" and "woman" keep the models they had: no batch 7 entry answers them', () => {
    for (const subject of ['man', 'woman', 'farmer']) expect(REVIEWED_LIBRARY_BATCH_7.filter(a => candidateMatches(a, { subject }))).toEqual([]);
    expect(REVIEWED_LIBRARY_BATCH_4.some(a => candidateMatches(a, { subject: 'man' }))).toBe(true);
  });
});
