/**
 * THE BUNDLE EXISTED, AND THE RUN SAID NOTHING.
 *
 * 🔴 Run #127 (2026-09-22) is the incident this file exists for. It ticked `upload_to_play` for the
 * first time, and the job's own step list reads:
 *
 *     11 success  Build the SIGNED release bundle (.aab) + universal APK
 *     13 success  Upload the .aab artifact          ← 15,174,130 bytes, kept 14 days
 *     14 success  Upload the .apk artifact
 *     15 failure  Upload to Google Play (internal track)
 *     16 SKIPPED  Summary
 *
 * The bundle was built, signed and downloadable the whole time. But the run went **red**, and the
 * one step that says *what was produced and where to find it* was skipped — because it had no
 * `if: always()` and the step before it had failed. The admin read the red run and reported, in
 * their own words, **"aab bana hi nahi"**. They were reasoning correctly from everything the run
 * showed them.
 *
 * ## Two defects, one class
 *
 * 1. **A report that disappears exactly when it is needed.** A summary that only survives a clean
 *    run is a summary for the case nobody needs explaining. The failing case is the one where
 *    somebody has to be told what to do next.
 *
 * 2. **An intention printed as a fact.** The old summary chose its wording from the INPUT
 *    (`inputs.upload_to_play == 'true'`), not from what the upload actually did — so on a run like
 *    #127 it would have announced *"🚀 Uploaded to Google Play"* about an edit Google had already
 *    rolled back. That is the same class this repo has paid for repeatedly: `RELEASE_GATE` reporting
 *    a typecheck that never ran, `CLAIM_UNSUPPORTED`, the journey check recording `JOURNEY_PASSED`
 *    for a browser that never launched. **A verdict must be read back from the thing it describes.**
 *
 * ## Why a test rather than a careful commit
 *
 * Neither defect is visible to anything else in this repo. `tsc` and `vitest` do not read YAML; the
 * workflow only runs on a manual dispatch, so CI never exercises it; and a summary that is skipped
 * produces no output to be wrong — it produces nothing at all. The failure mode of BOTH defects is
 * silence, which is precisely why they survived a year of green runs.
 *
 * The outcome-reading assertions are DERIVED, not hardcoded prose matching: the summary reads
 * `steps.<id>.outcome`, and this file checks that each id it reads is really declared on the step it
 * names. A renamed step id would otherwise leave `steps.foo.outcome` expanding to an empty string —
 * the summary would silently take its fallback branch and report a failure on every successful
 * upload, with nothing failing anywhere.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const workflow = readFileSync(resolve(root, '.github/workflows/android-aab.yml'), 'utf8');

/** The `- name: X` step block, up to the next step at the same indentation. */
function step(name: string): string {
  const head = `      - name: ${name}\n`;
    const at = workflow.indexOf(head);
  expect(at, `step "${name}" not found in android-aab.yml`).toBeGreaterThan(-1);
  const rest = workflow.slice(at + head.length);
  const next = rest.indexOf('\n      - name: ');
  return next === -1 ? rest : rest.slice(0, next);
}

/** The `id:` declared on a step, if any. */
function stepId(name: string): string | null {
  const m = /^\s{8}id:\s*(\S+)\s*$/m.exec(step(name));
  return m ? m[1] : null;
}

const SUMMARY = step('Summary');
const UPLOAD = 'Upload to Google Play (internal track)';
const BUNDLE = 'Build the SIGNED release bundle (.aab) + universal APK';

describe('the summary survives the failure it exists to explain', () => {
  it('runs even when a step before it failed', () => {
    // THE FIX. Without this line the summary is skipped on exactly the runs where the admin most
    // needs to be told the artifact is there — which is how run #127 read as "nothing was built".
    expect(SUMMARY).toMatch(/^\s{8}if:\s*always\(\)\s*$/m);
  });

  it('leads with the artifact, and says so in words that survive a red run', () => {
    // A red run is the case being explained, so the summary must state the artifact exists DESPITE
    // the red — not merely name it and leave the reader to infer.
    expect(SUMMARY).toContain('navbharatai-release-aab');
    expect(SUMMARY.toLowerCase()).toContain('even if this run is marked red');
  });

  it('does not claim a bundle when the bundle step did not succeed', () => {
    // `always()` cuts both ways: it also runs after a FAILED build, where "built ✅" would be the
    // same lie in the other direction. The honest branch must come first and stop.
    const built = SUMMARY.indexOf('signed .aab built');
    const notBuilt = SUMMARY.indexOf('was NOT built');
    expect(notBuilt).toBeGreaterThan(-1);
    expect(notBuilt).toBeLessThan(built);
    expect(SUMMARY).toMatch(/steps\.bundle\.outcome.*!=.*success|!=.*"success"/s);
  });
});

