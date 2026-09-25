import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BuildDiagnostics, isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';
import { buildHealthFromDiagnostics } from '../src/server/AgentV3/buildHealthCard';
import { hasProviderLeak } from '../src/server/lib/providerRedaction';

/**
 * 🔴 A RENDERED APP WAS CALLED "NOT READY" AND MADE FREE — build 4efab9d7, 2026-09-15.
 *
 * Admin, from his phone, with the dashboard rendering in the preview beside the words "This build did
 * not fully succeed, so it is FREE": *"yaar apko -100,000 bar bola hai. app ban jaye to 'app not
 * build' dikha kar free (₹0) charge nahi karna hai!"*
 *
 * The chain: the model turn timed out (eight 60-second GLM timeouts inside one 480-second turn) →
 * recorded as an unresolved ERROR in the `provider` phase → `shippingIssueCount('error')` counted it
 * → the release gate said "1 build-breaking blocker" → the verdict was flipped to NOT ok → the
 * "working app or free" law made it ₹0. The app's own evidence that day: `PROD_BUILD_OK`, a saved
 * snapshot, and a page on the admin's screen. Not one of them was consulted.
 *
 * The SAME class had been root-caused two days earlier (report 70115adf) for one error message —
 * budget-ended — and the timeout sibling was never hunted. These tests pin the class, not the message.
 */

const timeoutCall = {
  ts: 1, model: 'claude-sonnet-4-6', promptPreview: '', responsePreview: '', promptChars: 79054, responseChars: 0,
  finishReason: null, toolCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 480000, ok: false,
  error: 'model turn 3 timed out after 480000ms',
};

describe('isAppFinding — a fact about a provider call is never a fact about the app', () => {
  it('excludes EVERY provider-phase finding, by phase, not by code', () => {
    for (const code of ['LLM_CALL_FAILED', 'PROVIDER_FALLBACK', 'PROVIDER_BENCHED', 'LLM_TRUNCATED', 'SOME_CODE_ADDED_NEXT_MONTH']) {
      expect(isAppFinding({ phase: 'provider', code }), code).toBe(false);
    }
  });

  it('keeps findings about the app', () => {
    expect(isAppFinding({ phase: 'readiness', code: 'READINESS_BLOCKER' })).toBe(true);
    expect(isAppFinding({ phase: 'preview', code: 'PREVIEW_ERROR' })).toBe(true);
    expect(isAppFinding({ phase: 'build', code: 'TSC_ERRORS' })).toBe(true);
  });

  it('still excludes the process-only codes the gate never counted', () => {
    for (const code of ['GROUNDING_COST', 'POST_ANSWER_TIMING', 'SERVICE_GRAPH_SINGLE', 'JOURNEY_NOT_DERIVED', 'RELEASE_GATE']) {
      expect(isAppFinding({ phase: 'build', code }), code).toBe(false);
    }
  });
});

describe('🔴 the exact record from build 4efab9d7', () => {
  it('a model turn that timed out is NOT a shipping blocker', () => {
    const d = new BuildDiagnostics({ buildId: 'b' });
    d.recordLlmCall(timeoutCall);
    // The timeline keeps it — an admin must still see the engine struggled — but the gate must not.
    expect(d.report().issues.some((i) => i.code === 'LLM_CALL_FAILED')).toBe(true);
    expect(d.shippingIssueCount('error')).toBe(0);
  });

  it('says what is actually known: no provider answered — the planned model id is a label, not a culprit', () => {
    const d = new BuildDiagnostics({ buildId: 'b' });
    d.recordLlmCall(timeoutCall);
    const issue = d.report().issues.find((i) => i.code === 'LLM_CALL_FAILED')!;
    expect(issue.message).toMatch(/no provider answering/);
    expect(issue.message).not.toContain('claude-sonnet-4-6');
    expect(issue.detail).toContain('planned model=claude-sonnet-4-6');
  });

  it('a call that a provider genuinely FAILED keeps the old wording', () => {
    const d = new BuildDiagnostics({ buildId: 'b' });
    d.recordLlmCall({ ...timeoutCall, provider: 'GLM', model: 'glm-5.3-flash', inputTokens: 1200, error: '500 internal error' });
    const issue = d.report().issues.find((i) => i.code === 'LLM_CALL_FAILED')!;
    expect(issue.message).toContain('Model call failed (glm-5.3-flash)');
  });

  it('🔒 the user\'s build-health card is READY, and names no vendor', () => {
    const d = new BuildDiagnostics({ buildId: 'b' });
    d.recordLlmCall(timeoutCall);
    d.record({ phase: 'provider', severity: 'warning', code: 'PROVIDER_FALLBACK', message: 'Provider GLM failed — falling back to the next provider', autoResolved: true });
    d.record({ phase: 'build', severity: 'warning', code: 'DESIGN_CONSISTENCY', message: 'Design consistency 68/100 (C) across 10 file(s).', autoResolved: false });
    d.finish(true, 'built');
    const health = buildHealthFromDiagnostics(d.report(), true);
    expect(health.ready).toBe(true);
    expect(health.blockers).toEqual([]);
    for (const line of [...health.blockers, ...health.warnings]) {
      expect(hasProviderLeak(line), line).toBe(false);
    }
    // The genuine app finding survives.
    expect(health.warnings.join(' ')).toContain('Design consistency');
  });

  it('🔒 the card redacts BY CONSTRUCTION — an app-phase message naming a vendor still cannot leak', () => {
    const d = new BuildDiagnostics({ buildId: 'b' });
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: 'src/api.ts imports claude-sonnet-4-6 SDK that does not exist', autoResolved: false });
    d.finish(false, 'broken');
    const health = buildHealthFromDiagnostics(d.report(), false);
    expect(health.ready).toBe(false);
    expect(health.blockers).toHaveLength(1);
    expect(hasProviderLeak(health.blockers[0])).toBe(false);
  });
});

