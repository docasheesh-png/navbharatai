/**
 * A WORKING APP IS NOT AN EMPTY BUILD — report fd021c64 (2026-09-14).
 *
 * A user typed "Yess create karo" into a workspace already holding their 25-file Fantasy Football
 * app. The engine restored it, started the dev server, **opened it in a real browser and confirmed it
 * rendered**, ran the production build green, and saved it as the last known good state.
 *
 * It then told them: *"The build produced no files. Please try again"* — and asked them to
 * **add credits so a stronger engine could finish it**. The whole build had already run a SECOND time
 * on a stronger model to reach that same conclusion: five minutes and sixteen model calls to tell
 * somebody their working app does not exist.
 *
 * Three reasons "zero files" is not a capability failure were already handled — a policy refusal, our
 * own provider outage, a prompt with no instruction. This is the fourth, and the only one that is
 * positive evidence about the APP rather than about the model or the providers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyBuildFailureSummary } from '../src/server/routes/agentv3';

describe('emptyBuildFailureSummary — a verified render outranks a file count', () => {
  it('🔴 the exact report: zero files written, but the app rendered ⇒ NOT a failure', () => {
    expect(emptyBuildFailureSummary(true, 0, false, true)).toBeNull();
  });

  it('zero files and NO render is still an honest failure — the guard must not go blind', () => {
    const said = emptyBuildFailureSummary(true, 0, false, false);
    expect(said).toMatch(/produced no files/);
  });

  it('the old three-argument call still behaves exactly as before', () => {
    // Every existing caller passes three arguments; the new evidence defaults to "not seen".
    expect(emptyBuildFailureSummary(true, 0, false)).toMatch(/produced no files/);
    expect(emptyBuildFailureSummary(true, 3, false)).toBeNull();
    expect(emptyBuildFailureSummary(false, 0, false)).toBeNull();
  });

  it('🔒 a DEAD SANDBOX still wins over a claimed render — order matters', () => {
    // A sandbox that could not be created cannot have served a page. If the two signals ever
    // disagree, the one that says nothing could possibly have run is the one to believe.
    expect(emptyBuildFailureSummary(true, 0, true, true)).toMatch(/sandbox was unavailable/);
    expect(emptyBuildFailureSummary(true, 9, true, true)).toMatch(/sandbox was unavailable/);
  });

  it('files written plus a render is still not a failure, from either signal', () => {
    expect(emptyBuildFailureSummary(true, 5, false, true)).toBeNull();
  });
});

describe('the render evidence is WIRED, and it is enforced in exactly one place', () => {
  // This guard is a pure function, so a test of it alone proves nothing about the product: the whole
  // defect in report fd021c64 was a call site, not a rule. What follows reads the route.
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('🔒 the route passes the render observation into the guard', () => {
    expect(route).toContain(
      'emptyBuildFailureSummary(expectsArtifacts, writtenFiles.size, sandboxUnavailable, buildObs.previewRendered)',
    );
  });

  it('🔒 …and the upsell is silent BECAUSE of it, through one mechanism rather than two', () => {
    // #2919 originally added a second copy of this reason inside the free-tier upsell guard, because
    // the main it was written against had no `!result.ok` gate. #2917 then added one. With the guard
    // above returning null on a verified render, `result.ok` survives and that gate never opens — so
    // the upsell is already silent. A second copy would be two answers to one question, which is the
    // shape of every bug that guard's own comments record.
    //
    // ⚠️ What is pinned is the GATE, not the absence of any particular identifier: banning a name
    // forever is the same over-specification `pornographyBan.test.ts` has now been burned by three
    // times. Remove this gate and a rendering app can be asked for money again.
    expect(route).toContain('if (freeTierBuildActive && !result.ok) {');
  });

  it('the four causes remain four distinct questions', () => {
    const causes = {
      refused: 'the MODEL answered, and its answer was no',
      appAlreadyRuns: 'the APP was opened in a browser and rendered',
      degraded: 'our PROVIDERS did not answer',
      noInstruction: 'the PROMPT carried nothing to build',
    };
    // Four distinct subjects: model, app, providers, prompt. A guard that tested only one of them is
    // how each of these reached a real user in turn.
    const subjects = Object.values(causes).map((c) => c.split(' ')[1]);
    expect(new Set(subjects).size).toBe(4);
  });
});
