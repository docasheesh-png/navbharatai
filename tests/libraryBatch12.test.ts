/**
 * Library batch 12 (2026-11-21): variety for big worlds (admin: "ok models streaming banao, phir library variety badhao").
 * A streamed world uses a few models many times, so it needs KINDS — nine homes, eight vehicle bodies, people with their
 * own look, trees. Also locks the two matcher defects batch 12 exposed:
 *   - a word inside a LONGER known name was matched on its own too ("pickup truck" → truck + pickup truck), which every
 *     earlier batch patched one hand-written exclusion at a time;
 *   - walk/run was asked for only for a hand-typed list of subjects, which the new people were not on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REVIEWED_LIBRARY_BATCH_12 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch12';
import { REVIEWED_GAME_ASSETS, validateCatalogue, catalogueStorageBytes, CATALOGUE_STORAGE_BUDGET_BYTES } from '../src/server/AgentV3/gameAssets/providers';
import { gameAssetRequirements } from '../src/server/AgentV3/gameAssets/assetPlan';

type Proof = { id: string; verdict: string; sha256: string; bytes: number; proofs: { animated: boolean; animation: string | null }[] };
const admitted = new Map((JSON.parse(readFileSync('docs/game-engine/asset-candidates/library-batch-12-admission.json', 'utf8')) as { results: Proof[] }).results.map(r => [r.id, r]));
const req = (prompt: string) => gameAssetRequirements(prompt, REVIEWED_GAME_ASSETS);
const subjects = (prompt: string) => req(prompt).map(r => r.subject).sort();

describe('library batch 12 — kinds for big worlds', () => {
  it('40 entries: pinned kayquer sources, CC0, admitted live (people proven to move), inside the budget', () => {
    validateCatalogue(REVIEWED_GAME_ASSETS);
    expect(REVIEWED_LIBRARY_BATCH_12).toHaveLength(40);
    for (const a of REVIEWED_LIBRARY_BATCH_12) {
      expect(a.downloadUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/kayquer\/[^/]+\/[0-9a-f]{40}\//);
      expect(a.license.spdx).toBe('CC0-1.0');
      expect(a.license.evidenceUrl).toContain(a.revision);
      const proof = admitted.get(a.id);
      expect([proof?.verdict, proof?.sha256, proof?.bytes], a.id).toEqual(['admitted', a.sha256, a.bytes]);
      if (a.animationRoles) expect(proof!.proofs.filter(p => p.animation).every(p => p.animated), a.id).toBe(true);
    }
    const count = (category: string) => REVIEWED_LIBRARY_BATCH_12.filter(a => a.libraryCategory === category).length;
    expect([count('building'), count('vehicle-land'), count('character'), count('vegetation')]).toEqual([15, 8, 12, 4]);
    expect(catalogueStorageBytes(REVIEWED_GAME_ASSETS)).toBeLessThanOrEqual(CATALOGUE_STORAGE_BUDGET_BYTES);
    expect(new Set(REVIEWED_GAME_ASSETS.map(a => a.id)).size).toBe(REVIEWED_GAME_ASSETS.length);
  });

  it('no new subject is a word games use for something else (boss fight, item pickup, inventory manager, railway coach)', () => {
    const all = REVIEWED_LIBRARY_BATCH_12.flatMap(a => a.subjects);
    for (const risky of ['boss', 'pickup', 'manager', 'navigator', 'coach', 'tree', 'jeep', 'godown']) expect(all, risky).not.toContain(risky);
    for (const prompt of ['a boss fight in a dungeon', 'inventory manager screen', 'railway coach game']) expect(subjects(prompt), prompt).toEqual([]);
    expect(subjects('pickup coins and power ups')).toEqual(['coin']);
  });

  it('a named kind is that model only — the shorter name inside it is not picked too (it was: truck, van, woman, car, house, tower)', () => {
    expect(subjects('city with a pickup truck, a delivery van and a minivan')).toEqual(['delivery van', 'minivan', 'pickup truck']);
    expect(subjects('rally car racing on dirt')).toEqual(['rally car']);
    expect(subjects('a small house near a tree')).toEqual(['small house', 'tree']);
    expect(subjects('a water tower and a silo on the farm')).toEqual(['silo', 'water tower']);
    expect(subjects('police car chase')).toEqual(['police car']);
    // The generic still comes when it is the thing asked for.
    expect(subjects('a truck and a house')).toEqual(['house', 'truck']);
    expect(subjects('a van')).toEqual(['van']); // the delivery van's own short name
  });

  it('the new people walk and run when the prompt says so; a subject no model animates is not asked to', () => {
    expect(req('a young woman and a bearded man walking in the park')).toEqual([{ subject: 'young woman' }, { subject: 'bearded man', animation: 'walk' }]);
    expect(req('a running teenager')).toEqual([{ subject: 'teenager', animation: 'run' }]);
    expect(req('a flying bird')).toEqual([{ subject: 'bird', animation: 'fly' }]);
    expect(req('running man in a city')).toEqual([{ subject: 'man', animation: 'run' }]);
    for (const r of req('a running dog and a walking cactus')) if (r.animation) expect(REVIEWED_GAME_ASSETS.some(c => c.subjects.includes(r.subject) && c.animations.includes(c.animationRoles?.[r.animation!] ?? r.animation!))).toBe(true);
    expect(readFileSync('src/server/AgentV3/gameAssets/assetPlan.ts', 'utf8')).not.toMatch(/\['human', 'knight', 'dog'/);
  });
});
