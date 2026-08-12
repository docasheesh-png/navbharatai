import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { releaseGateFailureSummary } from '../src/server/AgentV3/AutoFix';

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. The worst failure this engine has produced, and it
 * was not a crash: **it lied**.
 *
 * ONE report carried, at the same time:
 *     ok: true
 *     RELEASE_GATE: RED — Not shippable
 *     rootCause: 2 local modules are STILL missing — the app will crash at runtime
 *
 * …and the user was told, in their own language: *"App tayyar hai! 🎉 App live hai: <link>"*.
 * The link showed a **Closed Port Error**.
 *
 * Everything needed to know better had already been computed and written down. Nothing was allowed to
 * act on it, because the gate block was explicitly "reports on the build, must never affect it". That
 * separation is right for the gate's ADVISORY half and wrong for its EVIDENTIAL half: a gate that is
 * RED *because a build-breaking blocker was recorded* is not an opinion, it is the build's own error
 * log.
 */

const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

describe('the verdict may no longer contradict the evidence', () => {
  it('a RED gate WITH real blockers corrects ok:true to NOT ok', () => {
    expect(route).toContain("if (gate.state === 'red' && gateBlockers > 0 && settled && settled.ok)");
    expect(route).toContain('ok: false, summary: releaseGateFailureSummary(');
    expect(route).toContain("code: 'OUTCOME_RELEASE_GATE_RED'");
  });

  it('it counts blockers with the SAME function the gate itself used', () => {
    /**
     * Two different counts would let the gate say RED while the guard saw nothing to correct — the
     * exact class of disagreement this whole fix exists to end.
     */
    const at = route.indexOf("const gateBlockers = buildDiag.shippingIssueCount('error');");
    expect(at).toBeGreaterThan(-1);
    expect(route.indexOf("blockers: buildDiag.shippingIssueCount('error')")).toBeGreaterThan(-1);
  });

  it('it does NOT fire on a RED driven only by tests', () => {
    /**
     * THE GUARD-VERSUS-NUISANCE LINE. This very report's suite said: "could be a failing test OR the
     * runner failing to start; the output gave nothing to tell them apart". Failing a working app over
     * an ambiguity in OUR OWN sandbox is the #2267 mistake in the other direction — so the correction
     * requires a genuine unresolved ERROR, not merely a RED state.
     */
    const at = route.indexOf("const gateBlockers = buildDiag.shippingIssueCount('error');");
    const seg = route.slice(at, at + 400);
    expect(seg).toContain('gateBlockers > 0');
  });

  it('the correction itself can never break a build', () => {
    // It lives inside the gate's try/catch: a fault in the honesty check must not fail the build it
    // is judging.
    const at = route.indexOf("code: 'OUTCOME_RELEASE_GATE_RED'");
    expect(route.slice(at, at + 700)).toContain('catch { /* the gate reports on the build; a fault HERE must never affect it */ }');
  });

  it('flipping ok:false also makes the build FREE — the standing "working app or free" law', () => {
    // Nothing new is wired for billing: the existing guard keys on !result.ok, so telling the truth
    // and not charging for a broken app are the same action.
    const at = route.indexOf('THE VERDICT MAY NO LONGER CONTRADICT THE EVIDENCE');
    expect(route.slice(at, at + 2600)).toMatch(/working app or free/);
  });
});

describe('what the user is told instead of "App tayyar hai! 🎉"', () => {
  it('says plainly that it is NOT ready, and refuses to claim otherwise', () => {
    const s = releaseGateFailureSummary(1, 'Release gate: RED — 2 local modules are STILL missing');
    expect(s).toMatch(/NOT ready to use yet/i);
    expect(s).toMatch(/will not tell you it is working when it is not/i);
  });

  it('names WHAT is broken — "something went wrong" is what makes people leave', () => {
    const s = releaseGateFailureSummary(2, 'Release gate: RED — 2 local modules are STILL missing');
    expect(s).toContain('2 things');
    expect(s).toMatch(/The main one:/);
    expect(s).toMatch(/modules are STILL missing/);
  });

  it('takes only the FIRST line of the cause, capped — not a stack of paths a user cannot act on', () => {
    const long = `first line here${'x'.repeat(400)}\nserver/db.js (imported by server/index.ts)\nserver/auth.js`;
    const s = releaseGateFailureSummary(1, long);
    expect(s).not.toContain('server/db.js');
    expect(s).toContain('…');
    expect(s.length).toBeLessThan(600);
  });

  it('works when no cause is known, rather than printing an empty sentence', () => {
    for (const cause of [undefined, null, '', '   ']) {
      const s = releaseGateFailureSummary(1, cause as any);
      expect(s).not.toMatch(/The main one:/);
      expect(s).toMatch(/NOT ready/i);
    }
  });

  it('says the money and the next step — the two things a stuck user needs', () => {
    const s = releaseGateFailureSummary(3, null);
    expect(s).toMatch(/have NOT been charged/i);
    expect(s).toMatch(/"fix it"/);
    expect(s).toMatch(/3 things are/);
  });

  it('singular reads as English, not as a template', () => {
    expect(releaseGateFailureSummary(1, null)).toContain('1 thing is');
    expect(releaseGateFailureSummary(0, null)).toContain('1 thing is'); // never "0 things"
  });

  it('names no provider or model — white-label law', () => {
    const s = releaseGateFailureSummary(2, 'kimi-k2.5 produced a broken file');
    // The cause line is admin-derived text; the SUMMARY wording itself must add no vendor.
    expect(s).not.toMatch(/\b(glm|claude|anthropic|openai|gemini|grok|sonnet|opus)\b/i);
  });
});