describe('every verdict is read back from what actually happened', () => {
  it('reports the upload from its OUTCOME, never from the input that requested it', () => {
    // The defect: `if [ "${{ inputs.upload_to_play }}" = "true" ]` → "🚀 Uploaded to Google Play".
    // That is an intention, and run #127 is the run where it would have been false.
    const claim = /Uploaded to Google Play/;
    expect(SUMMARY).toMatch(claim);

    // ⚠️ Asserting that `steps.play_upload.outcome` appears SOMEWHERE in the summary is not enough,
    // and proving that was worth the minute it took: reverting the branch to read the input still
    // left the string present in the failure message's own text, so a "presence" assertion passed
    // over the exact defect it was written for. **The scrutinee is what decides**, so that is what
    // is asserted — the same distinction this whole file is about, turned on the test itself.
    const scrutinee = /case\s+"\$\{\{\s*([^}]+?)\s*\}\}"\s+in/.exec(SUMMARY);
    expect(scrutinee, 'the summary must branch on the upload outcome in a case statement').toBeTruthy();
    expect(scrutinee![1]).toBe('steps.play_upload.outcome');
    expect(SUMMARY).not.toMatch(/inputs\.upload_to_play.*=.*"true"/);
  });

  it('distinguishes the three real outcomes — uploaded, not asked for, and failed', () => {
    expect(SUMMARY).toMatch(/\bsuccess\)/);   // it really went to Play
    expect(SUMMARY).toMatch(/\bskipped\)/);   // the box was not ticked
    expect(SUMMARY).toMatch(/upload to Google Play FAILED/i);
  });

  it('tells the admin what to do by hand when the upload failed', () => {
    // The whole cost of run #127 was that nobody was told the bundle was sitting there, ready.
    const failed = SUMMARY.slice(SUMMARY.indexOf('FAILED'));
    expect(failed).toMatch(/Internal testing/);
    expect(failed).toMatch(/Nothing reached Play/i);
  });
});

describe('the ids the summary reads are really declared', () => {
  // A `steps.<id>.outcome` naming an id that no step declares expands to the EMPTY STRING. The
  // `case` would then take its fallback branch and announce a failed upload on every successful
  // one — a wrong report, produced by a rename, with nothing anywhere failing.
  it('the upload step declares the id the summary reads', () => {
    expect(stepId(UPLOAD)).toBe('play_upload');
  });

  it('the bundle step declares the id the summary reads', () => {
    expect(stepId(BUNDLE)).toBe('bundle');
  });

  it('every steps.<id> the summary reads belongs to a step in this workflow', () => {
    const declared = new Set(
      [...workflow.matchAll(/^\s{8}id:\s*(\S+)\s*$/gm)].map((m) => m[1]),
    );
    const read = new Set([...SUMMARY.matchAll(/steps\.([A-Za-z0-9_-]+)\./g)].map((m) => m[1]));
    expect(read.size).toBeGreaterThan(0);
    for (const id of read) expect(declared, `summary reads steps.${id} — no step declares it`).toContain(id);
  });
});

describe('the upload itself stays possible', () => {
  it('the review flag is wired to an input, because Google flips which value it demands', () => {
    // It is a fact about the app's review state, not a setting we choose, and BOTH values have
    // already failed a real run in opposite directions: #127 (2026-09-22) died without it —
    // "Please set the query parameter changesNotSentForReview to true" — and #131 (2026-09-24)
    // died with it hardcoded true — "The query parameter changesNotSentForReview must not be set".
    // So what this pins is that the parameter is still SENT and still steerable, never a value.
    expect(step(UPLOAD)).toMatch(/^\s+changesNotSentForReview:\s*\$\{\{\s*inputs\.changes_not_sent_for_review\s*\}\}\s*$/m);
    expect(workflow).toMatch(/^\s{6}changes_not_sent_for_review:\s*$/m);
    // Default false — today's answer, and the one that needs no human to remember anything.
    expect(workflow.slice(workflow.indexOf('changes_not_sent_for_review:'))).toMatch(/type:\s*boolean\s*\n\s*default:\s*false/);
  });

  it('is still pinned to a full commit SHA, since it receives the Play service-account JSON', () => {
    expect(step(UPLOAD)).toMatch(/uses:\s*r0adkll\/upload-google-play@[0-9a-f]{40}\b/);
  });
});

