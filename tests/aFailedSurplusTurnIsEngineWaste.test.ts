// 🔴 A FAILED SURPLUS TURN'S SECONDS ARE THE ENGINE'S WASTE (failedbr #2408 b5042450, #2428 5192388e, 2026-11-17).
//
// Surplus held the fast lane's plan call for ~90 s and then failed (`invalid_completion`, status 404). The next rung found
// no time left; its "build budget exhausted before this call could start" became the call record's only error, and the
// report closed with PROVIDER_TIME_WASTED "no engine wasted any time this build". The user had watched 90 s of nothing.
// Reversion: drop the onSurplusAttemptWasted call from the wrapper and the first test fails.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wrapSurplusRunnerPreWriteFailOpen, type SurplusPreWriteFailOpenHooks } from '../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen';
import { PublicBuildEngineError } from '../src/server/lib/buildEngineError';

vi.mock('../src/server/AI/SurplusRegistry/surplusAdmitCircuit', () => ({ recordSurplusMidBuildDeath: vi.fn(), recordSurplusAdmitProbeSuccess: vi.fn() }));

const answer = { text: 'ok', rawContent: [], toolUses: [], stopReason: 'end_turn', model: 'm', usage: { inputTokens: 1, outputTokens: 1 } };
const hooks = (wasted: number[]): SurplusPreWriteFailOpenHooks => ({ state: { dropped: false }, userFilesWritten: () => 0, onSurplusAttemptWasted: (ms) => wasted.push(ms) });

describe('the wrapper reports how long a failed Surplus turn ran', () => {
  it('#2408: an engine failure after a long wait is counted', async () => {
    vi.useFakeTimers();
    const wasted: number[] = [];
    const surplus = { runTurn: () => new Promise<never>((_, reject) => setTimeout(() => reject(new PublicBuildEngineError()), 90_000)) };
    const runner = wrapSurplusRunnerPreWriteFailOpen(surplus as never, () => ({ runTurn: async () => answer }) as never, hooks(wasted));
    const p = runner.runTurn({ model: 'm', messages: [], tools: [], maxTokens: 10 } as never);
    await vi.advanceTimersByTimeAsync(90_000);
    await expect(p).resolves.toMatchObject({ text: 'ok' });
    expect(wasted).toEqual([90_000]);
    vi.useRealTimers();
  });
  it('a turn our own clock stopped (aborted signal) is not the engine\'s waste', async () => {
    const wasted: number[] = [];
    const ctl = new AbortController(); ctl.abort();
    const runner = wrapSurplusRunnerPreWriteFailOpen({ runTurn: async () => { throw new Error('aborted'); } } as never, () => ({ runTurn: async () => answer }) as never, hooks(wasted));
    await expect(runner.runTurn({ model: 'm', messages: [], tools: [], maxTokens: 10, signal: ctl.signal } as never)).rejects.toThrow();
    expect(wasted).toEqual([]);
  });
  it('a healthy turn records nothing', async () => {
    const wasted: number[] = [];
    const runner = wrapSurplusRunnerPreWriteFailOpen({ runTurn: async () => answer } as never, () => ({ runTurn: async () => answer }) as never, hooks(wasted));
    await runner.runTurn({ model: 'm', messages: [], tools: [], maxTokens: 10 } as never);
    expect(wasted).toEqual([]);
  });
  it('the route feeds it into the build\'s waste ledger', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/onSurplusAttemptWasted: \(ms\) => recordAttemptWasted\('SURPLUS', 'error', ms\)/);
  });
});
