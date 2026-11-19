import { describe, expect, it, vi } from 'vitest';
import * as ts from 'typescript';
import { readFileSync } from 'node:fs';
import { BR1955_PROMPT, BR1955_SUMMARY } from './fixtures/br1955';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { extractExportedDeclaration, kitTypeContract } from '../src/server/lib/kitTypeContract';
import { gameTurnHandoff } from '../src/server/AgentV3/gameKitSeed';
import { auditSummaryClaims, type MeasuredFacts } from '../src/server/AgentV3/claimAudit';
import { savedStateEvidence, noJourneyReason } from '../src/server/AgentV3/journeyDerivation';
import { gameAutoRepairEnabled, gameCompleteGateEnabled, runGameRepair, type GameRepairIO } from '../src/server/AgentV3/gameRepair';
import { judgeProdBuild } from '../src/server/AgentV3/prodBuildGate';
import { readinessVerdict } from '../src/server/AgentV3/Readiness';
import { doneSteer } from '../src/server/AgentV3/doneSignal';
import { nextTodoWithdrawal, toolsThisTurn } from '../src/server/AgentV3/todoOnlyTurn';

const pool = recipeFilePool();
const inputSource = pool.get('src/game/core/input.ts')!.content;
const sourceFiles = Object.fromEntries([...pool].map(([path, entry]) => [path, entry.content]));
const writer = { writingRun: true, moduleTurn: false, importTurn: false, stopped: false };
const facts: MeasuredFacts = { consoleCaptured: true, screenshotTaken: true, previewVerified: true, gamePlayed: 'failed' };
const exactSummary = "I've successfully built a top-down 3D driving game with all the requested features:";
const kind = (text: string, override: Partial<MeasuredFacts> = {}) => auditSummaryClaims(text, { ...facts, ...override }).map((c) => c.kind);
const defects = [{ code: 'GAME_DEFECT_INPUT_IGNORED' as const, evidence: 'controls 0 in retained BR1955 playtest' }];
const snap = { 'src/App.tsx': 'saved game' };
const repairIo = (overrides: Partial<GameRepairIO> = {}): GameRepairIO => ({
  repair: vi.fn(async () => true), changedSince: vi.fn(async () => 1), revert: vi.fn(async () => undefined),
  replay: vi.fn(async () => ({ defects: [], scopeMissing: [], proof: { outcome: 'passed' as const, score: 100 } })),
  ...overrides,
});
const repair = (io: GameRepairIO, buildSignal = new AbortController().signal) => runGameRepair(defects, [], 'driving game', { io, snapshot: snap, buildSignal, repairMs: 1000 });

