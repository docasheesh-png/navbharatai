// A FAILED BUILD NEVER REACHES THE USER'S BRANCH (admin 2026-10-11, Q-745 (c): "a failed build's files go to a
// separate `wip/` branch; the user's branch only receives work that ran").
//
// The end-of-turn push was gated on "files were written", never on the build having worked, while the
// comment beside it promised "GitHub push still happens only after 100% completion". So a failed turn's
// half-done edits were pushed onto the user's own branch. THE CLASS: a write to the user's real branch decided
// by activity instead of outcome. One decision now covers all three storage modes (own repo, PR flow, copy).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gitPushTarget, wipBranchName, wipPushNote } from '../src/server/AgentV3/gitPushTarget';

const T = Date.parse('2026-10-11T14:05:09Z');

describe('the decision', () => {
  it('🔒 a build that did not work goes to its own wip/ branch; one that worked goes where it always did', () => {
    expect(gitPushTarget({ buildOk: false, successBranch: 'main', nowMs: T })).toEqual({ branch: 'wip/build-20261011-140509', wip: true });
    expect(gitPushTarget({ buildOk: false, successBranch: 'navbharatai/work', nowMs: T }).branch).toMatch(/^wip\//);
    expect(gitPushTarget({ buildOk: true, successBranch: 'navbharatai/work', nowMs: T })).toEqual({ branch: 'navbharatai/work', wip: false });
  });

  it('two failed builds never overwrite each other', () => {
    expect(wipBranchName(T)).not.toBe(wipBranchName(T + 1000));
  });

  it('the user is told where the files went, and that their branch was left alone', () => {
    const note = wipPushNote('wip/build-20261011-140509', 'main');
    expect(note).toContain('wip/build-20261011-140509');
    expect(note).toContain('only receives work that ran');
    expect(note).toContain('Nothing was lost');
  });
});

describe('🔒 the push block asks it before touching any branch', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const block = route.slice(route.indexOf('// GIT-NATIVE PUSH: when storage is active'), route.indexOf('// P9 — new-user free onboarding builds'));

  it('the outcome decides, and the wip push comes first', () => {
    expect(block).toContain('gitPushTarget({ buildOk: result.ok === true, successBranch: userBranch, nowMs: Date.now() })');
    const pushes = [...block.matchAll(/repoSync\.pushAll\(repoAuthedUrl, ([^,]+),/g)].map((m) => m[1]);
    expect(pushes[0]).toBe('pushTarget.branch');
    // every other push — the user's working branch, the PR branch, the copy's branch — is in an `else`
    expect(block.indexOf('} else if (ownRepoTarget && prClient) {')).toBeGreaterThan(block.indexOf('if (pushTarget.wip) {'));
    expect(pushes.length).toBe(4);
  });

  it('the promise that was false is gone', () => {
    expect(route).not.toContain('GitHub push still happens only after 100% completion');
  });
});
