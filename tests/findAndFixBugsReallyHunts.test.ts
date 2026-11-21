// "FIND AND FIX BUGS" REALLY HUNTS (admin 2026-11-21: "find and fix the bugs par click karne se sach me bugs dhund ke fix
// kiye jaye!").
//
// 🧬 THE CLASS: a user-pressed action reused a pass built for something else — the post-build review reads only this turn's
// edits, is suggest-only on a working app, and does not run when nothing was written. The button now (1) hands the builder a
// hunting method over the whole app, (2) reviews the whole app even when nothing changed, (3) at full strength, with the
// verified repair acting on what it finds. Ordinary builds are byte-identical.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withBugHuntBrief, BUG_HUNT_TURN_BRIEF, bugHuntReviewScope, BUG_HUNT_REVIEW_MAX_FILES } from '../src/server/AgentV3/optionalBugHunt';
import { greenReviewPlan } from '../src/server/AgentV3/greenReviewPolicy';
import { reviewerShouldRun } from '../src/server/routes/agentv3';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

describe('1. the builder is told to hunt — only when the user pressed the button', () => {
  it('the brief comes first and names the method; an ordinary prompt is untouched', () => {
    const p = withBugHuntBrief('Find and fix the bugs in my app.', true);
    expect(p.startsWith(BUG_HUNT_TURN_BRIEF)).toBe(true);
    expect(BUG_HUNT_TURN_BRIEF).toMatch(/READ every source file/);
    expect(BUG_HUNT_TURN_BRIEF).toMatch(/typecheck/);
    expect(BUG_HUNT_TURN_BRIEF).toMatch(/Change NOTHING that is not a bug/);
    expect(BUG_HUNT_TURN_BRIEF).toMatch(/never invent one/);
    expect(withBugHuntBrief('add a login page', false)).toBe('add a login page');
    expect(route).toContain('let buildPrompt = withBugHuntBrief(prompt, bugHuntAskedByUser);');
  });
});

describe('2. the review reads the whole app on a hunt, and runs even when nothing was changed', () => {
  const all = ['src/App.tsx', 'src/game/features/police.ts', 'src/game/Game.ts', 'node_modules/x/index.js', 'dist/a.js', 'package-lock.json', 'src/App.test.tsx', 'src/vite-env.d.ts', 'public/logo.png'];
  const kit = (p: string) => p === 'src/game/Game.ts';
  it('whole app\'s own source, this turn\'s edits first; never dependencies, output, tests, typings or the kit engine', () => {
    expect(bugHuntReviewScope({ askedByUser: true, allFiles: all, changed: () => ['src/game/features/police.ts'], isKitFile: kit }))
      .toEqual(['src/game/features/police.ts', 'src/App.tsx']);
  });
  it('an ordinary review still reads exactly this turn\'s changes', () => {
    expect(bugHuntReviewScope({ askedByUser: false, allFiles: all, changed: () => ['src/App.tsx'], isKitFile: kit })).toEqual(['src/App.tsx']);
  });
  it('a big app is capped, so the review stays bounded', () => {
    const many = Array.from({ length: 300 }, (_, i) => `src/f${i}.ts`);
    expect(bugHuntReviewScope({ askedByUser: true, allFiles: many, changed: () => [] })).toHaveLength(BUG_HUNT_REVIEW_MAX_FILES);
  });
  it('the route: the review runs on a hunt with no writes and in the fast lane, over the whole-app scope', () => {
    expect(route).toContain('wroteFiles: writtenFiles.size > 0 || bugHuntAskedByUser,');
    expect(route).toContain("reviewFastlaneForced: envFlag('AGENTV3_REVIEW_FASTLANE') || bugHuntAskedByUser,");
    expect(route).toMatch(/const reviewChanged = bugHuntReviewScope\(\{ askedByUser: bugHuntAskedByUser, allFiles: rFiles,/);
    expect(reviewerShouldRun({ wroteFiles: true, isImportTurn: false, fastLaneGated: true, reviewFastlaneForced: true, startTierSonnet: false })).toBe(true);
    // An import/survey turn never gets it, hunt or not.
    expect(reviewerShouldRun({ wroteFiles: true, isImportTurn: true, fastLaneGated: false, reviewFastlaneForced: true, startTierSonnet: false })).toBe(false);
  });
});

describe('3. full strength on a hunt — lean only for the unasked review of a working app', () => {
  it('a working app\'s review is lean unless the user asked to fix', () => {
    expect(greenReviewPlan({ previewGreen: true, buildOk: true, env: {} }).mode).toBe('suggest');
    expect(greenReviewPlan({ previewGreen: true, buildOk: true, userAskedToFix: true, env: {} })).toEqual({ mode: 'full', maxSteps: undefined });
    expect(route).toContain('greenReviewPlan({ previewGreen, previewProvenBroken, buildOk: result.ok, userAskedToFix: bugHuntAskedByUser })');
  });
});
