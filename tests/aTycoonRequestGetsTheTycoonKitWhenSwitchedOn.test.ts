// The tycoon kit (money, people, management screen) is laid down by the platform for a shop / business game ONLY when
// the admin switches it on (AGENTV3_TYCOON_KIT_SEED=on). This file locks both halves: OFF changes nothing about any
// game build that exists today, and ON adds exactly the three layers, in the right place, for the right requests.
import { describe, it, expect } from 'vitest';
import { gameKitPlan, gameKitWantsTycoon, tycoonKitSeedEnabled, gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';

const ON = { AGENTV3_TYCOON_KIT_SEED: 'on' } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;
const TWO_D = ['generate_game_runtime', 'generate_game_vfx', 'generate_melody'];
const TYCOON = ['generate_game_economy', 'generate_game_shopsim', 'generate_game_manager'];

describe('the switch', () => {
  it('only an exact "on" turns it on — anything else, including unset, is off', () => {
    expect(tycoonKitSeedEnabled(ON)).toBe(true);
    expect(tycoonKitSeedEnabled({ AGENTV3_TYCOON_KIT_SEED: ' ON ' } as NodeJS.ProcessEnv)).toBe(true);
    for (const v of [undefined, '', 'off', '0', '1', 'true', 'yes', 'onn']) {
      expect(tycoonKitSeedEnabled({ AGENTV3_TYCOON_KIT_SEED: v } as NodeJS.ProcessEnv), String(v)).toBe(false);
    }
  });
});

describe('OFF — every plan is exactly what it was before the tycoon kit existed', () => {
  const prompts = [
    'Make a game game was type of super market simulator make a game',
    'Make a supermarket simulator game',
    'village super mart tycoon game',
    'restaurant tycoon game in 3D',
    'flappy bird game',
    'open world driving game',
    'Make a racing game in 3D',
  ];
  for (const prompt of prompts) {
    it(JSON.stringify(prompt), () => {
      const plan = gameKitPlan(prompt, undefined, OFF);
      for (const r of TYCOON) expect(plan).not.toContain(r);
      expect(gameKitPlan(prompt)).toEqual(plan); // the default environment is OFF too
    });
  }
});

describe('ON — the right requests get the three layers', () => {
  it('a 2D shop game gets them after the usual layers', () => {
    expect(gameKitPlan('Make a supermarket simulator game', undefined, ON)).toEqual([...TWO_D, ...TYCOON]);
  });

  it('a 3D shop game gets them BEFORE the shell, which stays last', () => {
    const plan = gameKitPlan('village super mart tycoon game in 3D', undefined, ON);
    expect(plan[plan.length - 1]).toBe('generate_game_shell');
    expect(plan.slice(-4, -1)).toEqual(TYCOON);
    expect(plan.indexOf('generate_game_3d')).toBeLessThan(plan.indexOf('generate_game_economy'));
  });

  it('reads English and Hinglish shop games', () => {
    for (const p of [
      'restaurant tycoon game', 'kirana store manager game', 'dukaan simulator game', 'cafe management simulator game',
      'idle shop game', 'a game where I run a small supermarket', 'general store tycoon', 'mini mart simulator game',
    ]) expect(gameKitWantsTycoon(p), p).toBe(true);
  });

  it('does NOT read other games, apps or loose words as a shop game', () => {
    for (const p of [
      'flappy bird game', 'gun shop shooter game', 'racing game', 'guess the number game', 'chess game', 'snake game',
      'a shooting game set in a mall', 'farm racing game', 'hotel booking app', 'supermarket billing POS app',
      'run through a supermarket shooting zombies', 'a game set in a restaurant where you fight', 'endless runner game',
    ]) expect(gameKitWantsTycoon(p), p).toBe(false);
  });

  it('never seeds a non-game, even with the word tycoon-ish and the switch on', () => {
    expect(gameKitPlan('supermarket billing POS app', undefined, ON)).toEqual([]);
    expect(gameKitPlan('supermarket inventory management app', undefined, ON)).toEqual([]);
  });

  it('a stack that cannot run the kit still gets nothing', () => {
    expect(gameKitPlan('restaurant tycoon game', 'vue', ON)).toEqual([]);
  });

  it('a non-shop game is unchanged with the switch on', () => {
    expect(gameKitPlan('flappy bird game', undefined, ON)).toEqual(gameKitPlan('flappy bird game', undefined, OFF));
    expect(gameKitPlan('Make a racing game in 3D', undefined, ON)).toEqual(gameKitPlan('Make a racing game in 3D', undefined, OFF));
  });
});

describe('every planned recipe is one the builder can run', () => {
  it('each tycoon recipe is in the recipe map', () => {
    for (const r of TYCOON) expect(Object.keys(GAME_RECIPES), r).toContain(r);
  });
});

describe('the handoff tells the builder what to do with them', () => {
  const done = (recipes: string[]) => recipes.map((recipe) => ({ recipe, ok: true, content: 'Created src/game/x.ts\nok' }));

  it('names the business layers and the rules when they were laid down', () => {
    const block = gameKitHandoffBlock(done([...TWO_D, ...TYCOON]));
    expect(block).toContain('BUSINESS game');
    expect(block).toContain('src/game/economy');
    expect(block).toContain('<ManagerPanel>');
    expect(block).toContain('autoCustomers: false');
  });

  it('says nothing about a business when the layers were not laid down', () => {
    expect(gameKitHandoffBlock(done(TWO_D))).not.toContain('BUSINESS game');
  });
});
