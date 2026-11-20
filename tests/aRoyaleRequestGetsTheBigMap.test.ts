// 🔴 failedbr #2478 (2026-11-20, "make a bgmi for me") and the admin's order: a PUBG / Free Fire / BGMI request must get a
// BIG, real map — "library me already maps hai, par use nahi kiye gaye". Four causes, each a class, each locked here:
//   1. The domain classifier said "general" for a request that NAMES a game without the word "game".
//   2. A roadmap milestone turn ("a 3D scene with a ground plane") lost the user's game: the contract said genre "unknown".
//   3. "ground plane" was read as an AIRCRAFT the player drives (contract and hero contract both).
//   4. The Athree map was only a line in the system prompt — the seed never laid it down for a 3D game.
import { describe, it, expect, afterEach } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { gameKitPlan, gameTurnRequest, gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';
import { buildGameContract } from '../src/server/AgentV3/gameIntent';
import { heroObjectContract } from '../src/server/lib/heroObjectSpec';
import { mapProfileFor } from '../src/server/lib/athreeMap/athreeMapIntent';

// The real prompts of the royale builds in the report list (#2473–#2478).
const ROYALE_PROMPTS = [
  'make a bgmi for me',
  'ek, pubg / bgmi jaisa 3d realstic game banao!!',
  'mujhe pubg/bgmi jaisa game chahiye. jahan ham character ko joystick se move kare! ',
  'free fire jaisa game banao',
  'make pubg for me',
];
// #2478's real roadmap step 1.
const STEP_1 = 'Create a basic 3D scene using Three.js or Babylon.js with a ground plane, some basic geometry objects as obstacles, first-person camera … No shooting yet — just movement.';

afterEach(() => { delete process.env.AGENTV3_ATHREE_MAP; });

describe('a royale request gets the big map, laid down by the platform', () => {
  it('every royale prompt is a game, drawn in 3D, and its seed includes the Athree map right after the 3D layer', () => {
    for (const p of ROYALE_PROMPTS) {
      expect(analyzeRequirementGaps(p).domain, p).toBe('game');
      const plan = gameKitPlan(p);
      expect(plan, p).toContain('generate_game_3d');
      expect(plan.indexOf('generate_athree_map'), p).toBe(plan.indexOf('generate_game_3d') + 1);
    }
  });

  it('the same holds on a roadmap milestone turn, which now carries the game the user named', () => {
    const turn = gameTurnRequest('make a bgmi for me', STEP_1);
    const c = buildGameContract(turn);
    expect(c.genre).toBe('shooter');
    expect(c.vehicle).toBeNull(); // a ground plane is not an aircraft
    expect(heroObjectContract(turn).categories).not.toContain('vehicle-air');
    expect(gameKitPlan(turn)).toContain('generate_athree_map');
    expect(c.requiredFeatures).toEqual([]); // the identity line adds no feature the user did not ask for
  });

  it('a plane of geometry is never a flight game for the map reader either; a real aeroplane still is', () => {
    expect(mapProfileFor(STEP_1)).not.toBe('flight');
    expect(mapProfileFor('make a flight simulator game with a plane')).toBe('flight');
  });

  it('an app ABOUT a game is not handed a game engine', () => {
    for (const p of ['BGMI tournament registration app', 'free fire diamond top up website', 'pubg stats tracker']) {
      expect(analyzeRequirementGaps(p).domain, p).not.toBe('game');
      expect(gameKitPlan(p), p).toEqual([]);
    }
  });

  it('the kill switch keeps the map out (AGENTV3_ATHREE_MAP=off)', () => {
    process.env.AGENTV3_ATHREE_MAP = 'off';
    expect(gameKitPlan('make a bgmi for me')).not.toContain('generate_athree_map');
  });

  it("the builder is told to build IN the map, with the recipe's own usage notes", () => {
    const block = gameKitHandoffBlock([
      { recipe: 'generate_game_3d', ok: true, content: 'ok' },
      { recipe: 'generate_athree_map', ok: true, content: 'Added the Athree map:\nsrc/game/athree/index.ts\n\nUSE createAthreeWorld(scene)' },
    ]);
    expect(block).toContain('THE BIG MAP IS ALREADY IN src/game/athree/');
    expect(block).toContain('USE createAthreeWorld(scene)');
    expect(block).toMatch(/NEVER replace it with a flat ground plane/);
  });
});

// The REAL dispatcher on a roadmap build: the turn's brief is milestone 1, the user's request is "make a bgmi for me".
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { clearPreviewGaveUp } from '../src/server/AgentV3/previewGiveUp';

class FakeWorkspace implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('the map recipe decides from the game the user asked for, not only the milestone brief', () => {
  it('a roadmap build of "make a bgmi for me" installs the Athree map although step 1 only says "a ground plane"', async () => {
    const act = new FakeWorkspace();
    const stream = new AgentEventStream();
    clearPreviewGaveUp('ws-royale');
    const d = new ToolDispatcher(act, 'ws-royale', new WorkspaceState(stream), stream);
    d.setUserOwnedFiles([], 'make a bgmi for me');
    d.setCoverageRequest(STEP_1);
    const r = await d.dispatch({ id: 't', name: 'run_recipe', input: { name: 'generate_athree_map' } }, 'architect');
    expect(r.is_error, String(r.content).slice(0, 300)).toBeFalsy();
    expect([...act.files.keys()].some((p) => p.startsWith('src/game/athree/'))).toBe(true);
  });
});
