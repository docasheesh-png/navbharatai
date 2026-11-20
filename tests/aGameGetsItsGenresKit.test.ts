// A GAME GETS ITS GENRE'S KIT (admin 2026-11-20, game audit 2). failedbr #2435 ("Mere liye super Mario Bros game banao")
// got only the loop, sound and music, and hand-wrote its platformer physics, renderer and touch buttons; #2470 (a
// Monopoly-style "business game") got the real-time kit and no rules engine. The 2D kit and the India games pack exist,
// but were only run if the model chose to. The seed now lays the genre's kit down itself and the handoff names it.
import { describe, it, expect } from 'vitest';
import { gameKitPlan, gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';

const BASE = ['generate_game_runtime', 'generate_game_vfx', 'generate_melody'];

describe('🎮 the seed lays the genre\'s kit down', () => {
  it('🔴 build #2435\'s request — a Mario-style platformer — gets the 2D kit', () => {
    expect(gameKitPlan('Mere liye super Mario Bros game banao', 'vite-react')).toEqual([...BASE, 'generate_game_2d']);
  });
  it('other 2D games that move a body get it too: a runner, a 2D shooter, an arcade game', () => {
    for (const p of ['make an endless runner game', 'space invaders shooting game banao', 'create a flappy bird game']) {
      expect(gameKitPlan(p, 'vite-react'), p).toContain('generate_game_2d');
    }
  });
  it('🔴 board and card games get the India games pack; so does cricket', () => {
    for (const p of ['ludo game banao 4 players', 'make a chess game', 'carrom board game', 'teen patti card game', 'snakes and ladders game', 'cricket game banao']) {
      const plan = gameKitPlan(p, 'vite-react');
      expect(plan, p).toContain('generate_board_games');
      expect(plan, p).not.toContain('generate_game_2d');
    }
  });
  it('a quiz or puzzle game gets neither; a 3D game keeps the 3D kit and gets neither', () => {
    expect(gameKitPlan('make a quiz game', 'vite-react')).toEqual(BASE);
    const threeD = gameKitPlan('make a 3d racing game', 'vite-react');
    expect(threeD).toContain('generate_game_3d');
    expect(threeD).not.toContain('generate_game_2d');
    expect(threeD).not.toContain('generate_board_games');
  });
});

describe('the handoff names the kit, so the builder builds on it', () => {
  const ok = (recipe: string) => ({ recipe, ok: true, content: 'Created src/game/x.ts' });
  it('the 2D kit: platformer physics, camera, animator — never a hand-written jump', () => {
    const h = gameKitHandoffBlock([...BASE, 'generate_game_2d'].map(ok), {});
    expect(h).toMatch(/THE 2D GAME KIT IS ALREADY IN src\/game\/2d\//);
    expect(h).toMatch(/NEVER a hand-written\s+jump/);
  });
  it('the India games pack: the rules come from it; card games never for real money', () => {
    const h = gameKitHandoffBlock([...BASE, 'generate_board_games'].map(ok), {});
    expect(h).toMatch(/THE INDIA GAMES PACK IS ALREADY IN src\/game\/board\//);
    expect(h).toMatch(/never real money/);
    expect(gameKitHandoffBlock(BASE.map(ok), {})).not.toMatch(/INDIA GAMES PACK|2D GAME KIT/);
  });
});
