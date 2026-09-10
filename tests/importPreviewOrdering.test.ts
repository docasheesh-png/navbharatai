import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * AN IMPORT'S PREVIEW MUST LAND BEFORE ANYTHING JUDGES IT — build report faa98da9, 2026-09-03.
 *
 * A zip/GitHub import boots its dev server in the BACKGROUND so the model can work while npm installs.
 * That concurrency is the feature. The defect was purely one of ORDER: the promise was awaited only in
 * the `finally` block, ~2,700 lines below the post-build checks, and every one of those checks is gated
 * on `lastPreviewUrl`. So on the import path they did not lose a race — there was never a race to win.
 *
 * What one report cost: render check, route smoke, page check and journey all skipped; `RELEASE_GATE`
 * said "no live preview was ever available" 7.5 SECONDS BEFORE `PREVIEW_PUBLISHED` recorded that exact
 * address serving; and the recap told the user "The live preview didn't start automatically". The app
 * was fine. Three false statements from one ordering mistake.
 *
 * WHY THIS IS PINNED AT SOURCE LEVEL, honestly: the code sits inside a ~16,000-line route closure that
 * cannot be imported or exercised in a unit test, and extracting the whole build path to test one await
 * would be a far larger change than the await protects. More to the point, THE REGRESSION IS SILENT —
 * moving or deleting that await throws nothing, fails no build, and produces exactly the report above:
 * a healthy app described as unproven. A weaker check than execution, chosen over no check at all.
 */
const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

/** Every occurrence of the bounded wait on the import's background boot. */
const awaitSites = [...route.matchAll(/await raceTimeout\(importPreviewBoot,/g)].map((m) => m.index ?? -1);
/** The first post-build check that cannot run without a preview URL. */
const firstPreviewGatedCheck = route.indexOf('process.env.AGENTV3_RENDER_RESCUE !==');
/** The verdict that told the user their working preview never existed. */
const releaseGate = route.indexOf('gateEvidence.previewUrlPublished = Boolean(lastPreviewUrl)');
/** The recap line that claimed the preview had not started. */
const recapSummary = route.indexOf('const summaryText = summarizeProject(');

describe('the import preview boot is awaited BEFORE anything reports on it (report faa98da9)', () => {
  it('the anchors this test reasons about all still exist', () => {
    // Guards the test itself: a refactor that renames these must fail loudly here rather than let the
    // ordering assertions below silently pass on -1 < -1 arithmetic.
    expect(awaitSites.length).toBeGreaterThan(0);
    expect(firstPreviewGatedCheck).toBeGreaterThan(0);
    expect(releaseGate).toBeGreaterThan(0);
    expect(recapSummary).toBeGreaterThan(0);
  });

  it('is awaited before the FIRST preview-gated runtime check', () => {
    expect(Math.min(...awaitSites)).toBeLessThan(firstPreviewGatedCheck);
  });

  it('is awaited before the release gate reads whether a preview URL was ever published', () => {
    // This is the assertion that maps 1:1 to the false sentence in the report.
    expect(Math.min(...awaitSites)).toBeLessThan(releaseGate);
  });

  it('is awaited before the user-facing recap decides whether to say the preview is live', () => {
    expect(Math.min(...awaitSites)).toBeLessThan(recapSummary);
  });

  it('KEEPS the finally-block wait as a net for a build that throws before the main path', () => {
    // The early await is the primary wait; it must not have REPLACED the one that guarantees npm
    // install is not killed by Cloud Run's post-stream CPU throttle on an aborted or failed build.
    expect(awaitSites.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...awaitSites)).toBeGreaterThan(recapSummary);
  });
});
