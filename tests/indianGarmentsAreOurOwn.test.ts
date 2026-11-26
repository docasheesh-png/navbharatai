/**
 * Admin 2026-11-25: "haan, Indian kapde banana shuru karo". Library batch 16 is NavBharatAI's OWN kurta-pajama, pagdi, dhoti
 * and saree, made from geometry (scripts/library/buildIndianGarments.mts) on the CC0 batch-7 villager bodies — the three
 * downloaded Indian-clothing models could not be licensed, so none of them is used. These lock what makes them real:
 *   - the files are the reviewed bytes, packaged, admitted live (rendered and animated in a browser);
 *   - each garment is its own node and material, so a game can recolour or hide it by name;
 *   - the whole body is back under the clothes (the villager carried only its head's faces), and the fantasy outfit is gone;
 *   - every garment is skinned to the same rig, its weights valid; a hem follows the pelvis and both thighs, a pagdi the head;
 *   - words in English, Hindi and Hinglish find them, and one person is one model.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REVIEWED_LIBRARY_BATCH_16 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch16';
import { REVIEWED_LIBRARY_BATCH_7 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch7';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';
import { readGlb, readAccessor, sha256, type Glb } from '../scripts/library/glbEdit.mts';
import { thumbnailPoseClip } from '../src/server/AgentV3/gameAssets/libraryThumbnails';

const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-16-admission.json', 'utf8')) as { results: { id: string; verdict: string; sha256: string; proofs: { animated: boolean; animation: string | null }[] }[] }).results.map(r => [r.id, r]));
const model = (id: string): Glb => readGlb(readFileSync(`assets/game-models/${REVIEWED_LIBRARY_BATCH_16.find(a => a.id === id)!.sha256}.glb`));
const meshNode = (g: Glb, name: string) => g.json.nodes.find((n: { name?: string; mesh?: number }) => n.name === name && n.mesh !== undefined);
const req = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS);

const GARMENTS: Record<string, string[]> = {
  'q16-man-kurta-pajama': ['Kurta', 'Pajama'],
  'q16-man-pagdi': ['Kurta', 'Pajama', 'Pagdi'],
  'q16-man-dhoti': ['Kurta', 'Dhoti', 'Pagdi'],
  'q16-woman-saree': ['Blouse', 'Saree', 'Pallu'],
};

describe('library batch 16 — Indian garments made by NavBharatAI', () => {
  it('four packaged CC0 models: exact bytes, valid, 16 clips with the villager roles, admitted live and proven to move', () => {
    validateCatalogue(REVIEWED_GAME_ASSETS);
    expect(REVIEWED_LIBRARY_BATCH_16.map(a => a.id).sort()).toEqual(Object.keys(GARMENTS).sort());
    for (const a of REVIEWED_LIBRARY_BATCH_16) {
      const bytes = readFileSync(`assets/game-models/${a.sha256}.glb`);
      expect([bytes.length, sha256(bytes)], a.id).toEqual([a.bytes, a.sha256]);
      expect(validateGlb(bytes).animations).toHaveLength(16);
      const base = REVIEWED_LIBRARY_BATCH_7.find(v => v.id === (a.id.includes('woman') ? 'q7-villager-woman' : 'q7-villager-man'))!;
      expect(a).toMatchObject({ provider: 'quaternius', packaged: true, libraryCategory: 'character', animationRoles: base.animationRoles, license: { spdx: 'CC0-1.0' } });
      expect(a.license.attribution).toMatch(/MADE by NavBharatAI from geometry[\s\S]*no downloaded garment/);
      const proof = admitted.get(a.id)!;
      expect([proof.verdict, proof.sha256], a.id).toEqual(['admitted', a.sha256]);
      expect(proof.proofs.filter(p => p.animation).every(p => p.animated), a.id).toBe(true);
    }
  });

  it('each garment is its own node and material (changeable by name); the fantasy outfit carries no mesh; a pagdi replaces the hair', () => {
    for (const [id, garments] of Object.entries(GARMENTS)) {
      const g = model(id);
      for (const name of garments) {
        expect(meshNode(g, name), `${id} ${name}`).toBeTruthy();
        expect(g.json.materials.some((m: { name?: string }) => m.name === name), `${id} material ${name}`).toBe(true);
      }
      for (const old of ['Arms', 'Body', 'Legs', 'Feet']) expect(meshNode(g, old), `${id} still wears ${old}`).toBeUndefined();
      expect(!!meshNode(g, 'Hair'), `${id} hair`).toBe(!garments.includes('Pagdi'));
    }
    expect(model('q16-woman-saree').json.materials.some((m: { name?: string }) => m.name === 'Border')).toBe(true);
  });

  it('the whole body is back under the clothes — the villager mesh had only its head\'s faces (1683 of 7281 vertices used)', () => {
    for (const id of Object.keys(GARMENTS)) {
      const g = model(id);
      const prim = g.json.meshes[meshNode(g, 'Head').mesh].primitives[0];
      const used = new Set(readAccessor(g, prim.indices).data);
      const pos = readAccessor(g, prim.attributes.POSITION).data;
      expect(used.size / (pos.length / 3), id).toBeGreaterThan(0.95);
      expect(Math.min(...[...used].map(i => pos[i * 3 + 1])), `${id} lowest body point`).toBeLessThan(0.05); // down to the feet
    }
  });

  it('every garment is skinned to the body\'s rig with valid weights; a hem follows the pelvis and both thighs; a pagdi follows the head', () => {
    for (const [id, garments] of Object.entries(GARMENTS)) {
      const g = model(id);
      const head = meshNode(g, 'Head');
      const joints = g.json.skins[head.skin].joints.map((j: number) => g.json.nodes[j].name as string);
      for (const name of garments) {
        const node = meshNode(g, name);
        expect(node.skin, `${id} ${name}`).toBe(head.skin);
        const used = new Set<string>(); // bones that move this garment, across its parts
        for (const prim of g.json.meshes[node.mesh].primitives) {
          const w = readAccessor(g, prim.attributes.WEIGHTS_0).data, j = readAccessor(g, prim.attributes.JOINTS_0).data;
          for (let v = 0; v < w.length; v += 4) {
            expect(Math.abs(w[v] + w[v + 1] + w[v + 2] + w[v + 3] - 1)).toBeLessThan(1e-3);
            for (let c = 0; c < 4; c++) if (w[v + c] > 0) expect(j[v + c]).toBeLessThan(joints.length);
          }
          for (let v = 0; v < w.length; v++) if (w[v] > 0.05) used.add(joints[j[v]]);
        }
        if (name === 'Pagdi') expect([...used]).toEqual(['Head']);
        if (name === 'Saree' || name === 'Dhoti') for (const bone of ['pelvis', 'thigh_l', 'thigh_r']) expect(used.has(bone), `${id} ${name} ${bone}`).toBe(true);
        if (name === 'Kurta') for (const bone of ['upperarm_l', 'lowerarm_r', 'spine_03', 'pelvis']) expect(used.has(bone), `${id} kurta ${bone}`).toBe(true);
      }
    }
  });

  it('English, Hindi and Hinglish words find them, and one person is one model (not a dhoti man AND a man)', () => {
    expect(req('a village with a man in kurta pajama and a woman in saree')).toEqual([{ subject: 'man in kurta pajama' }, { subject: 'woman in saree' }]);
    expect(req('ek saree wali aurat aur dhoti wala aadmi').map(r => r.subject).sort()).toEqual(['man in dhoti', 'woman in saree']);
    expect(req('पगड़ी वाला आदमी')).toEqual([{ subject: 'man in pagdi' }]);
    expect(req('साड़ी वाली महिला')).toEqual([{ subject: 'woman in saree' }]);
    expect(req('a walking woman in saree')).toEqual([{ subject: 'woman in saree', animation: 'walk' }]);
    expect(req('man in turban walking')).toEqual([{ subject: 'man in turban', animation: 'walk' }]);
    // The older recoloured rangers keep their own names; a bare man stays a man.
    expect(req('a saffron kurta ranger').map(r => r.subject)).toEqual(['saffron kurta', 'ranger']);
    expect(req('a man and a woman').map(r => r.subject)).toEqual(['man', 'woman']);
  });
});

describe('a library picture shows a character standing, not crouching or in a T-pose (found on these characters, 2026-11-25)', () => {
  it('the entry\'s idle role wins; then a name that starts with idle; a crouch idle only as the last resort', () => {
    const ual = ['Crouch_Fwd_Loop', 'Crouch_Idle_Loop', 'Death01', 'Idle_Loop', 'Walk_Loop']; // the GLB's own clip order
    expect(thumbnailPoseClip(ual, 'Idle_Loop')).toBe('Idle_Loop');
    expect(thumbnailPoseClip(ual)).toBe('Idle_Loop'); // the old rule took the first "idle" — Crouch_Idle_Loop
    expect(thumbnailPoseClip(['andar', 'correr', 'parado'], 'parado')).toBe('parado'); // no "idle" in the name: was a T-pose
    expect(thumbnailPoseClip(['Crouch_Idle_Loop', 'Walk'])).toBe('Crouch_Idle_Loop');
    expect(thumbnailPoseClip(['Walk'])).toBeNull();
    const renderer = readFileSync('scripts/library/renderLibraryThumbnails.mts', 'utf8');
    expect(renderer).toMatch(/thumbnailPoseClip\(clips, idleRoleByHash\.get\(hash\)\)/);
    expect(renderer).not.toMatch(/animations\.find\(\(a: \{ name: string \}\) => \/idle\/i\.test/);
  });
});
