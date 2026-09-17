/**
 * A RUN-PROVEN APP IS NEVER FLIPPED TO "NOT BUILT" BY A VERDICT THAT ONLY READ THE CODE.
 *
 * Autopsy e706e068 (School ERP, 2026-09-17), in the report's own timestamps:
 *   10:41:36  RENDER_RESCUE   — the live preview renders cleanly (real-browser verified)
 *   10:42:47  PROD_BUILD_OK   — the production build succeeded
 *   10:44:08  RELEASE_GATE: RED — 3 build-breaking blocker(s)  →  OUTCOME_RELEASE_GATE_RED
 *   10:44:23  user: "3 things are still broken … You have NOT been charged"   ← beside a working app
 *
 * The admin's standing rule (4efab9d7): "app bani = preview chala — ₹0 charge nahi karna hai."
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runProvenApp, verdictHeldMessage, type RunEvidence } from '../src/server/AgentV3/runProvenApp';
import { isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';

/** e706e068 at 10:44:08 — exactly what the route knew when the gate went RED. */
const SCHOOL_ERP: RunEvidence = {
  browserRendered: true,
  prodBuild: 'ok',
  previewFailed: false,
  pagesFailed: false,
  journeyFailed: false,
  runtimeCrashBlocker: false,
  deliveryRefused: false,
  stopped: false,
};

describe('the School ERP build, replayed', () => {
  it('is proven to run — a real browser rendered it and its production build succeeded', () => {
    const p = runProvenApp(SCHOOL_ERP);
    expect(p.proven).toBe(true);
    expect(p.reason).toMatch(/real browser rendered it/);
    expect(p.reason).toMatch(/production build succeeded/);
  });

  it('the held-verdict line names both sides and says the findings stay listed and the app is charged', () => {
    const m = verdictHeldMessage('release-gate-red', runProvenApp(SCHOOL_ERP), 3);
    expect(m).toMatch(/kept at OK/);
    expect(m).toMatch(/release gate was RED on static findings \(3 finding\(s\)\)/);
    expect(m).toMatch(/stay listed as things to fix/);
    expect(m).toMatch(/built, working, and charged/);
  });

  it('VERDICT_HELD_BY_RUN is a statement about our verdict, never a finding against the app', () => {
    expect(isAppFinding({ phase: 'readiness', code: 'VERDICT_HELD_BY_RUN' })).toBe(false);
  });
});

describe('what counts as proof — the admin\'s rule, and nothing looser', () => {
  it('a render alone is proof when the production build never ran (no build script, no time)', () => {
    const p = runProvenApp({ ...SCHOOL_ERP, prodBuild: 'not-run' });
    expect(p.proven).toBe(true);
    expect(p.reason).not.toMatch(/production build/);
  });

  it('without a REAL browser render there is no proof — a curl shell or no render at all', () => {
    expect(runProvenApp({ ...SCHOOL_ERP, browserRendered: false }).proven).toBe(false);
    expect(runProvenApp({ ...SCHOOL_ERP, browserRendered: false }).reason).toMatch(/no real-browser render/);
  });
});

describe('the vetoes — every one of them is RUNTIME evidence the app is broken, or not the user\'s app', () => {
  const vetoes: Array<[keyof RunEvidence, RunEvidence[keyof RunEvidence], RegExp]> = [
    ['prodBuild', 'failed', /production build RAN and failed/],
    ['previewFailed', true, /preview check found it broken/],
    ['pagesFailed', true, /page route failed to render/],
    ['journeyFailed', true, /user journey failed/],
    ['runtimeCrashBlocker', true, /runtime-crash defect/],
    ['deliveryRefused', true, /refusal/],
    ['stopped', true, /stopped/],
  ];
  for (const [key, value, why] of vetoes) {
    it(`${key} = ${String(value)} withholds the proof and says why`, () => {
      const p = runProvenApp({ ...SCHOOL_ERP, [key]: value });
      expect(p.proven).toBe(false);
      expect(p.reason).toMatch(why);
    });
  }

  it('the dukaan case (2026-08-12) is still flipped: modules missing, page routes failing — a RED with runtime evidence', () => {
    // The block this hold sits in was written for that build; a hold that reached it would re-open it.
    expect(runProvenApp({ ...SCHOOL_ERP, pagesFailed: true }).proven).toBe(false);
  });

  it('a missing or malformed field reads as NOT proven — a caller that forgets a flag gets today\'s flip', () => {
    expect(runProvenApp(undefined).proven).toBe(false);
    expect(runProvenApp(null).proven).toBe(false);
    expect(runProvenApp({}).proven).toBe(false);
    expect(runProvenApp({ browserRendered: 'yes' as unknown as boolean }).proven).toBe(false);
  });
});

