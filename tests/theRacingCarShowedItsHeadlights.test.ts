/**
 * ADMIN REPORT 2026-10-11, build 46e2d74b — "Create an racing game for Nokia c 2-01" (Weak tier).
 *
 * Admin, verbatim: *"ek bahut dangerous issue … racing game me car ulti chal rahi hai"* — the player's car
 * showed its HEADLIGHTS, and pressing LEFT turned it RIGHT, "on every game built now".
 *
 * Both symptoms are ONE defect: the camera sat on the side the car's nose points to, and seen face-on the
 * driver's left is the screen's right. The kit's correct camera and steering (2026-10-05) never reached
 * this game, because the builder never ran a recipe and hand-wrote its own engine. This file locks the
 * CLASSES behind that, each proven by reverting the fix and watching it fail:
 *
 *  1. THE KIT IS LAID DOWN BY THE PLATFORM, NOT LEFT TO THE MODEL (L-04, L-15) — `gameKitPlan`, the route's
 *     seed through `dispatcher.dispatch('run_recipe')`, the platform-authored index, and the honest
 *     FAST_LANE_SKIPPED_GAME / GAME_KIT_SEEDED lines.
 *  2. A PLATFORM SEED IS NEVER MISTAKEN FOR THE BUILDER'S WORK — `builderWrittenCount` in every "did this
 *     build produce anything?" question (the empty-build retry, the zero bill, the claim audit).
 *  3. THE INSTRUCTIONS ARE TRUE WITH OR WITHOUT THE KIT (P-1, P-2, P-3, P-4) — every game step is the call
 *     the model can make, every kit file is named by its real path, the camera half of the +Z rule is in
 *     plain three.js, writing sub-agents carry it, and AppKnowledgeBase stops promising what is not done.
 *  4. THE ETA PRICES A GAME AS A GAME, AND THE WRITER FILES IT UNDER THE KEY THE READER USES (L-12).
 *  5. THE GAME IS PLAYED AFTER THE EXPLORER HAS PRESSED THE APP (L-18).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  gameKitPlan, gameKitSeedEnabled, gameKitFrameworkSupported, gameKitHandoffBlock, compactRecipeResult,
  gameKitSeededMessage, builderWrittenCount, HANDOFF_RECIPE_CHARS, gameKitWants3D, gameKitRecipeInput,
  type GameKitRecipe, type GameKitSeedResult,
} from '../src/server/AgentV3/gameKitSeed';
import { GAME_RECIPES, recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { wantsSceneObjects, heroObjectContract } from '../src/server/lib/heroObjectSpec';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { appGeneratesImages } from '../src/server/AgentV3/inAppImageGeneration';
import { architectSystemPrompt, GAME_KIT_RULE, VEHICLE_CAMERA_RULE_LINES } from '../src/server/AgentV3/systemPrompt';
import { moduleText } from '../src/server/AgentV3/reliability/modularPrompt';
import { isPlatformSeededFile, modelAuthoredPaths, _resetPlatformSeededIndex } from '../src/server/AgentV3/platformAuthored';
import { etaTaskKey, etaBuildKind, fleetEtaBasisNote, SCAFFOLD_TASK_KEY } from '../src/server/AgentV3/etaHistory';
import { PROCESS_ONLY_CODES, isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const ROUTE = read('src/server/routes/agentv3.ts');

/** The report's own prompt, verbatim. */
const REPORTED = 'Create an racing game for Nokia c 2-01';

// ── 1 · THE KIT IS LAID DOWN BY THE PLATFORM ─────────────────────────────────────────────────────────

