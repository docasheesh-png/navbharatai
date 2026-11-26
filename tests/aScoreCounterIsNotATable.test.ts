// A SCORE COUNTER IS NOT A TABLE (failedbr #2523, Q-3468, 2026-11-26).
//
// The shooter prompt below was handed "human, table, gun": "score counter" matched the catalogue's worktop
// (table / desk / counter) and "first-person view" matched a human. The class is a HUD or screen sense of a
// catalogue word, so this test is a CENSUS of those senses — a new one that reads as an object fails it — plus
// the real objects those words still name, so the fix cannot be "drop the word".
import { describe, expect, it } from 'vitest';
import { heroObjectContract } from '../src/server/lib/heroObjectSpec';

// The prompt of failedbr #2523, verbatim.
const BR2523 = 'Create a simple playable shooting game with first-person view, a gun, enemies, shooting mechanics, crosshair, '
  + 'score counter, health system, and restart button. Add basic mobile touch controls. Keep graphics minimal and ensure '
  + 'the game actually works.';

const ids = (prompt: string) => heroObjectContract(prompt).specs.map((s) => s.id);

describe('a screen word is not an object', () => {
  it('failedbr #2523: only the gun is a hero object', () => {
    expect(ids(BR2523)).toEqual(['gun']);
  });

  const HUD = [
    'score counter', 'ammo counter', 'kill counter', 'lap counter', 'step counter', 'coin counter display',
    'high score table', 'leaderboard table', 'fire button', 'splash screen', 'chat box', 'text box',
    'dialog box', 'check box', 'bounding box', 'hit box', 'first-person view', 'third-person camera',
  ];
  for (const phrase of HUD) {
    it(`"${phrase}" names no table, crate, fire, splash or person`, () => {
      const got = ids(`a 3d game with a ${phrase}`);
      expect(got.filter((id) => ['table', 'crate', 'fire', 'splash', 'human'].includes(id))).toEqual([]);
    });
  }
});

describe('the same words still name the real thing', () => {
  const REAL: Array<[string, string]> = [
    ['a 3d restaurant game with tables and a kitchen counter', 'table'],
    ['a 3d shop game with a counter where the player pays', 'table'],
    ['a 3d game with a campfire in the forest', 'fire'],
    ['a 3d warehouse game with wooden boxes', 'crate'],
    ['a 3d game where a person walks in the park', 'human'],
    ['a first person shooter with a rifle', 'gun'],
  ];
  for (const [prompt, id] of REAL) {
    it(`${prompt} → ${id}`, () => { expect(ids(prompt)).toContain(id); });
  }
});
