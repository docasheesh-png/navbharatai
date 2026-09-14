/**
 * A HEAL THAT WORKED MUST NOT LEAVE A VERDICT THAT SAYS IT DID NOT (build 1ef27cd7, 2026-09-14).
 *
 * The reported build, in its own timeline, twenty seconds apart:
 *   08:04:40  READINESS_BLOCKER (error, unresolved) — "1 fake/incomplete code issue(s)"
 *   08:06:29  INCOMPLETE_CODE_HEALED — "Completed 1 unfinished/placeholder code section(s)"
 *   08:06:36  READINESS_RECOVERED_AFTER_COMPLETION — "now READY (score 92/100)"
 *   08:06:45  PROD_BUILD_OK — "ready to publish and to package"
 *   08:06:56  RELEASE_GATE: RED — 1 build-breaking blocker   ← the superseded one
 *             → OUTCOME_RELEASE_GATE_RED → ok:false
 *
 * The user was told "1 thing is still broken, so it is NOT ready to use yet" about an app the
 * platform had itself re-judged READY 92/100. This file reproduces that exact sequence end to end.
 */
import { describe, it, expect } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/** The blocker the readiness gate raises for placeholder code, exactly as the route records it. */
function withPlaceholderBlocker(): BuildDiagnostics {
  const d = new BuildDiagnostics('ws-1ef27cd7');
  d.record({
    phase: 'readiness', severity: 'error', code: 'READINESS_BLOCKER',
    message: '1 fake/incomplete code issue(s) (placeholder / not-implemented / fake data)',
    autoResolved: false,
  });
  return d;
}

describe('build 1ef27cd7 — the CapCut/Alight Motion build, replayed', () => {
  it('BEFORE the heal, the blocker is real and the gate would count it', () => {
    expect(withPlaceholderBlocker().shippingIssueCount('error')).toBe(1);
  });

  it('after the incomplete-code heal re-judges READY, the gate counts ZERO blockers', () => {
    const d = withPlaceholderBlocker();
    d.record({
      phase: 'build', severity: 'info', code: 'INCOMPLETE_CODE_HEALED',
      message: 'Completed 1 unfinished/placeholder code section(s) the first pass left behind.',
      autoResolved: true,
    });
    d.recordReadinessRecovery(
      'READINESS_RECOVERED_AFTER_COMPLETION',
      'Readiness re-judged after completing the unfinished code: now READY (score 92/100).',
    );
    // This is the number the release gate reads (blockers: shippingIssueCount('error')).
    expect(d.shippingIssueCount('error')).toBe(0);
  });

  it('the same holds for the hooks heal — the other site that was missing it', () => {
    const d = withPlaceholderBlocker();
    d.recordReadinessRecovery('READINESS_RECOVERED_AFTER_HOOKS_HEAL', 'now READY (score 90/100).');
    expect(d.shippingIssueCount('error')).toBe(0);
  });

  it('and for the dedupe heal, which was already correct — all three behave identically now', () => {
    const d = withPlaceholderBlocker();
    d.recordReadinessRecovery('READINESS_RECOVERED_AFTER_DEDUPE', 'now READY (score 95/100).');
    expect(d.shippingIssueCount('error')).toBe(0);
  });

  it('the recovery stays visible on the timeline — the finding is superseded, not erased', () => {
    const d = withPlaceholderBlocker();
    d.recordReadinessRecovery('READINESS_RECOVERED_AFTER_COMPLETION', 'now READY (score 92/100).');
    const codes = d.report().issues.map((i) => i.code);
    expect(codes).toContain('READINESS_BLOCKER');              // still readable
    expect(codes).toContain('READINESS_RECOVERED_AFTER_COMPLETION');
    const blocker = d.report().issues.find((i) => i.code === 'READINESS_BLOCKER');
    expect(blocker?.autoResolved).toBe(true);                   // ...but no longer counted
  });

  it('a build with a SECOND, genuinely unresolved blocker stays honestly not-ready', () => {
    // The whole safety property: recovery clears the re-judged question, never the report.
    const d = withPlaceholderBlocker();
    d.record({
      phase: 'build', severity: 'error', code: 'DB_UNREACHABLE',
      message: 'the database was never reachable', autoResolved: false,
    });
    d.recordReadinessRecovery('READINESS_RECOVERED_AFTER_COMPLETION', 'now READY (score 92/100).');
    expect(d.shippingIssueCount('error')).toBe(1);
  });

  it('two heals in one build do not double-count — clearing is idempotent', () => {
    const d = withPlaceholderBlocker();
    expect(d.recordReadinessRecovery('READINESS_RECOVERED_AFTER_HOOKS_HEAL', 'ready')).toBe(1);
    expect(d.recordReadinessRecovery('READINESS_RECOVERED_AFTER_COMPLETION', 'ready')).toBe(0);
    expect(d.shippingIssueCount('error')).toBe(0);
  });
});