describe('1a · gameKitPlan — which recipes the platform runs, PURE', () => {
  it('the report\'s own prompt is a game, and the plan starts with the runtime', () => {
    expect(analyzeRequirementGaps(REPORTED).domain).toBe('game');
    const plan = gameKitPlan(REPORTED, 'vite-react');
    expect(plan[0]).toBe('generate_game_runtime');
    expect(plan).toContain('generate_game_vfx');
    expect(plan).toContain('generate_melody');
  });

  it('the route\'s flat list always wins: the seed never lays the 3D layer or the shell under a game the route calls flat', () => {
    for (const p of [REPORTED, 'make a 3d racing game', 'make a bike racing game', 'build a car game', 'sudoku game banao', 'a quiz game for kids', '3d snake game', 'Create a candy crush game']) {
      const plan = gameKitPlan(p, 'vite-react');
      if (!wantsSceneObjects(p)) {
        expect(plan.includes('generate_game_3d'), p).toBe(false);
        expect(plan.includes('generate_game_shell'), p).toBe(false);
      }
      // The 3D layer and the shell travel together, always.
      expect(plan.includes('generate_game_3d'), p).toBe(plan.includes('generate_game_shell'));
    }
  });

  it('🔒 3D needs a POSITIVE sign — a game the request leaves open is never laid down as 3D (found in verification)', () => {
    // wantsSceneObjects calls EVERY game not on the flat list a scene, so the first version of this seed
    // laid three.js and the 3D shell under each of these and told the builder "This is a 3D game".
    for (const p of [
      'rock paper scissors game', 'guess the number game', 'hangman game', 'Create a flappy bird game', 'Make a pong game',
      'brick breaker game banao', 'whack a mole game', 'typing speed game', 'math game for kids', 'cookie clicker game',
      'piano tiles game', 'Build a space invaders game', 'make a game', 'typing race game', 'Create a battleship game',
    ]) {
      expect(gameKitWants3D(p), p).toBe(false);
      expect(gameKitPlan(p, 'vite-react'), p).toEqual(['generate_game_runtime', 'generate_game_vfx', 'generate_melody']);
    }
  });

  it('a request that says 3D, or is a racing / driving / vehicle / open-world / village game, gets the 3D kit', () => {
    for (const p of [REPORTED, 'make a 3d racing game', 'make a bike racing game', 'build a car game', 'a 3d football game',
      'open world game like GTA', 'Indian village game', 'truck driving simulator game', '3d snake game']) {
      expect(gameKitWants3D(p), p).toBe(true);
      expect(gameKitPlan(p, 'vite-react'), p).toContain('generate_game_shell');
    }
    expect(gameKitWants3D('gaadi wala game')).toBe(true); // the Hinglish word, whatever the domain reader says
  });

  it('🔒 a plan without the 3D layer takes only the SOUND half of the effects layer (its particles are three.js)', () => {
    const flat: GameKitRecipe[] = gameKitPlan('make a sudoku game');
    expect(gameKitRecipeInput('generate_game_vfx', flat)).toEqual({ include: ['audio'] });
    const threeD: GameKitRecipe[] = gameKitPlan(REPORTED);
    expect(gameKitRecipeInput('generate_game_vfx', threeD)).toBeUndefined();
    for (const r of threeD) if (r !== 'generate_game_vfx') expect(gameKitRecipeInput(r, threeD), r).toBeUndefined();
  });

  it('a racing game gets the whole 3D kit, in the prompt\'s order: runtime first, 3D before the shell, shell last', () => {
    expect(gameKitPlan('make a 3d racing game', 'vite-react')).toEqual([
      'generate_game_runtime', 'generate_game_3d', 'generate_game_vfx', 'generate_melody', 'generate_game_shell',
    ]);
    expect(gameKitPlan('make a bike racing game')).toContain('generate_game_shell');
  });

  it('a board, puzzle or candy game never gets three.js or the 3D shell (candy autopsy 7da1cdca)', () => {
    for (const p of ['make a sudoku game', 'Ek puzzle game bnao candy wala', 'Create a candy crush game', 'snake game banao', 'a match-3 game with fruits']) {
      expect(gameKitPlan(p, 'vite-react'), p).toEqual(['generate_game_runtime', 'generate_game_vfx', 'generate_melody']);
    }
  });

  it('a plain HTML site, another framework or a non-game gets nothing at all', () => {
    expect(gameKitPlan(REPORTED, 'static')).toEqual([]);
    for (const fw of ['nextjs', 'vue', 'svelte', 'node-express', 'python-fastapi']) expect(gameKitPlan(REPORTED, fw), fw).toEqual([]);
    expect(gameKitPlan('a todo list app with dark mode', 'vite-react')).toEqual([]);
    expect(gameKitPlan('', 'vite-react')).toEqual([]);
    expect(gameKitFrameworkSupported(undefined)).toBe(true); // the default scaffold is vite-react
    expect(gameKitFrameworkSupported('static')).toBe(false);
  });

  it('every recipe it can plan is a real recipe', () => {
    for (const r of gameKitPlan('make a 3d racing game')) expect(Object.keys(GAME_RECIPES)).toContain(r);
  });

  it('the kill switch is AGENTV3_GAME_KIT_SEED=off and nothing else', () => {
    expect(gameKitSeedEnabled({})).toBe(true);
    expect(gameKitSeedEnabled({ AGENTV3_GAME_KIT_SEED: 'off' })).toBe(false);
    expect(gameKitSeedEnabled({ AGENTV3_GAME_KIT_SEED: 'on' })).toBe(true);
  });
});

