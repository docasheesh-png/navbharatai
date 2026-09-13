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

describe('🔒 the guards that stop this coming back', () => {
  const ROUTE_SRC = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  // THE MOST DAMAGING BUG IN THE REPORT was not the failed build — it was asking the user to pay for
  // it. A future edit that adds a second upsell site, or drops the check from this one, would bring
  // it straight back and nothing would fail. So: EVERY mention of the upsell must sit next to the
  // evidence check.
  it('no code path can emit the upsell without first asking whether WE were the problem', () => {
    const sites = [...ROUTE_SRC.matchAll(/freeTierUpsellMessage\(\)/g)].map((m) => m.index ?? 0);
    expect(sites.length).toBeGreaterThan(0);
    for (const at of sites) {
      const around = ROUTE_SRC.slice(Math.max(0, at - 900), at + 200);
      expect(around, 'an upsell with no degraded-provider check next to it').toContain('providerFailuresLookDegraded');
    }
  });

  it('the degraded path records that it suppressed the ask, so the check is visible in the report', () => {
    expect(ROUTE_SRC).toContain("code: 'UPSELL_SUPPRESSED'");
  });

  // Real reason strings arrive with provider prefixes, trailing durations, capitals and full stops.
  // A classifier that only matches the tidy form is a classifier that fails in production.
  it('classification survives the shapes reasons actually arrive in', () => {
    for (const messy of [
      'OpenAI-compatible call (GLM/Kimi) timed out after 120000ms',
      '  REQUEST TIMED OUT.  ',
      'Error: ETIMEDOUT connecting to upstream',
      'HTTP 429 Too Many Requests',
      'Provider GLM failed: rate-limit exceeded, retry later',
      'socket hang up',
    ]) {
      expect(classifyLaneFailure(messy), messy).toBe('provider-degraded');
      expect(upsellIsHonest(messy), messy).toBe(false);
    }
  });

  // A safety property, stated directly: there is NO input for which we both refuse to retry and ask
  // for money. Those two would be a contradiction — "our engine is fine, but do not try again".
  it('we never simultaneously blame the provider and bill the user', () => {
    for (const r of ['timed out', 'manifest_too_small', '429', '', 'unknown thing', 'did not finish within 150000ms']) {
      expect(anotherLaneWorthTrying(r) || !upsellIsHonest(r), r).toBe(true);
    }
  });
});

describe('🔴 TRIPWIRE — the open root cause, so it cannot drift further in silence', () => {
  // NOT A FIX. The fast lane caps its plan call at 90s while the Kimi rung is allowed 120s, so the
  // lane is structurally guaranteed to abandon calls the provider still considers alive — which is
  // why that build logged provider events 148s AFTER it ended. Killing it means threading a per-call
  // deadline into the provider chain, which touches every build (PROGRESS.md, rule 6).
  //
  // Until then this pins BOTH numbers. If either moves, this test fails and whoever moved it has to
  // look at the other one — which is exactly what nobody did when they drifted apart.
  const ROUTE_SRC = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const SIMPLE = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');

  it('records today’s inverted pair: plan cap 90s, Kimi rung 120s', () => {
    expect(SIMPLE).toContain('deps.planTimeoutMs ?? 90_000');
    expect(ROUTE_SRC).toContain("Number(process.env.AGENTV3_KIMI_TIMEOUT_MS) || 120_000");
  });

  it('and states the invariant that is currently violated, so the direction of the fix is not lost', () => {
    // parent ≥ child. 90_000 < 120_000 today; when the threading lands, this becomes the assertion
    // that holds rather than the one that documents a debt.
    const planCap = 90_000, kimiCap = 120_000;
    expect(planCap).toBeLessThan(kimiCap);   // ← the bug, written down
  });
});
