// 🔴 A SEEDED GAME KIT IS NEVER OVERWRITTEN BY THE FAST LANE (failedbr #2339, 36ad150c, 2026-11-12).
//
// The kit seeder judged the request ("game 24*7 apne aap chalega … tribe … mukhiya …") a game and laid down 32 files.
// The requirement analyzer's domain was not 'game', so the fast lane ran anyway and regenerated 20 files — most at the
// kit's own paths (core/loop, core/input, three/camera, three/surfaces …), each from its own contract. The kit's other
// files then imported names that no longer existed: 37–58 compile errors, a 25-minute grind, OUTCOME_STOPPED.
// Reversion: drop the `kitSeededCount > 0` line and the first test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fastLaneSkipsGame } from '../src/server/AgentV3/fastLaneRung';

describe('the files on disk decide', () => {
  it('#2339: a seeded kit skips the fast lane even when the domain reader did not say "game"', () => {
    expect(fastLaneSkipsGame('productivity', {} as NodeJS.ProcessEnv, 32)).toBe(true);
    expect(fastLaneSkipsGame(null, {} as NodeJS.ProcessEnv, 5)).toBe(true);
  });
  it('the env switch that lets the lane try games cannot put it on top of a kit', () => {
    expect(fastLaneSkipsGame('game', { AGENTV3_FASTLANE_GAMES: 'on' } as NodeJS.ProcessEnv, 32)).toBe(true);
    expect(fastLaneSkipsGame('game', { AGENTV3_FASTLANE_GAMES: 'on' } as NodeJS.ProcessEnv, 0)).toBe(false);
  });
  it('without a kit, the domain rule is unchanged', () => {
    expect(fastLaneSkipsGame('game', {} as NodeJS.ProcessEnv)).toBe(true);
    expect(fastLaneSkipsGame('productivity', {} as NodeJS.ProcessEnv)).toBe(false);
  });
  it('the route passes the seeded kit, and a failed domain read still skips over a kit', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/fastLaneSkipsGame\(analyzeRequirementGaps\(prompt\)\.domain, process\.env, gameKitSeeded\.length\)/);
    expect(route).toMatch(/catch \{ fastLaneGameSkip = gameKitSeeded\.length > 0; \}/);
  });
});
