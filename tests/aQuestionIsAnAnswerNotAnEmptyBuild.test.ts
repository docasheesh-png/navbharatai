/**
 * 🙋 A QUESTION IS AN ANSWER, NOT AN EMPTY BUILD (autopsy e628efd4, 2026-09-25).
 *
 * The user asked, in a question: *"if we don't have a chat in next 2 hours can you send a message to
 * initiate the chat again"*. The first model answered it correctly in 7 seconds — it cannot message
 * anyone on its own, and *"would you like me to build a small messaging app with a 'remind me to chat
 * again' feature?"* Zero tool calls, `finish_reason: end_turn`.
 *
 * `decideBuildNudge` saw that, recognised it, and stood down — `BUILD_NUDGE_STOOD_DOWN`, detail
 * `asked-the-user`. **156 milliseconds later `shouldRetryEmptyBuild` read the same turn, counted
 * `filesWritten === 0`, and retried the whole build one rung higher.** Nine minutes, 53 model calls,
 * a six-feature chat app nobody asked for, and **₹196.28 charged to a free-tier account**.
 *
 * 🔑 THE CLASS, and `nudgeToBuild.ts` had already named it in its own docblock: *"`toolUses.length
 * === 0` is not evidence of a stall… ask what the turn WAS, not merely count what it did."*
 * `filesWritten === 0` is the identical mistake with a different counter. Half the guard had already
 * been carried across — `modelRefused` IS `turnDeclined`, the same `looksLikeRefusal` — and the other
 * half was left behind. The instance was fixed in one of the two places that carry it; the sibling
 * was never hunted. This repo's headline class.
 *
 * 🔒 WHY BOTH HALVES SHIP TOGETHER. Suppressing the retry alone would have replaced a good answer
 * with a false one: zero files reach `emptyBuildFailureSummary`, which would say *"The build produced
 * no files. Please try again"* over the question the model had just asked. Fixing problem A while
 * creating problem X is the thing the admin's own standing rule forbids.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { shouldRetryEmptyBuild, emptyBuildFailureSummary } from '../src/server/routes/agentv3';
import { turnAskedTheUser, decideBuildNudge } from '../src/server/AgentV3/nudgeToBuild';
import { looksLikeRefusal } from '../src/server/lib/promptSafety';

/** The real first-attempt answer from that build, verbatim from the report's `responsePreview`. */
const THE_ANSWER = [
  'I can’t send you a message on my own after 2 hours — I can only reply when you message me first. '
  + 'So I don’t have a way to proactively ping you later.',
  '',
  'What I *can* do is help you set up a reminder so you remember to come back:',
  '',
  '- **On your phone**: set a timer or reminder for 2 hours from now.',
  '- **In an app**: I can build you a simple chat or reminder app that sends you a browser notification after 2 hours.',
  '',
  'Since you mentioned chat/messaging earlier, would you like me to build a small messaging app with a '
  + '“remind me to chat again” feature?',
].join('\n');

const EMPTY_TURN = {
  expectsArtifacts: true,
  filesWritten: 0,
  isEditMode: false,
  existingProjectFiles: 0,
  aborted: false,
  withinCostCap: true,
} as const;

describe('🔴 the real turn: the two guards read the same answer and must now agree', () => {
  it('the nudge stood down on it — `asked-the-user`, exactly as the report records', () => {
    const d = decideBuildNudge({
      text: THE_ANSWER, expectsArtifacts: true, totalToolUses: 0,
      nudgesUsed: 0, maxNudges: 2, editingExistingApp: false,
    });
    expect(d.nudge).toBe(false);
    expect(d.standDown).toBe('asked-the-user');
  });

  it('🔑 it is NOT a refusal — which is exactly why the half-carried guard let it through', () => {
    // `looksLikeRefusal` needs "I can't" followed by build/make/create/help…; this says "send".
    // The guard was right to stay silent; the missing guard is the one that had to speak.
    expect(looksLikeRefusal(THE_ANSWER)).toBe(false);
    expect(turnAskedTheUser(THE_ANSWER)).toBe(true);
  });

  it('🔴 THE ₹196 BUILD: it is no longer retried on a higher rung', () => {
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN, modelAskedTheUser: true })).toBe(false);
  });

  it('🔴 …and its answer is no longer replaced with "the build produced no files"', () => {
    expect(emptyBuildFailureSummary(true, 0, false, false, true)).toBeNull();
  });

  it('BOTH HALVES, or the fix trades one problem for another', () => {
    // Retry suppressed but the summary still flipped = the user loses a good answer (697b38ee).
    const retried = shouldRetryEmptyBuild({ ...EMPTY_TURN, modelAskedTheUser: true });
    const summary = emptyBuildFailureSummary(true, 0, false, false, true);
    expect([retried, summary]).toEqual([false, null]);
  });
});

