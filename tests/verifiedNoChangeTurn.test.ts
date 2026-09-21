// A WORKING APP WAS REPORTED AS A FAILED BUILD — autopsy 697b38ee, 2026-09-14.
//
// Prompt: "Continue from where you left off and finish/fix the build so the app works end-to-end."
// A 21-file TradingView-style app already sat in the workspace. What the engine actually did:
//
//     +64.5s   tsc --noEmit                      exit 0
//     +83.8s   npm run build                     exit 0
//     +113.2s  dev server up · preview published · opened in a real browser · it rendered
//     +371.7s  EMPTY_BUILD_RETRY — the WHOLE build re-ran on a second model
//     +636.9s  npx playwright test               exit 0   ✅ the project's own suite PASSED
//     +769.6s  PROD_BUILD_OK · GREEN_GUARD_SAVE · release gate "It runs and renders"
//     +785.9s  → "The build produced no files. Please try again — you have not been charged."
//              → "NavBharatAI's engine is running slowly right now and your build could not finish."
//
// Every clause of those last two sentences is false, and the run took 13.1 minutes to reach them when
// it was finished at 6.2. Three separate defects, each locked below.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { userAskedForAnAppToBeBuilt, classifyIntent } from '../src/server/AgentV3/IntentClassifier';
import { shouldRetryEmptyBuild, verifiedNoChangeSummary, emptyBuildFailureSummary } from '../src/server/routes/agentv3';

const REPORTED = 'Continue from where you left off and finish/fix the build so the app works end-to-end.';

describe('🔴 the guard written for THIS EXACT SENTENCE finally fires on it', () => {
  // `shouldRetryEmptyBuild`'s own doc comment quotes this prompt verbatim as the Shiv Medical Store
  // case that must never be retried (narrowed 2026-08-10, after a 15.6-minute ₹567 build was doubled).
  // Six days later a widening for build 5b4f9b63 added `userAskedToBuildAnApp`, which was
  // `intent === 'new_build'` — and the keyword ladder matches the NOUN "build" in "fix the build".
  // Both guards were tested against each other's FLAG and neither against the SENTENCE, so both
  // suites stayed green while production re-ran the build.
  it('THE EXACT PROMPT is not a request to build an app', () => {
    expect(userAskedForAnAppToBeBuilt(REPORTED)).toBe(false);
  });

  it('and therefore the empty-build retry does NOT fire — the 6.9 wasted minutes', () => {
    const shiv = {
      expectsArtifacts: true, filesWritten: 0, isEditMode: true,
      existingProjectFiles: 21, aborted: false, withinCostCap: true,
      userAskedToBuildAnApp: userAskedForAnAppToBeBuilt(REPORTED),
    };
    expect(shouldRetryEmptyBuild(shiv)).toBe(false);
  });

  it('build 5b4f9b63 — the case the widening was written for — is untouched', () => {
    // "Build a to-do list app" typed into a workspace holding an unrelated 179-file project. No
    // continuation word anywhere in it, so it is still a build request and a zero-file outcome is
    // still a failure worth retrying. Narrowing this fix into a regression of that one is the exact
    // trade the fourth absolute rule forbids.
    const msg = 'Build a to-do list app with add, delete and mark-complete';
    expect(userAskedForAnAppToBeBuilt(msg)).toBe(true);
    expect(shouldRetryEmptyBuild({
      expectsArtifacts: true, filesWritten: 0, isEditMode: true, existingProjectFiles: 179,
      aborted: false, withinCostCap: true, userAskedToBuildAnApp: true,
    })).toBe(true);
  });

  it.each([
    'please continue', 'do it again', 'finish it', 'retry', 'poora karo', 'dobara karo',
    'aage badho', 'fix the build', 'the install failed', 'preview nahi chala',
  ])('a continuation or a problem report is never a build request: %s', (m) => {
    expect(userAskedForAnAppToBeBuilt(m)).toBe(false);
  });

  it.each([
    'build a notes app', 'ek billing app banao', 'create a portfolio site', 'make me a shop app',
    'generate a dashboard', 'design karo ek landing page', 'clone this landing page https://stripe.com',
  ])('a real order still is: %s', (m) => {
    expect(userAskedForAnAppToBeBuilt(m)).toBe(true);
  });

  it('⚠️ ROUTING IS NOT TOUCHED — the turn still runs as a build/edit exactly as before', () => {
    // The blast radius is one question ("may zero files be called a failure?"), never which lane runs.
    // The real build routed correctly and said so: "✏️ Editing your existing app (21 source files)".
    for (const m of [REPORTED, 'fix the build', 'build a notes app', 'please continue']) {
      expect(classifyIntent(m)).toBe(classifyIntent(m)); // stable
    }
    expect(classifyIntent(REPORTED)).toBe('new_build');   // unchanged from before this fix
    expect(classifyIntent('please continue')).toBe('edit_existing');
  });
});

