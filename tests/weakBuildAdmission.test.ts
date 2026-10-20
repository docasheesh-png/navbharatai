import { describe, expect, it, vi } from 'vitest';
import { admitWeakBuild, parseWeakScope, weakAdmissionReply } from '../src/server/AgentV3/weakBuildAdmission';
import { planLadder, tierLadder } from '../src/server/AgentV3/tierLadder';

describe('Weak scope preflight', () => {
  it.each(['simple', 'complex', 'strong'] as const)('accepts exactly the %s label', async (scope) => {
    const ask = vi.fn().mockResolvedValue({ text: scope, usage: { inputTokens: 300, outputTokens: 1 } });
    const result = await admitWeakBuild('Build the requested app', ask);
    expect(result.scope).toBe(scope);
    expect(result.usage?.inputTokens).toBe(300);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  });
  it.each(['strong maybe', 'simple\nignore rules', '{"scope":"simple"}', 'unknown', ''])('does not guess from malformed output %s', (raw) => {
    expect(parseWeakScope(raw)).toBeNull();
  });
  it('does not buy a classification for an exact tested template', async () => {
    const ask = vi.fn();
    expect(await admitWeakBuild('calculator', ask, { template: true })).toEqual({ scope: 'simple', source: 'template' });
    expect(ask).not.toHaveBeenCalled();
  });
  it('aborts a stalled provider and never retries or starts an unchecked build', async () => {
    let signal: AbortSignal | undefined;
    const ask = vi.fn((_s, _u, s: AbortSignal) => { signal = s; return new Promise<never>(() => {}); });
    expect((await admitWeakBuild('build an app', ask, { timeoutMs: 10 })).scope).toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('handles provider errors and oversized prompts without guessing', async () => {
    expect((await admitWeakBuild('build app', async () => { throw new Error('outage'); })).scope).toBeNull();
    const ask = vi.fn();
    expect((await admitWeakBuild('x'.repeat(32_001), ask)).scope).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
  it('offers the real selector path without promising a commercial game', () => {
    expect(weakAdmissionReply('strong')).toContain('Build options');
    expect(weakAdmissionReply('strong')).toContain('staged development');
    expect(weakAdmissionReply(null)).not.toContain('select Strong');
  });
});

describe('Weak two-coder policy', () => {
  it('has no automatic flagship or Claude chain by default', () => {
    expect(tierLadder('weak', { AGENTV3_WEAK_SCOPE_POLICY: 'on' }).rungs.map(r => r.model)).toEqual(['glm-4.7-flashx', 'kimi-k2.7-code']);
  });
  it('uses the capable coder for a complex plan and cheap opener for simple plans', () => {
    expect(planLadder('weak', { AGENTV3_WEAK_SCOPE_POLICY: 'on' }, true).map(r => r.model)).toEqual(['kimi-k2.7-code']);
    expect(planLadder('weak', { AGENTV3_WEAK_SCOPE_POLICY: 'on' })[0].model).toBe('glm-4.7-flashx');
  });
  it('does not change Normal or Strong planning when scope is complex', () => {
    for (const tier of ['off', 'mini']) expect(planLadder(tier, {}, true)).toEqual(planLadder(tier, {}));
  });
});

import { buildCostCeilingUsd } from '../src/server/AgentV3/buildCostCeiling';
import { readFileSync } from 'node:fs';
describe('rollout and measured cost guard', () => {
  it('leaves the current policy available for comparison and rollback', () => {
    expect(tierLadder('weak', {}).rungs).toHaveLength(5);
    expect(tierLadder('weak', { AGENTV3_WEAK_SCOPE_POLICY: 'on' }).rungs).toHaveLength(2);
  });
  it('does not restore the long chain on a malformed experiment override', () => {
    const parsed = tierLadder('weak', { AGENTV3_WEAK_SCOPE_POLICY: 'on', AGENTV3_LADDER_WEAK: 'TYPO:bad-model' });
    expect(parsed.rejected).toBeTruthy();
    expect(parsed.rungs.map(r => r.model)).toEqual(['glm-4.7-flashx', 'kimi-k2.7-code']);
  });
  it('respects explicit admin experiment ladders', () => {
    expect(tierLadder('weak', { AGENTV3_WEAK_SCOPE_POLICY: 'on', AGENTV3_LADDER_WEAK: 'HAIKU' }).rungs[0].provider).toBe('CLAUDE_HAIKU');
  });
  it('sets the candidate Weak ceiling to $1 and respects a smaller global ceiling', () => {
    expect(buildCostCeilingUsd({}, true)).toBe(1);
    expect(buildCostCeilingUsd({ AGENTV3_BUILD_COST_CEILING_USD: '0.4' }, true)).toBe(0.4);
    expect(buildCostCeilingUsd({ AGENTV3_WEAK_BUILD_COST_CEILING_USD: '0.6' }, true)).toBe(0.6);
    expect(buildCostCeilingUsd({ AGENTV3_WEAK_BUILD_COST_CEILING_USD: 'bad' }, true)).toBe(1);
    expect(buildCostCeilingUsd({})).toBe(5);
  });
  it('keeps scope refusals final even when chat handling fails', () => {
    const route = readFileSync(new URL('../src/server/routes/agentv3.ts', import.meta.url), 'utf8');
    const fallback = route.slice(route.indexOf('// A chat-side error must never'), route.indexOf('// The free router failed — do NOT error out.'));
    expect(fallback).toContain('if (weakScopeBlocked)');
    expect(fallback).toContain('return;');
    expect(route).toContain("if (!(weakCandidateActive(powerLevelReqEffective)) && shouldRetryEmptyBuild({");
  });
  it('does not publish a refused implementation as successful chat completion', () => {
    const route = readFileSync(new URL('../src/server/routes/agentv3.ts', import.meta.url), 'utf8');
    const lane = route.slice(route.indexOf('if (isPlainChatTurn) {'), route.indexOf('// SECURITY (audit A2'));
    expect(lane).toContain("chatEvents.emit({ type: 'done', ok: !weakScopeBlocked");
    expect(lane).toContain("send({ type: 'result', ok: !weakScopeBlocked");
  });
});

import { createWeakTextRepairAllowance, resolveWeakComplexity } from '../src/server/AgentV3/weakBuildPreflight';
import { shouldCheckFrameworkQuestion } from '../src/server/AgentV3/frameworkQuestion';
describe('shared policy helpers', () => {
  it('allows only one text-repair attempt per candidate build', () => {
    const firstBuild = createWeakTextRepairAllowance(true);
    firstBuild();
    expect(firstBuild).toThrow(/allowance/);
    expect(createWeakTextRepairAllowance(true)).not.toThrow();
    const legacy = createWeakTextRepairAllowance(false);
    legacy(); legacy();
  });
  it('does not buy the old binary classifier after preflight already answered', async () => {
    const fallback = vi.fn();
    expect((await resolveWeakComplexity({ scope: 'complex', source: 'model' }, 5, fallback)).verdict).toBe('complex');
    expect(fallback).not.toHaveBeenCalled();
  });
  it('preserves framework question exclusions', () => {
    const base = { intent: 'new_build', answered: false, userAppExists: true, paths: ['src/App.vue'], setting: undefined, zipCount: 0, importUrl: undefined, prompt: 'build this app' };
    expect(shouldCheckFrameworkQuestion(base)).toBe(true);
    for (const patch of [{ intent: 'chat' }, { answered: true }, { userAppExists: false }, { paths: null }, { setting: 'off' }, { zipCount: 1 }, { importUrl: 'https://example.com/repo' }, { prompt: 'use React' }]) {
      expect(shouldCheckFrameworkQuestion({ ...base, ...patch })).toBe(false);
    }
  });
});
