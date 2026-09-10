// WHERE "PUT THIS APP IN MY GITHUB" MAY PUSH — and the one place it must never force-push.
// (admin 2026-09-07, while tracing why that button failed on an app that was "already on GitHub".)
//
// 🔴 THE HAZARD. The push-app route does `ensureRepo(name)` — get-or-create — and then
// `GitRepoSync.pushAll`, which is a `git push --force` of the sandbox onto the repository's DEFAULT
// branch. Force is correct for a repository NavBharatAI created: it is a private, single-writer mirror
// whose only prior commit is GitHub's auto-init. It is catastrophic for a repository the USER created:
// their default branch holds their history, and a force-push replaces it with whatever the sandbox
// holds, with no way back.
//
// `ensureRepo` cannot tell the two apart by name — a user's real repository and the name NavBharatAI
// would derive can coincide (a rename to the app's own name, a repository named like the app before
// the import). So the decision is made HERE, from evidence, before a single byte is pushed:
//
//   • `created`            — this very call created it            → push its default branch (empty before us)
//   • our description      — NavBharatAI created it on an earlier turn (every mirror it makes carries
//                            PLATFORM_REPO_DESCRIPTION; the build path already force-pushes these on
//                            every build, so this is the established behaviour, not a new liberty)
//                                                                  → push its default branch
//   • anything else        — somebody else's history lives there   → push ONLY the working branch
//                            (`navbharatai/work`, the same branch own-repo builds use), leave the
//                            default branch exactly as it was, and say so.
//
// A user who edits our description off a mirror falls into the third case — the safe direction: the
// default branch keeps whatever the build path last pushed, and the app is still saved and deployable.
//
// PURE — repository facts in, branch decision out. Tested in tests/pushAppTarget.test.ts.

import { PLATFORM_REPO_DESCRIPTION } from './GitHubAppClient';
import { WORK_BRANCH } from './GitStorageTarget';

export type PushAppMode = 'created' | 'platform-mirror' | 'foreign-repo';

export interface PushBranchDecision {
  /** The branch to push to — and, because it is the branch that now holds THIS app, the deploy branch. */
  branch: string;
  mode: PushAppMode;
  /** True when the push replaces the repository's default branch. Never true for a foreign repository. */
  overwritesDefault: boolean;
}

export function decidePushBranch(repo: {
  created: boolean;
  description?: string | null;
  defaultBranch?: string | null;
}): PushBranchDecision {
  const def = (repo.defaultBranch || 'main').trim() || 'main';
  if (repo.created) return { branch: def, mode: 'created', overwritesDefault: true };
  if ((repo.description ?? '').trim() === PLATFORM_REPO_DESCRIPTION) {
    return { branch: def, mode: 'platform-mirror', overwritesDefault: true };
  }
  return { branch: WORK_BRANCH, mode: 'foreign-repo', overwritesDefault: false };
}
