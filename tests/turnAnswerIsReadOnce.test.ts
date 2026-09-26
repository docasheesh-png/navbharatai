/**
 * THE MODEL'S ANSWER IS READ ONCE, BEFORE THE PLATFORM REWRITES IT (2026-09-26 — the `turnKind` open
 * root cause from autopsy e628efd4).
 *
 * Four verdicts in the build route ask "did the model decline, or ask the user something?". Each used
 * to read `result.summary` at its own moment — and the platform rewrites `result.summary` between
 * them. Two defects followed, both verified before this change:
 *
 *   1. A free build whose model DECLINED had its refusal replaced with "please try again", and the
 *      upsell then read THAT sentence, found no refusal, and asked the user to add credits.
 *   2. An EDIT whose model ASKED a question ("navy or sky blue?") had the question replaced with
 *      "Nothing needed changing — your app works." The request was dropped.
 *
 * Every wiring guard below was proven by reversion. `tsc` and `vitest` cannot see that a reader asks
 * its question of the wrong sentence, which is exactly how both defects shipped.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { readTurnAnswer, answeredWithoutBuilding } from '../src/server/AgentV3/turnAnswer';
import { emptyBuildFailureSummary, verifiedNoChangeSummary } from '../src/server/routes/agentv3';
import { looksLikeRefusal } from '../src/server/lib/promptSafety';

const REFUSAL = "I can't help build that — a tool to scrape and resell people's private contact data would violate their privacy.";
const QUESTION = 'I can change the header colour. Which blue would you like — navy or sky blue?';
const BUILT = 'Built your notes app with search, tags and a dark mode toggle.';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
/** Comments stripped, so a docblock that merely DESCRIBES a reader can never stand in for one. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('reading the answer', () => {
  it('a refusal is declined, a question is asked, a delivery is neither', () => {
    expect(readTurnAnswer(REFUSAL)).toEqual({ declined: true, asked: false });
    expect(readTurnAnswer(QUESTION)).toEqual({ declined: false, asked: true });
    expect(readTurnAnswer(BUILT)).toEqual({ declined: false, asked: false });
    expect(readTurnAnswer(undefined)).toEqual({ declined: false, asked: false });
  });

  it('either one is an answer given instead of a build', () => {
    expect(answeredWithoutBuilding(readTurnAnswer(REFUSAL))).toBe(true);
    expect(answeredWithoutBuilding(readTurnAnswer(QUESTION))).toBe(true);
    expect(answeredWithoutBuilding(readTurnAnswer(BUILT))).toBe(false);
  });

  it('🔴 WHY IT MUST BE READ EARLY: our own sentence contains no refusal', () => {
    // This is the whole of defect 1 in one line. The upsell asked `looksLikeRefusal` of the text the
    // empty-build flip had just written, and that text is ours, not the model's.
    const ours = emptyBuildFailureSummary(true, 0, false);
    expect(ours).toContain('produced no files');
    expect(looksLikeRefusal(REFUSAL)).toBe(true);
    expect(looksLikeRefusal(ours)).toBe(false);
  });
});

describe('the empty-build flip leaves a refusal standing', () => {
  it('a declined zero-file turn is not an empty build', () => {
    expect(emptyBuildFailureSummary(true, 0, false, false, false, true)).toBeNull();
  });

  it('…exactly as a question already was (e628efd4)', () => {
    expect(emptyBuildFailureSummary(true, 0, false, false, true, false)).toBeNull();
  });

  it('a turn that neither answered nor built is still an honest failure', () => {
    expect(emptyBuildFailureSummary(true, 0, false, false, false, false)).toContain('produced no files');
  });

  it('a dead sandbox still wins — it is an infrastructure fact, whatever the model said', () => {
    expect(emptyBuildFailureSummary(true, 0, true, false, false, true)).toContain('sandbox was unavailable');
  });
});

describe('the verified-no-change sentence never answers for the user', () => {
  const proven = {
    expectsArtifacts: true, filesWritten: 0, sandboxUnavailable: false, isEditMode: true,
    existingProjectFiles: 12, userAskedToBuildAnApp: false, appRendered: true,
  };

  it('without an answer from the model, a verified edit still gets its sentence', () => {
    expect(verifiedNoChangeSummary(proven)).toContain('Nothing needed changing');
  });

  it('🔴 a question the model asked is NOT replaced with "nothing needed changing"', () => {
    expect(verifiedNoChangeSummary({ ...proven, modelAnsweredTheUser: true })).toBeNull();
  });

  it('…and neither is a refusal', () => {
    expect(verifiedNoChangeSummary({
      ...proven, modelAnsweredTheUser: answeredWithoutBuilding(readTurnAnswer(REFUSAL)),
    })).toBeNull();
  });
});

describe('🔒 WIRING — one reading, taken before the platform writes a word', () => {
  const route = code('src/server/routes/agentv3.ts');

  it('the reading is taken exactly once', () => {
    expect(route.match(/const modelAnswer = readTurnAnswer\(result\.summary\);/g) ?? []).toHaveLength(1);
  });

  it('it is taken AFTER the last model run and BEFORE the platform rewrites the summary', () => {
    const retry = route.indexOf('result = retry;');
    const capture = route.indexOf('const modelAnswer = readTurnAnswer(result.summary);');
    const verified = route.indexOf('result = { ...result, summary: verifiedNoChange };');
    const flip = route.indexOf('result = { ...result, ok: false, summary: emptyFail };');
    const proof = route.indexOf('const runProof = () => runProvenApp({');
    const upsell = route.indexOf('const refused = !stopped && modelAnswer.declined;');
    for (const at of [retry, capture, verified, flip, proof, upsell]) expect(at).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(retry);
    expect(capture).toBeLessThan(proof);
    expect(capture).toBeLessThan(verified);
    expect(capture).toBeLessThan(flip);
    expect(capture).toBeLessThan(upsell);
  });

  it('no reader asks either question of result.summary directly any more', () => {
    // The retry reads the FIRST attempt through the same reader; nothing calls the predicates raw.
    expect(route).not.toMatch(/looksLikeRefusal\(/);
    expect(route).not.toMatch(/turnAskedTheUser\(/);
  });

  it('every reader is given the captured reading', () => {
    expect(route).toContain('deliveryRefused: modelAnswer.declined,');
    expect(route).toContain('modelAnsweredTheUser: answeredWithoutBuilding(modelAnswer),');
    expect(route).toMatch(/modelAnswer\.asked,\s*modelAnswer\.declined,\s*\)/);
    expect(route).toContain('const refused = !stopped && modelAnswer.declined;');
  });

  it('the question note is recorded only where its own sentence is true — a zero-file turn', () => {
    expect(route).toContain('if (firstAttemptAskedTheUser && expectsArtifacts && writtenFiles.size === 0) {');
  });

  it('a refusal left standing is visible in the admin report, and counts against nothing', () => {
    expect(route).toContain("code: 'TURN_DECLINED'");
    expect(read('src/server/AgentV3/BuildDiagnostics.ts')).toContain("'TURN_DECLINED'");
    expect(read('src/server/AgentV3/buildFindingSuggestions.ts')).toContain("'TURN_DECLINED'");
  });
});