describe('the route wiring — the CODE of each late flip, comments stripped', () => {
  const raw = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('a real-browser render is the ONLY thing that sets browserRenderProven — never a curl fallback', () => {
    const sets = code.match(/browserRenderProven = true/g) ?? [];
    expect(sets.length).toBeGreaterThanOrEqual(2); // the rescue and the verify loop
    const guarded = code.match(/if \(shot\.source === 'browser'\) browserRenderProven = true/g) ?? [];
    expect(guarded.length).toBe(sets.length);
  });

  it('prodBuildOutcome is set from judgeProdBuild\'s own verdict, right where it is judged', () => {
    const at = code.indexOf('const verdict = judgeProdBuild({ ran, exitCode, output });');
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(at, at + 300)).toContain("prodBuildOutcome = verdict.code === 'PROD_BUILD_OK' ? 'ok' : verdict.code === 'PROD_BUILD_FAILED' ? 'failed' : 'not-run'");
  });

  it('all THREE late flips ask runProof() before failing the build', () => {
    // 1. the release gate's RED
    const gate = code.indexOf("if (gate.state === 'red' && gateBlockers > 0 && settled && settled.ok) {");
    expect(gate).toBeGreaterThan(-1);
    const gateBody = code.slice(gate, code.indexOf("code: 'OUTCOME_RELEASE_GATE_RED'", gate));
    expect(gateBody).toContain('const held = runProof();');
    expect(gateBody).toContain("recordVerdictHeld('release-gate-red', gateBlockers)");
    expect(gateBody.indexOf('if (held.proven) {')).toBeLessThan(gateBody.indexOf('ok: false, summary: releaseGateFailureSummary('));
    // 2. the final syntax re-verify
    // The FINAL re-verify (the second OUTCOME_SYNTAX_ERROR site — the first, the mid-build syntax
    // gate, records a blocker and flips nothing itself; the gate hold above covers it).
    const finalVerify = code.indexOf('const finalSyntaxErrors = await findSyntaxErrors(');
    expect(finalVerify).toBeGreaterThan(-1);
    const syntax = code.indexOf("code: 'OUTCOME_SYNTAX_ERROR'", finalVerify);
    expect(syntax).toBeGreaterThan(finalVerify);
    // Bounded by the block's own closing catch, never by a character count (the byte-window trap
    // PROGRESS.md records four times over on 2026-09-17).
    const syntaxBody = code.slice(syntax, code.indexOf('} catch {', syntax));
    const held = syntaxBody.indexOf("recordVerdictHeld('final-syntax-error'");
    const flip = syntaxBody.indexOf('summary: finalSyntaxErrorSummary(');
    expect(held).toBeGreaterThan(-1);
    expect(flip).toBeGreaterThan(held);
    // 3. the reviewer's unresolved criticals
    expect(code).toContain('if (result && result.ok && reviewCriticalsUnresolved.length > 0 && runProof().proven) {');
    expect(code).toContain("recordVerdictHeld('review-critical', reviewCriticalsUnresolved.length)");
  });

  it('the proof reads the LIVE gate evidence, so a runtime failure recorded after the render still vetoes', () => {
    const at = code.indexOf('const runProof = () => runProvenApp({');
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at, at + 700);
    for (const line of [
      'browserRendered: browserRenderProven',
      'prodBuild: prodBuildOutcome',
      "previewFailed: gateEvidence.preview === 'failed'",
      "pagesFailed: gateEvidence.pages === 'failed'",
      "journeyFailed: gateEvidence.journeys === 'failed'",
      'runtimeCrashBlocker: buildDiag.hasRuntimeCrashBlocker()',
      "deliveryRefused: looksLikeRefusal(result?.summary ?? '')",
      'stopped: abort.signal.aborted',
    ]) expect(body).toContain(line);
  });
});
