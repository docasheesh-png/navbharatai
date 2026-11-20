// 🎮 A GAME IS BUILT ON THE KIT, NOT SPLIT INTO PROJECT MODULES (failedbr #2279, 2026-11-20 — "GO CAR").
//
// The 40-part 3D racing spec read LARGE and project-shaped, so Software Project Mode split it into 14 modules.
// Module 1 ("Core Gameplay Loop") owned no screen and got no game kit (kit seeding waits for no module in flight),
// so the builder spent eight minutes on its own car physics, found the kit's car and camera APIs at minute 9,
// rewrote everything, and the user stopped at 13 minutes with nothing to play. The fixture is the report's prompt.
// Reversion: make scopeVerdict ignore `gameOnKit` (projectMode: large && shape.fires) and the first test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { scopeVerdict } from '../src/server/lib/appScopeAnalyzer';
import { gameKitOwnsTheBuild } from '../src/server/AgentV3/gameKitSeed';
import { projectModeDiagnosis, roadmapDecision } from '../src/server/AgentV3/ProjectPlan';

const GO_CAR = readFileSync(`${__dirname}/fixtures/failedbr2279.gocar.prompt.txt`, 'utf8');

describe('failedbr #2279: the GO CAR spec is built on the kit', () => {
  it('the scope verdict still calls it large, but Project Mode does not split it', () => {
    const gameOnKit = gameKitOwnsTheBuild(GO_CAR, 'vite-react', {});
    expect(gameOnKit).toBe(true);
    const v = scopeVerdict(GO_CAR, { complex: true, gameOnKit });
    expect(v.large).toBe(true);
    expect(v.shape.fires).toBe(true);
    expect(v.projectMode).toBe(false);
  });
  it('so the mega-app roadmap (which narrows a big game to a playable step 1) owns it instead of standing down', () => {
    const v = scopeVerdict(GO_CAR, { complex: true, gameOnKit: true });
    const d = roadmapDecision({ projectModeOn: true, planFirst: false, megaProject: v.projectMode, templateIsTheApp: false,
      decisionIsAnalyze: v.scope.decision === 'analyze', disputed: !!v.dispute, signals: v.scope.signals });
    expect(d.standDown).toBeNull();
    expect(d.runPlanner).toBe(true);
  });
  it('the report says why Project Mode stood down', () => {
    const v = scopeVerdict(GO_CAR, { complex: true, gameOnKit: true });
    const diag = projectModeDiagnosis({ flagRaw: 'on', identity: { userId: 'u1' }, isNewBuild: true, isEditMode: false,
      prompt: GO_CAR, scope: { large: v.large, signals: v.scope.signals, gameOnKit: v.gameOnKit } });
    expect(diag.skipReason).toBe('game-builds-on-kit');
    expect(diag.message).toMatch(/it is a game/);
  });
});

describe('the boundaries', () => {
  it('a large non-game project spec is still split (nothing changes for real projects)', () => {
    const erp = ['Build a School ERP system with these modules:', ...Array.from({ length: 16 }, (_, i) => `- Module ${i + 1}: feature ${i + 1} with its own screens and reports`)].join('\n');
    expect(gameKitOwnsTheBuild(erp, 'vite-react', {})).toBe(false);
  });
  it('AGENTV3_GAME_PROJECT_MODE=on restores the split; a kit switched off cannot own the build', () => {
    expect(gameKitOwnsTheBuild(GO_CAR, 'vite-react', { AGENTV3_GAME_PROJECT_MODE: 'on' })).toBe(false);
    expect(gameKitOwnsTheBuild(GO_CAR, 'vite-react', { AGENTV3_GAME_KIT_SEED: 'off' })).toBe(false);
  });
  it('a stack the kit cannot run keeps today\'s behaviour', () => {
    expect(gameKitOwnsTheBuild(GO_CAR, 'django', {})).toBe(false);
  });
});
