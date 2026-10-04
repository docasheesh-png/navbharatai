/**
 * AUTOPSY f496c75b, its ETA item (open since 2026-09-30), and a sibling found re-checking it on 2026-10-04.
 *
 * The ETA was 2.4× under the real time because the heavy 3D game was sized as a `coding` snippet (score
 * 30). #3402 made a heavy game `complex_app` — but only when the requirement reader names the GAME domain,
 * and "a 3d fight game with … health bars" was read as HEALTHCARE. So the same request, worded the way a
 * game is described, fell back to the snippet size and the cheapest rung, and the builder would have been
 * told to include patient records and staff roles. A game's health is hit points.
 */
import { describe, expect, it } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { namesHeavyGame } from '../src/server/lib/appComplexitySignals';

const GAME = 'make a single file html 3d fight game with two players, combos, health bars and a stage';

describe("a game's health bar is not healthcare", () => {
  it('the game is a game, and so a heavy game, and so a complex app', () => {
    expect(analyzeRequirementGaps(GAME).domain).toBe('game');
    expect(namesHeavyGame(GAME)).toBe(true);
    expect(analyzeRequest({ prompt: GAME } as never).taskType).toBe('complex_app');
  });

  it('other game wordings of health', () => {
    for (const p of ['platformer with hp bar and lives', 'rpg with health potions and mana', 'boss health and player health shown on screen game']) {
      expect(analyzeRequirementGaps(p).domain, p).not.toBe('healthcare');
    }
  });

  it('a real health app is still healthcare', () => {
    for (const p of ['hospital management app with patient records', 'health tracking app for diabetes patients', 'clinic appointment booking', 'a health app for my pharmacy']) {
      expect(analyzeRequirementGaps(p).domain, p).toBe('healthcare');
    }
  });
});