/**
 * THE SIBLING, HUNTED (2026-09-24).
 *
 * The fixes above were made to `android-aab.yml` alone and the iOS workflow was never looked at —
 * the "instance fixed, class not" pattern this repo keeps paying for. `ios-ipa.yml` carried BOTH
 * defects, and the second one is worse there than it ever was on Android:
 *
 *   - its Summary had no `if: always()`, so a failed upload erased the note saying the .ipa exists;
 *   - its Summary asserted the upload from `inputs.upload` — and unlike Android's, the iOS upload
 *     step has **no `if:` guard at all**. It is named "Build, sign & upload", the upload lives
 *     inside the Fastfile behind `DO_UPLOAD`, so the step is GREEN whether or not anything was ever
 *     sent to Apple. Nothing in a finished run — not the step list, not the conclusion, not the
 *     artifacts — could distinguish "uploaded to TestFlight" from "built and kept on the runner".
 *
 * The admin asked exactly that question ("ipa/aab upload nhi hua??") and the honest answer was that
 * the run could not be made to say. The Fastfile now writes `uploaded=true` to `$GITHUB_OUTPUT`
 * only after `upload_to_testflight` returns, and the summary reads that. A fact, from the thing it
 * describes.
 */
describe('the iOS run can prove whether the binary reached TestFlight', () => {
  const ios = readFileSync(resolve(root, '.github/workflows/ios-ipa.yml'), 'utf8');
  const fastfile = readFileSync(resolve(root, 'fastlane/Fastfile'), 'utf8');

  function iosStep(name: string): string {
    const head = `      - name: ${name}\n`;
    const at = ios.indexOf(head);
    expect(at, `step "${name}" not found in ios-ipa.yml`).toBeGreaterThan(-1);
    const rest = ios.slice(at + head.length);
    const next = rest.indexOf('\n      - name: ');
    return next === -1 ? rest : rest.slice(0, next);
  }

  const IOS_SUMMARY = iosStep('Summary');
  const FASTLANE = 'Build, sign & upload to TestFlight (fastlane)';

  it('the summary survives a failed upload, so the .ipa is never reported as missing', () => {
    expect(IOS_SUMMARY).toMatch(/^\s+if:\s*always\(\)\s*$/m);
  });

  it('reports the upload from what the Fastfile recorded, never from the input that asked for it', () => {
    // The whole point: `inputs.upload` states an intention. `steps.fastlane.outputs.uploaded` is
    // written on one line that is only reachable after upload_to_testflight has returned.
    expect(IOS_SUMMARY).toContain('steps.fastlane.outputs.uploaded');
    expect(iosStep(FASTLANE)).toMatch(/^\s{8}id:\s*fastlane\s*$/m);
  });

  it('distinguishes the three real outcomes — delivered, asked for but not delivered, not asked', () => {
    expect(IOS_SUMMARY).toMatch(/\*\*Uploaded to App Store Connect/);
    expect(IOS_SUMMARY).toMatch(/Nothing was uploaded, although/);
    expect(IOS_SUMMARY).toMatch(/Not uploaded\*\* — \\`upload\\` was not ticked/);
  });

  it('does not claim an .ipa when the build/sign step did not succeed', () => {
    expect(IOS_SUMMARY).toMatch(/steps\.fastlane\.outcome.*!=.*success|!=\s*"success"/s);
    expect(IOS_SUMMARY).toContain('The .ipa was NOT built');
  });

  it('the Fastfile records the upload ONLY after upload_to_testflight returns', () => {
    const at = fastfile.indexOf('upload_to_testflight(opts)');
    expect(at, 'upload_to_testflight call not found').toBeGreaterThan(-1);
    const marker = fastfile.indexOf('uploaded=true');
    expect(marker, 'the Fastfile never records the upload').toBeGreaterThan(at);
    // And it must live inside the DO_UPLOAD branch — a record written unconditionally would be the
    // same lie in a new place.
    expect(fastfile.indexOf('DO_UPLOAD')).toBeLessThan(marker);
    expect(fastfile.slice(at, marker)).not.toContain('\n    end');
  });

  it('still waits for Apple to finish processing, so "uploaded" means available', () => {
    expect(fastfile).toMatch(/skip_waiting_for_build_processing:\s*false/);
  });
});
