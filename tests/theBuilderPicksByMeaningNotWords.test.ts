/**
 * Admin 2026-11-21: "words par nahi intention par build hona chahiye … agar user kahe 'mujhe in characters ko khud change
 * karne ka option do' ya 'character ko edit ka option do' to kya hoga? … ek universal intent picker banao". The builder is a
 * language model; what it lacked was a map of outcomes. These lock that map (gameCapabilities.ts): every capability by the
 * OUTCOME the user wants, the near-twins told apart, examples shown as examples (several languages), and the menu reaching
 * every 3D game turn — with the recipe's one-line listing saying what it is for, not which words trigger it.
 */
import { describe, it, expect } from 'vitest';
import { GAME_CAPABILITIES, gameCapabilityMenu } from '../src/server/AgentV3/gameAssets/gameCapabilities';
import { gameLibraryMenuHandoff } from '../src/server/AgentV3/gameAssets/gameLibrarySelection';
import { recipeToolDef, isRecipeName } from '../src/server/AgentV3/ToolCatalog';

describe('the builder picks by meaning, not by words', () => {
  const menu = gameCapabilityMenu();

  it('every capability says the outcome and the exact way to deliver it, with examples in more than one script', () => {
    for (const c of GAME_CAPABILITIES) {
      expect(c.outcome.length, c.id).toBeGreaterThan(40);
      expect(c.use.length, c.id).toBeGreaterThan(10);
      expect(c.saidAs.length, c.id).toBeGreaterThanOrEqual(3);
    }
    const all = GAME_CAPABILITIES.flatMap(c => c.saidAs).join(' ');
    expect(all).toMatch(/[ऀ-ॿ]/); // Devanagari
    expect(all).toMatch(/[஀-௿]/); // Tamil
    expect(menu).toMatch(/not triggers/);
  });

  it('the admin\'s own phrasings land on the player customizer, and a change wanted NOW is told apart from it', () => {
    const player = GAME_CAPABILITIES.find(c => c.id === 'player-customizer')!;
    expect(player.saidAs).toEqual(expect.arrayContaining(['mujhe in characters ko khud change karne ka option do', 'character ko edit ka option do']));
    expect(player.use).toMatch(/generate_character_customizer/);
    expect(isRecipeName('generate_character_customizer')).toBe(true);
    expect(GAME_CAPABILITIES.find(c => c.id === 'builder-changes-a-model')!.use).toMatch(/assetCustomizations\.ts/);
    expect(menu).toMatch(/differ by WHO changes the thing and WHEN/);
  });

  it('a request that matches nothing is still built — never refused, never faked; one question only for a real fork', () => {
    expect(menu).toMatch(/build what they mean anyway[\s\S]*never refuse it, never fake it/);
    expect(menu).toMatch(/Ask ONE short question only when two outcomes would give the user really different things/);
  });

  it('it reaches every 3D game turn (it rides the library menu), and the recipe\'s one line says what it is for, uncut', () => {
    expect(gameLibraryMenuHandoff().startsWith('[WHAT THE USER MEANS → WHAT TO DO]')).toBe(true);
    const line = recipeToolDef().description.split('\n').find(l => l.startsWith('- generate_character_customizer:'))!;
    expect(line).toMatch(/In-game control for players to change how characters look/);
    expect(line.endsWith('…')).toBe(false);
  });
});
