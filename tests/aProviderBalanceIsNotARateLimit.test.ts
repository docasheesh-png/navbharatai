import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  fatalProviderHint, isFatalProviderError, isRateLimitProviderError, makeMultiProviderTurnRunner,
  sharedRateLimitCooldowns, type NamedRunner,
} from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import {
  classifyProviderFailure, providerFailuresLookDegraded, providerFailuresLookMisconfigured,
} from '../src/server/AgentV3/BuildDiagnostics';
import type { RunTurnParams, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

// dc96f9b3, 8408d4d0 and b357f9d4 (2026-10-19). Account identifiers are synthetic.
const BALANCE_ERROR = '429 Your account org-example <ak-example> is suspended due to insufficient balance, please recharge your account or check your plan and billing details';
const params = { model: 'x', messages: [], tools: [] } as RunTurnParams;
const failing = (text: string): TurnRunner => ({ runTurn: vi.fn(async () => { throw new Error(text); }) });
const healthy = (): TurnRunner => ({ runTurn: vi.fn(async () => ({
  text: 'done', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 },
} as never)) });

describe('a provider account with no balance cannot recover through rate-limit retries', () => {
  beforeEach(() => sharedRateLimitCooldowns.reset());

  it('classifies the exact recorded 429 as fatal billing, not transient throttling', () => {
    expect(isFatalProviderError(new Error(BALANCE_ERROR))).toBe(true);
    expect(isRateLimitProviderError(new Error(BALANCE_ERROR))).toBe(false);
    expect(classifyProviderFailure(BALANCE_ERROR)).toBe('billing');
    expect(providerFailuresLookDegraded({ KIMI: '1 billing' })).toBe(false);
    expect(providerFailuresLookMisconfigured({ KIMI: '1 billing' })).toBe(true);
  });

  it('recognises explicit balance exhaustion across provider status codes and error codes', () => {
    for (const error of [
      '400 Your credit balance is too low',
      '402 Insufficient balance',
      '403 insufficient credits',
      '429 {"error":{"code":"insufficient_quota"}}',
    ]) {
      expect(isFatalProviderError(error), error).toBe(true);
      expect(classifyProviderFailure(error), error).toBe('billing');
    }
  });

  it('leaves ordinary rate quotas, service overload and timeouts transient', () => {
    for (const error of ['429 Rate limit reached for requests', '429 tokens per minute quota exceeded', '503 temporarily overloaded', 'Request timed out.']) {
      expect(isFatalProviderError(error), error).toBe(false);
    }
    expect(classifyProviderFailure('429 tokens per minute quota exceeded')).toBe('rate-limit');
    expect(isRateLimitProviderError('429 tokens per minute quota exceeded')).toBe(true);
  });

  it('remembers the exhausted credential when a later lane constructs another runner', async () => {
    const noBalance = failing(BALANCE_ERROR);
    const backstop = healthy();
    const chain: NamedRunner[] = [
      { name: 'KIMI', modelId: 'kimi-k2.7-code', runner: noBalance },
      { name: 'GLM', runner: backstop },
    ];
    const deadRungs = new Map<string, string>();
    await makeMultiProviderTurnRunner(chain, { deadRungs }).runTurn(params);
    await makeMultiProviderTurnRunner(chain, { deadRungs }).runTurn(params);
    expect(noBalance.runTurn).toHaveBeenCalledTimes(1);
    expect(backstop.runTurn).toHaveBeenCalledTimes(2);
  });

  it('wires that same retirement memory into the builder, heals and empty-build retry', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const client = route.slice(route.indexOf('const client = buildTurnRunner({'), route.indexOf('// WHY THIS BUILD\'S ENGINES'));
    const heal = route.slice(route.indexOf('const healRunnerOpts = () => ({'), route.indexOf('// MEGA-APP ROADMAP', route.indexOf('const healRunnerOpts = () => ({')));
    const retry = route.split('\n').find((line) => line.includes("client: buildTurnRunner({ tier: powerLevelReqEffective, fromProvider:"));
    expect(client.includes('deadRungs: fastLaneDeadRungs')).toBe(true);
    expect(heal.includes('deadRungs: fastLaneDeadRungs')).toBe(true);
    expect(retry?.includes('deadRungs: fastLaneDeadRungs')).toBe(true);
  });

  it('keeps an independently funded credential in the same provider pool available', async () => {
    const noBalance = failing(BALANCE_ERROR);
    const funded = healthy();
    const runner = makeMultiProviderTurnRunner([
      { name: 'KIMI', reportAs: 'KIMI', modelId: 'kimi-k2.7-code', runner: noBalance },
      { name: 'KIMI#2', reportAs: 'KIMI', modelId: 'kimi-k2.7-code', runner: funded },
    ]);
    expect((await runner.runTurn(params)).text).toBe('done');
    expect((await runner.runTurn(params)).text).toBe('done');
    expect(noBalance.runTurn).toHaveBeenCalledTimes(1);
    expect(funded.runTurn).toHaveBeenCalledTimes(2);
  });

  it('names the platform account that needs funding when no provider can answer', async () => {
    const runner = makeMultiProviderTurnRunner([{ name: 'KIMI', runner: failing(BALANCE_ERROR) }]);
    await expect(runner.runTurn(params)).rejects.toThrow(/PLATFORM ISSUE.*(?:balance|credits)/);
    expect(fatalProviderHint(BALANCE_ERROR)).toMatch(/admin/);
    expect(fatalProviderHint(BALANCE_ERROR)).not.toMatch(/Anthropic/);
  });
});
