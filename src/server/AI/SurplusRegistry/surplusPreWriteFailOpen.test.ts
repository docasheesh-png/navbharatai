import { describe, expect, it, vi } from 'vitest';
import { PublicBuildEngineError, PUBLIC_BUILD_ENGINE_UNAVAILABLE } from '../../lib/buildEngineError';
import { SurplusBuildTransportError } from './transport';
import {
  shouldFailOpenSurplusPreWrite,
  surplusPreWriteFailOpenReason,
  isSurplusPublicBuildEngineFailure,
  wrapSurplusRunnerPreWriteFailOpen,
  isSurplusPreWriteFailOpenReason,
  allSafeSurplusFailOpenReasons,
} from './surplusPreWriteFailOpen';
import type { TurnRunner } from '../../AgentV3/ClaudeClient';
import type { RunTurnParams, TurnResult } from '../../AgentV3/ClaudeClient';

const emptyTurn = (): TurnResult => ({
  text: 'ok',
  rawContent: [],
  toolUses: [],
  stopReason: 'end_turn',
  model: 'weak-model',
  usage: { inputTokens: 1, outputTokens: 1 },
});

const params = (): RunTurnParams => ({
  model: 'm',
  system: 's',
  messages: [],
  tools: [],
  maxTokens: 64,
});