describe('🔒 nothing else moved — every other reason to retry is untouched', () => {
  it('an ordinary empty build still retries', () => {
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN })).toBe(true);
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN, modelAskedTheUser: false })).toBe(true);
  });

  it('a refusal is still final, and still by its own guard', () => {
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN, modelRefused: true })).toBe(false);
  });

  it('an edit that legitimately changed nothing still does not retry', () => {
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN, isEditMode: true, existingProjectFiles: 25 })).toBe(false);
  });

  it('a build order reclassified as an edit still retries', () => {
    expect(shouldRetryEmptyBuild({
      ...EMPTY_TURN, isEditMode: true, existingProjectFiles: 25, userAskedToBuildAnApp: true,
    })).toBe(true);
  });

  it('a stopped build, a cost-capped build and a chat turn are unchanged', () => {
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN, aborted: true, modelAskedTheUser: true })).toBe(false);
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN, withinCostCap: false })).toBe(false);
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN, expectsArtifacts: false })).toBe(false);
  });

  it('a turn that DID write files never reaches either guard', () => {
    expect(shouldRetryEmptyBuild({ ...EMPTY_TURN, filesWritten: 3, modelAskedTheUser: true })).toBe(false);
    expect(emptyBuildFailureSummary(true, 3, false, false, true)).toBeNull();
  });
});

describe('🔒 the failure sentence still fires everywhere it should', () => {
  it('a genuine empty build is still an honest failure', () => {
    expect(emptyBuildFailureSummary(true, 0, false, false, false)).toContain('produced no files');
  });

  it('🔴 A DEAD SANDBOX STILL WINS — infrastructure outranks the answer', () => {
    // Ordering claim, not decoration: a sandbox that could not be set up never ran anything, so it
    // must be reported even if the model also happened to end on a question.
    expect(emptyBuildFailureSummary(true, 0, true, false, true)).toContain('sandbox was unavailable');
  });

  it('a rendering app is still not an empty build', () => {
    expect(emptyBuildFailureSummary(true, 0, false, true, false)).toBeNull();
  });

  it('a chat turn still makes no claim', () => {
    expect(emptyBuildFailureSummary(false, 0, false, false, false)).toBeNull();
  });
});

describe('🔒 REVERSION GUARDS — tsc and vitest cannot see an argument that stopped being passed', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  // ⚠️ WIDENED, NOT WEAKENED (2026-09-26). These pinned `turnAskedTheUser(result.summary)` at each
  // reader. The retry keeps reading the FIRST attempt's answer; every later reader now reads ONE
  // capture of the model's final answer (`modelAnswer`, see `turnAnswer.ts`), because the platform
  // rewrites `result.summary` between the readers. What these guards exist to prove — each reader is
  // really given the fact — is asserted below against the new spelling.
  it('the retry decision is really given the fact', () => {
    expect(route).toContain('const firstAttempt = readTurnAnswer(result.summary);');
    expect(route).toContain('const firstAttemptAskedTheUser = firstAttempt.asked;');
    expect(route).toContain('modelAskedTheUser: firstAttemptAskedTheUser');
  });

  it('the settle flip is really given the fact — both halves of it', () => {
    expect(route).toMatch(/emptyBuildFailureSummary\([\s\S]{0,900}?modelAnswer\.asked,\s*modelAnswer\.declined,\s*\)/);
  });

  it('🔑 the predicate is IMPORTED, never re-implemented beside its sibling', () => {
    // A second copy of "does this end on a question mark?" is how the two guards drift back apart.
    // The route reaches it only through `readTurnAnswer`, which imports it from `nudgeToBuild`.
    expect(route).toContain("import { readTurnAnswer, answeredWithoutBuilding } from '../AgentV3/turnAnswer'");
    const reader = fs.readFileSync(path.join(process.cwd(), 'src/server/AgentV3/turnAnswer.ts'), 'utf8');
    expect(reader).toContain("import { turnAskedTheUser } from './nudgeToBuild'");
    expect(route).not.toMatch(/const\s+\w*[Aa]skedTheUser\s*=\s*\/.*\?/);
  });

  it('the decision is VISIBLE in the admin report, and counts against nothing', () => {
    expect(route).toContain("code: 'TURN_ANSWERED_A_QUESTION'");
    const diag = fs.readFileSync(path.join(process.cwd(), 'src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    const sugg = fs.readFileSync(path.join(process.cwd(), 'src/server/AgentV3/buildFindingSuggestions.ts'), 'utf8');
    expect(diag).toContain("'TURN_ANSWERED_A_QUESTION'");
    expect(sugg).toContain("'TURN_ANSWERED_A_QUESTION'");
  });
});
