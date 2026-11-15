import { describe, it, expect, vi } from 'vitest';
import { attachProChainV2, consumeEarlySurplusFailure, plansOnBuildRunner, proChainV2ForBuild, scopeDropSurplus, scopeFinalAsk } from '../src/server/routes/agentv3';
import { weakBuildAdmissionAsk } from '../src/server/AgentV3/weakBuildAdmissionAsk';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import type { SurplusPreWriteFailOpenHooks } from '../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen';
import { PublicBuildEngineError } from '../src/server/lib/buildEngineError';

/**
 * PRO CHAIN V2 — the four route helpers that sit on the EVERYONE path (owner t311u: no fix may create a new
 * problem). With no v2 context each must be the identity of the pre-v2 line it replaced, exactly.
 */
const hooks = (extra: Partial<SurplusPreWriteFailOpenHooks> = {}): SurplusPreWriteFailOpenHooks => ({ state: { dropped: false }, userFilesWritten: () => 0, ...extra });

describe('flag OFF ⇒ every route helper is the old line', () => {
  it('scope: the GLM classifier and the build-wide Surplus drop are returned as the SAME functions', () => {
    const drop = () => {};
    expect(scopeFinalAsk(undefined, weakBuildAdmissionAsk)).toBe(weakBuildAdmissionAsk);
    expect(scopeDropSurplus(undefined, drop)).toBe(drop);
  });
  it('the early Surplus scope failure still drops Surplus build-wide (pre-v2 behaviour)', () => {
    const onFailOpen = vi.fn();
    const h = hooks({ onFailOpen });
    consumeEarlySurplusFailure(h, new PublicBuildEngineError());
    expect(h.state.dropped).toBe(true);
    expect(onFailOpen).toHaveBeenCalledTimes(1);
  });
  it('the planner runs on the build runner only when a Surplus session exists (pre-v2 rule)', () => {
    expect(plansOnBuildRunner(undefined, hooks())).toBe(false);
    expect(plansOnBuildRunner({}, hooks())).toBe(true);
  });
  it('no v2 context ⇒ nothing is written to the report or the ledger', () => {
    const diag = new BuildDiagnostics();
    const add = vi.fn();
    attachProChainV2(undefined, diag, { add });
    expect(add).not.toHaveBeenCalled();
    expect(diag.report().issues).toEqual([]);
    expect(diag.report().proChainV2).toBeUndefined();
  });
});

describe('flag ON (z@) ⇒ the helpers switch to per-agent behaviour', () => {
  it('the early Surplus failure does NOT drop Surplus for the whole build; the planner uses the v2 chain', () => {
    const v2 = proChainV2ForBuild('weak', 'z@gmail.com', null)!;
    expect(v2).toBeDefined();
    const h = hooks({ proChainV2: v2 });
    consumeEarlySurplusFailure(h, new PublicBuildEngineError());
    expect(h.state.dropped).toBe(false);
    expect(plansOnBuildRunner(undefined, h)).toBe(true);
    const drop = vi.fn();
    scopeDropSurplus(v2, drop)();
    expect(drop).not.toHaveBeenCalled();
    expect(scopeFinalAsk(v2, weakBuildAdmissionAsk)).not.toBe(weakBuildAdmissionAsk);
  });
  it('attach writes the activation line and moves scope usage into the ledger once', () => {
    const v2 = proChainV2ForBuild('weak', 'z@gmail.com', null)!;
    v2.scopeUsage.push({ provider: 'ENGINE_QX', model: 'qwen3-235b-a22b-2507', usage: { inputTokens: 10, outputTokens: 1 }, estimated: false });
    const diag = new BuildDiagnostics();
    const add = vi.fn();
    attachProChainV2(v2, diag, { add });
    expect(add).toHaveBeenCalledTimes(1);
    expect(diag.report().issues.map((i) => i.code)).toContain('PRO_CHAIN_V2_ACTIVE');
    expect(diag.report().proChainV2?.reason).toBe('test-profile');
  });
});
