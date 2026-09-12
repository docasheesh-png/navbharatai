// "PUT THIS APP IN MY GITHUB" — what the screen says about the outcome, from the server's own facts.
// (admin 2026-09-07, screenshot: the button reported "nothing was changed" over a push that landed.)
//
// PURE — every line here is derived from data the server returned or from a durable record it wrote,
// never from what the screen assumes happened. Tested in tests/pushAppFeedback.test.ts.

import type { FailureWording } from '../../lib/longRequest';

/** The push-app route's success payload (see POST /api/agentv3/github/push-app). */
export interface PushAppResult {
  fullName?: string;
  owner?: string;
  repo?: string;
  /** The branch the app was actually pushed to. */
  pushedBranch?: string;
  /** The repository's own default branch — untouched when it differs from `pushedBranch`. */
  defaultBranch?: string;
  /** How the server decided where to push (see server/AgentV3/pushAppTarget.ts). */
  mode?: 'created' | 'platform-mirror' | 'foreign-repo';
}

/**
 * The line to show once the push has landed.
 *
 * 🔒 WHEN THE REPOSITORY WAS THE USER'S OWN, SAY WHICH BRANCH — because their default branch was
 * deliberately NOT overwritten, and a user who reads "Saved to owner/repo" would otherwise look at
 * that branch, see their old code, and conclude the save failed.
 */
export function pushSavedLine(d: PushAppResult | null | undefined): string {
  const name = (d?.fullName || `${d?.owner ?? ''}/${d?.repo ?? ''}`).trim();
  if (d?.mode === 'foreign-repo' && d.pushedBranch) {
    const def = (d.defaultBranch || 'main').trim() || 'main';
    return `Saved to ${name} on the "${d.pushedBranch}" branch. Your "${def}" branch was not touched — it `
      + `holds your own history. Deploys build from "${d.pushedBranch}", so what you see here is what goes live.`;
  }
  return `Saved to ${name}. You can deploy the backend now.`;
}

/**
 * The durable repo fact from GET /api/agentv3/conversations/:id, or null.
 *
 * Read while the screen waits out a push that outlived its request: the route records the repo the
 * moment the push lands, so the record — not the lost response — is what proves it. The same fields
 * `deployRepoMemory.ts` requires on the server, so what counts as "a repo" cannot drift.
 *
 * ⚠️ `deployRepoName` FIRST, `repoName` only as the fallback — the same order as the server's
 * `deployRepoNameOf` (2026-09-12). The two are different repositories for an app imported from the
 * user's own GitHub, and this function wants the one a deploy can use.
 */
export function repoFactOf(payload: unknown): { owner: string; repo: string } | null {
  const conv = (payload as { conversation?: unknown } | null | undefined)?.conversation as
    { repoOwnedByUser?: unknown; repoOwner?: unknown; repoName?: unknown; deployRepoName?: unknown } | null | undefined;
  if (!conv || conv.repoOwnedByUser !== true) return null;
  const owner = typeof conv.repoOwner === 'string' ? conv.repoOwner.trim() : '';
  const deployName = typeof conv.deployRepoName === 'string' ? conv.deployRepoName.trim() : '';
  const storageName = typeof conv.repoName === 'string' ? conv.repoName.trim() : '';
  const repo = deployName || storageName;
  return owner && repo ? { owner, repo } : null;
}

export const PUSH_APP_FAILURE: FailureWording = {
  notStarted: 'Could not reach NavBharatAI — nothing was changed.',
  stillRunning: 'Still saving to GitHub — a large app can take a few minutes, and the save carries on even '
    + 'though this screen stopped waiting. Nothing is lost. We will keep checking and show the repository '
    + 'here the moment it is there.',
};

/** Shown when the post-timeout check ran out of time without seeing the repository land. */
export const PUSH_APP_UNCONFIRMED_LINE =
  'We could not confirm the save within three minutes. Reopen this screen — if the repository is shown, '
  + 'it worked; if not, press the button again.';

export const DEPLOY_BACKEND_FAILURE: FailureWording = {
  notStarted: 'Could not reach NavBharatAI — nothing was deployed.',
  stillRunning: 'The deploy request is taking longer than expected and may still complete on your host. '
    + 'Wait a minute, then open your host\'s dashboard or press Deploy backend again — a repeat deploy of '
    + 'the same service is safe.',
};

export const PROVISION_DB_FAILURE: FailureWording = {
  notStarted: 'Could not reach NavBharatAI. Check your connection and try again.',
  stillRunning: 'Your database is still being created — this can take a couple of minutes. Reopen this '
    + 'screen in a minute; if it shows as connected, it worked. Only create it again if it does not.',
};
