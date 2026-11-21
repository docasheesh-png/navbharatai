import { readyOverrunNote } from '../src/server/AgentV3/doneSignal';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { describe, expect, it, vi } from 'vitest';
import { splitSeedOrphans, seedOrphanObservation } from '../src/server/AgentV3/seedOrphanOwnership';
import { roadmapGuardrail } from '../src/server/lib/megaRoadmap';
import { readSummaryManifest } from '../src/server/AgentV3/ProjectSummary';
import { readFileSync } from 'node:fs';
import { createSandboxAdmissionBudget, sandboxAdmissionActuator } from '../src/server/AgentV3/sandboxAdmissionBudget';
import { sandboxWasUnavailable } from '../src/server/AgentV3/sandboxAvailability';
import type { IEngineerActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/IEngineerActuator';
import { prepareGameSeedWorkspace } from '../src/server/AgentV3/gameSeedWorkspace';
import { compilerNeedsPackageSetup, compilerRepairProven } from '../src/server/AgentV3/compilerSetupBoundary';
import { runEndgameRepair } from '../src/server/AgentV3/EndgameRepair';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { gameKitPlan, gameTurnRequest, gamePlannerCapability, gameTurnHandoff } from '../src/server/AgentV3/gameKitSeed';
import { extractFacts, type ProjectGraph } from '../src/server/AgentV3/WorkspaceMemory';
import { findOrphanComponents } from '../src/server/AgentV3/ArchitectureAnalysis';
import { summarizeProject, isProjectSummaryNarration } from '../src/server/AgentV3/ProjectSummary';
import { completedAppReviewEligible, offerBugHunt } from '../src/server/AgentV3/optionalBugHunt';
import { finalChecksEtaLine, etaAppExists } from '../src/server/AgentV3/progressEta';

const route = () => readFileSync('src/server/routes/agentv3.ts', 'utf8');
const missing = (name: string) => `src/game/GameCanvas.tsx(1,45): error TS2307: Cannot find module '${name}' or its corresponding type declarations.`;
const jsx = "src/game/GameCanvas.tsx(63,7): error TS2875: This JSX tag requires the module path 'react/jsx-runtime' to exist, but none could be found. Make sure you have types for the appropriate package installed.";
const reportErrors = ['three', 'react', 'vitest'].map(missing).concat(jsx).join('\n');
const manifest = JSON.stringify({ dependencies: { react: '^19.0.0' }, scripts: { dev: 'vite' } });
const graph = (files = ['src/game/GameCanvas.tsx', 'index.html', 'game.js']): ProjectGraph => ({ files, symbols: [], components: ['GameCanvas'], routes: [], imports: {}, dependencies: ['react', 'three'] });

describe('BR1958 F1: acknowledged workspace writes are availability, never app-run proof', () => {
  it.each(['writeFile', 'writeBinaryFile'] as const)('actual build-local %s acknowledgment replaces a stale unavailable flag without a command log', async method => {
    const budget = createSandboxAdmissionBudget();
    const raw = { [method]: vi.fn(async () => {}) } as unknown as IEngineerActuator;
    const actuator = sandboxAdmissionActuator(raw, 'this-build', budget);
    expect(sandboxWasUnavailable(true, { workspaceWriteAcknowledged: budget.workspaceWriteAcknowledged })).toBe(true);
    await actuator[method]('this-build', 'index.html', 'real acknowledged bytes');
    expect(budget.workspaceWriteAcknowledged).toBe(true);
    expect(sandboxWasUnavailable(true, { workspaceWriteAcknowledged: budget.workspaceWriteAcknowledged })).toBe(false);
  });
  it('a rejected write, another workspace, durable metadata, or tool success prose cannot establish the write fact', async () => {
    const b = createSandboxAdmissionBudget();
    const raw = { writeFile: vi.fn(async (_w: string, p: string) => { if (p === 'refused') throw Error('Stop/write refused'); }), readFile: vi.fn(async () => 'cached metadata') } as unknown as IEngineerActuator;
    const a = sandboxAdmissionActuator(raw, 'ours', b);
    await expect(a.writeFile('ours', 'refused', 'x')).rejects.toThrow('refused');
    await a.writeFile('theirs', 'index.html', 'x'); await a.readFile('ours', 'metadata');
    expect(b.workspaceWriteAcknowledged).toBe(false);
    await b.dispatch({ id: 'x', name: 'write_file', input: {} }, async () => ({ tool_use_id: 'x', content: 'Created index.html' }));
    expect(b.workspaceWriteAcknowledged).toBe(false);
  });
  it('the route reads the authoritative write fact even when diagnostics fail, without making app-render proof', () => {
    expect(route()).toContain('workspaceWriteAcknowledged: sandboxAdmissionBudget.workspaceWriteAcknowledged');
    expect(route()).toContain('workspace file writes were acknowledged');
    expect(sandboxWasUnavailable(true, { commands: [{ exitCode: -1 }, { exitCode: null }] })).toBe(true);
  });
});

describe('BR1958 F2: no React game seed in a manifest-less recovered workspace', () => {
  function fixture(first: string | null, after = manifest, stopped = false) {
    let current = first; const state = { stopped };
    const io = { stopped: () => state.stopped, readManifest: vi.fn(async () => { if (current === null) throw Error('ENOENT'); return current; }),
      recoverStarter: vi.fn(async () => { current = after; }), takeScaffold: vi.fn(() => ({ 'package.json': after })) };
    return { io, state };
  }
  it('missing manifest invokes the existing ownership-checked starter completion once before recipes and returns only its acknowledged scaffold', async () => {
    const { io } = fixture(null); expect(await prepareGameSeedWorkspace(io)).toMatchObject({ ready: true, scaffold: { 'package.json': manifest } }); expect(io.recoverStarter).toHaveBeenCalledTimes(1);
  });
  it('existing valid manifest is untouched; there is no extra setup', async () => {
    const { io } = fixture(manifest); expect(await prepareGameSeedWorkspace(io)).toMatchObject({ ready: true, scaffold: {} }); expect(io.recoverStarter).not.toHaveBeenCalled();
  });
  it.each(['{bad', 'null', '[]', '{}', '{"dependencies":{"react":3}}'])('malformed/non-React owned manifest remains untouched: %s', async text => {
    const { io } = fixture(text); expect((await prepareGameSeedWorkspace(io)).ready).toBe(false); expect(io.recoverStarter).not.toHaveBeenCalled();
  });
  it('a failed recovery remains blocked, without a second probe or synthetic manifest', async () => {
    const { io } = fixture(null); io.recoverStarter.mockRejectedValue(Error('capacity'));
    expect(await prepareGameSeedWorkspace(io)).toMatchObject({ ready: false, scaffold: {} }); expect(io.recoverStarter).toHaveBeenCalledTimes(1);
  });
  it('Stop before or during read starts no setup; Stop during setup retains acknowledged bytes but starts no recipes', async () => {
    const first = fixture(null, manifest, true); expect((await prepareGameSeedWorkspace(first.io)).ready).toBe(false); expect(first.io.readManifest).not.toHaveBeenCalled();
    const second = fixture(null); second.io.readManifest.mockImplementation(async () => { second.state.stopped = true; throw Error('missing'); });
    expect((await prepareGameSeedWorkspace(second.io)).ready).toBe(false); expect(second.io.recoverStarter).not.toHaveBeenCalled();
    const third = fixture(null); third.io.recoverStarter.mockImplementation(async () => { third.state.stopped = true; });
    expect(await prepareGameSeedWorkspace(third.io)).toMatchObject({ ready: false, scaffold: { 'package.json': manifest } });
  });
  it('production preflight stays inside source preservation and before the first recipe; missing manifest cannot produce a seed-success claim', () => {
    const s = route(); const at = s.indexOf('const prerequisite = await prepareGameSeedWorkspace');
    expect(at).toBeGreaterThan(s.indexOf('if (!nobodysWorkHere)', s.indexOf('const kitPlan:')));
    expect(s.indexOf('if (!prerequisite.ready) throw new Error(prerequisite.reason);', at)).toBeLessThan(s.indexOf('for (const recipe of kitPlan)', at));
    expect(s.slice(at, at + 650)).toContain('preseededGolden.set(path, content)');
  });
});

describe('BR1958 F3: the active game milestone and available capabilities own preparation', () => {
  const original = 'Gta 5 full copy game banao';
  const milestone = 'Create a basic HTML5 canvas-based game with a static grid-map background representing streets. Add keyboard-controlled player vehicle movement.';
  it('the exact retained roadmap-shaped first slice no longer receives a full-goal 3D shell', () => {
    expect(gameKitPlan(original)).toContain('generate_game_3d');
    const current = gameTurnRequest(original, milestone);
    expect(gameKitPlan(current)).not.toContain('generate_game_3d'); expect(gameKitPlan(current)).toContain('generate_game_runtime');
    expect(current).not.toContain('Gta 5 full copy');
  });
  it('no milestone is byte-identical, user constraints survive, and a 3D milestone remains 3D', () => {
    expect(gameTurnRequest(original)).toBe(original);
    expect(gameTurnRequest('Game banao. Must use keyboard and touch.', milestone)).toContain('Must use keyboard and touch.');
    expect(gameKitPlan(gameTurnRequest(original, 'Create a 3D driving game with a working vehicle'))).toContain('generate_game_3d');
    expect(gameKitPlan(gameTurnRequest('Build a 3D open world game', 'Build the first game scene'))).toContain('generate_game_3d');
    expect(gameKitPlan(gameTurnRequest('Build a car game for Nokia c 2-01', 'Create a driving game'))).not.toContain('generate_game_3d');
  });
  it('planner is told capability is available, not falsely unavailable or already seeded; static/non-games get no React claim', () => {
    expect(gamePlannerCapability(original, 'vite-react')).toContain('a three.js renderer and camera'); // failedbr #2481: the planner hears the whole kit
    expect(gamePlannerCapability(original, 'vite-react')).not.toContain('already');
    expect(gamePlannerCapability(original, 'static')).toBe(''); expect(gamePlannerCapability('Build a todo app', 'vite-react')).toBe('');
  });
  it('all dimension/kit/contract readers use the same effective brief and retain old Stop/module/import fences', () => {
    const s = route(); expect(s).toContain('gameKitPlan(gameTurnRequest(prompt, milestoneRequest), framework)');
    expect(s).toContain('gameTurnHandoff(gameTurnRequest(prompt, milestoneRequest), {');
    expect(s).toContain('wantsSceneDetail(gameTurnRequest(prompt, megaRoadmapActive?.steps[0]?.buildPrompt))');
    expect(s).toContain('${gamePlannerCapability(prompt, framework)}');
    expect(gameTurnHandoff(original, {}, { writingRun: true, moduleTurn: false, importTurn: false, stopped: true }).block).toBe('');
  });
});

describe('BR1958 F4: missing packages never authorize placeholder component repair', () => {
  it.each(['three', 'react', 'react/jsx-runtime', 'vitest', 'vite'])('recognizes exact missing known-package diagnostics: %s', name => expect(compilerNeedsPackageSetup(missing(name))).toBe(true));
  it.each(['./local', '@/types', '~/store', '#alias', 'src/store', 'unknown-package'])('does not assume local/alias/unknown dependency failure is package setup: %s', name => expect(compilerNeedsPackageSetup(missing(name))).toBe(false));
  it.each(['', 'tsc help', "src/x.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.", reportErrors + '\nsrc/x.ts(1,1): error TS2322: Wrong source type'])('empty/unknown/mixed source errors keep the ordinary repair owner: %s', text => expect(compilerNeedsPackageSetup(text)).toBe(false));
  it('actual Endgame orchestration buys no model repair and writes no replacement for the complete retained package-only signature', async () => {
    const write = vi.fn(async () => {}), llmRepair = vi.fn(async () => [{ path: 'src/game/GameCanvas.tsx', content: '// Placeholder implementation to fix immediate compiler errors' }]);
    const result = await runEndgameRepair({ runTsc: async () => reportErrors, readFiles: async () => ({ 'src/game/GameCanvas.tsx': 'export function GameCanvas(){ return <canvas/>; }' }), writeFile: write, llmRepair });
    expect(llmRepair).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(result.clean).toBe(false); expect(result.errorsBefore).toBe(4);
  });
  it('actual fast-lane orchestration does not enter an escalating component-rewrite loop for packages', async () => {
    const repair = vi.fn(async () => []);
    const result = await runSimpleBuild({ prompt: 'game', framework: 'vite-react', scaffoldPaths: [], shareContract: false, depOrder: false,
      generate: async (_s, user) => user.includes('Plan the file list') ? 'src/App.tsx :: entry\nsrc/Game.tsx :: game'
        : `<<<FILE ${user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)?.[1]?.trim() ?? 'src/App.tsx'}>>>\nexport default function Game(){ return <canvas/>; }\n<<<ENDFILE>>>`,
      writeFiles: async () => {}, verify: async () => ({ ok: false, errors: reportErrors, ran: true }), repair });
    expect(result.ok).toBe(false); expect(repair).not.toHaveBeenCalled();
  });
  it('ordinary genuine source errors still receive a model repair and verification', async () => {
    let n = 0; const repair = vi.fn(async () => [{ path: 'src/x.ts', content: 'export const speed: number = 1;' }]);
    const r = await runEndgameRepair({ runTsc: async () => n++ ? '' : "src/x.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.", readFiles: async () => ({ 'src/x.ts': "export const speed: number = 'wrong';" }), writeFile: async () => {}, llmRepair: repair });
    expect(repair).toHaveBeenCalledTimes(1); expect(r.clean).toBe(true);
  });
  it('the normal agentic compiler door blocks both canonical source restoration and paid rewrite on setup-only errors', () => {
    const s = route(); expect(s).toContain("!compilerNeedsPackageSetup(check.errors) && process.env.AGENTV3_SCAFFOLD_RESTORE");
    expect(s).toContain('if (!check.ok && compilerNeedsPackageSetup(check.errors))');
    expect(s.indexOf('if (!check.ok && compilerNeedsPackageSetup(check.errors))')).toBeLessThan(s.indexOf('const t = await recordedRepairCall(repairSystemPrompt(framework)'));
  });
});

describe('BR1958 F5/F6: typed declarations and platform seed ownership are not user component defects', () => {
  it('actual symbol extraction includes Props but orphan detection counts only the runtime candidate', () => {
    const file = 'src/game/GameCanvas.tsx';
    const facts = extractFacts(file, 'export interface GameCanvasProps {}\nexport type GameMode = string;\nexport enum Theme {Dark}\nexport function GameCanvas(){return <canvas/>;}');
    expect(facts.symbols.map(s => s.name)).toContain('GameCanvasProps');
    expect(findOrphanComponents({ ...graph([file]), symbols: facts.symbols })).toEqual([file + ' (GameCanvas)']);
  });
  it('imported runtime components are still not orphans', () => {
    const file = 'src/game/GameCanvas.tsx'; const facts = extractFacts(file, 'export function GameCanvas(){return <canvas/>;}');
    expect(findOrphanComponents({ ...graph(['src/App.tsx', file]), symbols: facts.symbols, imports: { 'src/App.tsx': ['./game/GameCanvas'] } })).toEqual([]);
  });
  it('the readiness owner samples the shared exact kit map, separates platform preparation, and keeps true old-user observations', () => {
    expect(route()).toContain('dispatcher.setPlatformSeedFiles(() => kitSeededFiles.keys())');
    const s = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(s).toContain('splitSeedOrphans(split.preExisting.filter((o) => !orphanedHere.includes(o)), this.platformSeedFiles?.() ?? [])');
    expect(s).toContain('seedOrphanObservation(seedOwnership.platform.map((o) => o.label))');
    expect(s).toContain('preExistingCodeObservation(');
  });
});

describe('BR1958 F7/F8/F9: generated files and source inventory are not a runnable completed app', () => {
  it('real project summary uses no unverified npm command or active-stack claim without manifest/run proof', () => {
    const s = summarizeProject(graph(), 'Gta 5 full copy game banao', { changedFiles: 3, packageJson: null, previewLive: false, runProven: false });
    expect(s).toContain('Source files prepared — runtime is not verified'); expect(s).toContain('Detected source: React'); expect(s).not.toContain('Stack: React');
    expect(s).not.toContain('npm install && npm run dev'); expect(isProjectSummaryNarration(s)).toBe(true);
  });
  it.each(['{}', '{bad', '{"scripts":{"start":"node app.js"}}'])('does not invent a dev script from %s', pkg => expect(summarizeProject(graph(), '', { packageJson: pkg })).not.toContain('npm install && npm run dev'));
  it('a manifest-proven dev script and independently run app retain the useful run hint', () => {
    expect(summarizeProject(graph(), '', { packageJson: manifest, previewLive: true, runProven: true })).toContain('Run: npm install && npm run dev.');
  });
  it('both heartbeat and immediate final-check paths can say source prepared, never completed just from file count', () => {
    const s = finalChecksEtaLine(120000, etaAppExists(2, false)); expect(s).toContain('source files prepared'); expect(s).not.toContain('your app is built');
    expect(finalChecksEtaLine(120000, etaAppExists(0, false))).not.toContain('source files prepared');
    expect(finalChecksEtaLine(120000, etaAppExists(2, true))).not.toContain('source files prepared');
  });
  const eligible = { ok: true, headroom: true, allowed: true, deferred: false, runProven: true, stopped: false };
  it.each(['ok', 'headroom', 'allowed', 'runProven'] as const)('no hunt offer or paid review without %s', async key => {
    const ask = vi.fn(); const result = await offerBugHunt({ eligible: completedAppReviewEligible({ ...eligible, [key]: false }), hasUser: true,
      newCallId: () => 'x', ask, wait: async () => 'approved', say: () => {}, record: () => {}, env: {} });
    expect(ask).not.toHaveBeenCalled(); expect(result.runReview).toBe(false);
  });
  it.each(['stopped', 'deferred'] as const)('Stop/module ownership still wins: %s', key => expect(completedAppReviewEligible({ ...eligible, [key]: true })).toBe(false));
  it('a genuinely eligible explicit yes still runs, a decline does not, and both route doors use the same eligibility owner', async () => {
    const ask = vi.fn(); const r = await offerBugHunt({ eligible: completedAppReviewEligible(eligible), hasUser: true, newCallId: () => 'x', ask, wait: async () => 'approved', say: () => {}, record: () => {}, env: {} });
    expect(ask).toHaveBeenCalledTimes(1); expect(r.runReview).toBe(true);
    expect(route().match(/completedAppReviewEligible\(\{/g)).toHaveLength(2);
    expect(route()).toContain('runProven: runProof().proven, stopped: abort.signal.aborted');
    expect(route()).toContain('packageJson: await readSummaryManifest(');
  });
});

describe('BR1958 review safeguards: explicit dimensions, actual script reads and independent seed ownership', () => {
  it.each([['Build a 3D game', 'Build a 2D game with a working city map'], ['Build a 2D game', 'Build a 3D game with vehicle controls']])('a known contradictory planner dimension never overrides user constraint: %s', (request, brief) => {
    const parsed = { achievableSummary: 'Game', note: null, steps: [1,2,3].map(n => ({ title: 'Step '+n, goal: 'Real playable goal', buildPrompt: brief, needsInfra: null })) };
    expect(roadmapGuardrail(parsed, null, { framework: 'vite-react', originalRequest: request }).roadmap).toBeNull();
  });
  it('GTA/driving without an explicit dimension may legitimately choose a 2D milestone', () => {
    const p = { achievableSummary: 'Game', note: null, steps: [1,2,3].map(n => ({ title: 'Step '+n, goal: 'Real playable goal', buildPrompt: 'Build a 2D game with a working city map', needsInfra: null })) };
    expect(roadmapGuardrail(p, null, { framework: 'vite-react', originalRequest: 'Gta 5 full copy game banao' }).roadmap).not.toBeNull();
  });
  it('ownership follows exact normalized acknowledgments, not src/game naming, and keeps pre-existing/user findings visible', () => {
    const a = { file: './src/game/GameCanvas.tsx', label: 'GameCanvas' }, b = { file: 'src/game/UserGame.tsx', label: 'UserGame' };
    const split = splitSeedOrphans([a,b], ['src/game/GameCanvas.tsx']);
    expect(split.platform).toEqual([a]); expect(split.preExisting).toEqual([b]);
    expect(seedOrphanObservation(split.platform.map(x => x.label))).toContain("not the user's existing code");
    expect(splitSeedOrphans([a,b], []).preExisting).toEqual([a,b]);
  });
  it('the current manifest owner refuses Stop and failed reads, not an old stored manifest', async () => {
    const read = vi.fn(async () => manifest); expect(await readSummaryManifest({ stopped: () => true, read })).toBeNull(); expect(read).not.toHaveBeenCalled();
    expect(await readSummaryManifest({ stopped: () => false, read })).toBe(manifest); read.mockRejectedValue(Error('unavailable'));
    expect(await readSummaryManifest({ stopped: () => false, read })).toBeNull();
  });
  it('post-repair compiler success requires the verified bit, not fail-open ok alone', () => {
    expect(route()).toContain('if (compilerRepairProven(check))');
    expect(compilerRepairProven({ ok: true, verified: false })).toBe(false);
    expect(compilerRepairProven({ ok: false, verified: true })).toBe(false);
    expect(compilerRepairProven({ ok: true, verified: true })).toBe(true);
    expect(route()).toContain('Type errors were not verified as resolved after the agentic build and one repair pass.');
  });
});

describe('BR1958 F11: an admission call outside the timer is not a zero-duration call', () => {
  it('actual BR1958-shaped backfill preserves measured 2751ms and refuses the impossible split', () => {
    let t = 1000; const d = new BuildDiagnostics({ now: () => t }); t += 4;
    d.recordLlmCall({ model: 'fixture', promptPreview: 'Build scope admission classification', latencyMs: 2751, ok: true });
    const report = d.report(); const note = report.issues.find(x => x.code === 'TIME_TO_FIRST_CALL')!.message;
    // Q-2746: the old wording ("longer than the 0s build timing window") was true but unreadable. Same intent, plain words.
    expect(note).toContain('2.8s model call'); expect(note).toContain("started before this build's timer");
    expect(note).not.toContain('first call itself then took 0s'); expect(note).not.toContain('0s of preparation');
    expect(report.llmCalls?.[0].latencyMs).toBe(2751);
  });
  it('a compatible real timing window retains the normal measured split', () => {
    let t = 1000; const d = new BuildDiagnostics({ now: () => t }); t += 8000;
    d.recordLlmCall({ model: 'fixture', latencyMs: 2000, ok: true });
    expect(d.report().issues.find(x => x.code === 'TIME_TO_FIRST_CALL')!.message).toContain('6s of preparation');
    expect(d.report().issues.find(x => x.code === 'TIME_TO_FIRST_CALL')!.message).toContain('then took 2s');
  });
});

describe('BR1958 review: a known package name does not bless an invented public subpath', () => {
  it.each(['react/missing', 'three/not-a-real-api', 'vitest/imaginary', 'react/jsx-runtime-typo'])('keeps normal source repair for %s', name => {
    expect(compilerNeedsPackageSetup(`src/App.tsx(1,1): error TS2307: Cannot find module '${name}' or its corresponding type declarations.`)).toBe(false);
  });
});

describe('BR1958 F12: structural readiness92 is not runtime proof', () => {
  it.each([0, 2000])('retains same-origin overrun measurement without declaring the app built (%sms)', extra => {
    const note = readyOverrunNote({ step: 3, score: 92, elapsedMs: 1000, at: 10000 }, 3, 1000 + extra, { endAt: 10000 + extra });
    expect(note).toContain('Structural readiness'); expect(note).toContain('not proof the app ran');
    expect(note).toContain('(92/100)'); expect(note).not.toContain('The app was judged finished');
    expect(note).toContain(extra ? 'over 2s' : 'build ended there');
  });
});