import { fastLaneCallIdentity } from '../src/server/routes/agentv3';

/**
 * THE REPORT MUST NOT NAME A PROVIDER THAT WAS NEVER CONTACTED (build 1ef27cd7, 2026-09-14).
 *
 * That build's FIRST model call is recorded as a failed `anthropic / claude-sonnet-4-6` — on a FREE,
 * weak-tier build whose own billing block says `noClaude: true`, where `enforceNoClaude` had stripped
 * Claude out of the chain entirely. Claude was never called. `usedProvider` is INITIALISED to 'CLAUDE'
 * and the budget refusal is thrown at the top of the runner, before any provider reports in — so the
 * failure path recorded a default as if it were an observation.
 */
describe('fastLaneCallIdentity — a default is not an observation', () => {
  const SONNET = 'claude-sonnet-4-6';

  it('THE BUG: nobody reported, so the call is unknown — never Claude', () => {
    expect(fastLaneCallIdentity(false, 'CLAUDE', SONNET)).toEqual({ provider: 'unknown', model: 'unknown' });
  });

  it('...and that holds whatever the variable happened to be initialised to', () => {
    expect(fastLaneCallIdentity(false, 'KIMI', SONNET).provider).toBe('unknown');
    expect(fastLaneCallIdentity(false, undefined, SONNET).provider).toBe('unknown');
    expect(fastLaneCallIdentity(false, '', SONNET).model).toBe('unknown');
  });

  it('a real Claude delivery is still reported as Claude, with the Claude-tier model', () => {
    expect(fastLaneCallIdentity(true, 'CLAUDE', SONNET)).toEqual({ provider: 'anthropic', model: SONNET });
    expect(fastLaneCallIdentity(true, 'CLAUDE_HAIKU', SONNET).provider).toBe('anthropic');
  });

  it('a cheap-floor delivery reports its OWN model, not the requested Claude-tier one', () => {
    // fbModel is the "requested" model that GLM/Kimi ignore — recording it for them was the older bug.
    expect(fastLaneCallIdentity(true, 'KIMI', SONNET)).toEqual({ provider: 'kimi', model: 'kimi' });
    expect(fastLaneCallIdentity(true, 'GLM', SONNET)).toEqual({ provider: 'glm', model: 'glm' });
    expect(fastLaneCallIdentity(true, 'VERTEX', SONNET).provider).toBe('google');
  });

  it('both record paths use it, so a failed call cannot be labelled differently from a served one', async () => {
    const src = await import('node:fs/promises').then((fs) => fs.readFile('src/server/routes/agentv3.ts', 'utf8'));
    const lane = src.slice(src.indexOf('const fastGenerateOnce ='), src.indexOf('const fastGenerate ='));
    expect((lane.match(/fastLaneCallIdentity\(/g) ?? []).length).toBe(2); // the catch and the success path
    // The unconditional Claude-tier label on the failure path is gone.
    expect(lane).not.toMatch(/recordLlmCall\(\{\s*model: fbModel,/);
    // And the callback that proves a provider spoke is actually wired.
    expect(lane).toContain('providerReported = true');
  });
});
