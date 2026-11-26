// THE TURN AFTER SURPLUS SAYS WHERE IT WENT AND HOW LONG IT LOST (failedbr #2525, Q-3465 + Q-3467, 2026-11-26).
//
// Q-3467: SURPLUS_FALLBACK said the turn continued "on the Weak ladder"; it continued on ENGINE_R1(deepseek-v4.1-flash),
// an engine the chain puts in front of the ladder TIER_LADDER printed. The line now names the engine that runs next.
// Q-3465: that answered call recorded latencyMs 83888, answerMs 4378, fallbackMs 0 — ~79 s of Surplus refusals counted as
// no fallback time. Class: a wrapper that retries a turn elsewhere (or again) drops the seconds before the answer. Every
// such wrapper now goes through `addFallbackMs`, and a census fails when a new retrying wrapper skips it.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/AI/SurplusRegistry/surplusAdmitCircuit', () => ({
  recordSurplusMidBuildDeath: vi.fn(),
  recordSurplusAdmitProbeSuccess: vi.fn(),
}));

import { PublicBuildEngineError } from '../src/server/lib/buildEngineError';
import { surplusFallbackMessage, wrapSurplusRunnerPreWriteFailOpen } from '../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen';
import { recordSurplusAdmissionDiag } from '../src/server/AI/SurplusRegistry/surplusChatAdmission';
import { addFallbackMs } from '../src/server/AgentV3/fallbackTime';
import type { RunTurnParams, TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

const answered = (): TurnResult => ({
  text: 'ok', rawContent: [], toolUses: [], stopReason: 'end_turn', model: 'deepseek-v4.1-flash',
  usage: { inputTokens: 1, outputTokens: 1 }, attemptMs: 4378, fallbackMs: 0,
});
const params = (): RunTurnParams => ({ model: 'm', system: 's', messages: [], tools: [], maxTokens: 64 });

describe('Q-3467: the fall-back line names the engine that runs next', () => {
  it('failedbr #2525: after writes, Surplus refuses → the line names deepseek-v4.1-flash, not "the Weak ladder"', async () => {
    const onFailOpen = vi.fn();
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(
      { runTurn: async () => { throw new PublicBuildEngineError(); } } as TurnRunner,
      () => ({ plannedModel: 'deepseek-v4.1-flash', runTurn: async () => answered() } as TurnRunner),
      { state: { dropped: false }, userFilesWritten: () => 2, onFailOpen },
    );
    await wrapped.runTurn(params());
    expect(onFailOpen).toHaveBeenCalledOnce();
    const [reason, , next] = onFailOpen.mock.calls[0];
    expect(reason).toBe('mid_build_after_write');
    expect(next).toBe('deepseek-v4.1-flash');
    const line = surplusFallbackMessage(reason, next);
    expect(line).toContain('continuing the same turn on deepseek-v4.1-flash');
    expect(line).not.toContain('Weak ladder');
  });

  it('with no engine known, the line names the chain, never a ladder', () => {
    expect(surplusFallbackMessage('mid_build_engine_unavailable')).toContain('the Weak chain without Surplus');
    expect(surplusFallbackMessage('mid_build_engine_unavailable')).not.toContain('Weak ladder');
  });

  it('the admission fall-back line (sibling) names the chain too', () => {
    const rows: Array<{ message: string }> = [];
    recordSurplusAdmissionDiag({ record: (i) => rows.push(i) }, { code: 'SURPLUS_FALLBACK', reason: 'admit_circuit_open' } as never);
    expect(rows[0].message).not.toContain('Weak ladder');
    expect(rows[0].message).toContain('providerChain');
  });
});

describe('Q-3465: the seconds before the answer are fallback time', () => {
  it('failedbr #2525: Surplus fails after ~80 ms → the answered turn carries that time as fallbackMs', async () => {
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(
      { runTurn: async () => { await new Promise((r) => setTimeout(r, 80)); throw new PublicBuildEngineError(); } } as TurnRunner,
      () => ({ runTurn: async () => answered() } as TurnRunner),
      { state: { dropped: false }, userFilesWritten: () => 2 },
    );
    const r = await wrapped.runTurn(params());
    expect(r.fallbackMs).toBeGreaterThanOrEqual(70);
    expect(r.attemptMs).toBe(4378);
  });

  it('addFallbackMs adds to what the chain measured and never invents from a bad value', () => {
    expect(addFallbackMs({ fallbackMs: 1000 }, 2500).fallbackMs).toBe(3500);
    expect(addFallbackMs({}, 2500).fallbackMs).toBe(2500);
    const same = { fallbackMs: 7 };
    expect(addFallbackMs(same, Number.NaN)).toBe(same);
    expect(addFallbackMs(same, -5)).toBe(same);
  });

  // The census: every wrapper that retries a turn after a failure goes through addFallbackMs.
  const RETRYING_WRAPPERS = [
    'src/server/AI/SurplusRegistry/surplusPreWriteFailOpen.ts',
    'src/server/AI/SurplusRegistry/buildSession.ts',
    'src/server/AgentV3/proChainV2/agentRunner.ts',
    'src/server/routes/agentv3Resilient.ts',
  ];
  for (const file of RETRYING_WRAPPERS) {
    it(`${file} adds the lost seconds through addFallbackMs`, () => {
      expect(readFileSync(file, 'utf8')).toMatch(/addFallbackMs\(/);
    });
  }
});
