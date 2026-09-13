import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyLaneFailure, anotherLaneWorthTrying, upsellIsHonest, providerDegradedMessage,
} from '../src/server/AgentV3/laneFailure';
import { providerFailuresLookDegraded } from '../src/server/AgentV3/BuildDiagnostics';

const ROUTE = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

/**
 * THE REPORT (admin 2026-09-13). A free build spent 4m18s, produced ZERO files and the user stopped
 * it. The plan call returned a CORRECT five-file manifest — 178s late, because the providers were
 * degraded: 3 timeouts on one, 7 rate-limits out of 8 on the other.
 */
describe('a lane that died of a slow provider is not a lane that died of a hard app', () => {
  it('reads the real reasons this build recorded', () => {
    expect(classifyLaneFailure('simple-plan timed out after 90000ms')).toBe('provider-degraded');
    expect(classifyLaneFailure('operation did not finish within 150000ms')).toBe('provider-degraded');
    expect(classifyLaneFailure('OpenAI-compatible call (GLM/Kimi) timed out after 120000ms')).toBe('provider-degraded');
    expect(classifyLaneFailure('Request timed out.')).toBe('provider-degraded');
    expect(classifyLaneFailure('429 rate limit exceeded')).toBe('provider-degraded');
  });

  it('still recognises a genuine content failure — the case a stronger engine DOES fix', () => {
    expect(classifyLaneFailure('manifest_too_small')).toBe('content');
    expect(classifyLaneFailure('could not parse the file blocks')).toBe('content');
  });

  // A reason carrying both is a timeout whose SYMPTOM is emptiness. Reading it the other way round
  // is how an outage gets reported to a user as their app being too hard.
  it('when a reason carries both, the provider cause wins', () => {
    expect(classifyLaneFailure('plan timed out — no files')).toBe('provider-degraded');
  });

  it('an unreadable reason is never treated as evidence', () => {
    expect(classifyLaneFailure('')).toBe('unknown');
    expect(classifyLaneFailure(null)).toBe('unknown');
    expect(classifyLaneFailure('something nobody has seen before')).toBe('unknown');
  });
});

describe('a second lane on the same sick provider is the same failure at full price', () => {
  it('declines another lane after a provider-degraded failure', () => {
    expect(anotherLaneWorthTrying('simple-plan timed out after 90000ms')).toBe(false);
  });

  it('still allows one after a content failure, and after an unreadable one', () => {
    expect(anotherLaneWorthTrying('manifest_too_small')).toBe(true);
    expect(anotherLaneWorthTrying('')).toBe(true);            // no evidence ⇒ do not disable a working path
    expect(anotherLaneWorthTrying('who knows')).toBe(true);
  });

  it('the route really gates the one-shot on it — the 150s this cost', () => {
    expect(ROUTE).toContain('oneShotStillViable(sb) && anotherLaneWorthTrying(sb.reason)');
    expect(ROUTE).toContain("!anotherLaneWorthTrying(sb.reason)");
  });
});

describe('🔴 we do not ask the user to pay for our own outage', () => {
  it('the upsell is honest ONLY when a stronger engine would help', () => {
    expect(upsellIsHonest('manifest_too_small')).toBe(true);
    expect(upsellIsHonest('simple-plan timed out after 90000ms')).toBe(false);
    expect(upsellIsHonest('429 rate limit')).toBe(false);
    expect(upsellIsHonest('')).toBe(false);   // unproven ⇒ never ask for money
  });

  // Reads the buckets the build already recorded, so the message and the admin's report cannot
  // disagree about what happened.
  it('the recorded buckets from THIS report read as degraded', () => {
    expect(providerFailuresLookDegraded({ KIMI: '3 timeout', GLM: '7 rate-limit, 1 timeout' })).toBe(true);
  });

  it('a configuration fault is NOT "try again in a few minutes"', () => {
    // model-unavailable and auth never come right on a retry — they get their own louder treatment.
    expect(providerFailuresLookDegraded({ KIMI: '5 model-unavailable' })).toBe(false);
    expect(providerFailuresLookDegraded({ KIMI: '2 auth' })).toBe(false);
    expect(providerFailuresLookDegraded({})).toBe(false);
    expect(providerFailuresLookDegraded(null)).toBe(false);
  });

  it('the degraded message blames us, asks for nothing, and names no vendor', () => {
    const m = providerDegradedMessage();
    expect(m).toMatch(/this one is on us/i);
    expect(m).not.toMatch(/credit|add credits|upgrade|pay/i);
    for (const vendor of ['Kimi', 'GLM', 'Claude', 'Gemini', 'Grok', 'Moonshot', 'Anthropic', 'OpenAI']) {
      expect(m).not.toContain(vendor);
    }
  });

  it('the route chooses between the two messages on that evidence, and says when it suppressed one', () => {
    expect(ROUTE).toContain('providerFailuresLookDegraded(buildDiag.providerFailureBreakdown())');
    expect(ROUTE).toContain('degraded ? providerDegradedMessage() : freeTierUpsellMessage()');
    expect(ROUTE).toContain('UPSELL_SUPPRESSED');
  });
});

describe('a workaround is never counted as a self-heal (rule 5, in the data)', () => {
  // That build's counts read `autoResolved: 4`, and all four were PROVIDER_FALLBACK warnings. None
  // resolved anything — zero files were produced and the user stopped the build. Four deferred root
  // causes were shown to the admin as four things the engine fixed itself.
  it('provider and lane fallbacks are excluded from autoResolved and counted as debt', async () => {
    const { BuildDiagnostics } = await import('../src/server/AgentV3/BuildDiagnostics');
    const d = new BuildDiagnostics('ws', 'sess');
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'Provider KIMI failed', autoResolved: true });
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed', autoResolved: true });
    d.record({ phase: 'build', severity: 'warning', code: 'REAL_HEAL', message: 'genuinely fixed', autoResolved: true });
    const snap = d.report();
    expect(snap.counts.workarounds).toBe(2);
    expect(snap.counts.autoResolved).toBe(1);   // the real heal only
  });

  it('a build with no fallbacks does not grow a workarounds field', async () => {
    const { BuildDiagnostics } = await import('../src/server/AgentV3/BuildDiagnostics');
    const d = new BuildDiagnostics('ws', 'sess');
    d.record({ phase: 'build', severity: 'warning', code: 'REAL_HEAL', message: 'fixed', autoResolved: true });
    const snap = d.report();
    expect(snap.counts.workarounds).toBeUndefined();
    expect(snap.counts.autoResolved).toBe(1);
  });
});