describe('shouldFailOpenSurplusPreWrite', () => {
  it('fail-opens on PublicBuildEngineError when no user files were written', () => {
    expect(shouldFailOpenSurplusPreWrite({
      userFilesWritten: 0,
      error: new PublicBuildEngineError(),
    })).toBe(true);
  });

  it('fail-opens on transport subclass and UNAVAILABLE message twin', () => {
    expect(shouldFailOpenSurplusPreWrite({
      userFilesWritten: 0,
      error: new SurplusBuildTransportError('network'),
    })).toBe(true);
    expect(shouldFailOpenSurplusPreWrite({
      userFilesWritten: 0,
      error: new Error(PUBLIC_BUILD_ENGINE_UNAVAILABLE),
    })).toBe(true);
  });

  it('does NOT fail-open once any user file exists (partial Surplus work)', () => {
    expect(shouldFailOpenSurplusPreWrite({
      userFilesWritten: 1,
      error: new PublicBuildEngineError(),
    })).toBe(false);
  });

  it('does NOT fail-open for ordinary errors, stop, or after already dropped', () => {
    expect(shouldFailOpenSurplusPreWrite({
      userFilesWritten: 0,
      error: new Error('Stopped — the build was asked to stop'),
    })).toBe(false);
    expect(shouldFailOpenSurplusPreWrite({
      userFilesWritten: 0,
      error: new PublicBuildEngineError(),
      alreadyDropped: true,
    })).toBe(false);
  });

  it('fail-opens on timeout-shaped public message (stacks with #3959 honesty copy)', () => {
    expect(isSurplusPublicBuildEngineFailure(new Error('The build step timed out. Please try again shortly.'))).toBe(true);
    expect(shouldFailOpenSurplusPreWrite({
      userFilesWritten: 0,
      error: new Error('The build step timed out. Please try again shortly.'),
    })).toBe(true);
  });

  it('bench A: sub-second LLM_CALL_FAILED scrubbed to UNAVAILABLE fail-opens (NOT timeout-only)', () => {
    // Autopsy: SURPLUS_ADMITTED → LLM_CALL_FAILED → SurplusTurnRunner folds to PublicBuildEngineError
    // in well under a second. Must recover on Weak with Files still 0 — same gate as timeout, not a
    // separate timeout-only branch.
    const scrubbed = new PublicBuildEngineError(); // folded public boundary; no upstream text
    expect(scrubbed.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(shouldFailOpenSurplusPreWrite({ userFilesWritten: 0, error: scrubbed })).toBe(true);
    expect(surplusPreWriteFailOpenReason(scrubbed)).toBe('mid_build_engine_unavailable');
    expect(surplusPreWriteFailOpenReason(scrubbed)).not.toBe('mid_build_timeout');
  });
});

describe('surplusPreWriteFailOpenReason', () => {
  it('maps transport / timeout / generic without leaking upstream text', () => {
    expect(surplusPreWriteFailOpenReason(new SurplusBuildTransportError('response'))).toBe('mid_build_transport');
    expect(surplusPreWriteFailOpenReason(new Error('turn timed out after 60000ms'))).toBe('mid_build_timeout');
    expect(surplusPreWriteFailOpenReason(new PublicBuildEngineError())).toBe('mid_build_engine_unavailable');
    const hostile = surplusPreWriteFailOpenReason(new Error('https://api.surplusintelligence.ai/min90 secret-key'));
    expect(isSurplusPreWriteFailOpenReason(hostile) || hostile === 'mid_build_timeout').toBe(true);
    expect(hostile).not.toMatch(/surplus|secret|https|min90/i);
  });

  it('keeps mid-build reasons on the combined allowlist', () => {
    const all = allSafeSurplusFailOpenReasons();
    expect(all).toEqual(expect.arrayContaining([
      'mid_build_timeout', 'mid_build_transport', 'mid_build_engine_unavailable',
      'admission_timeout', 'flag_off',
    ]));
  });
});

describe('wrapSurplusRunnerPreWriteFailOpen', () => {
  it('retries the same turn on the Weak ladder after Surplus public failure with Files=0', async () => {
    const surplusRun = vi.fn(async () => { throw new PublicBuildEngineError(); });
    const weakRun = vi.fn(async () => emptyTurn());
    const onFailOpen = vi.fn();
    const state = { dropped: false };
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(
      { runTurn: surplusRun } as TurnRunner,
      () => ({ runTurn: weakRun } as TurnRunner),
      { state, userFilesWritten: () => 0, onFailOpen },
    );
    const result = await wrapped.runTurn(params());
    expect(result.text).toBe('ok');
    expect(surplusRun).toHaveBeenCalledOnce();
    expect(weakRun).toHaveBeenCalledOnce();
    expect(onFailOpen).toHaveBeenCalledExactlyOnceWith('mid_build_engine_unavailable');
    expect(state.dropped).toBe(true);
  });

  it('does not call Weak when Surplus succeeds', async () => {
    const surplusRun = vi.fn(async () => emptyTurn());
    const weakFactory = vi.fn(() => ({ runTurn: vi.fn() } as TurnRunner));
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(
      { runTurn: surplusRun } as TurnRunner,
      weakFactory,
      { state: { dropped: false }, userFilesWritten: () => 0 },
    );
    await wrapped.runTurn(params());
    expect(weakFactory).not.toHaveBeenCalled();
  });

  it('rethrows when user files already exist — no Weak restart after partial write', async () => {
    const surplusRun = vi.fn(async () => { throw new PublicBuildEngineError(); });
    const weakRun = vi.fn(async () => emptyTurn());
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(
      { runTurn: surplusRun } as TurnRunner,
      () => ({ runTurn: weakRun } as TurnRunner),
      { state: { dropped: false }, userFilesWritten: () => 3 },
    );
    await expect(wrapped.runTurn(params())).rejects.toThrow(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(weakRun).not.toHaveBeenCalled();
  });

  it('routes subsequent turns straight to Weak after one fail-open (shared state)', async () => {
    const surplusRun = vi.fn(async () => { throw new PublicBuildEngineError(); });
    const weakRun = vi.fn(async () => emptyTurn());
    const state = { dropped: false };
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(
      { runTurn: surplusRun } as TurnRunner,
      () => ({ runTurn: weakRun } as TurnRunner),
      { state, userFilesWritten: () => 0 },
    );
    await wrapped.runTurn(params());
    await wrapped.runTurn(params());
    expect(surplusRun).toHaveBeenCalledOnce();
    expect(weakRun).toHaveBeenCalledTimes(2);
  });

  it('never puts Surplus / min90 / supplier strings on the fail-open reason', async () => {
    const onFailOpen = vi.fn();
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(
      { runTurn: async () => { throw new SurplusBuildTransportError('network'); } } as TurnRunner,
      () => ({ runTurn: async () => emptyTurn() } as TurnRunner),
      { state: { dropped: false }, userFilesWritten: () => 0, onFailOpen },
    );
    await wrapped.runTurn(params());
    expect(JSON.stringify(onFailOpen.mock.calls)).not.toMatch(/surplus|min90|supplier|https/i);
  });

  it('bench A wrap: immediate UNAVAILABLE scrub (LLM_CALL_FAILED fold) retries Weak same turn', async () => {
    const surplusRun = vi.fn(async () => { throw new PublicBuildEngineError(); });
    const weakRun = vi.fn(async () => emptyTurn());
    const onFailOpen = vi.fn();
    const wrapped = wrapSurplusRunnerPreWriteFailOpen(
      { runTurn: surplusRun } as TurnRunner,
      () => ({ runTurn: weakRun } as TurnRunner),
      { state: { dropped: false }, userFilesWritten: () => 0, onFailOpen },
    );
    await expect(wrapped.runTurn(params())).resolves.toMatchObject({ text: 'ok' });
    expect(onFailOpen).toHaveBeenCalledExactlyOnceWith('mid_build_engine_unavailable');
    expect(weakRun).toHaveBeenCalledOnce();
  });
});