/** The sandbox, in memory — the same shape the candy autopsy test drives the real dispatcher with. */
class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, cmd: string) { this.commands.push(cmd); return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

/** Run the plan exactly as the route does: one `run_recipe` dispatch per recipe, as the architect. */
async function seed(act: FakeActuator, plan: string[], recorded: Map<string, string>): Promise<GameKitSeedResult[]> {
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(
    act, 'ws-racing', new WorkspaceState(stream), stream,
    undefined, undefined, undefined, undefined, undefined, undefined,
    (path, content) => { recorded.set(path, content); },
  );
  const out: GameKitSeedResult[] = [];
  for (const recipe of plan) {
    const recipeInput = gameKitRecipeInput(recipe as GameKitRecipe, plan as GameKitRecipe[]);
    const r = await d.dispatch({ id: `game-kit-${recipe}`, name: 'run_recipe', input: { name: recipe, ...(recipeInput ? { input: recipeInput } : {}) } }, 'architect');
    out.push({ recipe, ok: !r.is_error, content: String(r.content ?? '') });
  }
  return out;
}

describe('1b · the seed through the real dispatcher — what lands, and whose it is', () => {
  let act: FakeActuator;
  let recorded: Map<string, string>;
  beforeEach(() => {
    _resetPlatformSeededIndex();
    act = new FakeActuator();
    recorded = new Map();
    act.files.set('package.json', JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0' } }));
  });

  it('the report\'s prompt lays down the engine the builder must use: the loop, meta, objects, camera and shell', async () => {
    const results = await seed(act, gameKitPlan(REPORTED), recorded);
    expect(results.every((r) => r.ok), JSON.stringify(results.map((r) => [r.recipe, r.content.slice(0, 120)]))).toBe(true);
    for (const p of ['src/game/core/loop.ts', 'src/game/core/meta.ts', 'src/game/three/objects.ts', 'src/game/three/camera.ts', 'src/game/Game.ts', 'src/game/GameCanvas.tsx']) {
      expect(act.files.has(p), p).toBe(true);
      expect(recorded.has(p), `${p} reached the saved project`).toBe(true);
    }
    // The kit's correct path is ON DISK now — the thing build 46e2d74b never had.
    expect(act.files.get('src/game/three/objects.ts')).toContain('export function driveVehicle(');
    expect(act.files.get('src/game/Game.ts')).toContain('this.rig.follow(');
  });

  it('🔒 every file the seed wrote is recognised byte-for-byte as NavBharatAI\'s own — never graded or blamed as the user\'s', async () => {
    await seed(act, gameKitPlan('make a 3d racing game'), recorded);
    const kit = [...recorded].filter(([p]) => p.startsWith('src/game/') || p.startsWith('src/audio/'));
    expect(kit.length).toBeGreaterThan(20);
    for (const [p, c] of kit) expect(isPlatformSeededFile(p, c), p).toBe(true);
    expect(modelAuthoredPaths(new Map(kit))).toEqual([]);
    // …and the moment the builder changes one byte of a kit file, it is the user's again.
    const [p0, c0] = kit[0];
    expect(modelAuthoredPaths(new Map([[p0, `${c0}\n// tuned`]]))).toEqual([p0]);
  });

  it('🔒 never writes over a file that is already there', async () => {
    act.files.set('src/game/core/loop.ts', '// the user\'s own loop');
    await seed(act, ['generate_game_runtime'], recorded);
    expect(act.files.get('src/game/core/loop.ts')).toBe('// the user\'s own loop');
    expect(recorded.has('src/game/core/loop.ts')).toBe(false);
  });

  it('a 2D game gets no three.js layer and no 3D shell on disk', async () => {
    await seed(act, gameKitPlan('make a sudoku game'), recorded);
    expect([...act.files.keys()].some((p) => p.startsWith('src/game/three/'))).toBe(false);
    expect(act.files.has('src/game/GameCanvas.tsx')).toBe(false);
    expect(act.files.has('src/game/core/loop.ts')).toBe(true);
  });

  it('🔒 …and `three` is never installed for it: the effects layer lands as sound only (found in verification)', async () => {
    // The whole effects layer imports three.js (particles.ts), and run_recipe installs what a recipe imports —
    // so the first version of this seed ran `npm install three` for every sudoku, snake and candy game.
    const results = await seed(act, gameKitPlan('Create a candy crush game'), recorded);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(act.commands.filter((c) => /\bthree\b/.test(c)), act.commands.join('\n')).toEqual([]);
    expect(act.files.has('src/game/fx/audio.ts')).toBe(true);
    expect(act.files.has('src/game/fx/synth.ts')).toBe(true);
    expect(act.files.has('src/game/fx/particles.ts')).toBe(false);
    expect(act.files.has('src/game/fx/feedback.ts')).toBe(false);
    const block = gameKitHandoffBlock(results, { flat: true });
    expect(block).toContain('This game is drawn in 2D on purpose');
    expect(block).toContain('The effects layer is SOUND ONLY here');
    expect(block).not.toContain('particle\nsystem or audio engine');
  });

  it('a 3D game still gets the whole effects layer, and three installed with the 3D layer', async () => {
    await seed(act, gameKitPlan(REPORTED), recorded);
    expect(act.files.has('src/game/fx/particles.ts')).toBe(true);
    expect(act.commands.some((c) => /npm install[^\n]*\bthree@/.test(c))).toBe(true);
  });

  it('the handoff states only what is on disk, built from the real recipe results', async () => {
    const results = await seed(act, gameKitPlan(REPORTED), recorded);
    const block = gameKitHandoffBlock(results);
    expect(block).toMatch(/^\[BUILD ON THE GAME KIT — IT IS ALREADY IN src\/game\]/);
    expect(block).toContain('NEVER write a second game loop, input system, camera, meta/best-score store');
    expect(block).toContain('ctx.follow(vehicle)');
    expect(block).toContain('--- generate_game_runtime ---');
    // Every path the block names as written is really there.
    for (const m of block.matchAll(/^Wrote: (.+)$/gm)) {
      for (const p of m[1].split(', ')) expect(act.files.has(p), p).toBe(true);
    }
  });
});

describe('1c · the handoff block, PURE', () => {
  const ok = (recipe: string, content = `Wired:\nCreated src/game/x/${recipe}.ts\n\nUse it like this.`): GameKitSeedResult => ({ recipe, ok: true, content });

  it('nothing laid down ⇒ no block at all — never a claim that a kit exists', () => {
    expect(gameKitHandoffBlock([])).toBe('');
    expect(gameKitHandoffBlock([{ recipe: 'generate_game_runtime', ok: false, content: 'Error: boom' }])).toBe('');
  });

  it('a recipe that failed is named with the call that runs it', () => {
    const block = gameKitHandoffBlock([ok('generate_game_runtime'), { recipe: 'generate_game_3d', ok: false, content: 'Error: x' }]);
    expect(block).toContain('NOT laid down: generate_game_3d');
    expect(block).toContain('run_recipe({ name: "generate_game_3d" })');
    expect(block).not.toContain('--- generate_game_3d ---');
    // Every failed recipe is named with its own call, not only the first.
    const two = gameKitHandoffBlock([ok('generate_game_runtime'), { recipe: 'generate_game_3d', ok: false, content: '' }, { recipe: 'generate_game_shell', ok: false, content: '' }]);
    expect(two).toContain('run_recipe({ name: "generate_game_3d" }) and run_recipe({ name: "generate_game_shell" })');
  });

  it('2D and 3D are told different, true things', () => {
    expect(gameKitHandoffBlock([ok('generate_game_runtime'), ok('generate_game_vfx')])).toContain('no 3D layer and no 3D shell were laid down');
    const threeD = gameKitHandoffBlock([ok('generate_game_runtime'), ok('generate_game_3d'), ok('generate_game_shell')]);
    expect(threeD).toContain('<GameCanvas> from src/game/GameCanvas.tsx');
    expect(threeD).not.toContain('no 3D layer');
  });

  it('a flat game is 2D on purpose; a game the request left open is told how to add 3D, never "2D" as a fact', () => {
    const twoD = [ok('generate_game_runtime'), ok('generate_game_vfx'), ok('generate_melody')];
    const flat = gameKitHandoffBlock(twoD, { flat: true });
    expect(flat).toContain('drawn in 2D on purpose');
    expect(flat).not.toContain('run_recipe({ name: "generate_game_shell" })');
    const open = gameKitHandoffBlock(twoD, { flat: false });
    expect(open).not.toContain('drawn in 2D on purpose');
    expect(open).toContain('The request does not say this game is 3D');
    expect(open).toContain('run_recipe({ name: "generate_game_3d" }) and then run_recipe({ name: "generate_game_shell" })');
  });

  it('a 3D plan whose shell failed never calls the game 2D, and never names <GameCanvas> as on disk', () => {
    const block = gameKitHandoffBlock([ok('generate_game_runtime'), ok('generate_game_3d'), { recipe: 'generate_game_shell', ok: false, content: '' }]);
    expect(block).not.toContain('no 3D layer');
    expect(block).not.toContain('<GameCanvas> from src/game/GameCanvas.tsx');
    expect(block).toContain('This is a 3D game.');
    expect(block).toContain('NOT laid down: generate_game_shell');
  });

  it('the per-file lines collapse to one "Wrote:" line and a long result is bounded', () => {
    expect(compactRecipeResult('Wired the runtime:\nCreated src/a.ts\nUnchanged src/b.ts (already exactly)\n\nDo this.')).toBe('Wrote: src/a.ts, src/b.ts\nDo this.');
    expect(compactRecipeResult(`Wired:\n${'x'.repeat(HANDOFF_RECIPE_CHARS + 500)}`).length).toBeLessThan(HANDOFF_RECIPE_CHARS + 200);
  });

  it('the admin line names what ran and what did not', () => {
    const m = gameKitSeededMessage([ok('generate_game_runtime'), { recipe: 'generate_melody', ok: false, content: '' }], 9, 2400);
    expect(m).toContain('generate_game_runtime (9 files, 2.4 s)');
    expect(m).toContain('Not laid down: generate_melody');
  });
});

describe('1d · the route seeds the kit before the first model call, behind every gate (source guard)', () => {
  const seedAt = ROUTE.indexOf('// ── GAME KIT SEED (admin 2026-10-11, build 46e2d74b');
  const block = ROUTE.slice(seedAt, ROUTE.indexOf('// ── ONE-SHOT FAST LANE', seedAt));

  it('sits after the golden pre-seed and before the package snapshot, the fast lane and the builder', () => {
    const goldenAt = ROUTE.indexOf('// ── GOLDEN SCAFFOLD PRE-SEED');
    const pkgAt = ROUTE.indexOf('const packageJsonAtBuildStart');
    expect(goldenAt).toBeGreaterThan(-1);
    expect(seedAt).toBeGreaterThan(goldenAt);
    expect(pkgAt).toBeGreaterThan(seedAt);
    // The first model calls of a build: the fast lane's and the full builder's.
    expect(ROUTE.indexOf('const sb = await runSimpleBuild(', seedAt)).toBeGreaterThan(pkgAt);
    expect(ROUTE.indexOf('runner.run(buildPrompt)', seedAt)).toBeGreaterThan(pkgAt);
  });

  it('runs only on a new build of a fresh workspace, never an edit, import, module, template or pasted page', () => {
    expect(block).toContain("if (intent === 'new_build' && !projectModuleRef && !isImportTurn) {");
    expect(block).toContain('gameKitPlan(prompt, framework)');
    expect(block).toContain('} else if (!gameKitSeedEnabled()) {');
    expect(block).toContain('} else if (goldenPreseeded) {');
    expect(block).toContain('} else if (pastedSeed.size > 0) {');
    expect(block).toContain('await srcHoldsOnlyOurStarter(');
  });

  it('goes through the dispatcher exactly as a model call would, with the plan bookkeeping muted', () => {
    expect(block).toContain("const recipeInput = gameKitRecipeInput(recipe, kitPlan);");
    expect(block).toContain("dispatcher.dispatch({ id: `game-kit-${recipe}`, name: 'run_recipe', input: { name: recipe, ...(recipeInput ? { input: recipeInput } : {}) } }, 'architect', { signal: abort.signal })");
    const on = block.indexOf('platformSeedInFlight = true;');
    const off = block.indexOf('platformSeedInFlight = false;');
    expect(on).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(on);
    expect(block.slice(on, off)).toContain('} finally {');
    expect(ROUTE).toContain('if (!platformSeedInFlight) noteEtaFileWritten();');
    expect(ROUTE).toContain('if (cur.length > 0 && !platformSeedInFlight) {');
  });

  it('remembers every seeded file as ours, hands the builder the kit, and says so in the report', () => {
    expect(block).toContain('preseededGolden.set(kp, kc);');
    expect(block).toContain('kitSeededFiles.set(kp, kc);');
    expect(block).toContain('buildPrompt = `${gameKitHandoffBlock(kitResults, { flat: !wantsSceneObjects(prompt) })}\\n\\n---\\n\\n${buildPrompt}`;');
    expect(block).toContain("code: 'GAME_KIT_SEEDED'");
    expect(block).toContain("code: 'GAME_KIT_NOT_SEEDED'");
    expect(block).toContain('futilityState = armedFutilityState(');
  });

  it('L-15: FAST_LANE_SKIPPED_GAME states whether the kit is on disk instead of assuming it', () => {
    const at = ROUTE.indexOf("code: 'FAST_LANE_SKIPPED_GAME'");
    const before = ROUTE.slice(ROUTE.lastIndexOf('if (fastLaneGameSkip) {', at), at);
    expect(before).toContain('gameKitSeeded.length > 0');
    expect(before).toContain('The game kit was NOT laid down (${gameKitSkipReason');
  });

  it('the seed\'s findings are facts about OUR run — never a mark against the user\'s app', () => {
    for (const code of ['GAME_KIT_SEEDED', 'GAME_KIT_NOT_SEEDED']) {
      expect(PROCESS_ONLY_CODES.has(code), code).toBe(true);
      expect(isAppFinding({ code, severity: 'warning', phase: 'build' } as never), code).toBe(false);
      expect(buildFindingSuggestions([{ code, severity: 'warning' }] as never)).toEqual([]);
    }
  });
});

// ── 2 · A PLATFORM SEED IS NEVER THE BUILDER'S WORK ──────────────────────────────────────────────────

describe('2 · builderWrittenCount — the kit alone is not a build', () => {
  const kit = new Map([['src/game/core/loop.ts', 'LOOP'], ['package.json', '{"three":1}']]);

  it('a builder that wrote nothing after the seed wrote nothing — the retry fires and the bill is ₹0', () => {
    expect(builderWrittenCount(new Map(kit), kit)).toBe(0);
  });

  it('a file the builder wrote counts; so does a kit file it CHANGED', () => {
    expect(builderWrittenCount(new Map([...kit, ['src/App.tsx', 'GAME']]), kit)).toBe(1);
    expect(builderWrittenCount(new Map([['src/game/core/loop.ts', 'LOOP2'], ['package.json', '{"three":1}']]), kit)).toBe(1);
  });

  it('with nothing seeded it is exactly the old count — every other build is untouched', () => {
    const w = new Map([['a', '1'], ['b', '2']]);
    expect(builderWrittenCount(w, new Map())).toBe(2);
  });

  it('every "did this build produce anything?" question in the route reads it (source guard)', () => {
    expect(ROUTE).toContain('const builderWroteCount = (): number => builderWrittenCount(writtenFiles, kitSeededFiles);');
    for (const line of [
      'if (expectsArtifacts && builderWroteCount() === 0) {',                                   // the zero bill
      'filesWritten: builderWroteCount(), // our game kit alone is not a build',                  // the empty-build retry
      'if (retry.ok || builderWroteCount() > 0) {',
      'if (firstAttemptAskedTheUser && expectsArtifacts && builderWroteCount() === 0) {',
      'if (expectsArtifacts && builderWroteCount() === 0 && modelAnswer.declined && !abort.signal.aborted) {',
      "(builderWroteCount() === 0 ? 'no-writes' : null)",
      'renderRescueEligible({ ok: result.ok, expectsArtifacts, filesWritten: builderWroteCount() })',
      // The empty-build flip (found in verification): with the kit counted, a builder that wrote nothing kept
      // `ok: true` and its own "your game is ready" over an engine with no game in it.
      'expectsArtifacts, builderWroteCount(), sandboxUnavailable, buildObs.previewRendered,',
    ]) expect(ROUTE, line).toContain(line);
    expect(ROUTE).not.toContain('expectsArtifacts, writtenFiles.size, sandboxUnavailable, buildObs.previewRendered,');
    expect(ROUTE).not.toContain('if (expectsArtifacts && writtenFiles.size === 0) {');
  });

  it('the measured ETA does not count our kit as progress on the builder\'s plan', () => {
    expect(ROUTE).toContain('const etaFilesDone = Math.max(0, writtenFiles.size - etaPlatformSeededFiles);');
    expect(ROUTE).toContain('etaPlatformSeededFiles += kitFiles;');
  });
});

// ── 3 · THE INSTRUCTIONS ARE TRUE WITH OR WITHOUT THE KIT ────────────────────────────────────────────

describe('3a · P-2: every game step is the call the model can actually make (census)', () => {
  const games = moduleText(architectSystemPrompt(), 'games');

  it('the games module is really read (canary)', () => {
    expect(games).toContain('GAMES ARE BUILT WITH THE GAME TOOLS');
    expect(games.length).toBeGreaterThan(5_000);
  });

  it('every recipe name in the game section is written as run_recipe({ name: "…" }) — no bare tool names', () => {
    const names = [...games.matchAll(/generate_\w+/g)];
    expect(names.length).toBeGreaterThan(6);
    const bare = names.filter((m) => !games.slice(Math.max(0, m.index! - 20), m.index).endsWith('run_recipe({ name: "')).map((m) => m[0]);
    expect(bare, 'a bare generate_* name is a tool the model does not have (build 46e2d74b)').toEqual([]);
  });

  it('every kit file the section names is named by its REAL path, never as a bare file that may not exist', () => {
    const paths = [...recipeFilePool().keys()];
    const offenders: string[] = [];
    for (const full of paths) {
      const base = full.split('/').pop()!;
      const re = new RegExp(`(^|[^\\w/.-])${base.replace(/\./g, '\\.')}\\b`, 'g');
      for (const m of games.matchAll(re)) offenders.push(`${base} @${m.index}`);
    }
    expect(offenders, 'name the file by its path and the recipe that writes it (meta.ts, objects.ts in 46e2d74b)').toEqual([]);
  });

  it('nothing is described as already present: the section says the files exist only once their recipe ran', () => {
    expect(games).toContain('NONE of those files exists until its recipe has run');
    expect(games).not.toContain('IT ALSO SHIPS meta.ts');
    expect(games).not.toMatch(/(^|\s)objects\.ts builds them/);
  });

  it('the route\'s 3D object block and the hero contract name the path and the recipe too', () => {
    expect(ROUTE).toContain("'the 3D layer\\'s builders in src/game/three/objects.ts (createCar / createTree / createMountain / '");
    expect(ROUTE).toContain("'shapes. That file is written by run_recipe({ name: \"generate_game_3d\" }) — if it is not in the '");
    expect(ROUTE).not.toContain("+ 'objects.ts (createCar / createTree");
    const hero = heroObjectContract('3d auto rickshaw driving game').block;
    expect(hero).toContain('BUILD IT WITH createAutoRickshaw from src/game/three/objects.ts');
    expect(hero).toContain('run_recipe({ name: "generate_game_3d" })');
  });
});

describe('3b · P-1: the CAMERA half of the +Z rule, in plain three.js', () => {
  const prompt = architectSystemPrompt();
  const rule = VEHICLE_CAMERA_RULE_LINES.join('\n');

  it('the camera goes opposite the nose, as code any builder can copy — with or without the kit', () => {
    expect(rule).toContain('new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion)');
    expect(rule).toContain('camera.position.copy(car.position).addScaledVector(forward, -6)');
    expect(rule).toContain('camera.lookAt(car.position)');
    expect(rule).toContain('camera = car.position − forward·d + up·h: at −Z LOCAL of a +Z model');
  });

  it('it forbids the exact habit that filmed the headlights, and states the steering sign', () => {
    expect(rule).toContain('NEVER\ncamera.position.z = car.position.z + d');
    expect(rule).toContain("LEFT (A / ←) turns the car toward the DRIVER'S left = its own\n+X (car.rotation.y increases), which is SCREEN-left when the camera is behind");
  });

  it('the architect prompt carries every one of those lines, inside the games module', () => {
    const games = moduleText(prompt, 'games');
    for (const line of VEHICLE_CAMERA_RULE_LINES) expect(games, line).toContain(line);
    // The kit half is kept, and named by path.
    expect(games).toContain('ctx.follow(vehicle) in the game shell');
    expect(games).toContain('NEVER rig.update(vehicle.position)');
    expect(games).toContain('src/game/three/objects.ts');
  });

  it('the geometry is right: behind a +Z car, the driver\'s left (+X) is the screen\'s left', () => {
    // Camera at car − forward·d looks along +forward = +Z. Its right vector is forward × up.
    const forward = [0, 0, 1];
    const up = [0, 1, 0];
    const right = [forward[1] * up[2] - forward[2] * up[1], forward[2] * up[0] - forward[0] * up[2], forward[0] * up[1] - forward[1] * up[0]];
    expect(right).toEqual([-1, 0, 0]);            // screen-right is world −X …
    // …so +X — where a LEFT turn (rotation.y increasing) swings the nose: sin(+δ) > 0 — is screen-left.
    expect(Math.sin(0.1)).toBeGreaterThan(0);
  });

  it('a vehicle still starts moving (the 2026-08-25 rule is kept)', () => {
    expect(prompt).toContain('A VEHICLE STARTS MOVING, ALWAYS');
  });
});

describe('3c · P-3: a writing sub-agent carries the game rule, with the SAME camera lines', () => {
  it('the rule names the run_recipe calls, the kit-on-disk rule and every camera line', () => {
    expect(GAME_KIT_RULE).toContain('run_recipe({ name: "generate_game_runtime" })');
    expect(GAME_KIT_RULE).toContain('If src/game/core/loop.ts exists, the kit is ALREADY in the project');
    expect(GAME_KIT_RULE).toContain('NON-ZERO');
    for (const line of VEHICLE_CAMERA_RULE_LINES) expect(GAME_KIT_RULE, line).toContain(line);
  });

  it('SubAgent pushes it to every role that writes files, beside the image rule', () => {
    expect(read('src/server/AgentV3/SubAgent.ts')).toMatch(/if \(roleExpectsArtifacts\(cfg\.tools\)\) contextBlocks\.push\(GAME_KIT_RULE\);/);
  });
});

describe('3d · P-4: AppKnowledgeBase says what a game build really guarantees', () => {
  const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
  it('no unconditional "it first lays down a real game runtime"', () => {
    expect(kb).not.toContain('Ask for a game and it first lays down a real game runtime');
  });
  it('names when the engine is laid down, when it is not, and the camera note', () => {
    expect(kb).toContain('WHEN THE ENGINE IS LAID DOWN (corrected 2026-10-11, build 46e2d74b)');
    expect(kb).toContain('It is NOT laid down automatically when you change an existing game');
    expect(kb).toContain('HONEST NOTE (2026-10-11, build 46e2d74b)');
  });
});

describe('3e · one list of 2D games: the 3D gate agrees with the prompt\'s own 2D list', () => {
  it('match-3, candy crush and the snake game are flat', () => {
    for (const p of ['snake game banao', 'Create a candy crush game', 'a match-3 game with fruits', 'match three puzzle game']) {
      expect(wantsSceneObjects(p), p).toBe(false);
    }
  });
  it('snakes in a scene, a 3D snake game and the racing games stay scenes', () => {
    for (const p of ['a jungle adventure game with snakes and tigers', '3d snake game', REPORTED, 'make a bike racing game']) {
      expect(wantsSceneObjects(p), p).toBe(true);
    }
  });
});

describe('3f · the 2D path never pulls three.js in through the effects layer (found in verification)', () => {
  it('the architect prompt\'s 2D line takes only the effects layer\'s sound half', () => {
    const games = moduleText(architectSystemPrompt(), 'games');
    expect(games).toContain('take only the SOUND half of');
    expect(games).toContain('run_recipe({ name: "generate_game_vfx", input: { include: ["audio"] } })');
    expect(games).not.toContain('runtime, the vfx and the melody recipes');
  });
  it('the recipe\'s own description no longer says it adds no dependency', () => {
    const catalog = read('src/server/AgentV3/ToolCatalog.ts');
    expect(catalog).not.toContain('Adds no dependency and needs NO sound files');
    expect(catalog).toContain('so a 2D game takes \'\n        + \'include: ["audio"]');
  });
  it('the seed module no longer claims its 2D recipes add no dependency', () => {
    const src = read('src/server/AgentV3/gameKitSeed.ts');
    expect(src).not.toMatch(/melody layer — none adds a dependency/);
  });
});

// ── 4 · THE ETA PRICES A GAME AS A GAME ──────────────────────────────────────────────────────────────

describe('4 · L-12: the ETA key is decided before the estimate, and one helper keys both sides', () => {
  it('the report\'s prompt is a game build, whatever the scorer called it', () => {
    const kind = etaBuildKind(analyzeRequirementGaps(REPORTED).domain, appGeneratesImages(REPORTED));
    expect(kind).toBe('game');
    expect(etaTaskKey('simple_app', false, false, kind)).toBe('game');
    expect(etaTaskKey('complex_app', false, true, kind)).toBe('game');
  });

  it('an app that makes pictures is its own slice too; a template stays a template', () => {
    expect(etaBuildKind('general', true)).toBe('image_app');
    expect(etaTaskKey('simple_app', false, false, 'image_app')).toBe('image_app');
    expect(etaTaskKey('simple_app', true, false, 'game')).toBe(SCAFFOLD_TASK_KEY);
  });

  it('with no kind, every existing key is unchanged', () => {
    expect(etaBuildKind('ecommerce', false)).toBeNull();
    expect(etaTaskKey('simple_app', false, true)).toBe('complex_app');
    expect(etaTaskKey('simple_app', false, false)).toBe('simple_app');
    expect(etaTaskKey(null, false)).toBe('unknown');
  });

  it('the admin line names the slice in words', () => {
    expect(fleetEtaBasisNote('game', 12, 4)).toContain('game builds');
    expect(fleetEtaBasisNote('image_app', 3, 2)).toContain('apps that make pictures');
  });

  it('the kind is known before the opening ETA and before the fast-lane skip (source guard)', () => {
    const kindAt = ROUTE.indexOf('const etaKind: EtaBuildKind | null = intent === \'new_build\' && !isImportTurn');
    const readerAt = ROUTE.indexOf('const etaFleetKey =');
    const skipAt = ROUTE.indexOf('fastLaneGameSkip = fastLaneSkipsGame(');
    expect(kindAt).toBeGreaterThan(-1);
    expect(readerAt).toBeGreaterThan(kindAt);
    expect(skipAt).toBeGreaterThan(readerAt);
  });

  it('the reader and the telemetry writer use ONE helper; etaTaskKey is called nowhere else in the route', () => {
    expect(ROUTE).toContain('etaKeyForBuild(scaffoldWillSeed)');
    expect(ROUTE).toMatch(/\.record\(\{[\s\S]{0,600}?taskType: etaKeyForBuild\(goldenPreseeded\),/);
    const calls = [...ROUTE.matchAll(/\betaTaskKey\(/g)];
    expect(calls).toHaveLength(1); // inside `etaKeyForBuild`
    expect(ROUTE).toContain('etaTaskKey(analysis?.taskType, scaffolded, buildIsComplex, etaKind)');
  });
});

// ── 5 · THE GAME IS PLAYED AFTER THE EXPLORER HAS PRESSED THE APP ────────────────────────────────────

describe('5 · L-18: press-run → playtest → the explorer\'s repair', () => {
  it('the playtest runs once, right after the explorer recorded its presses and before any repair', () => {
    const def = ROUTE.indexOf('const runGamePlaytest = async (): Promise<void> => {');
    const pressed = ROUTE.indexOf('gateEvidence.explorePresses = explored.pressed;');
    const played = ROUTE.indexOf('await runGamePlaytest();', pressed);
    const repair = ROUTE.indexOf("const targets = explored.outcome === 'failed' && explorerRepairEnabled()", pressed);
    expect(def).toBeGreaterThan(-1);
    expect(pressed).toBeGreaterThan(def);
    expect(played).toBeGreaterThan(pressed);
    expect(repair).toBeGreaterThan(played);
  });

  it('when the explorer does not run, the game is still played — and never twice', () => {
    const calls = [...ROUTE.matchAll(/await runGamePlaytest\(\);/g)];
    expect(calls).toHaveLength(2);
    expect(ROUTE).toContain('if (gamePlaytestDone) return;');
    // The script is started from inside the closure only.
    expect([...ROUTE.matchAll(/gamePlaytestScript\(/g)]).toHaveLength(1);
    expect(ROUTE.indexOf('gamePlaytestScript(')).toBeGreaterThan(ROUTE.indexOf('const runGamePlaytest = async'));
  });
});