describe('BR1955 F1: action vocabulary belongs to the real source API handoff', () => {
  it('hands over every actual default action/code pair, including the bounded real route handoff', () => {
    const declaration = extractExportedDeclaration(inputSource, 'DEFAULT_ACTIONS');
    // Each action also answers to a standard gamepad button (Pad:N) since 2026-11-19 — the handoff quotes them too.
    expect(declaration).toContain("up: ['KeyW', 'ArrowUp', 'Pad:12']");
    expect(declaration).toContain("jump: ['Space', 'Pad:0']");
    const block = gameTurnHandoff(BR1955_PROMPT, sourceFiles, writer, {}).block;
    expect(block.replace(/^  /gm, '')).toContain(declaration!);
    expect(block).toContain('isDown(action: string)');
    expect(block).not.toContain('key(action:');
  });
  it('quotes supplied remapping, never a hardcoded canonical list or an evaluated initializer', () => {
    const source = "export const DEFAULT_ACTIONS = { forward: ['KeyZ'], fire: ['Space'] };";
    expect(kitTypeContract({ 'src/game/core/input.ts': source })).toContain("forward: ['KeyZ']");
    expect(extractExportedDeclaration("export const DEFAULT_ACTIONS = dangerous();", 'DEFAULT_ACTIONS')).toBeNull();
    expect(extractExportedDeclaration("const DEFAULT_ACTIONS = { up: ['KeyW'] };", 'DEFAULT_ACTIONS')).toBeNull();
    expect(extractExportedDeclaration("export const DEFAULT_ACTIONS = { ...hidden };", 'DEFAULT_ACTIONS')).toBeNull();
    expect(extractExportedDeclaration("export const DEFAULT_ACTIONS = { custom: ['/*actual literal*/'] };", 'DEFAULT_ACTIONS')).toContain('/*actual literal*/');
  });
  it('executes the actual emitted Input: event codes and polled action names are different; custom maps remain valid', () => {
    const exports: Record<string, any> = {};
    new Function('exports', ts.transpileModule(inputSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports);
    const target = new EventTarget();
    const input = new exports.Input(target);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
    expect(input.isDown('up')).toBe(true);
    expect(input.isDown('KeyW')).toBe(false); // a valid string can compile yet ignore every key
    expect(input.axis()).toEqual({ x: 0, y: -1 });
    target.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW' }));
    expect(input.axis()).toEqual({ x: 0, y: 0 });
    input.dispose();
    const mapped = new exports.Input(target, { forward: ['KeyZ'] });
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyZ', repeat: false }));
    expect(mapped.isDown('forward')).toBe(true);
    mapped.setVirtualButton('forward', true);
    expect(mapped.isDown('forward')).toBe(true);
    mapped.dispose();
  });
});

describe('BR1955 F2: exact completion claims read final gameplay, not technical readiness', () => {
  it.each([BR1955_SUMMARY, exactSummary, '## Car Driving Game - Milestone 1 Complete ✅'])('catches the retained affirmative claim: %s', (summary) => {
    expect(kind(summary)).toContain('game-claimed-playable');
    expect(kind(summary, { gamePlayed: 'not-run' })).toContain('game-claimed-playable');
  });
  it.each([
    "I have not built a driving game with all the requested features.",
    'When the driving game milestone 1 complete screen appears, test it.',
    'The plan is to mark the driving game Milestone 1 Complete.',
    'Driving game: will be built with all requested features later.',
    'The driving game has a minimap and a car model; controls remain unverified.',
  ])('leaves qualified descriptions and future plans alone: %s', (summary) => expect(kind(summary)).not.toContain('game-claimed-playable'));
  it('does not invent negative game evidence, and does not change unrelated app claims', () => {
    expect(kind(exactSummary, { gamePlayed: 'passed' })).not.toContain('game-claimed-playable');
    expect(kind(exactSummary, { gamePlayed: undefined })).not.toContain('game-claimed-playable');
    expect(kind("I've built a dashboard with all requested features.")).not.toContain('game-claimed-playable');
  });
});

describe('BR1955 F3: gameplay methods are not persistence', () => {
  it('the real generated loop is not called a database write; the final journey sentence does not invent progress storage', () => {
    const project = { ...sourceFiles, 'src/App.tsx': 'export default function App(){ return <GameCanvas />; }' };
    expect(savedStateEvidence({ 'src/game/core/loop.ts': sourceFiles['src/game/core/loop.ts'] })).toBeNull();
    expect(noJourneyReason(project)).not.toContain('a database write in src/game/core/loop.ts');
  });
  it.each(['this.update(dt);', 'map.delete(key);', 'world.insert(car);', 'input.update();', "const sample = \"supabase.from('scores').update({ xp })\";", "// supabase.from('scores').insert({ xp })"])(
    'does not infer storage from arbitrary methods or noncode: %s', (src) => expect(savedStateEvidence({ 'src/game/custom.ts': src })).toBeNull());
  it.each(['insert', 'upsert', 'update', 'delete'])('retains actual relational %s call evidence, including an aliased client name', (method) => {
    expect(savedStateEvidence({ 'src/game/save.ts': `await client.from('scores').${method}({ xp });` })?.what).toBe('a database write');
  });
  it('retains compat document writes, genuine browser progress and preference exclusions', () => {
    expect(savedStateEvidence({ 'src/game/save.ts': "db.collection('scores').doc('me').set({ xp });" })?.what).toBe('a database write');
    expect(savedStateEvidence({ 'src/game/save.ts': "localStorage.setItem('progress', JSON.stringify({ xp }));" })?.what).toBe('browser storage');
    expect(savedStateEvidence({ 'src/lib/preference.ts': "localStorage.setItem('theme', mode);" })).toBeNull();
  });
});

describe('BR1955 F4: unsafe automatic repair is suspended without inventing gameplay proof', () => {
  it.each([null, { outcome: 'passed' as const, score: 100 }, { outcome: 'failed' as const, score: 57 }])('does not invoke replay or claim its hypothetical proof %j', async proof => {
    const io = repairIo({ replay: vi.fn(async () => ({ defects: [], scopeMissing: [], proof })) });
    const o = await repair(io);
    expect(o).toMatchObject({ attempted: false, kept: false, proof: null });
    for (const callback of Object.values(io)) expect(callback).not.toHaveBeenCalled();
  });
  it('an already stopped build never begins repair or rewrites the saved app', async () => {
    const stop = new AbortController(); stop.abort();
    const io = repairIo(); const o = await repair(io, stop.signal);
    expect(o.attempted).toBe(false);
    for (const callback of Object.values(io)) expect(callback).not.toHaveBeenCalled();
  });
  it('repair cannot be re-enabled by environment; measured completion gate stays unchanged', () => {
    for (const value of [undefined, 'on', 'true', '1', 'off']) expect(gameAutoRepairEnabled({ AGENTV3_GAME_AUTO_REPAIR: value })).toBe(false);
    expect(gameCompleteGateEnabled({})).toBe(true);
    expect(gameCompleteGateEnabled({ AGENTV3_GAME_COMPLETE_GATE: 'off' })).toBe(false);
  });
  it('the production route supplies real replay proof and binds kept proof to both final consumers', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const block = route.slice(route.indexOf('GAME ENGINE ULTRA PHASE 3'), route.indexOf('// 🔴 THE CARD IS EMITTED'));
    expect(block).toContain("proof: v.score && outcome !== 'not-run'");
    expect(block).toContain('gameProof = { ...outcome.proof }');
    expect(block).toContain('gateEvidence.game = gameProof.outcome');
    expect(block).not.toContain("gamePlayed.defects.length === 0) gateEvidence.game = 'passed'");
  });
});

