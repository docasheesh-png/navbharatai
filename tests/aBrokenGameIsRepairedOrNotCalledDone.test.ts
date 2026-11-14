/** Automatic repair is suspended; measured completion checks remain active. */
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
  it('repair is unconditionally suspended while the existing gate default remains on', () => {
    expect(gameAutoRepairEnabled(env({}))).toBe(false);
    expect(gameCompleteGateEnabled(env({}))).toBe(true);
    expect(gameAutoRepairEnabled(env({ AGENTV3_GAME_AUTO_REPAIR: 'on' }))).toBe(false);
    expect(gameCompleteGateEnabled(env({ AGENTV3_GAME_COMPLETE_GATE: 'on' }))).toBe(true);
    expect(gameAutoRepairEnabled(env({ AGENTV3_GAME_AUTO_REPAIR: 'off' }))).toBe(false);
    expect(gameCompleteGateEnabled(env({ AGENTV3_GAME_COMPLETE_GATE: 'off' }))).toBe(false);
  });
});

describe('suspension cannot start automatic model or rollback work', () => {
  it.each(['success', 'failure', 'empty-proof', 'late', 'unchanged'])('never invokes %s callback scenarios', async scenario => {
    const i = io({ repair: vi.fn(async () => scenario === 'success') });
    const o = await run(i);
    expect(o).toMatchObject({ attempted: false, kept: false, proof: null, after: null });
    expect(o.reason).toContain('suspended');
    for (const callback of Object.values(i)) expect(callback).not.toHaveBeenCalled();
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
