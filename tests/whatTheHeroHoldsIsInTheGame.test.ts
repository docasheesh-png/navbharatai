/**
 * Autopsy BR #2535 (2026-11-26): "hero kr hath me ek badi gun banao". The builder wrote `holds: { right: 'rifle' }` and said
 * the hero holds a rifle — but the kit shows a held item only when it is one of the game's SAVED models, and the builder never
 * added it. The hand stayed empty.
 *
 * Class: a player setting that names a library model the game does not have. Locked by the real line from the report, the
 * prompt rule, and the write-time wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { heldSubjects, missingHeldModels } from '../src/server/AgentV3/heldItemRule';
import { GAME_PLAYER_RULE } from '../src/server/AgentV3/gameKitSeed';

/** player.ts exactly as BR #2535 left it (the model line came from BR #2534). */
const PLAYER_BR2535 = `// holds: what it holds, from the game library, for example holds: { right: 'pistol' } or { right: 'sword', left: 'shield' }.
export const PLAYER: PlayerChoice = {
  look: { height: 1.75 },
  model: 'sports coach',
  file: null,
  modelHeight: 1.74,
  turn: 0,
  holds: { right: 'rifle' },
};`;

const assetModels = (subjects: string[]) =>
  `const assets: Record<string, LocalGameAsset> = ${JSON.stringify(Object.fromEntries(subjects.map((s) => [s, { sha256: 'x', height: 1, yaw: 0 }])))};\n`;

describe('what the hero holds must be a saved model', () => {
  it('reads the held subjects and ignores the example in the comment', () => {
    expect(heldSubjects(PLAYER_BR2535)).toEqual(['rifle']);
    expect(heldSubjects("export const PLAYER = { holds: { right: 'sword', left: 'shield' } };")).toEqual(['sword', 'shield']);
    expect(heldSubjects("export const PLAYER = { model: null };")).toEqual([]);
  });
  it('BR #2535: rifle held, only the coach saved — the builder is told it is not done and how to finish', () => {
    const note = missingHeldModels(PLAYER_BR2535, assetModels(['sports coach']));
    expect(note).toMatch(/HELD ITEM NOT IN THE GAME/);
    expect(note).toMatch(/'rifle'/);
    expect(note).toMatch(/add_library_models with \{ "subject": "rifle" \}/);
    expect(note).toMatch(/never say the character is holding it/);
  });
  it('no note once the item is saved, and none when nothing is held', () => {
    expect(missingHeldModels(PLAYER_BR2535, assetModels(['sports coach', 'rifle']))).toBe('');
    expect(missingHeldModels("export const PLAYER = { model: 'knight' };", assetModels([]))).toBe('');
  });
  it('a game with no saved models at all still gets the note', () => {
    expect(missingHeldModels(PLAYER_BR2535, '')).toMatch(/it has no saved library models yet/);
  });
});

describe('the builder is taught it, and the note is wired', () => {
  it('GAME_PLAYER_RULE says a held item is added first, then set in holds', () => {
    expect(GAME_PLAYER_RULE).toMatch(/SOMETHING IN THE HAND/);
    expect(GAME_PLAYER_RULE).toMatch(/first add_library_models with that item, then PLAYER\.holds/);
  });
  it('every write of player.ts with a held item runs the check against the saved models', () => {
    const td = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(td).toMatch(/vehicle \+= missingHeldModels\(files\[PLAYER_FILE_PATH\], saved\);/);
    expect(td).toMatch(/await this\.actuator\.readFile\(this\.workspaceId, ASSET_MODELS_PATH\)\.catch\(\(\) => ''\)/);
  });
});
