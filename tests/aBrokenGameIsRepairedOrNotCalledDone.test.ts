/**
 * Game Engine Ultra Phase 3 (2026-10-30): a game the playtest proved broken gets one verified repair (kept only
 * if strictly better when played again, else undone; platform pays), and with the gate on it is never reported
 * shippable while still unplayable or missing a named feature. Both switches default ON and have an explicit
 * `=off` escape hatch.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HARD_DEFECTS, gameAutoRepairEnabled, gameCompleteGateEnabled, runGameRepair, repairImproved, gameRepairRecord,
  gameIncompleteReason, gameRepairPrompt, type GameRepairIO,
} from '../src/server/AgentV3/gameRepair';
import type { GameDefect } from '../src/server/AgentV3/gamePlaytest';
import { releaseGate } from '../src/server/AgentV3/releaseGate';

const D = (code: GameDefect['code']): GameDefect => ({ code, evidence: 'measured' });
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const snap = { 'src/App.tsx': 'x' };

function io(over: Partial<GameRepairIO> = {}): GameRepairIO {
  return {
    repair: vi.fn(async () => true),
    replay: vi.fn(async () => ({ defects: [], scopeMissing: [], proof: { outcome: 'passed' as const, score: 100 } })),
    changedSince: vi.fn(async () => 1),
    revert: vi.fn(async () => undefined),
    ...over,
  };
}
const run = (i: GameRepairIO, defects = [D('GAME_DEFECT_INPUT_IGNORED')], missing: string[] = []) =>
  runGameRepair(defects, missing, 'racing game with score', { repairMs: 60_000, snapshot: snap, buildSignal: new AbortController().signal, io: i });

describe('safe game repair defaults', () => {
  it('repair and gate are on by default and can each be explicitly disabled', () => {
    expect(gameAutoRepairEnabled(env({}))).toBe(true);
    expect(gameCompleteGateEnabled(env({}))).toBe(true);
    expect(gameAutoRepairEnabled(env({ AGENTV3_GAME_AUTO_REPAIR: 'on' }))).toBe(true);
    expect(gameCompleteGateEnabled(env({ AGENTV3_GAME_COMPLETE_GATE: 'on' }))).toBe(true);
    expect(gameAutoRepairEnabled(env({ AGENTV3_GAME_AUTO_REPAIR: 'off' }))).toBe(false);
    expect(gameCompleteGateEnabled(env({ AGENTV3_GAME_COMPLETE_GATE: 'off' }))).toBe(false);
  });
});

describe('the repair is kept only when the game, played again, is better', () => {
  it('kept when the defect is gone', async () => {
    const i = io();
    const o = await run(i);
    expect(o.kept).toBe(true);
    expect(i.revert).not.toHaveBeenCalled();
    expect(gameRepairRecord(o).code).toBe('GAME_REPAIRED');
  });
  it('undone when nothing improved', async () => {
    const i = io({ replay: vi.fn(async () => ({ defects: [D('GAME_DEFECT_INPUT_IGNORED')], scopeMissing: [], proof: { outcome: 'passed' as const, score: 100 } })) });
    const o = await run(i);
    expect(o.kept).toBe(false);
    expect(i.revert).toHaveBeenCalledWith(snap);
    expect(gameRepairRecord(o).code).toBe('GAME_REPAIR_UNREPAIRED');
  });
  it('undone when something new broke', async () => {
    const i = io({ replay: vi.fn(async () => ({ defects: [D('GAME_DEFECT_RUNTIME_ERROR')], scopeMissing: [], proof: { outcome: 'passed' as const, score: 100 } })) });
    expect((await run(i)).kept).toBe(false);
    expect(i.revert).toHaveBeenCalled();
  });
  it('undone when the runner did not finish', async () => {
    const i = io({ repair: vi.fn(async () => false) });
    expect((await run(i)).kept).toBe(false);
    expect(i.replay).not.toHaveBeenCalled();
    expect(i.revert).toHaveBeenCalled();
  });
  it('scope gap: kept when the named feature now exists', async () => {
    const o = await run(io(), [], ['levels']);
    expect(o.kept).toBe(true);
  });
  it('skipped with nothing to fix, no time, or no snapshot', async () => {
    expect((await run(io(), [], [])).attempted).toBe(false);
    const o = await runGameRepair([D('GAME_DEFECT_BLANK')], [], 'p', { repairMs: 0, snapshot: snap, buildSignal: new AbortController().signal, io: io() });
    expect(gameRepairRecord(o).code).toBe('GAME_REPAIR_SKIPPED');
  });
  it('repairImproved is strict', () => {
    expect(repairImproved([D('GAME_DEFECT_NO_TOUCH')], [D('GAME_DEFECT_NO_TOUCH')], [], [])).toBe(false);
    expect(repairImproved([D('GAME_DEFECT_BLANK'), D('GAME_DEFECT_NO_TOUCH')], [D('GAME_DEFECT_NO_TOUCH')], [], [])).toBe(true);
  });
  it('the prompt names each measured defect and the missing features', () => {
    const p = gameRepairPrompt('x', [D('GAME_DEFECT_START_STUCK')], ['timer']);
    expect(p).toContain('GAME_DEFECT_START_STUCK');
    expect(p).toContain('timer');
  });
});

describe('incomplete delivery gate', () => {
  it('all measured playability defects and named missing features block completion', () => {
    const measuredDefects: GameDefect['code'][] = [
      'GAME_DEFECT_START_STUCK', 'GAME_DEFECT_BLANK', 'GAME_DEFECT_INPUT_IGNORED', 'GAME_DEFECT_NO_TOUCH',
      'GAME_DEFECT_RUNTIME_ERROR', 'GAME_DEFECT_CAMERA_WRONG', 'GAME_DEFECT_VEHICLE_STALLED', 'GAME_DEFECT_MISSING_LAYER',
    ];
    expect(new Set(measuredDefects)).toEqual(HARD_DEFECTS);
    for (const defect of measuredDefects) expect(gameIncompleteReason([D(defect)], [])).not.toBeNull();
    expect(gameIncompleteReason([], ['levels'])).toContain('levels');
  });
  it('makes the release gate RED, and leaves it alone when unset', () => {
    const ev = { buildOk: true, preview: 'passed', pages: 'passed', journeys: 'passed', typecheck: 'passed', tests: 'passed' } as const;
    const f = { blockers: 0, highSeverity: 0, warnings: 0 };
    expect(releaseGate({ ...ev }, f).state).not.toBe('red');
    const g = releaseGate({ ...ev, gameIncomplete: 'the game was played and is not playable (blank)' }, f);
    expect(g.state).toBe('red');
    expect(g.headline).toContain('the game is not complete');
  });
});

describe('route wiring (source guard)', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const at = route.indexOf('GAME ENGINE ULTRA PHASE 3');
  const block = route.slice(at, at + 5000);
  it('both switches gate the block, the platform absorbs the repair, the gate never flips ok', () => {
    expect(block).toContain('gameAutoRepairEnabled()');
    expect(block).toContain('gameCompleteGateEnabled()');
    expect(block).toContain('barrenPhases.add(PHASE_GAME_REPAIR)');
    expect(block).toContain("runInPass(GAME_REPAIR_PASS");
    expect(block).not.toMatch(/result\s*=\s*\{[^}]*ok:\s*false/);
  });
});
