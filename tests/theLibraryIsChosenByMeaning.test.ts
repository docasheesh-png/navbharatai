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
import { gameLibraryMenuHandoff, withLibraryMenuForExistingGame, THREE_KIT_MARKER } from '../src/server/AgentV3/gameAssets/gameLibrarySelection';
import { libraryRequirement } from '../src/server/AgentV3/gameAssets/assetPlan';
import { REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

describe('the builder chooses library models by meaning', () => {
  const menu = gameLibraryMenuHandoff();

  it('the menu names EVERY catalogue subject, and the roles each can play', () => {
    for (const c of REVIEWED_GAME_ASSETS) for (const s of c.subjects) expect(menu, s).toMatch(new RegExp(`(: |, )${s}( \\(|,|\\n|$)`));
    // Subjects that play the same roles share one line, the roles written once (2026-11-21: the per-subject form spent
    // 1.5 KB repeating "(walk/run)" once the library had 48 people).
    const rolesOf = (subject: string) => menu.split('\n').find(l => new RegExp(`: (.*, )?${subject}(,|$)`).test(l))?.match(/^[a-z-]+ \(([^)]*)\):/)?.[1];
    expect(rolesOf('villager')).toBe('walk/run/jog/jump/crouch/aim/shoot/reload/die/hit/drive');
    expect(rolesOf('bird')).toBe('fly');
    expect(rolesOf('young woman')).toBe('walk/run');
    expect(rolesOf('cactus')).toBeUndefined();
    expect(menu).toMatch(/MEANING/);
    // Paid on every 3D game turn: keep it a menu, not a dump of the catalogue. 2026-11-21: 8000 → 11000 for the intent map
    // (gameCapabilities.ts, ~2.7 KB) that lets the builder pick by meaning in any language — ~2.5k tokens a turn in all.
    expect(menu.length).toBeLessThan(11000);
  });

  it('a subject appears once even when several models serve it', () => {
    const characterLines = menu.split('\n').filter(l => /^character( \([^)]*\))?: /.test(l)).join('\n');
    expect(characterLines.match(/(, |: )woman(,|$)/gm)).toHaveLength(1);
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

describe('an EXISTING 3D game sees the library on every later turn (admin 2026-11-20)', () => {
  const read = (files: Record<string, string>) => async (p: string) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };
  const on = { AGENTV3_EXTERNAL_GAME_ASSETS: 'on' } as NodeJS.ProcessEnv;

  it('a later turn on a project with the 3D kit gets the menu first; the prompt itself is kept whole', async () => {
    const out = await withLibraryMenuForExistingGame('add a cow to my game', { intent: 'edit_existing', read: read({ [THREE_KIT_MARKER]: 'export const x = 1;' }), env: on });
    expect(out.startsWith('[WHAT THE USER MEANS → WHAT TO DO]')).toBe(true);
    expect(out).toContain('[GAME_LIBRARY_MENU]');
    expect(out.endsWith('\n\nadd a cow to my game')).toBe(true);
  });

  it('unchanged when: the first turn (the seed already sent it), no 3D kit, the library is off, or the read fails', async () => {
    const kit = read({ [THREE_KIT_MARKER]: 'x' });
    expect(await withLibraryMenuForExistingGame('p', { intent: 'new_build', read: kit, env: on })).toBe('p');
    expect(await withLibraryMenuForExistingGame('p', { intent: 'edit_existing', read: read({}), env: on })).toBe('p');
    expect(await withLibraryMenuForExistingGame('p', { intent: 'edit_existing', read: read({ [THREE_KIT_MARKER]: '  ' }), env: on })).toBe('p');
    expect(await withLibraryMenuForExistingGame('p', { intent: 'edit_existing', read: kit, env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'off' } as NodeJS.ProcessEnv })).toBe('p');
    expect(await withLibraryMenuForExistingGame('p', { intent: 'edit_existing', read: kit, env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'admin' } as NodeJS.ProcessEnv, uid: null })).toBe('p');
  });

  it('the chat route calls it before the new-game seed block, with the workspace reader', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    // Timed as its own setup step since failedbr #2484 (Q-3245).
    const call = route.indexOf("buildPrompt = await finalSteps.step('library menu', () => withLibraryMenuForExistingGame(buildPrompt, { intent, read: (p) => actuator.readFile(workspaceId, p), uid: verified?.uid }));");
    expect(call).toBeGreaterThan(0);
    expect(call).toBeLessThan(route.indexOf('// ── GAME KIT SEED'));
  });
});
