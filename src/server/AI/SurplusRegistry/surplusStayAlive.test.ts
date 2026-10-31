import { describe, it, expect } from 'vitest';
import { isSurplusTurnRetryable, surplusStayAlivePolicy, SurplusBuildUnavailableError } from './buildSession';
import { publicBuildEngineError } from '../../lib/buildEngineError';
import { BuildStoppedError } from '../../AgentV3/stopSignal';
import { BUDGET_REACHED_MESSAGE } from '../../AgentV3/turnDeadline';

describe('Surplus stay-alive (owner 2026-10-31)', () => {
  it('defaults: 5 retries, 240s per turn; env can turn off', () => {
    expect(surplusStayAlivePolicy({}).retries).toBe(5);
    expect(surplusStayAlivePolicy({}).turnMs).toBe(240_000);
    expect(surplusStayAlivePolicy({ SURPLUS_STAY_ALIVE: 'off' }).retries).toBe(0);
    expect(surplusStayAlivePolicy({ SURPLUS_TURN_RETRIES: '99' }).retries).toBe(10);
  });
  it('retries transient engine deaths, never stop/policy/budget', () => {
    expect(isSurplusTurnRetryable(publicBuildEngineError('turn_timeout'))).toBe(true);
    expect(isSurplusTurnRetryable(publicBuildEngineError('terminal_fold'))).toBe(true);
    expect(isSurplusTurnRetryable(new SurplusBuildUnavailableError('review_unavailable'))).toBe(true);
    expect(isSurplusTurnRetryable(publicBuildEngineError('policy_refusal'))).toBe(false);
    expect(isSurplusTurnRetryable(new BuildStoppedError())).toBe(false);
    expect(isSurplusTurnRetryable(new Error(BUDGET_REACHED_MESSAGE))).toBe(false);
    expect(isSurplusTurnRetryable(new Error('random'))).toBe(false);
  });
});