describe('BR1955 F2: component receipts do not promise a playable release', () => {
  it('a clean production compilation claims compilation, not release approval', () => {
    const result = judgeProdBuild({ ran: true, exitCode: 0, output: 'built' });
    expect(result.code).toBe('PROD_BUILD_OK'); expect(result.ok).toBe(true);
    expect(result.message).toContain('compiled successfully');
    expect(result.message).not.toContain('ready to publish');
    expect(result.message).toContain('gameplay and release readiness are reported separately');
  });
  it('automatic generation hand-back also distinguishes code health from final gameplay', () => {
    const note = doneSteer({ ready: true, score: 100, blockers: [], warnings: [] } as never);
    expect(note).toContain('does not establish gameplay');
    expect(note).not.toContain('complete and healthy');
    const runner = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
    expect(runner).toContain("text: '✅ Source/build checks are clear — final runtime checks are next.'");
  });
  it('technical READY100 retains its score but cannot be mistaken for gameplay proof', () => {
    const result = readinessVerdict({ ready: true, score: 100, blockers: [], warnings: [], reasons: [] } as never);
    expect(result).toContain('READY — score 100/100');
    expect(result).toContain('does not establish gameplay');
  });
});

describe('BR1955 F5: ordinary work never reopens solo writer planning', () => {
  const tools = [{ name: 'update_todo' }, { name: 'read_file' }, { name: 'write_file' }];
  it('the retained solo-plan → work → solo-plan shape cannot be offered a second time', () => {
    const withdrawn = nextTodoWithdrawal('offered', { todoOnly: true, didOtherWork: false, plannedOnlyBefore: false }, {});
    expect(withdrawn).toBe('for-run');
    const afterWork = nextTodoWithdrawal(withdrawn, { todoOnly: false, didOtherWork: true, plannedOnlyBefore: true }, {});
    expect(toolsThisTurn(tools, afterWork).map((t) => t.name)).not.toContain('update_todo');
    expect(toolsThisTurn(tools, afterWork).map((t) => t.name)).toContain('write_file');
  });
  it('mixed work/plan turns, plan-only approval lanes and the existing off control remain valid', () => {
    expect(nextTodoWithdrawal('offered', { todoOnly: false, didOtherWork: true, plannedOnlyBefore: false }, {})).toBe('offered');
    expect(toolsThisTurn([{ name: 'update_todo' }], 'for-run')).toEqual([{ name: 'update_todo' }]);
    expect(nextTodoWithdrawal('for-run', { todoOnly: true, didOtherWork: false, plannedOnlyBefore: true }, { AGENTV3_TODO_WITHDRAW: 'off' })).toBe('offered');
  });
});
