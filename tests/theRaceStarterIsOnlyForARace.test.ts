// 🏁 failedbr #2478 (Q-3016): the 3D shell shipped src/game/RacingRoadGame.tsx under EVERY 3D game, so "make a bgmi for me"
// was handed a racing starter ("2 game component(s) were seeded but not imported: … RacingRoadGame"). The CLASS: a seeded
// starter must match the game's genre. The race starter goes only to a race; every other 3D game gets the rest of the shell.
import { describe, it, expect } from 'vitest';
import { gameKitRecipeInput, gameKitPlan, gameTurnRequest } from '../src/server/AgentV3/gameKitSeed';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const shellFor = (request: string) => {
  const input = gameKitRecipeInput('generate_game_shell', gameKitPlan(request), request) as { include?: string[] } | undefined;
  return generateGameShell(input?.include).files;
};

describe('the race starter is only for a race', () => {
  it('a royale (also on its roadmap step 1) gets the shell without the racing starter', () => {
    for (const r of ['make a bgmi for me', gameTurnRequest('make a bgmi for me', 'Create a basic 3D scene with a ground plane and a first-person camera.'), 'gta5 wala game banao']) {
      const files = shellFor(r);
      expect(Object.keys(files), r).not.toContain('src/game/RacingRoadGame.tsx');
      for (const p of ['src/game/Game.ts', 'src/game/GameCanvas.tsx', 'src/game/ui/Hud.tsx', 'src/game/ui/touchControls.ts']) expect(files[p], `${r}: ${p}`).toBeTruthy();
    }
  });

  it('a race keeps the whole shell, starter included', () => {
    expect(gameKitRecipeInput('generate_game_shell', gameKitPlan('make a 3d car racing game'), 'make a 3d car racing game')).toBeUndefined();
    expect(Object.keys(shellFor('make a 3d car racing game'))).toContain('src/game/RacingRoadGame.tsx');
  });

  it('without a request the shell is whole, exactly as before', () => {
    expect(gameKitRecipeInput('generate_game_shell', ['generate_game_shell'])).toBeUndefined();
  });
});
