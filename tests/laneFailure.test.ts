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
    // ⚠️ UPDATED 2026-09-13, and the update is the interesting part. `freeTierUpsellMessage` gained a
    // CAUSE argument on main the same day (#2887: a prompt with nothing to build from is not an engine
    // limit either), so the two conditions now COMPOSE — degraded first, because it is a statement about
    // US, and only then a statement about the prompt. Asserted argument-agnostically so a third cause
    // does not fail this test for the wrong reason; the guard below is what actually holds the line.
    expect(ROUTE).toMatch(/degraded \? providerDegradedMessage\(\) : freeTierUpsellMessage\(/);
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
  /**
   * The route with whole-line comments blanked out, so a proximity check measures CODE distance.
   *
   * Only lines whose first non-space characters are `//` or a block-comment body are removed — never a
   * trailing comment and never anything mid-line — so no string literal (`https://…`) can be touched.
   * Line COUNT is preserved by keeping the newlines, and `codeAt` maps a source offset to this text's
   * offset, so `sites` can go on being found in the real source.
   */
  const commentLine = (line: string): boolean => /^\s*(?:\/\/|\*|\/\*)/.test(line);
  const CODE_LINES = ROUTE_SRC.split('\n').map((l) => (commentLine(l) ? '' : l));
  const CODE_ONLY = CODE_LINES.join('\n');
  const SRC_LINES = ROUTE_SRC.split('\n');
  const codeAt = (offset: number): number => {
    // How many characters of code precede the source line this offset falls on.
    let srcSeen = 0;
    let codeSeen = 0;
    for (let i = 0; i < SRC_LINES.length; i++) {
      const next = srcSeen + SRC_LINES[i].length + 1;
      if (offset < next) return codeSeen + (CODE_LINES[i] ? offset - srcSeen : 0);
      srcSeen = next;
      codeSeen += CODE_LINES[i].length + 1;
    }
    return codeSeen;
  };

  // THE MOST DAMAGING BUG IN THE REPORT was not the failed build — it was asking the user to pay for
  // it. A future edit that adds a second upsell site, or drops the check from this one, would bring
  // it straight back and nothing would fail. So: EVERY mention of the upsell must sit next to the
  // evidence check.
  it('no code path can emit the upsell without first asking whether WE were the problem', () => {
    // 🔴 THE REGEX MUST NOT PIN THE ARGUMENT LIST, and this is not hypothetical: it was written as
    // `freeTierUpsellMessage\(\)` and went BLIND within hours, when #2887 added a cause argument on main.
    // `sites.length` fell to zero and the loop below simply had nothing to check — a guard that passes
    // by finding nothing is worse than no guard, because it reports success. Hence both the
    // open-paren-only match and the non-empty assertion that caught it.
    const sites = [...ROUTE_SRC.matchAll(/freeTierUpsellMessage\(/g)]
      .map((m) => m.index ?? 0)
      // The import line names the symbol without calling it.
      .filter((at) => !/^import /.test(ROUTE_SRC.slice(ROUTE_SRC.lastIndexOf('\n', at) + 1, at)));
    expect(sites.length).toBeGreaterThan(0);
    for (const at of sites) {
      // ⚠️ THE WINDOW IS MEASURED ON CODE, NOT ON SOURCE TEXT, AND THAT IS THE POINT (2026-09-15).
      //
      // It was 900, then 1800, and was about to need a third widening — not because the decision moved
      // away from the call site, but because each autopsy adds a paragraph of rationale ABOVE it. The
      // window was measuring comment volume. So it now measures the stripped code, where the real
      // distance has stayed small and constant, and a fourth reason can be documented as fully as it
      // deserves without anyone having to re-tune a number that was never about documentation.
      const around = CODE_ONLY.slice(Math.max(0, codeAt(at) - 900), codeAt(at) + 200);
      expect(around, 'an upsell with no degraded-provider check next to it').toContain('providerFailuresLookDegraded');
      // 🔴 THE SECOND WAY WE CAN BE THE PROBLEM (build report 58fe8254): a rung that rejects every call
      // with the same PERMANENT error. `degraded` is deliberately false for it — it is not transient —
      // so before this predicate existed 279 identical bad-requests still ended in "Add credits".
      expect(around, 'an upsell with no our-configuration check next to it').toContain('providerFailuresLookMisconfigured');
      // 🔴 THE THIRD (build report ee20478d): every rung ANSWERED, inside its clock, and produced
      // nothing, because OUR output ceiling was spent before the answer began. It is in no failure
      // class at all — the calls returned HTTP 200 — so both predicates above are false for it, and
      // the user was asked to buy a ceiling that is identical on every tier we sell.
      expect(around, 'an upsell with no output-budget check next to it').toContain('buildStarvedItsOutputBudget');
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

describe('the two caps, and the contract that now reconciles them', () => {
  // ✅ CLOSED. This block was written as a TRIPWIRE on an OPEN root cause: the fast lane capped its
  // plan call at 90s while the Kimi rung was allowed 120s, so the lane was structurally guaranteed to
  // abandon calls the provider still considered alive — which is why that build logged provider
  // events 148s AFTER it ended, on a sandbox still being billed.
  //
  // `turnDeadline.ts` closed it: the lane's cap is handed DOWN as an absolute epoch-ms instant, so the
  // call a lane starts can no longer outlive the wait. Its author wrote that when the threading
  // landed this would "become the assertion that holds rather than the one that documents a debt" —
  // this is that moment, and the wording is updated rather than left describing a fixed bug as open.
  //
  // 🔒 BOTH NUMBERS ARE STILL PINNED, and deliberately. They were never wrong — they answer different
  // questions ("how long may this lane wait?" and "how long may this provider take?") and Kimi really
  // does need 120s on a large prompt when the lane has 120s to give. What changed is that the lane's
  // budget now WINS when it is smaller, instead of being a suggestion the provider never heard. If
  // either number moves, this still fails and whoever moved it has to look at the other one.
  const ROUTE_SRC = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  const SIMPLE = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');

  it('records the pair the contract reconciles: plan cap 90s, Kimi rung 120s', () => {
    expect(SIMPLE).toContain('deps.planTimeoutMs ?? 90_000');
    expect(ROUTE_SRC).toContain("Number(process.env.AGENTV3_KIMI_TIMEOUT_MS) || 120_000");
  });

  it('the parent cap is still the SMALLER number — which is exactly why the contract has to exist', () => {
    // A configured parent < child is no longer a bug, because the parent's budget now reaches the
    // child. This records WHY the contract is load-bearing: remove it and the inversion is a live
    // leak again, not a tidy-up.
    const planCap = 90_000, kimiCap = 120_000;
    expect(planCap).toBeLessThan(kimiCap);
  });

  it('🔒 and the contract that reconciles them is actually wired — not merely present', () => {
    // The assertions above would still pass if turnDeadline.ts existed and nothing called it, which
    // is the state this whole block exists to make impossible to reach quietly.
    const SIMPLE_SRC = readFileSync(join(process.cwd(), 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');
    expect(SIMPLE_SRC).toContain('deadlineFromBudget');
    expect(SIMPLE_SRC).toMatch(/deadlineAt/);
  });
});
