/**
 * 🧬 THE PLATFORM SAYS ONLY WHAT IT CHECKED (build report 9c612cdb — Q-1024, Q-1032, Q-1034).
 *
 * Three rows, one class: a sentence shown to a user that states something the code never established.
 *
 *   Q-1024  The live tick said "your app is built — running the final checks" on a STOPPED or EMPTY
 *           build. `finalChecks` is only a PHASE flag (the builder's loop is over), which is equally
 *           true of a build that wrote nothing.
 *   Q-1032  The starter-test skip said "vitest is not declared in package.json" for a project with NO
 *           package.json — a sentence about a file that does not exist.
 *   Q-1034  `AppKnowledgeBase` named an internal build id ("build 9c612cdb") in text every AI reads
 *           and may repeat to a user.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { finalChecksEtaLine, etaPhaseLine } from '../src/server/AgentV3/progressEta';
import {
  starterTestsSkipReason, STARTER_TESTS_NEED_VITEST,
  STARTER_TESTS_NO_PACKAGE_JSON, STARTER_TESTS_PACKAGE_JSON_UNREADABLE,
} from '../src/server/AgentV3/starterTestsSkip';

const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');
const BUILT = /your app is built/;

describe('Q-1024 — "your app is built" needs a built app', () => {
  it('the phase line alone never claims it: a stopped or empty build is told only the phase', () => {
    const line = etaPhaseLine({ elapsedMs: 300_000, finalChecks: true, appRenderedAt: 0 });
    expect(line).toMatch(/running the final checks/);
    expect(line).not.toMatch(BUILT);
  });

  it('files written OR a rendered app earns the claim — either fact is enough', () => {
    expect(etaPhaseLine({ elapsedMs: 300_000, finalChecks: true, appRenderedAt: 0, appExists: true })).toMatch(BUILT);
    expect(etaPhaseLine({ elapsedMs: 300_000, finalChecks: true, appRenderedAt: 1_700_000_000_000 })).toMatch(BUILT);
  });

  it('`appExists: false` is not merely unknown — it is a denial, and it is honoured', () => {
    expect(etaPhaseLine({ elapsedMs: 300_000, finalChecks: true, appRenderedAt: 0, appExists: false })).not.toMatch(BUILT);
  });

  it('the sentence itself defaults to claiming NOTHING, so a new caller cannot leak the claim', () => {
    expect(finalChecksEtaLine(300_000)).not.toMatch(BUILT);
    expect(finalChecksEtaLine(300_000, false)).not.toMatch(BUILT);
    expect(finalChecksEtaLine(300_000, true)).toMatch(BUILT);
    // Both forms still report the phase and the elapsed time — the fix removes a claim, not the line.
    for (const l of [finalChecksEtaLine(300_000), finalChecksEtaLine(300_000, true)]) {
      expect(l).toMatch(/running the final checks/);
      expect(l).toMatch(/5 min in/); // the elapsed time is kept, exactly as formatEta writes it
    }
  });

  it('the claim needs at least as much evidence as the WEAKER one beside it', () => {
    // `appRunningEtaLine` demands a real `appRenderedAt` to say "running in the preview". The stronger
    // claim "your app is built" must not be reachable on less, which is exactly what `finalChecks`
    // alone was.
    const weakerWithoutEvidence = etaPhaseLine({ elapsedMs: 300_000, finalChecks: false, appRenderedAt: 0 });
    expect(weakerWithoutEvidence).toBeNull();
    expect(etaPhaseLine({ elapsedMs: 300_000, finalChecks: true, appRenderedAt: 0 })).not.toMatch(BUILT);
  });

  it('BOTH route callers pass the fact — a rule enforced at one of two sites is not enforced', () => {
    const route = read('src/server/routes/agentv3.ts');
    // The transition emitter: the builder's own file count, handed in (it runs before `builderWroteCount` exists).
    expect(route).toContain('appExists: (only?.wrote?.() ?? 0) > 0 });');
    // The two-minute heartbeat: the one that had NO guard at all, which is this row's defect.
    expect(route).toContain('appExists: etaFilesDone > 0,');
    // And the announcement's own guard is still there — this fix adds a net, it does not replace one.
    expect(route).toContain('if (only && (only.unlessStopped.aborted || only.wrote() <= 0)) return;');
  });
});

describe('Q-1032 — a reason names something that exists', () => {
  it('no package.json, unreadable package.json and no vitest are three different sentences', () => {
    const base = { skeletonsSafe: false, planned: 0, written: 0 };
    expect(starterTestsSkipReason({ ...base, packageJson: null })).toBe(STARTER_TESTS_NO_PACKAGE_JSON);
    expect(starterTestsSkipReason({ ...base, packageJson: undefined })).toBe(STARTER_TESTS_NO_PACKAGE_JSON);
    expect(starterTestsSkipReason({ ...base, packageJson: '' })).toBe(STARTER_TESTS_NO_PACKAGE_JSON);
    expect(starterTestsSkipReason({ ...base, packageJson: '{ not json' })).toBe(STARTER_TESTS_PACKAGE_JSON_UNREADABLE);
    expect(starterTestsSkipReason({ ...base, packageJson: '{"name":"a"}' })).toBe(STARTER_TESTS_NEED_VITEST);
    expect(new Set([STARTER_TESTS_NO_PACKAGE_JSON, STARTER_TESTS_PACKAGE_JSON_UNREADABLE, STARTER_TESTS_NEED_VITEST]).size).toBe(3);
  });

  it('the no-package.json reason does not send a reader to edit a file that is not there', () => {
    expect(STARTER_TESTS_NO_PACKAGE_JSON).not.toMatch(/not declared in package\.json/);
    expect(STARTER_TESTS_NO_PACKAGE_JSON).toMatch(/no package\.json/i);
    // The vitest reason is unchanged — it was always true of exactly its own case.
    expect(STARTER_TESTS_NEED_VITEST).toBe('vitest is not declared in package.json');
  });

  it('a pass that WROTE something still explains nothing, whatever the package.json', () => {
    for (const packageJson of [null, '{ not json', '{"devDependencies":{"vitest":"1"}}']) {
      expect(starterTestsSkipReason({ packageJson, skeletonsSafe: true, planned: 2, written: 2 })).toBeNull();
    }
  });
});

describe('Q-1034 — the knowledge every AI reads names nothing internal', () => {
  const src = read('src/server/AppContext/AppKnowledgeBase.ts');
  /** Comments are the audit trail and are deliberately not swept (CLAUDE.md); the TEXT is. */
  const text = src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('no internal build / autopsy / report id survives in text an AI can repeat', () => {
    const found = text.match(/\b(?:build|autopsy|report)\s+[0-9a-f]{8}\b/g) ?? [];
    expect(found, `AppKnowledgeBase text names internal id(s): ${found.join(', ')}`).toEqual([]);
  });

  it('the census really reached the file, so it cannot pass vacuously', () => {
    expect(text.length).toBeGreaterThan(50_000);
    expect(text).toContain('QUALITY DEFAULTS');
    // The audit trail in the COMMENTS is untouched — the sweep is scoped, not blind.
    expect(src.match(/\b(?:build|autopsy|report)\s+[0-9a-f]{8}\b/g) ?? []).not.toEqual([]);
  });

  it('and the tests sentence now tells the user where THEIR own reason is', () => {
    expect(text).toContain('⋮ More → Report');
  });
});