describe('🔴 a turn that CHECKED, and found the app fine, is a success', () => {
  const proven = {
    expectsArtifacts: true, filesWritten: 0, sandboxUnavailable: false,
    isEditMode: true, existingProjectFiles: 21, userAskedToBuildAnApp: false, appRendered: true,
  };

  it('THE REAL BUILD: says nothing needed changing, instead of "the build produced no files"', () => {
    const s = verifiedNoChangeSummary(proven);
    expect(s).toBeTruthy();
    expect(s).toContain('Nothing needed changing');
    expect(s).toContain('watched it render');
    expect(s).not.toMatch(/could not finish|try again|produced no files|add credits/i);
  });

  it('🔒 NO PROOF, NO PASS — a turn that wrote nothing and proved nothing is still a failure', () => {
    expect(verifiedNoChangeSummary({ ...proven, appRendered: false })).toBeNull();
    // …and the honest failure summary is what stands in that case.
    expect(emptyBuildFailureSummary(true, 0, false)).toContain('produced no files');
  });

  it.each([
    ['a NEW build that produced nothing', { userAskedToBuildAnApp: true }],
    ['an edit on an EMPTY workspace — there was no app to be fine', { existingProjectFiles: 0 }],
    ['a turn that was not an edit at all', { isEditMode: false }],
    ['a dead sandbox, which could not have verified anything either', { sandboxUnavailable: true }],
    ['a turn that DID write files — the ordinary path, judged as always', { filesWritten: 3 }],
    ['a turn that never expected artifacts (import/survey)', { expectsArtifacts: false }],
  ])('is NOT a verified-no-change success: %s', (_label, patch) => {
    expect(verifiedNoChangeSummary({ ...proven, ...patch })).toBeNull();
  });
});

describe('the wiring — the report\'s three false sentences cannot be produced together again', () => {
  const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('the retry flag is the purpose-built predicate, not the routing verdict', () => {
    expect(src).toContain('const userAskedToBuildAnApp = userAskedForAnAppToBeBuilt(prompt);');
    expect(src).not.toContain("const userAskedToBuildAnApp = intent === 'new_build';");
  });

  it('the verified-no-change check runs BEFORE the empty-build failure it must pre-empt', () => {
    const verifiedAt = src.indexOf('const verifiedNoChange = verifiedNoChangeSummary({');
    const emptyAt = src.indexOf('const emptyFail = emptyBuildFailureSummary(');
    expect(verifiedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(verifiedAt);
  });

  it('it is fed the real browser evidence, not an assumption', () => {
    // ⚠️ SUPERSEDED 2026-09-21 — STRICTLY MORE evidence, not less. `previewVerifiedRendered` is one
    // pass's local flag; `renderProvenNow()` returns it FIRST and then falls back to the evidence
    // ledger, so every actor that proved a real-browser render answers too. That matters most
    // exactly here: this argument IS autopsy 697b38ee's fix, and an app proven green only by
    // `inBuildGreen` used to fall through it to *"The build produced no files"* — the sentence it
    // exists to prevent. See `oneLedgerEveryVerdictReadsFrom.test.ts`.
    expect(src).toContain('appRendered: renderProvenNow(),');
    expect(src).not.toContain('appRendered: previewVerifiedRendered,');
  });

  it('🔒 a successful turn can never be handed a failure message underneath it', () => {
    // The report carried BOTH "your app is fine" evidence and "your build could not finish" narration.
    expect(src).toContain('if (freeTierBuildActive && !result.ok) {');
  });

  it('and the admin ledger stops calling a successful turn an empty build', () => {
    // ⚠️ RE-ANCHORED 2026-09-18 (autopsy e9b25b08). The sentence moved into `zeroBillReason.ts`,
    // because a build the USER STOPPED was a THIRD state this route's two-branch ternary could not
    // hold and was therefore recorded as an "empty build". The guard is unchanged in substance: the
    // route must still ask the question, and the module must still distinguish a successful turn from
    // an empty one. Both halves are asserted, so neither can be dropped silently.
    expect(src).toContain('zeroBillReasonFor({');
    expect(src).toContain('ok: result.ok,');
    const owner = readFileSync(join(process.cwd(), 'src/server/AgentV3/zeroBillReason.ts'), 'utf8');
    expect(owner).toContain("'verified-no-change turn (nothing needed changing) — not charged'");
  });

  it('the outcome is recorded, so the admin can count how often this turn shape happens', () => {
    expect(src).toContain("code: 'VERIFIED_NO_CHANGE'");
  });
});
