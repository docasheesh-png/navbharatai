// A GAME IS NOT "DONE" BEFORE IT HAS WHAT ITS CONTRACT NAMES (Q-2339 — autopsy 61279465, 2026-11-04).
//
// READY_BEFORE_END: "The app was judged finished at step 20 (100/100); the build then ran 19 more step(s) over 229s".
// Those 19 steps were the train's driving mechanics and three type fixes — real work. The JUDGEMENT was early:
// the score measures the PROJECT, and a seeded game kit is a healthy project. The fourth return of the class
// `editingExistingApp` (2b1f845e) and `projectModule` (50378049) named. The game contract now says what the
// REQUEST needs (throttle, braking for a simulator), and both done readers ask it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { endOfTurnReadyMark } from '../src/server/AgentV3/doneSignal';
import { buildGameContract, scopeMatch } from '../src/server/AgentV3/gameIntent';

const PROMPT = 'Create a 3D train simulator with a realistic train, railway tracks, trees, buildings and mountains. Use compatible free external 3D assets, not primitive placeholders. Make the game playable with mobile controls.';
const READY = { ready: true, score: 100, blockers: [], warnings: [] } as never;

describe('the end-of-turn ready mark', () => {
  const base = { existing: null, readiness: READY, typeErrors: 0, editingExistingApp: false, wroteThisRun: true, step: 20, elapsedMs: 1000 };
  it('THE REPORTED STATE: a train that cannot yet brake or accelerate is not marked finished', () => {
    const gaps = scopeMatch(buildGameContract(PROMPT), { 'src/game/train/TrainSimulator.tsx': 'scene.add(createTrain());' }).missing;
    expect(gaps).toEqual(['throttle', 'braking']);
    expect(endOfTurnReadyMark({ ...base, requestGaps: gaps })).toBeNull();
  });
  it('once it drives, the mark is recorded as before', () => {
    const gaps = scopeMatch(buildGameContract(PROMPT), { 'src/game/train/TrainSimulator.tsx': 'state = driveVehicle(train, state, axis, dt);' }).missing;
    expect(gaps).toEqual([]);
    expect(endOfTurnReadyMark({ ...base, requestGaps: gaps })).not.toBeNull();
  });
});

describe('🔒 wiring: both done readers in the runner ask the request, and the route hands the contract over', () => {
  const runner = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('the in-loop signal and the end-of-turn mark', () => {
    expect(runner).toMatch(/appIsDone\(readiness\) && !\(typeErrors !== null && typeErrors > 0\) && requestGaps\.length === 0/);
    expect(runner).toMatch(/requestGaps: \(\(\) => \{ try \{ return this\.opts\.requestGaps\?\.\(\) \?\? \[\]; \}/);
  });
  it('the route: a getter over the contract the kit seed reads, and the files as they are now', () => {
    expect(route).toContain('requestContractRef.contract = gameContract;');
    expect(route).toMatch(/requestGaps: \(\) => \{\n\s*const c = requestContractRef\.contract;/);
  });
});