describe('🔒 the wiring — the platform proves the preview itself, and the bench is recorded', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('the platform-driven preview attempt runs BEFORE the render rescue and the verify loop', () => {
    const proof = route.indexOf("code: 'PLATFORM_PREVIEW_UP'");
    const rescue = route.indexOf("process.env.AGENTV3_RENDER_RESCUE !== 'off'");
    const verify = route.indexOf("process.env.AGENTV3_PREVIEW_VERIFY !== 'off'");
    expect(proof).toBeGreaterThan(-1);
    expect(proof).toBeLessThan(rescue);
    expect(rescue).toBeLessThan(verify);
  });

  it('a page that serves is PUBLISHED the same way the agent publishes one — the verify loop needs nothing new', () => {
    const at = route.indexOf("code: 'PLATFORM_PREVIEW_UP'");
    const block = route.slice(at - 1200, at);
    expect(block).toContain('lastPreviewUrl = url;');
    expect(block).toContain("events.emit({ type: 'preview', url, ts: Date.now() });");
    expect(block).toContain('applyPreviewDomain(rawUrl)');
  });

  it('it never publishes a dead port — the body is judged by the same analyzer the health route uses', () => {
    const at = route.indexOf("code: 'PLATFORM_PREVIEW_UP'");
    const block = route.slice(at - 1600, at);
    expect(block).toContain('analyzePreviewHtml(probeBody)');
    expect(block).toContain("!pageVerdict.serverDown");
  });

  it('when the platform does not try, the report says WHY', () => {
    expect(route).toContain("code: 'PLATFORM_PREVIEW_SKIPPED'");
    expect(route).toContain("code: 'PLATFORM_PREVIEW_NOT_UP'");
  });

  it('both build-turn runners record a benched provider family', () => {
    // Three since 2026-09-25 (autopsy Study-Racer): the heal runners report a bench too, now that the
    // bench is one registry per build rather than a memory private to each runner.
    expect(route.match(/onProviderBenched: recordProviderBenched,/g) ?? []).toHaveLength(3);
    expect(route).toContain("code: 'PROVIDER_BENCHED'");
  });

  it('the release gate and the health card count with ONE predicate', () => {
    expect(route).toContain("blockers: buildDiag.shippingIssueCount('error')");
    const diag = readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8');
    // The three-part predicate, asserted as a conjunction rather than as one literal line — the
    // original pattern pinned the exact `issues.filter(...)` formatting, so it broke the moment the
    // body changed shape even though the predicate itself was untouched.
    const body = diag.slice(diag.indexOf('shippingIssueCount(severity: IssueSeverity): number'), diag.indexOf('shippingIssueCount(severity: IssueSeverity): number') + 1600);
    expect(body).toContain('i.severity !== severity');
    expect(body).toContain('i.autoResolved');
    expect(body).toContain('isAppFinding(i)');
    const card = readFileSync('src/server/AgentV3/buildHealthCard.ts', 'utf8');
    expect(card).toContain("p.severity === 'error' && !p.autoResolved && isAppFinding(p)");
  });

  /**
   * 🔴 THE GUARD ABOVE IS NAMED FOR A COUNT AND NEVER CHECKED ONE (autopsy e706e068, 2026-09-17).
   *
   * It asserted that both surfaces use the same FILTER EXPRESSION. They did — and they still
   * disagreed, because `buildHealthCard`'s `messages()` de-duplicates by message text and
   * `shippingIssueCount` did not. The School ERP build recorded the byte-identical blocker
   * `1 unresolved import(s) — the build will fail: App.tsx -> ./components/TransportRequest` twice,
   * 189 seconds apart, and the release gate's headline read "3 build-breaking blocker(s)" over an app
   * that had two.
   *
   * So this asserts the thing the name promises: the same repeated finding is ONE finding to both.
   */
  it('…and they agree on the COUNT when the same finding is recorded twice', () => {
    const d = new BuildDiagnostics('agreement');
    const dup = 'the build will fail: App.tsx -> ./components/Missing';
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: dup, autoResolved: false, ts: 1 });
    d.record({ phase: 'tool', severity: 'warning', code: 'NOISE', message: 'something else', autoResolved: false, ts: 2 });
    d.record({ phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER', message: dup, autoResolved: false, ts: 3 });

    const gateCount = d.shippingIssueCount('error');
    const card = buildHealthFromDiagnostics(d.report(), false);
    expect(gateCount).toBe(1);
    expect(card.blockers).toHaveLength(gateCount);
  });
});
