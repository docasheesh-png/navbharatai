/**
 * Library batch 8 (2026-11-20): KayKit Adventurers Character Pack 2.0 (Kay Lousberg, CC0 per the archive's License.txt),
 * the admin's own download. A bowman with 15 clips and 15 props the library lacked, converted offline and PACKAGED in the
 * server image — the first packaged models from a provider other than Quaternius.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { REVIEWED_LIBRARY_BATCH_8 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch8';
import { REVIEWED_GAME_ASSETS, validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';

type Proof = { id: string; verdict: string; sha256: string; bytes: number; proofs: { animation: string | null; animated: boolean }[] };
const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-8-admission.json', 'utf8')) as { results: Proof[] }).results.map(r => [r.id, r]));
const subjects = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS).map(r => r.subject).sort();

describe('library batch 8 — KayKit Adventurers 2.0, packaged', () => {
  it('16 entries: CC0 Kay Lousberg, packaged, exact file, admitted live, each moving role animated', () => {
    validateCatalogue(REVIEWED_LIBRARY_BATCH_8);
    expect(REVIEWED_LIBRARY_BATCH_8).toHaveLength(16);
    for (const a of REVIEWED_LIBRARY_BATCH_8) {
      expect(a).toMatchObject({ provider: 'kaykit', packaged: true });
      expect(a.license).toMatchObject({ spdx: 'CC0-1.0', author: 'Kay Lousberg', commercial: true, redistributeInGame: true, redistributeSource: true });
      expect(a.license.attribution).toMatch(/License\.txt in the archive \(sha256 [0-9a-f]{64}/);
      const bytes = readFileSync(`assets/game-models/${a.sha256}.glb`);
      expect(bytes.length, a.id).toBe(a.bytes);
      expect(statSync(`assets/game-models/thumbs/${a.sha256}.webp`).size, a.id).toBeGreaterThan(0);
      expect(createHash('sha256').update(bytes).digest('hex'), a.id).toBe(a.sha256);
      expect(validateGlb(bytes).animations.sort()).toEqual([...a.animations].sort());
      const proof = admitted.get(a.id)!;
      expect([proof.verdict, proof.sha256, proof.bytes], a.id).toEqual(['admitted', a.sha256, a.bytes]);
      for (const [role, clip] of Object.entries(a.animationRoles ?? {})) {
        expect(a.animations, `${a.id} ${role}`).toContain(clip);
        if (role !== 'idle') expect(proof.proofs.some(p => p.animation === clip && p.animated), `${a.id} ${clip}`).toBe(true);
      }
    }
  });

  it('packaged models: Quaternius and KayKit only — any other provider is still refused', () => {
    const bow = REVIEWED_LIBRARY_BATCH_8.find(a => a.id === 'k8-bow')!;
    expect(() => validateCatalogue([{ ...bow, provider: 'github' } as never])).toThrow('Unreviewed packaged');
    expect(() => validateCatalogue([{ ...bow, provider: 'kenney' } as never])).toThrow('Unreviewed packaged');
  });

  it('real prompts, English and Hindi, get the new models', () => {
    expect(subjects('archery game with a bow and arrows and a quiver')).toEqual(['arrow', 'bow', 'quiver']);
    expect(subjects('धनुष और तीर वाला गेम')).toEqual(['arrow', 'bow']);
    expect(subjects('a wizard with a magic staff and spellbook')).toEqual(['magic staff', 'spellbook', 'wizard']);
    expect(gameAssetRequirements('bowman walking', REVIEWED_GAME_ASSETS)).toEqual([{ subject: 'bowman', animation: 'walk' }]);
  });

  it('words that are not these objects stay out, and a named kind is not also the generic one', () => {
    expect(subjects('use arrow keys to move')).toEqual([]);
    expect(subjects('book a ticket app game')).toEqual([]);
    expect(subjects('hotel staff simulator')).toEqual(['hotel']);
    expect(subjects('knight with a big sword and a round shield')).toEqual(['greatsword', 'knight', 'round shield']);
    expect(subjects('a sword and shield')).toEqual(['shield', 'sword']);
  });
});
