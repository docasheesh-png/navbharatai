/**
 * Admin 2026-11-20: "words par nahi, intention par depend hona chahiye". The library was reached only through the WORDS
 * of a request: "a story set in a village" got no villager because nobody typed "villager", and the builder model — which
 * reads meaning — never saw what the library holds. These lock the fix:
 *   - the builder is handed the whole library as a menu (every subject, with the animation roles it plays),
 *   - only when the library is on for the account (otherwise the menu would invite a wasted call),
 *   - add_library_models takes every role the library has, and a role a model lacks no longer loses the model.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gameLibraryMenuHandoff } from '../src/server/AgentV3/gameAssets/gameLibrarySelection';
import { libraryRequirement } from '../src/server/AgentV3/gameAssets/assetPlan';
import { REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

describe('the builder chooses library models by meaning', () => {
  const menu = gameLibraryMenuHandoff();

  it('the menu names EVERY catalogue subject, and the roles each can play', () => {
    for (const c of REVIEWED_GAME_ASSETS) for (const s of c.subjects) expect(menu, s).toMatch(new RegExp(`(: |, )${s}( \\(|,|\\n|$)`));
    expect(menu).toMatch(/villager \(walk\/run\/jog\/jump\/crouch\/aim\/shoot\/reload\/die\/hit\/drive\)/);
    expect(menu).toMatch(/bird \(fly\)/);
    expect(menu).toMatch(/MEANING/);
    // Paid on every build that has the library: keep it a menu, not a dump of the catalogue.
    expect(menu.length).toBeLessThan(8000);
  });

  it('a subject appears once even when several models serve it', () => {
    const characterLine = menu.split('\n').find(l => l.startsWith('character: '))!;
    expect(characterLine.match(/(^|, |: )woman( \(|,|$)/g)).toHaveLength(1);
  });

  it('the menu reaches a new game only when the library is on for the account', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/assets\.status !== 'off' \? gameLibraryMenuHandoff\(\) : ''/);
  });

  it('add_library_models takes any animation role, pointed at the menu', () => {
    const tool = defaultToolCatalog().find(t => t.name === 'add_library_models')!;
    const animation = (tool.input_schema as { properties: { models: { items: { properties: { animation: { enum?: string[]; description?: string } } } } } }).properties.models.items.properties.animation;
    expect(animation.enum).toBeUndefined();
    expect(animation.description).toMatch(/shoot/);
    expect(tool.description).toMatch(/GAME_LIBRARY_MENU/);
  });

  it('a name or a word the plan knows becomes a requirement; a role the model plays is kept', () => {
    expect(libraryRequirement('villager', 'shoot', REVIEWED_GAME_ASSETS)).toEqual({ requirement: { subject: 'villager', animation: 'shoot' } });
    expect(libraryRequirement('gaon wala', 'Run', REVIEWED_GAME_ASSETS)).toEqual({ requirement: { subject: 'villager', animation: 'run' } });
    expect(libraryRequirement('cow', undefined, REVIEWED_GAME_ASSETS)).toEqual({ requirement: { subject: 'cow' } });
    expect(libraryRequirement('a spaceship from mars', 'fly', REVIEWED_GAME_ASSETS)).toBeNull();
  });

  it('a role no model of that subject plays keeps the model and reports the dropped role (it used to lose the model)', () => {
    expect(libraryRequirement('cow', 'fly', REVIEWED_GAME_ASSETS)).toEqual({ requirement: { subject: 'cow' }, droppedRole: 'fly' });
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toMatch(/Added without that animation/);
  });
});
