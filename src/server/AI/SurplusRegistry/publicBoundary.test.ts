import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SurplusBuildUnavailableError } from './buildSession';
import { SurplusAccountingUnavailableError } from '../../AgentV3/providerRates';
import { PublicBuildEngineError, PUBLIC_BUILD_ENGINE_UNAVAILABLE, PUBLIC_BUILD_ENGINE_TIMEOUT, publicBuildEngineError, publicBuildEngineSafeReason } from '../../lib/buildEngineError';
import { publishBuildException } from '../../AgentV3/BuildRequestCoordination';
import { providerDebugTag } from '../../routes/agentv3';

describe('public build failure boundary', () => {
  it.each([
    new SurplusBuildUnavailableError('no_eligible_90_percent_offer'),
    new SurplusAccountingUnavailableError(),
    new PublicBuildEngineError(),
  ])('serializes only generic public failure and keeps SSE supplier-free', error => {
    expect(error.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(error.stack).toBe(`Error: ${PUBLIC_BUILD_ENGINE_UNAVAILABLE}`);
    expect(error.cause).toBeUndefined();
    const events: unknown[] = []; publishBuildException(error,null,event=>events.push(event));
    const publicJson = JSON.stringify({error,message:error.message,stack:error.stack,events});
    expect(publicJson).not.toMatch(/surplus|glm|deepseek|min90|supplier|tariff|receipt|90_percent|no_eligible/i);
    expect(events).toEqual([expect.objectContaining({type:'error',message:PUBLIC_BUILD_ENGINE_UNAVAILABLE})]);
  });
  it('retains only enumerated non-public admission reasons, not arbitrary upstream data', () => {
    const trusted = new SurplusBuildUnavailableError('invalid_build_scope');
    expect(trusted.reason).toBe('invalid_build_scope');
    expect(Object.keys(trusted)).not.toContain('reason');
    const hostile = new SurplusBuildUnavailableError('Surplus provider secret-key prompt-content https://api.surplusintelligence.ai');
    expect(hostile.reason).toBe('review_unavailable');
    expect(JSON.stringify(hostile)).not.toMatch(/surplus|secret|prompt|https/i);
  });
  it('cannot append provider/model tags to public replies even with a debug flag', () => {
    const previous = process.env.AGENTV3_DEBUG_PROVIDER;
    try {
      process.env.AGENTV3_DEBUG_PROVIDER='true';
      for (const identity of ['SURPLUS','glm-5.3','unknown-private-seller']) expect(providerDebugTag(identity)).toBe('');
    } finally { if(previous===undefined) delete process.env.AGENTV3_DEBUG_PROVIDER; else process.env.AGENTV3_DEBUG_PROVIDER=previous; }
  });
  it('preflight and persisted failure chat use the public projection, not raw errors', () => {
    const route = readFileSync('src/server/routes/agentv3.ts','utf8');
    const surplusAdmit = readFileSync('src/server/AI/SurplusRegistry/surplusChatAdmission.ts','utf8');
    // Surplus admission fail-opens to Weak/CHEAP_FLOOR (never a Surplus-only hard 503).
    // Weak-only gate + fallback audit live in surplusChatAdmission (TS2563 extraction).
    expect(route).toContain('runWeakSurplusAdmissionForChat');
    expect(route).toContain('recordSurplusAdmissionDiag');
    expect(surplusAdmit).toContain('resolveProBuildSurplusAdmission');
    expect(surplusAdmit).toContain('AGENTV3_SURPLUS_FALLBACK_TO_WEAK');
    expect(surplusAdmit).toContain('[AGENT_STEP] Surplus unavailable');
    // Mid-build sibling of admission fail-open: Surplus timeout/transport with Files=0 → Weak ladder.
    const preWrite = readFileSync('src/server/AI/SurplusRegistry/surplusPreWriteFailOpen.ts','utf8');
    expect(preWrite).toContain('wrapSurplusRunnerPreWriteFailOpen');
    expect(preWrite).toContain('tryConsumeSurplusPreWriteFailOpen');
    expect(route).not.toContain('isPublicBuildEngineUnavailableText');
    expect(route).not.toContain('scrubRetry');
    expect(route).toContain('earlySurplusFailure = error');
    expect(route).toContain('surplusPreWriteFailOpen');
    expect(route).toContain('wrapSurplusRunnerPreWriteFailOpen');
    expect(route).toContain('tryConsumeSurplusPreWriteFailOpen');
    expect(route).toContain("phase: 'mid_build_pre_write'");
    expect(route).not.toContain("res.status(503).json({ code: 'ENGINE_UNAVAILABLE', error: PUBLIC_BUILD_ENGINE_UNAVAILABLE });");
    expect(route).toContain('content: `❌ Build failed: ${redactProviderError(errMsg)}`');
    expect(route).not.toContain('content: `❌ Build failed: ${errMsg}`');
    expect(route).not.toContain('isProviderDebugOn()');
    expect(route).not.toContain('Decision trace:\\n${decisionTrace.format()}');
    expect(route).toContain('await persistDecisionTrace(decisionTrace, nowIso)');
  });

  it('distinguishes turn timeout from generic unavailable without leaking the safe reason', () => {
    const timed = publicBuildEngineError('turn_timeout');
    expect(timed.message).toBe(PUBLIC_BUILD_ENGINE_TIMEOUT);
    expect(publicBuildEngineSafeReason(timed)).toBe('turn_timeout');
    expect(Object.getOwnPropertyNames(timed).sort()).toEqual(['message', 'name', 'stack']);
    expect(JSON.stringify(timed)).not.toMatch(/turn_timeout|surplus/i);
    const folded = publicBuildEngineError('terminal_fold');
    expect(folded.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(publicBuildEngineSafeReason(folded)).toBe('terminal_fold');
    const refusal = publicBuildEngineError('policy_refusal');
    expect(publicBuildEngineSafeReason(refusal)).toBe('policy_refusal');
    expect(refusal.message).toBe(PUBLIC_BUILD_ENGINE_UNAVAILABLE);
    expect(Object.getOwnPropertyNames(refusal).sort()).toEqual(['message', 'name', 'stack']);
    expect(JSON.stringify(refusal)).not.toMatch(/policy_refusal|surplus/i);
  });

});
