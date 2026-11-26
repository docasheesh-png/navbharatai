/**
 * THE FALLBACK LINE NAMES THE ENGINE THAT TAKES THE TURN (Q-3467, failedbr #2525).
 *
 * SURPLUS_FALLBACK said "continuing the same turn on the Weak ladder", and TIER_LADDER printed GLM → KIMI → GLM — but
 * the build went on on ENGINE_R1 (deepseek-v4.1-flash): a Weak build tries Router One, Qubax, BluesMinds and Moyi
 * BEFORE its tier ladder. One list (weakEnginesBeforeLadder) now builds the chain AND is named in both lines.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { surplusFallbackMessage } from '../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen';

afterEach(() => vi.unstubAllEnvs());

describe('the message', () => {
  it('names the next engine when there is one, and the ladder only when there is not', () => {
    expect(surplusFallbackMessage('mid_build_after_write', 'ENGINE_R1 (deepseek-v4.1-flash)'))
      .toBe('Surplus unavailable mid-build after the builder had written files — continuing the same turn on ENGINE_R1 (deepseek-v4.1-flash), the next engine of the Weak chain (reason: mid_build_after_write).');
    expect(surplusFallbackMessage('mid_build_after_write')).toMatch(/continuing the same turn on the Weak ladder/);
  });
});

describe('one list builds the chain and names it', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('the Weak chain is built from weakEnginesBeforeLadder, and no engine is listed beside it', () => {
    expect(route).toMatch(/\.\.\.\(level === 'weak' \? weakEnginesBeforeLadder\(\) : \[\]\),/);
    const chain = route.slice(route.indexOf('  const runners = [\n    ...(level === \'weak\' ? weakEnginesBeforeLadder()'));
    expect(chain.slice(0, 600)).not.toMatch(/qubaxBuilderRungs|bluesmindsBuilderRungs|moyiBuilderRungs|ROUTER_ONE_LABEL/);
  });
  it('SURPLUS_FALLBACK and TIER_LADDER read the same list', () => {
    expect(route).toMatch(/message: surplusFallbackMessage\(reason, weakChainHead\(\)\)/);
    expect(route).toMatch(/weakChainBeforeLadderNote\(toPowerLevel\(powerLevelReqEffective\)\),/);
  });
  it('with Router One configured, the head of the Weak chain is ENGINE_R1 and the ladder note names it', async () => {
    vi.stubEnv('ROUTER_ONE_API_KEY', 'test-key');
    vi.stubEnv('ROUTER_ONE_MODEL', 'deepseek-v4.1-flash');
    const { weakChainHead, weakChainBeforeLadderNote } = await import('../src/server/routes/agentv3');
    expect(weakChainHead()).toMatch(/^ENGINE_R1/);
    expect(weakChainBeforeLadderNote('weak')).toMatch(/^Before this ladder, a Weak build tries: ENGINE_R1/);
    expect(weakChainBeforeLadderNote('normal' as never)).toBe('');
  }, 120_000);
});
